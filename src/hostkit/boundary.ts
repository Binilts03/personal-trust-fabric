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
  type ExecutionQuery,
  type ProtectedProvider,
} from "../adapters/providers.js";
import {
  deriveIdempotencyKey,
  type ExecutionRecord,
} from "../store/execution.js";
import { FileExecutions } from "../store/repositories.js";
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
   * The idempotency key for this effect. Equal to the attempt reference:
   * the same terms produce the same key, so a host can dedupe a retry.
   */
  readonly idempotencyKey: string;
  /**
   * Signal that the external effect has started. A callback that starts an
   * effect MUST call this first: after it, a failure is an unknown outcome,
   * never a proven pre-effect failure.
   */
  markEffectStarted(): void;
}

/**
 * The read-only view of one attempt's durable evidence. Observation never
 * mutates: an absent record stays absent, a corrupt or ambiguous record is
 * unknown, and an effected live attempt is reported as observed evidence.
 */
export type HostEffectInspection =
  | { readonly kind: "succeeded"; readonly receipt: ExecutionReceipt }
  | { readonly kind: "absent" }
  | { readonly kind: "failed_final" }
  | { readonly kind: "unsubmitted" }
  | { readonly kind: "effected"; readonly externalRef: string }
  | { readonly kind: "unknown"; readonly reason: string };

/** The boundary a host composes. */
export interface HostEffectBoundary {
  /** The dry-run decision. No effect, no event, no consumption. */
  check(): Promise<HostEffectDecision>;
  /** Run the effect under the ordering above. */
  run(): Promise<HostEffectReceipt>;
  /**
   * Observation only. Reads the journal and, for a live attempt, the
   * provider-side query. Never submits, never writes, never finalizes.
   */
  inspect(): Promise<HostEffectInspection>;
  /**
   * Adopt an observed effect into the journal under authority. Never starts
   * an effect when the journal has no record for these terms.
   */
  reconcile(): Promise<HostEffectReceipt>;
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
  /**
   * Durable authority persistence. Defaults to the file store's CAS.
   *
   * May be asynchronous: the boundary awaits it before the effect, so a
   * host that keeps authority in a database gets the same burn-before-effect
   * ordering as the file store.
   */
  readonly persistAuthority?: (auth: Authority) => void | Promise<void>;
  /**
   * A stable attempt identity. Defaults to the terms digest, so a retry of
   * the same terms lands on the same attempt and cannot run the effect a
   * second time. Supply a distinct value only for a genuinely distinct
   * operation (a fresh authorization/redemption), never for a retry.
   */
  readonly attemptRef?: string;
  /**
   * Provider outcome query used only to reconcile an existing attempt. With
   * it, a live attempt resolves to an observed effect, an absent outcome, or
   * an unknown outcome; without it the live case is unobservable.
   */
  readonly query?: ExecutionQuery;
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
 * Attempt references are bounded opaque tokens. The format cannot prove a
 * value is not an identifier; the host remains responsible for that. The
 * default is the terms digest, and a malformed or over-long value is refused
 * before any evidence or consumption. The 200-character ceiling matches the
 * privacy runtime's own validation, so a value accepted here cannot fail
 * later, after authority has been spent.
 */
const OPAQUE_REF = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;

function attemptRefOf(value: string | undefined, termsDigest: string): string {
  const ref = value ?? termsDigest;
  if (!OPAQUE_REF.test(ref)) {
    throw new PrivacyPreEffectError(
      "host boundary: the attempt reference is not opaque"
    );
  }
  return ref;
}

/**
 * The provider scope the journal key was derived with. The journaled executor
 * derives the key from the provider's namespace (or its kind), so the reader
 * and the writer must agree on it exactly.
 */
function providerScope(provider: ProtectedProvider): string {
  return provider.namespace ?? provider.kind;
}

/** The journal idempotency key for one terms set in one provider scope. */
function journalKeyOf(
  provider: ProtectedProvider,
  termsDigest: string
): string {
  return deriveIdempotencyKey(termsDigest, providerScope(provider));
}

/**
 * The journal record for one attempt, read only. A record that cannot be read
 * or parsed is `corrupt`, never `absent`: treating it as absent would let a
 * caller conclude that no effect happened when the journal cannot say.
 */
function findAttempt(
  dir: string,
  provider: ProtectedProvider,
  termsDigest: string
):
  | { readonly kind: "record"; readonly record: ExecutionRecord }
  | { readonly kind: "absent" }
  | { readonly kind: "corrupt" } {
  let key: string;
  try {
    key = journalKeyOf(provider, termsDigest);
  } catch {
    return { kind: "corrupt" };
  }
  try {
    const record = FileExecutions.findByIdempotencyKey(dir, key);
    return record === null ? { kind: "absent" } : { kind: "record", record };
  } catch {
    return { kind: "corrupt" };
  }
}

/**
 * The record must describe the very operation the host is asking about. The
 * key already binds the terms digest; the remaining fields are checked so a
 * record that somehow carries other terms can never be adopted.
 */
function recordMatchesTerms(
  record: ExecutionRecord,
  op: {
    readonly cmd: string;
    readonly recipient: string;
    readonly resource?: string;
    readonly purpose?: string;
    readonly termsDigest: string;
  },
  context: Readonly<Record<string, unknown>>
): boolean {
  return (
    record.termsDigest === op.termsDigest &&
    record.action === op.cmd &&
    record.recipient === op.recipient &&
    record.resource === (op.resource ?? "") &&
    record.purpose === (op.purpose ?? "") &&
    deepEqual(record.context, context)
  );
}

/** The receipt of a succeeded journal row, when the row carries a complete one. */
function receiptOf(record: ExecutionRecord): ExecutionReceipt | undefined {
  if (
    record.state !== "SUCCEEDED" ||
    record.receiptId === undefined ||
    record.receiptAt === undefined ||
    record.externalRef === undefined
  ) {
    return undefined;
  }
  return {
    receiptId: record.receiptId,
    capabilityId: record.capabilityId,
    recipient: record.recipient,
    resource: record.resource,
    purpose: record.purpose,
    transaction: record.externalRef,
    at: record.receiptAt,
    termsDigest: record.termsDigest,
  };
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
        ...(opts.query !== undefined ? { query: opts.query } : {}),
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
    const at =
      typeof raw?.at === "number" && Number.isFinite(raw.at) && raw.at >= 0
        ? Math.floor(raw.at)
        : now();
    return {
      receiptId,
      action: operation.action.name,
      // The receipt always binds the AUTHORISED terms. A host callback can
      // report ids and an external reference, never a different operation.
      resource: operation.resource.id,
      purpose: operation.purpose ?? "",
      termsDigest,
      at,
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
      // an unauthorized caller (ADR-0024). The agent-facing error is coarse:
      // the internal deny reason stays out of it.
      if (!authorityPreview()) {
        throw new PrivacyPreEffectError("authority denied");
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
      // leaves a PREPARED attempt the operator can reconcile. The attempt
      // identity defaults to the terms digest, so a retry is the same
      // attempt rather than a second effect.
      const attemptRef = attemptRefOf(opts.attemptRef, live.termsDigest);
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
          // The agent gets the coarse class, never the internal reason.
          throw new PrivacyPreEffectError("authority denied");
        }
        authorityId = consumed.citations[0]?.authorityId;
        await persist(auth);
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
        idempotencyKey: attemptRef,
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
        // The effect happened and the success could not be recorded. Do not
        // leave a PREPARED event that a retry could mistake for a fresh
        // attempt; mark the ambiguity if the store will take it.
        finalize(event.eventId, "OUTCOME_UNKNOWN", { finalizedAt: now() });
        throw new PrivacyOutcomeUnknownError(error);
      }
      return receipt;
    },

    async inspect(): Promise<HostEffectInspection> {
      if (opts.provider === undefined || opts.redemption === undefined) {
        // The callback path has no journal oracle, so it cannot be inspected.
        // Report unknown rather than inventing an outcome.
        return { kind: "unknown", reason: "unsupported-path" };
      }
      const op = opts.redemption.operation;
      const found = findAttempt(opts.dir, opts.provider, op.termsDigest);
      if (found.kind === "corrupt") {
        // A journal scan that cannot be read is ambiguous evidence, never
        // "no record".
        return { kind: "unknown", reason: "corrupt" };
      }
      if (found.kind === "absent") {
        return { kind: "absent" };
      }
      const record = found.record;
      if (!recordMatchesTerms(record, op, operation.context)) {
        return { kind: "unknown", reason: "mismatch" };
      }
      switch (record.state) {
        case "SUCCEEDED": {
          const receipt = receiptOf(record);
          return receipt === undefined
            ? { kind: "unknown", reason: "corrupt" }
            : { kind: "succeeded", receipt };
        }
        case "FAILED_FINAL":
          return { kind: "failed_final" };
        case "RECONCILED":
          return { kind: "unknown", reason: "reconciled" };
        case "PREPARED":
        case "AUTHORIZED":
          // The row was written before the submit boundary: the provider was
          // provably never called, so no effect happened.
          return { kind: "unsubmitted" };
        default: {
          // SUBMITTING / SUBMITTED_UNKNOWN: the provider may or may not have
          // been called. Only the provider can resolve it.
          if (opts.query === undefined) {
            return { kind: "unknown", reason: "query-missing" };
          }
          const outcome = await opts.query.query({
            idempotencyKey: journalKeyOf(opts.provider, op.termsDigest),
            capabilityId: opts.redemption.chainId,
            termsDigest: op.termsDigest,
          });
          if (outcome.state === "effected") {
            // Observation only: the reference is reported, never written.
            return { kind: "effected", externalRef: outcome.externalRef };
          }
          if (outcome.state === "absent") {
            return { kind: "absent" };
          }
          return { kind: "unknown", reason: "live" };
        }
      }
    },

    async reconcile(): Promise<HostEffectReceipt> {
      if (opts.redemption === undefined) {
        throw new Error("host boundary: reconcile requires a redemption");
      }
      if (opts.provider === undefined) {
        throw new Error("host boundary: reconcile requires a provider");
      }
      const op = opts.redemption.operation;
      const found = findAttempt(opts.dir, opts.provider, op.termsDigest);
      if (found.kind === "corrupt") {
        throw new Error(
          "host boundary: cannot reconcile an unreadable journal record"
        );
      }
      if (found.kind === "absent") {
        // No journal record means the journaled path never crossed its create
        // boundary, so no effect can be proven. Refuse without submitting.
        throw new Error(
          "host boundary: cannot reconcile an effect with no journal record"
        );
      }
      const record = found.record;
      if (!recordMatchesTerms(record, op, operation.context)) {
        throw new Error(
          "host boundary: cannot reconcile a journal record for other terms"
        );
      }
      if (record.state === "FAILED_FINAL") {
        throw new Error(
          "host boundary: cannot reconcile a failed_final execution"
        );
      }
      if (record.state === "PREPARED" || record.state === "AUTHORIZED") {
        // The provider was provably never called: there is nothing to adopt,
        // and the authority use for these terms is already spent.
        throw new Error(
          "host boundary: cannot reconcile an unsubmitted attempt"
        );
      }
      if (record.state === "RECONCILED") {
        throw new Error(
          "host boundary: cannot reconcile a quarantined execution"
        );
      }
      if (opts.query === undefined) {
        throw new Error(
          "host boundary: reconcile requires a provider outcome query"
        );
      }
      // The journaled executor owns the reconciliation and the attestation: an
      // effected query adopts the existing reference without resubmitting, and
      // an unknown query quarantines. It never starts a new effect unless the
      // provider confirms that it never took one.
      const attemptRef = attemptRefOf(opts.attemptRef, op.termsDigest);
      let effectStarted = false;
      const ctx: HostEffectContext = {
        operation,
        termsDigest: op.termsDigest,
        attemptRef,
        idempotencyKey: attemptRef,
        markEffectStarted: () => {
          effectStarted = true;
        },
      };
      let raw: ExecutionReceipt | void = undefined;
      try {
        raw = await performEffect(ctx);
      } catch (error) {
        if (effectStarted) {
          // The effect may have happened; never report it as a pre-effect
          // failure.
          throw new PrivacyOutcomeUnknownError(error);
        }
        throw new PrivacyPreEffectError(
          `host boundary: the reconcile failed before the effect boundary: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      const receipt = project(
        raw,
        op.termsDigest,
        attemptRef,
        undefined,
        opts.redemption.chainId
      );
      try {
        opts.runtime.reconcileAttemptEvent(gate, {
          termsDigest: op.termsDigest,
          attemptRef,
          state: "SUCCEEDED",
          finalizedAt: receipt.at,
          evidenceRef: `execution-receipt:${receipt.receiptId}`,
          createIfMissing: true,
        });
      } catch (error) {
        // The effect was adopted but the evidence could not be finalized: the
        // attempt stays reconcilable rather than looking successful.
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
