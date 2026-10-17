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

function deny(result: Exclude<PrivacyGateResult, { allow: true }>): never {
  throw new Error(result.publicReason === "authority-denied" ? "authority denied" : "privacy denied");
}

function requireDisclosureBinding(
  gate: PrivacyGateRequest,
  disclosure: VaultReadRequest
): PrivacyGateRequest {
  if (
    gate.operation.action.name !== "/disclose" ||
    gate.operation.resource.type !== disclosure.resource.type ||
    gate.operation.resource.id !== disclosure.resource.id ||
    gate.operation.purpose !== disclosure.purpose ||
    gate.ingress.id !== disclosure.ingress.id ||
    gate.ingress.principal !== disclosure.ingress.principal
  ) {
    throw new Error("privacy vault: disclosure gate does not match vault request");
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
    throw new Error("privacy vault: disclosure terms differ from authorized operation");
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

  const event = opts.runtime.prepareEvent(live, gate);
  try {
    const presentation = readForPurpose(opts.vault, opts.disclosure);
    await opts.onAuthorityConsumed(opts.disclosure.authority);
    opts.runtime.finalizeEvent(event.eventId, "SUCCEEDED", {
      finalizedAt: opts.disclosure.nowSec,
      evidenceRef: `presentation:${live.termsDigest.slice(0, 16)}`,
    });
    return presentation;
  } catch (error) {
    opts.runtime.finalizeEvent(event.eventId, "FAILED_FINAL", {
      finalizedAt: opts.disclosure.nowSec,
    });
    throw error;
  }
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
}): Promise<Awaited<ReturnType<typeof useCredential>>> {
  const gate = requireSecretBinding(opts.gate, opts.vault, opts.secret);
  const first = opts.runtime.preflight(gate);
  if (!first.allow) deny(first);

  let live: Extract<PrivacyGateResult, { allow: true }>;
  try {
    live = opts.runtime.recheck(first, gate);
  } catch {
    throw new Error("privacy denied");
  }

  const event = opts.runtime.prepareEvent(live, gate);
  try {
    const result = await useCredential(opts.vault, opts.secret);
    opts.runtime.finalizeEvent(event.eventId, "SUCCEEDED", {
      finalizedAt: opts.secret.nowSec,
      evidenceRef: `protected-use:${live.termsDigest.slice(0, 16)}`,
    });
    return result;
  } catch (error) {
    // Once protected use starts, an external callback may have taken effect
    // before throwing. Preserve ambiguity rather than claiming final failure.
    opts.runtime.finalizeEvent(event.eventId, "OUTCOME_UNKNOWN", {
      finalizedAt: opts.secret.nowSec,
    });
    throw error;
  }
}
