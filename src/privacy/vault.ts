import type { Presentation } from "../core/disclose.js";
import {
  readForPurpose,
  useCredential,
  type SecretUseOptions,
  type VaultReadRequest,
  type VaultStore,
} from "../store/vault.js";
import {
  PrivacyRuntime,
  type PrivacyGateRequest,
  type PrivacyGateResult,
} from "./runtime.js";
import { PrivacyOutcomeUnknownError } from "./errors.js";
import { canonicalize, sha256Hex } from "../core/canonical.js";

function deny(result: Exclude<PrivacyGateResult, { allow: true }>): never {
  throw new Error(
    result.publicReason === "authority-denied"
      ? "authority denied"
      : "privacy denied"
  );
}

function requireDisclosureBinding(
  gate: PrivacyGateRequest,
  disclosure: VaultReadRequest
): PrivacyGateRequest {
  if (
    gate.authority !== disclosure.authority ||
    gate.operation.action.name !== "/disclose" ||
    gate.operation.resource.type !== disclosure.resource.type ||
    gate.operation.resource.id !== disclosure.resource.id ||
    gate.operation.purpose !== disclosure.purpose ||
    gate.ingress.id !== disclosure.ingress.id ||
    gate.ingress.principal !== disclosure.ingress.principal
  ) {
    throw new Error(
      "privacy vault: disclosure gate does not match vault request"
    );
  }
  const ctx = gate.operation.context;
  const claims = ctx["claims"];
  const verifier = ctx["verifier"];
  if (
    !Array.isArray(claims) ||
    claims.length !== disclosure.requested.length ||
    claims.some((v, i) => v !== disclosure.requested[i]) ||
    verifier !== disclosure.verifier
  ) {
    throw new Error(
      "privacy vault: disclosure terms differ from authorized operation"
    );
  }
  const recipient = gate.processing.recipients.find(
    (item) => item.id === disclosure.verifier
  );
  if (recipient === undefined) {
    throw new Error("privacy denied");
  }
  return {
    ...gate,
    processing: {
      ...gate.processing,
      dataCategories: [...disclosure.requested],
      recipients: [{ ...recipient }],
    },
  };
}

export async function discloseWithPrivacy(opts: {
  readonly runtime: PrivacyRuntime;
  readonly gate: PrivacyGateRequest;
  readonly vault: VaultStore;
  readonly disclosure: VaultReadRequest;
  readonly onAuthorityConsumed: (
    authority: VaultReadRequest["authority"]
  ) => void | Promise<void>;
}): Promise<Presentation> {
  const gate = requireDisclosureBinding(opts.gate, opts.disclosure);
  const first = opts.runtime.preflight(gate);
  if (!first.allow) deny(first);

  let live: Extract<PrivacyGateResult, { allow: true }>;
  try {
    live = opts.runtime.recheck(first, gate);
  } catch {
    throw new Error("privacy denied");
  }

  // Verifier nonces are arbitrary strings. Hash domain-separated so the
  // event attempt reference stays a bounded opaque identifier.
  const attemptRef = sha256Hex(
    canonicalize({
      kind: "privacy-disclosure-attempt",
      nonce: opts.disclosure.nonce,
    })
  );
  const event = opts.runtime.prepareEvent(live, gate, attemptRef);
  let presentation: Presentation;
  try {
    presentation = readForPurpose(opts.vault, opts.disclosure);
    await opts.onAuthorityConsumed(opts.disclosure.authority);
  } catch (error) {
    // The presentation has not been returned to the caller and authority
    // persistence failed before delivery, so this is still a provable
    // pre-effect failure. Never mask the original failure.
    try {
      opts.runtime.finalizeEvent(event.eventId, "FAILED_FINAL", {
        finalizedAt: opts.disclosure.nowSec,
      });
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
  try {
    opts.runtime.finalizeEvent(event.eventId, "SUCCEEDED", {
      finalizedAt: opts.disclosure.nowSec,
      evidenceRef: `presentation:${live.termsDigest.slice(0, 16)}`,
    });
  } catch (error) {
    // The presentation was built and authority was consumed; only the
    // evidence finalization failed. Do not report this as a denial.
    throw new PrivacyOutcomeUnknownError(error);
  }
  return presentation;
}

function requireSecretBinding(
  gate: PrivacyGateRequest,
  vault: VaultStore,
  secret: SecretUseOptions
): PrivacyGateRequest {
  const meta = vault
    .listMetadata(secret.ingress.principal)
    .find((item) => item.id === secret.recordId);
  if (meta === undefined) throw new Error("vault: unknown record");
  if (
    gate.authority !== secret.authority ||
    gate.operation.action.name !== "/use" ||
    gate.operation.resource.type !== "vault-record" ||
    gate.operation.resource.id !== secret.recordId ||
    gate.operation.purpose !== secret.purpose ||
    gate.operation.context["claim"] !== meta.type ||
    gate.ingress.id !== secret.ingress.id ||
    gate.ingress.principal !== secret.ingress.principal
  ) {
    throw new Error("privacy vault: secret gate does not match vault use");
  }
  return {
    ...gate,
    processing: {
      ...gate.processing,
      dataCategories: [meta.type],
    },
  };
}

export async function useCredentialWithPrivacy(opts: {
  readonly runtime: PrivacyRuntime;
  readonly gate: PrivacyGateRequest;
  readonly vault: VaultStore;
  readonly secret: SecretUseOptions;
  /** Stable retry id; omit for a new, distinct protected use. */
  readonly attemptRef?: string;
}): Promise<Awaited<ReturnType<typeof useCredential>>> {
  // Authority must reject an unauthorised request BEFORE vault metadata is
  // inspected; otherwise "unknown record" becomes an existence oracle.
  const authorityFirst = opts.runtime.preflight(opts.gate);
  if (!authorityFirst.allow) deny(authorityFirst);
  let gate: PrivacyGateRequest;
  try {
    gate = requireSecretBinding(opts.gate, opts.vault, opts.secret);
  } catch {
    // Do not reveal existence of a Vault record to agent callers.
    throw new Error("privacy denied");
  }
  const first = opts.runtime.preflight(gate);
  if (!first.allow) deny(first);

  let live: Extract<PrivacyGateResult, { allow: true }>;
  try {
    live = opts.runtime.recheck(first, gate);
  } catch {
    throw new Error("privacy denied");
  }

  const event = opts.runtime.prepareEvent(live, gate, opts.attemptRef);
  let effectStarted = false;
  const secret: SecretUseOptions = {
    ...opts.secret,
    use: async (instruction) => {
      effectStarted = true;
      return opts.secret.use(instruction);
    },
  };
  let result: Awaited<ReturnType<typeof useCredential>>;
  try {
    result = await useCredential(opts.vault, secret);
  } catch (error) {
    // Before the callback starts, no secret was released and no external
    // effect can have happened. Once it starts, preserve ambiguity.
    try {
      opts.runtime.finalizeEvent(
        event.eventId,
        effectStarted ? "OUTCOME_UNKNOWN" : "FAILED_FINAL",
        { finalizedAt: opts.secret.nowSec }
      );
    } catch {
      // Preserve the original failure.
    }
    if (effectStarted) throw new PrivacyOutcomeUnknownError(error);
    throw error;
  }
  try {
    opts.runtime.finalizeEvent(event.eventId, "SUCCEEDED", {
      finalizedAt: opts.secret.nowSec,
      evidenceRef: `protected-use:${result.receipt}`,
    });
  } catch (error) {
    // The secret was released to the in-host callback; only evidence
    // finalization failed. Callers must reconcile, not report a denial.
    throw new PrivacyOutcomeUnknownError(error);
  }
  return result;
}
