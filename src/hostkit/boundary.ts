import { randomUUID } from "node:crypto";
import {
  digestForOperation,
  type Authority,
  type AuthorityOperation,
  type VerifiedIdentity,
} from "../core/authority.js";
import { canonicalize } from "../core/canonical.js";
import type { ExecutionReceipt } from "../core/execute.js";
import type { Redemption } from "../core/types.js";
import {
  executeWithJournal,
  type ProtectedProvider,
} from "../adapters/providers.js";
import {
  PrivacyEventConflictError,
  PrivacyOutcomeUnknownError,
  PrivacyPreEffectError,
} from "../privacy/errors.js";
import type { PrivacyGateRequest, PrivacyRuntime } from "../privacy/runtime.js";
import { saveAuthority } from "../store/files.js";

/**
 * The host effect boundary (ADR-0025).
 *
 * A host adopts the ordering once, here, and every effect it performs is
 * then enforced and evidenced. The boundary is a library, not an
 * interceptor: a host that does not route its effects through it is
 * uncovered, not compliant.
 *
 * The nine steps, in order:
 *
 *  1. terms binding   - the effect context deep-equals the authorized one;
 *  2. authority       - a non-consuming decision, before any privacy read;
 *  3. privacy preflight - the configured processing controls;
 *  4. privacy recheck - the live privacy state, re-read;
 *  5. evidence precommit - a durable, secret-free Processing Event;
 *  6. authority consume + durable CAS - the use is burned and persisted;
 *  7. privacy fence   - the effect boundary re-reads the privacy state;
 *  8. effect          - the journaled provider call or the host callback;
 *  9. evidence finalize - SUCCEEDED / FAILED_FINAL / OUTCOME_UNKNOWN.
 */

/** The coarse reasons a dry run can refuse. */
export type HostEffectDenialReason =
  "authority-denied" | "privacy-denied" | "terms-mismatch";

/**
 * The dry-run decision. It carries no effect, no event and no consumption:
 * a `check()` result can never execute (ADR-0018: CHECK != REDEEM != EXECUTE).
 */
export interface HostEffectDecision {
  readonly allow: boolean;
  readonly reason?: HostEffectDenialReason;
  /** The digest the authorized operation binds to. Present when allowed. */
  readonly termsDigest?: string;
}

/**
 * The host-visible outcome of one effect-boundary run.
 *
 * Fixed fields only: ids, digests and the provider's external reference.
 * The processing context (data principal reference, controller, categories)
 * never reaches a receipt, so the receipt cannot carry a subject
 * identifier (invariant 3: use without possession).
 */
export interface HostEffectReceipt {
  readonly receiptId: string;
  readonly action: string;
  readonly resource: string;
  readonly purpose: string;
  readonly termsDigest: string;
  readonly at: number;
  /** The grant or approval the effect ran under. */
  readonly authorityId?: string;
  /** The capability the effect ran under, when one was redeemed. */
  readonly capabilityId?: string;
  /** The provider's external reference. Evidence, never authority. */
  readonly transaction?: string;
  /** The Processing Event that carries the evidence for this attempt. */
  readonly eventId?: string;
}

/** What the host's effect callback receives. */
export interface HostEffectContext {
  /** The authorized operation. Its context equals the authorized context. */
  readonly operation: AuthorityOperation;
  /** The digest the authority and the privacy decision both bind to. */
  readonly termsDigest: string;
  /** The attempt identity this evidence is filed under. */
  readonly attemptRef: string;
  /**
   * Signal that the external effect has started. A callback that starts an
   * effect MUST call this first: after it, a failure is an unknown outcome,
   * never a proven pre-effect failure.
   */
  markEffectStarted(): void;
}

/** The boundary a host composes. */
export interface HostEffectBoundary {
  /** The dry-run decision. No effect, no event, no consumption. */
  check(): Promise<HostEffectDecision>;
  /** Run the effect under the ordering above. */
  run(): Promise<HostEffectReceipt>;
}

export interface HostEffectBoundaryOptions {
  /** The store directory: the authority CAS and the journal live here. */
  readonly dir: string;
  /** The authority instance that decides and is consumed. */
  readonly auth: Authority;
  /** The verified ingress identity the operation runs under. */
  readonly ingress: VerifiedIdentity;
  /** The privacy runtime that owns the narrowing gate and the evidence. */
  readonly runtime: PrivacyRuntime;
  /** The privacy gate. Must carry the same Authority instance. */
  readonly gate: PrivacyGateRequest;
  /** Clock, in epoch seconds. */
  readonly now: () => number;
  /**
   * The exact effect-bearing context the authority covered. Without a
   * redemption to derive it from, it is required: the boundary compares it
   * against the operation it is about to execute.
   */
  readonly authorizedContext?: Readonly<Record<string, unknown>>;
  /** Journaled provider path. Requires `redemption`. */
  readonly provider?: ProtectedProvider;
  /** The consumed, proof-verified redemption for the effect. */
  readonly redemption?: Redemption;
  /** Host effect path. Used when no provider is supplied. */
  readonly execute?: (
    ctx: HostEffectContext
  ) => Promise<ExecutionReceipt | void>;
  /** Durable authority persistence. Defaults to the file store's CAS. */
  readonly persistAuthority?: (auth: Authority) => void;
  /**
   * A stable attempt identity. Omit it for a fresh attempt; reuse it only
   * for a retry of the same attempt (ADR-0024: attempt identity is
   * explicit, and a terminal event is never reused for a new effect).
   */
  readonly attemptRef?: string;
}

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    return canonicalize(a) === canonicalize(b);
  } catch {
    return false;
  }
}

/** Bounded provider reference. Free text never reaches a receipt. */
function boundedRef(value: unknown, what: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error(`host boundary: malformed ${what}`);
  }
  return value;
}

/**
 * The host effect boundary. See the module comment for the ordering.
 */
export function createEffectBoundary(
  opts: HostEffectBoundaryOptions
): HostEffectBoundary {
  const { auth, gate, ingress, now } = opts;
  if (gate.authority !== auth) {
    // The privacy decision and the consumption must be made against the
    // same authority state; two instances could disagree.
    throw new Error(
      "host boundary: the gate must carry the same Authority instance"
    );
  }
  if (opts.provider !== undefined && opts.redemption === undefined) {
    throw new Error("host boundary: a provider requires a redemption");
  }
  if (
    opts.provider === undefined &&
    opts.execute === undefined &&
    opts.redemption === undefined
  ) {
    throw new Error("host boundary: an effect path is required");
  }
  const operation = gate.operation;
  const authorizedContext =
    opts.authorizedContext ?? opts.redemption?.operation.args;
  if (authorizedContext === undefined) {
    throw new Error(
      "host boundary: authorizedContext required when no redemption derives it"
    );
  }
  if (
    opts.redemption !== undefined &&
    !deepEqual(opts.redemption.operation.args, authorizedContext)
  ) {
    throw new Error(
      "host boundary: the redemption's authorized terms differ from the declared context"
    );
  }
  const persist =
    opts.persistAuthority ??
    ((instance: Authority): void => {
      saveAuthority(opts.dir, instance);
    });

  /** Step 1: the effect context must equal the authorized context exactly. */
  function assertTermsBinding(): void {
    if (!deepEqual(operation.context, authorizedContext)) {
      throw new PrivacyPreEffectError(
        "host boundary: the effect context differs from the authorized operation"
      );
    }
  }

  /** Step 2: the authority decides first, and decides nothing yet. */
  function authorityPreview(): boolean {
    const decision = auth.evaluate(operation, ingress, {
      consume: false,
      nowSec: now(),
    });
    return decision.allow;
  }

  /**
   * The redemption must be minted for the operation the boundary is about
   * to execute. The terms digest binds the action, resource, context and
   * purpose, so a redemption for other terms cannot ride along.
   */
  function redemptionMatches(termsDigest: string): boolean {
    if (opts.redemption === undefined) return true;
    const op = opts.redemption.operation;
    return (
      op.termsDigest === termsDigest &&
      op.cmd === operation.action.name &&
      op.resource === operation.resource.id &&
      (op.purpose ?? undefined) === (operation.purpose ?? undefined)
    );
  }

  function finalize(
    eventId: string,
    state: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN",
    patch: { readonly finalizedAt: number; readonly evidenceRef?: string }
  ): void {
    try {
      opts.runtime.finalizeEvent(eventId, state, patch);
    } catch {
      // Bookkeeping never masks the failure that caused it. The journal
      // stays the recovery oracle for an ambiguous outcome.
    }
  }

  /**
   * Step 8: the effect. The journaled provider path is preferred when a
   * provider and a redemption are supplied; otherwise the host callback
   * runs.
   */
  async function performEffect(
    ctx: HostEffectContext
  ): Promise<ExecutionReceipt | void> {
    if (opts.provider !== undefined && opts.redemption !== undefined) {
      const op = opts.redemption.operation;
      if (op.resource === undefined || op.purpose === undefined) {
        throw new Error(
          "host boundary: the redemption must carry resource and purpose"
        );
      }
      return executeWithJournal({
        dir: opts.dir,
        provider: opts.provider,
        req: {
          capabilityId: opts.redemption.chainId,
          termsDigest: op.termsDigest,
          action: op.cmd,
          recipient: op.recipient,
          resource: op.resource,
          purpose: op.purpose,
          context: { ...operation.context },
        },
        redemption: opts.redemption,
        nowSec: now(),
        at: now(),
        onEffectStart: ctx.markEffectStarted,
      });
    }
    if (opts.execute === undefined) {
      throw new Error("host boundary: no effect path configured");
    }
    return opts.execute(ctx);
  }

  function project(
    raw: ExecutionReceipt | void,
    termsDigest: string,
    eventId: string,
    authorityId: string | undefined,
    capabilityId: string | undefined
  ): HostEffectReceipt {
    const receiptId = boundedRef(
      raw?.receiptId ?? `host-${randomUUID()}`,
      "receipt id"
    );
    const transaction =
      raw?.transaction === undefined
        ? undefined
        : boundedRef(raw.transaction, "transaction reference");
    return {
      receiptId,
      action: operation.action.name,
      resource: raw?.resource ?? operation.resource.id,
      purpose: raw?.purpose ?? operation.purpose ?? "",
      termsDigest: raw?.termsDigest ?? termsDigest,
      at: raw?.at ?? now(),
      ...(authorityId !== undefined ? { authorityId } : {}),
      ...(capabilityId !== undefined ? { capabilityId } : {}),
      ...(transaction !== undefined ? { transaction } : {}),
      eventId,
    };
  }

  return {
    async check(): Promise<HostEffectDecision> {
      try {
        assertTermsBinding();
      } catch {
        return { allow: false, reason: "terms-mismatch" };
      }
      if (!authorityPreview()) {
        return { allow: false, reason: "authority-denied" };
      }
      const first = opts.runtime.preflight(gate);
      if (!first.allow) {
        return { allow: false, reason: first.publicReason };
      }
      try {
        opts.runtime.recheck(first, gate);
      } catch {
        return { allow: false, reason: "privacy-denied" };
      }
      if (!redemptionMatches(first.termsDigest)) {
        return { allow: false, reason: "terms-mismatch" };
      }
      return { allow: true, termsDigest: first.termsDigest };
    },

    async run(): Promise<HostEffectReceipt> {
      // 1. Terms binding. A smuggled effect-bearing key stops here.
      assertTermsBinding();

      // 2. Authority, non-consuming. The privacy state is not an oracle for
      // an unauthorized caller (ADR-0024).
      if (!authorityPreview()) {
        throw new Error("authority denied");
      }

      // 3. Privacy preflight, then 4. the live recheck.
      const first = opts.runtime.preflight(gate);
      if (!first.allow) {
        throw new PrivacyPreEffectError(
          first.publicReason === "authority-denied"
            ? "authority denied"
            : "privacy denied"
        );
      }
      let live;
      try {
        live = opts.runtime.recheck(first, gate);
      } catch {
        throw new PrivacyPreEffectError("privacy denied");
      }
      if (!redemptionMatches(live.termsDigest)) {
        throw new PrivacyPreEffectError(
          "host boundary: the redemption's terms differ from the authorized operation"
        );
      }

      // 5. Evidence precommit, before any consumption: a crash from here on
      // leaves a PREPARED attempt the operator can reconcile.
      const attemptRef = opts.attemptRef ?? randomUUID();
      let event;
      try {
        event = opts.runtime.prepareEvent(live, gate, attemptRef);
      } catch (error) {
        if (error instanceof PrivacyEventConflictError) throw error;
        throw new PrivacyPreEffectError("privacy denied");
      }

      // 6. Consume the authority use and persist it durably, before the
      // effect. A crash between here and the effect burns a use instead of
      // resurrecting one-time authority (invariant 9).
      let authorityId: string | undefined;
      try {
        const consumed = auth.evaluate(operation, ingress, {
          consume: true,
          nowSec: now(),
        });
        if (!consumed.allow) {
          throw new PrivacyPreEffectError(
            `authority denied at redeem time: ${consumed.reason}`
          );
        }
        authorityId = consumed.citations[0]?.authorityId;
        persist(auth);
      } catch (error) {
        finalize(event.eventId, "FAILED_FINAL", { finalizedAt: now() });
        throw error;
      }

      // 7. The fence. The privacy state is re-read at the effect boundary:
      // a withdrawal that lands after the recheck stops the attempt.
      try {
        opts.runtime.fence(live, gate);
      } catch {
        finalize(event.eventId, "FAILED_FINAL", { finalizedAt: now() });
        throw new PrivacyPreEffectError("privacy denied");
      }

      // 8. The effect.
      let effectStarted = false;
      const ctx: HostEffectContext = {
        operation,
        termsDigest: live.termsDigest,
        attemptRef,
        markEffectStarted: () => {
          effectStarted = true;
        },
      };
      let raw: ExecutionReceipt | void;
      try {
        raw = await performEffect(ctx);
      } catch (error) {
        if (effectStarted) {
          // The effect may have happened. Never report it as a denial.
          finalize(event.eventId, "OUTCOME_UNKNOWN", { finalizedAt: now() });
          throw new PrivacyOutcomeUnknownError(error);
        }
        finalize(event.eventId, "FAILED_FINAL", { finalizedAt: now() });
        // The cause is kept for the host. A host that forwards this error to
        // an agent maps it to a coarse message first.
        throw new PrivacyPreEffectError(
          `host boundary: the effect failed before the effect boundary: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      // 9. Finalize the evidence. A bookkeeping failure here is not a
      // denial: the effect happened, so the attempt stays reconcilable.
      let receipt: HostEffectReceipt;
      try {
        receipt = project(
          raw,
          live.termsDigest,
          event.eventId,
          authorityId,
          opts.redemption?.chainId
        );
      } catch (error) {
        finalize(event.eventId, "OUTCOME_UNKNOWN", { finalizedAt: now() });
        throw new PrivacyOutcomeUnknownError(error);
      }
      try {
        opts.runtime.finalizeEvent(event.eventId, "SUCCEEDED", {
          finalizedAt: receipt.at,
          evidenceRef: `execution-receipt:${receipt.receiptId}`,
        });
      } catch (error) {
        throw new PrivacyOutcomeUnknownError(error);
      }
      return receipt;
    },
  };
}

/**
 * The terms digest the boundary binds an operation to. Hosts use it to
 * build the demand and the redemption from the same terms.
 */
export function hostTermsDigest(
  operation: AuthorityOperation,
  ingress: VerifiedIdentity
): string {
  return digestForOperation({
    ...operation,
    principal: ingress.principal,
    actor: ingress.id,
    ...(ingress.chain !== undefined ? { actorChain: [...ingress.chain] } : {}),
  });
}
