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
import { inspectExecutionJournal } from "../store/execution-replay.js";

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

export type ProcessingMode =
  | { readonly kind: "not-enforced"; readonly reason: "synthetic-no-personal-data" | "no-host-privacy-profile-configured" }
  | { readonly kind: "enforced"; readonly runtime: PrivacyRuntime; readonly gate: PrivacyGateRequest };

export type EffectMode =
  | { readonly kind: "provider"; readonly provider: ProtectedProvider; readonly redemption: Redemption }
  | { readonly kind: "trusted-callback"; readonly execute: (ctx: HostEffectContext) => Promise<ExecutionReceipt | void>; readonly redemption?: Redemption };

export interface ProtectedEffectOptions {
  readonly dir: string;
  readonly auth: Authority;
  readonly ingress: VerifiedIdentity;
  readonly operation: AuthorityOperation;
  readonly authorizedContext: Readonly<Record<string, unknown>>;
  readonly now: () => number;
  readonly processing: ProcessingMode;
  readonly effect: EffectMode;
  readonly persistAuthority?: (auth: Authority) => void;
  readonly attemptRef?: string;
}

export type ProtectedEffectReceipt = Omit<HostEffectReceipt, "eventId"> & { readonly privacyEventId?: string };
export interface ProtectedEffect {
  check(): Promise<HostEffectDecision>;
  run(): Promise<ProtectedEffectReceipt>;
}

export class ProtectedEffectOutcomeUnknownError extends Error {
  constructor(cause: unknown) {
    super("protected effect outcome unknown; reconcile before retry");
    this.name = "ProtectedEffectOutcomeUnknownError";
    this.cause = cause;
  }
}

/** One effect-ordering implementation for privacy-enforced and explicit non-enforced hosts. */
export function createProtectedEffect(opts: ProtectedEffectOptions): ProtectedEffect {
  const { auth, ingress, operation, now, processing } = opts;
  if (processing === undefined || (processing.kind !== "enforced" && processing.kind !== "not-enforced")) {
    throw new Error("host boundary: explicit processing mode required");
  }
  if (processing.kind === "not-enforced" &&
      processing.reason !== "synthetic-no-personal-data" &&
      processing.reason !== "no-host-privacy-profile-configured") {
    throw new Error("host boundary: invalid non-enforcement reason");
  }
  if (processing.kind === "enforced" &&
      (processing.gate.authority !== auth ||
       !deepEqual(processing.gate.operation, operation) ||
       !deepEqual(processing.gate.ingress, ingress))) {
    throw new Error("host boundary: privacy gate and operation must share authority and identity");
  }
  if (opts.effect === undefined ||
      (opts.effect.kind !== "provider" && opts.effect.kind !== "trusted-callback")) {
    throw new Error("host boundary: trusted effect path required");
  }
  const redemption = opts.effect.redemption;
  const authorizedContext = opts.authorizedContext;
  if (authorizedContext === undefined) throw new Error("host boundary: authorizedContext required");
  if (redemption !== undefined && !deepEqual(redemption.operation?.args, authorizedContext)) {
    throw new Error("host boundary: the redemption's authorized terms differ from the declared context");
  }
  const persist = opts.persistAuthority ?? ((instance: Authority): void => saveAuthority(opts.dir, instance));

  function assertTermsBinding(): void {
    if (!deepEqual(operation.context, authorizedContext)) {
      throw new PrivacyPreEffectError("host boundary: the effect context differs from the authorized operation");
    }
  }
  function preview(): boolean {
    return auth.evaluate(operation, ingress, { consume: false, nowSec: now() }).allow;
  }
  function redemptionMatches(digest: string): boolean {
    if (redemption === undefined) return true;
    const op = redemption.operation;
    return redemption.ok === true && redemption.consumed === true &&
      redemption.proofVerified === true && typeof redemption.chainId === "string" &&
      redemption.chainId.length > 0 && op !== undefined &&
      op.termsDigest === digest && op.cmd === operation.action.name &&
      op.resource === operation.resource.id &&
      op.recipient === operation.context["recipient"] &&
      (op.purpose ?? undefined) === (operation.purpose ?? undefined) &&
      deepEqual(op.args, authorizedContext);
  }
  function project(raw: ExecutionReceipt | void, digest: string,
                   eventId: string | undefined, authorityId: string | undefined): ProtectedEffectReceipt {
    // Never let a trusted callback re-label the authorized effect in a receipt.
    // This is checked even though provider execution has its own binding:
    // callback integrations are a separate host-controlled effect source.
    if (raw !== undefined && (
      raw.resource !== operation.resource.id ||
      raw.purpose !== (operation.purpose ?? "") ||
      raw.termsDigest !== digest ||
      (operation.context["recipient"] !== undefined &&
       raw.recipient !== operation.context["recipient"])
    )) {
      throw new Error("host boundary: receipt fields disagree with authorized operation");
    }
    const receiptId = boundedRef(raw?.receiptId ?? ("host-" + randomUUID()), "receipt id");
    const transaction = raw?.transaction === undefined ? undefined :
      boundedRef(raw.transaction, "transaction reference");
    return {
      receiptId,
      action: operation.action.name,
      resource: operation.resource.id,
      purpose: operation.purpose ?? "",
      termsDigest: digest,
      at: raw?.at ?? now(),
      ...(authorityId !== undefined ? { authorityId } : {}),
      ...(redemption !== undefined ? { capabilityId: raw?.capabilityId ?? redemption.chainId } : {}),
      ...(transaction !== undefined ? { transaction } : {}),
      ...(eventId !== undefined ? { privacyEventId: eventId } : {}),
    };
  }
  async function perform(ctx: HostEffectContext): Promise<ExecutionReceipt | void> {
    if (opts.effect.kind === "provider") {
      const r = opts.effect.redemption;
      const op = r.operation;
      if (op.resource === undefined || op.purpose === undefined) {
        throw new Error("host boundary: redemption must carry resource and purpose");
      }
      return executeWithJournal({
        dir: opts.dir, provider: opts.effect.provider,
        req: {
          capabilityId: r.chainId, termsDigest: op.termsDigest, action: op.cmd,
          recipient: op.recipient, resource: op.resource, purpose: op.purpose,
          context: { ...operation.context }
        },
        redemption: r, nowSec: now(), at: now(),
        onEffectStart: ctx.markEffectStarted,
      });
    }
    return opts.effect.execute(ctx);
  }
  return {
    async check(): Promise<HostEffectDecision> {
      try { assertTermsBinding(); } catch { return { allow: false, reason: "terms-mismatch" }; }
      if (!preview()) return { allow: false, reason: "authority-denied" };
      let digest = hostTermsDigest(operation, ingress);
      if (processing.kind === "enforced") {
        const first = processing.runtime.preflight(processing.gate);
        if (!first.allow) return { allow: false, reason: first.publicReason };
        try { digest = processing.runtime.recheck(first, processing.gate).termsDigest; }
        catch { return { allow: false, reason: "privacy-denied" }; }
      }
      if (!redemptionMatches(digest)) return { allow: false, reason: "terms-mismatch" };
      return { allow: true, termsDigest: digest };
    },
    async run(): Promise<ProtectedEffectReceipt> {
      assertTermsBinding();
      // Journal-first evidence is inspected before live Authority only for an
      // exact, consumed and proof-verified provider operation. A completed
      // effect survives a spent grant; ambiguous/corrupt state never retries.
      if (opts.effect.kind === "provider") {
        const digest = hostTermsDigest(operation, ingress);
        if (!redemptionMatches(digest)) {
          throw new PrivacyPreEffectError("host boundary: redemption terms or proof invalid");
        }
        const journal = inspectExecutionJournal({
          dir: opts.dir,
          namespace: opts.effect.provider.namespace ?? opts.effect.provider.kind,
          termsDigest: digest,
          action: operation.action.name,
          recipient: opts.effect.redemption.operation.recipient,
          resource: operation.resource.id,
          purpose: operation.purpose ?? "",
          context: operation.context
        });
        if (journal.kind === "succeeded") {
          if (processing.kind === "enforced") {
            // A privacy-backed attempt cannot report success until its event
            // is reconciled. Missing/unverifiable evidence is an unknown,
            // not a silent downgrade to an unregulated successful receipt.
            try {
              processing.runtime.reconcileAttemptEvent(processing.gate, {
                termsDigest: digest,
                attemptRef: opts.attemptRef ?? digest,
                state: "SUCCEEDED",
                finalizedAt: journal.receipt.at,
                evidenceRef: "execution-receipt:" + journal.receipt.receiptId,
                preparedAt: journal.record.createdAt,
                createIfMissing: true
              });
            } catch (error) {
              throw new ProtectedEffectOutcomeUnknownError(error);
            }
          }
          return project(journal.receipt, digest, undefined, undefined);
        }
        if (journal.kind === "failed_final") {
          throw new PrivacyPreEffectError("host boundary: prior execution failed; new terms required");
        }
        if (journal.kind === "unknown") {
          throw new ProtectedEffectOutcomeUnknownError(
            new Error("journal: uncertain prior execution (" + journal.reason + ")")
          );
        }
      }
      if (!preview()) throw new Error("authority denied");
      const attemptRef = opts.attemptRef ?? randomUUID();
      let digest = hostTermsDigest(operation, ingress);
      let eventId: string | undefined;
      let fence = (): void => {};
      let finalize = (_state: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN"): void => {};
      if (processing.kind === "enforced") {
        const first = processing.runtime.preflight(processing.gate);
        if (!first.allow) {
          throw new PrivacyPreEffectError(first.publicReason === "authority-denied" ? "authority denied" : "privacy denied");
        }
        let live: ReturnType<PrivacyRuntime["recheck"]>;
        try { live = processing.runtime.recheck(first, processing.gate); }
        catch { throw new PrivacyPreEffectError("privacy denied"); }
        digest = live.termsDigest;
        if (!redemptionMatches(digest)) {
          throw new PrivacyPreEffectError("host boundary: redemption terms differ from authorized operation");
        }
        try {
          const event = processing.runtime.prepareEvent(live, processing.gate, attemptRef);
          eventId = event.eventId;
          fence = () => processing.runtime.fence(live, processing.gate);
          finalize = (state) => {
            try { processing.runtime.finalizeEvent(event.eventId, state, { finalizedAt: now() }); }
            catch { /* journal remains the recovery oracle */ }
          };
        } catch (error) {
          if (error instanceof PrivacyEventConflictError) throw error;
          throw new PrivacyPreEffectError("privacy denied");
        }
      } else if (!redemptionMatches(digest)) {
        throw new Error("host boundary: redemption terms or proof invalid");
      }
      let authorityId: string | undefined;
      try {
        const consumed = auth.evaluate(operation, ingress, { consume: true, nowSec: now() });
        if (!consumed.allow) throw new PrivacyPreEffectError("authority denied at redeem time: " + consumed.reason);
        authorityId = consumed.citations[0]?.authorityId;
        persist(auth);
      } catch (error) { finalize("FAILED_FINAL"); throw error; }
      try { fence(); } catch {
        finalize("FAILED_FINAL");
        throw new PrivacyPreEffectError("privacy denied");
      }
      let started = false;
      const ctx: HostEffectContext = {
        operation, termsDigest: digest, attemptRef,
        markEffectStarted: () => { started = true; }
      };
      let raw: ExecutionReceipt | void;
      try { raw = await perform(ctx); } catch (error) {
        finalize(started ? "OUTCOME_UNKNOWN" : "FAILED_FINAL");
        if (started) {
          if (processing.kind === "enforced") throw new PrivacyOutcomeUnknownError(error);
          throw new ProtectedEffectOutcomeUnknownError(error);
        }
        throw new PrivacyPreEffectError("host boundary: effect failed before effect boundary: " +
          (error instanceof Error ? error.message : String(error)));
      }
      let receipt: ProtectedEffectReceipt;
      try { receipt = project(raw, digest, eventId, authorityId); }
      catch (error) {
        finalize("OUTCOME_UNKNOWN");
        if (processing.kind === "enforced") throw new PrivacyOutcomeUnknownError(error);
        throw new ProtectedEffectOutcomeUnknownError(error);
      }
      if (processing.kind === "enforced" && eventId !== undefined) {
        try {
          processing.runtime.finalizeEvent(eventId, "SUCCEEDED", {
            finalizedAt: receipt.at, evidenceRef: "execution-receipt:" + receipt.receiptId,
          });
        } catch (error) { throw new PrivacyOutcomeUnknownError(error); }
      }
      return receipt;
    }
  };
}

/** Compatibility adapter: this historical entry point ALWAYS enforces privacy. */
export function createEffectBoundary(opts: HostEffectBoundaryOptions): HostEffectBoundary {
  if (opts.provider !== undefined && opts.redemption === undefined) {
    throw new Error("host boundary: a provider requires a redemption");
  }
  if (opts.provider === undefined && opts.execute === undefined) {
    throw new Error("host boundary: an effect path is required");
  }
  const ctx = opts.authorizedContext ?? opts.redemption?.operation.args;
  if (ctx === undefined) {
    throw new Error("host boundary: authorizedContext required when no redemption derives it");
  }
  const effect: EffectMode =
    opts.provider !== undefined && opts.redemption !== undefined
      ? { kind: "provider", provider: opts.provider, redemption: opts.redemption }
      : { kind: "trusted-callback", execute: opts.execute as (ctx: HostEffectContext) => Promise<ExecutionReceipt | void>,
          ...(opts.redemption !== undefined ? { redemption: opts.redemption } : {}) };
  const canonical = createProtectedEffect({
    dir: opts.dir, auth: opts.auth, ingress: opts.ingress, now: opts.now,
    operation: opts.gate.operation, authorizedContext: ctx,
    processing: { kind: "enforced", runtime: opts.runtime, gate: opts.gate },
    effect,
    ...(opts.persistAuthority !== undefined ? { persistAuthority: opts.persistAuthority } : {}),
    ...(opts.attemptRef !== undefined ? { attemptRef: opts.attemptRef } : {})
  });
  return {
    check: () => canonical.check(),
    run: async (): Promise<HostEffectReceipt> => {
      const { privacyEventId, ...receipt } = await canonical.run();
      if (privacyEventId === undefined) throw new Error("host boundary: evidence missing");
      return { ...receipt, eventId: privacyEventId };
    }
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
