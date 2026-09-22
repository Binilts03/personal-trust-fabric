import { canonicalize } from "../core/canonical.js";
import { randomHex } from "../core/crypto.js";
import { requireBoundOperation } from "../core/execute.js";
import { isNonEmptyString } from "./guards.js";
import type {
  ExecutionReceipt,
  PaymentExecutor,
  PaymentInstruction,
  Receipt,
} from "../core/execute.js";
import type { AuthorizedOperation, Redemption } from "../core/types.js";
import type { Authority, VerifiedIdentity } from "../core/authority.js";
import type { FileAuditLog } from "../store/files.js";
import { loadAuthority, saveAuthority } from "../store/files.js";
import type { SecretInstruction, VaultStore } from "../store/vault.js";
import { useCredential } from "../store/vault.js";
import {
  AmbiguousExecutionError,
  ExecutionError,
  assertExternalRef,
  deriveIdempotencyKey,
  isTerminal,
  type ExecutionRecord,
} from "../store/execution.js";
import {
  FileExecutions,
  type ExecutionRepository,
} from "../store/repositories.js";

/**
 * Protected provider seam (P0 slice 3).
 *
 * PTF decides; external rails execute. A `ProtectedProvider` moves value (or
 * books travel/retail/email/identity effects) per a capability-bound request
 * and returns an external reference the host verifies before it can enter a
 * receipt. Rail results are evidence, never authority (ADR-0005): hosts must
 * run the existing `x402`/`ap2` verifiers (`checkSettlement`,
 * `verifyMandatePair`) on provider output before trusting it.
 *
 * Requests carry handles only (`capabilityId`, `termsDigest`, ids, amounts) —
 * never raw secrets. Receipts reuse `Receipt` with `transaction=externalRef`
 * and a fixed field set, so non-propagation holds by construction for the
 * receipt itself; callers must keep free-text `context` handles secret-free
 * (same host obligation as `execute.ts` `detail`).
 *
 * Host glue (`providerAsExecutor`) adapts a payment provider to the existing
 * `PaymentExecutor` shape, so `executeAndReceipt` call sites are untouched.
 */

export type ProviderKind =
  "payment" | "travel" | "retail" | "email" | "identity";

export interface ProviderRequest {
  readonly capabilityId: string;
  readonly termsDigest: string;
  readonly action: `/${string}`;
  readonly recipient: string;
  readonly resource: string;
  readonly purpose: string;
  /**
   * Effect-bearing terms — must deep-equal the authorized args exactly
   * (ADR-0018). Extra keys are NOT allowed: anything that can alter the
   * external effect belongs in the authorization, never smuggled alongside.
   */
  readonly context: Readonly<Record<string, unknown>>;
  /**
   * Non-effectful telemetry (trace/correlation ids, provider hints).
   * Never compared, never receipted, never part of the authorized terms —
   * and MUST NOT alter the external effect. Hosts enforce that last clause
   * in review: metadata rides along only because the provider transport
   * needs plumbing, not because it is authorized.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ProviderSubmission {
  readonly kind: ProviderKind;
  readonly capabilityId: string;
  readonly termsDigest: string;
  readonly externalRef: string;
  readonly at: number;
}

export interface ProtectedProvider {
  readonly kind: ProviderKind;
  submit(req: ProviderRequest): Promise<ProviderSubmission>;
  verify(
    sub: ProviderSubmission,
    expected: { readonly capabilityId: string; readonly termsDigest: string }
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string };
}

function checkRequest(req: ProviderRequest): void {
  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    throw new Error("provider: request must be an object");
  }
  if (!isNonEmptyString(req.capabilityId) || req.capabilityId.length < 8) {
    throw new Error("provider: capabilityId required");
  }
  if (!isNonEmptyString(req.termsDigest) || req.termsDigest.length < 16) {
    throw new Error("provider: termsDigest required");
  }
  if (
    typeof req.action !== "string" ||
    !req.action.startsWith("/") ||
    req.action === "/"
  ) {
    throw new Error('provider: action must be a /-path ("/" forbidden)');
  }
  if (!isNonEmptyString(req.recipient))
    throw new Error("provider: recipient required");
  if (!isNonEmptyString(req.resource))
    throw new Error("provider: resource required");
  if (!isNonEmptyString(req.purpose))
    throw new Error("provider: purpose required");
  if (
    typeof req.context !== "object" ||
    req.context === null ||
    Array.isArray(req.context)
  ) {
    throw new Error("provider: context must be an object");
  }
  try {
    canonicalize(req.context);
  } catch {
    throw new Error("provider: context must be canonicalizable (handles only)");
  }
}

/** In-memory stand-in per kind. Records calls for assertions. Moves nothing. */
export class FakeProvider implements ProtectedProvider {
  readonly calls: ProviderRequest[] = [];
  constructor(
    readonly kind: ProviderKind,
    private readonly opts: {
      readonly prefix?: string;
      readonly nowSec?: () => number;
    } = {}
  ) {}

  async submit(req: ProviderRequest): Promise<ProviderSubmission> {
    checkRequest(req);
    this.calls.push({
      ...req,
      context: { ...req.context },
    });
    const prefix = this.opts.prefix ?? `fake-${this.kind}`;
    const now = this.opts.nowSec?.() ?? Math.floor(Date.now() / 1000);
    return {
      kind: this.kind,
      capabilityId: req.capabilityId,
      termsDigest: req.termsDigest,
      externalRef: `${prefix}-${randomHex(8)}`,
      at: now,
    };
  }

  verify(
    sub: ProviderSubmission,
    expected: { readonly capabilityId: string; readonly termsDigest: string }
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (typeof sub !== "object" || sub === null)
      return { ok: false, reason: "malformed submission" };
    if (sub.kind !== this.kind) return { ok: false, reason: "kind mismatch" };
    if (sub.capabilityId !== expected.capabilityId)
      return { ok: false, reason: "capability mismatch" };
    if (sub.termsDigest !== expected.termsDigest)
      return { ok: false, reason: "terms mismatch" };
    if (!isNonEmptyString(sub.externalRef))
      return { ok: false, reason: "missing externalRef" };
    return { ok: true };
  }
}

/** One canned fake per kind (each records its own calls, moves nothing). */
export function makeFakeProviders(
  opts: { readonly nowSec?: () => number } = {}
): Record<ProviderKind, FakeProvider> {
  return {
    payment: new FakeProvider("payment", opts),
    travel: new FakeProvider("travel", opts),
    retail: new FakeProvider("retail", opts),
    email: new FakeProvider("email", opts),
    identity: new FakeProvider("identity", opts),
  };
}

function fieldsEqual(a: unknown, b: unknown): boolean {
  try {
    return canonicalize(a) === canonicalize(b);
  } catch {
    return false;
  }
}

/**
 * Redemption gate shared by every provider execute path (ADR-0018):
 * dry-run checks can never execute — only a consumed, proof-verified
 * redemption runs.
 */
function requireRedemption(redemption: Redemption): AuthorizedOperation {
  if (redemption.ok !== true) {
    throw new Error("provider: redemption required before execution");
  }
  // Binding first (nothing bound at all?), then flags (dry-run checks can
  // never execute) — distinct forgeries, distinct errors.
  const op = requireBoundOperation(redemption);
  if (redemption.consumed !== true || redemption.proofVerified !== true) {
    throw new Error(
      "provider: dry-run check cannot execute — redeem with proof first (ADR-0018)"
    );
  }
  return op;
}

/**
 * Every term the authorization covered must appear identically in the
 * request — and nothing else effect-bearing may ride along. The authorized
 * args must deep-equal the request context EXACTLY (ADR-0018); use
 * `metadata` for non-effectful telemetry.
 */
function authorizedTermsCover(
  op: AuthorizedOperation,
  req: ProviderRequest
): void {
  if (req.termsDigest !== op.termsDigest) {
    throw new Error("provider: terms digest mismatch — new approval required");
  }
  if (req.action !== op.cmd) {
    throw new Error("provider: action differs from authorized terms");
  }
  if (req.recipient !== op.recipient) {
    throw new Error("provider: recipient differs from authorized terms");
  }
  if (op.resource === undefined || req.resource !== op.resource) {
    throw new Error("provider: resource differs from authorized terms");
  }
  if (op.purpose === undefined || req.purpose !== op.purpose) {
    throw new Error("provider: purpose differs from authorized terms");
  }
  if (
    !fieldsEqual(
      op.args as Record<string, unknown>,
      req.context as Record<string, unknown>
    )
  ) {
    throw new Error(
      "provider: context differs from authorized terms — authorize every effect-bearing field, use metadata for the rest"
    );
  }
}

/**
 * Adapt a payment provider to the existing `PaymentExecutor` shape.
 * Takes the redemption (not a bare binding) so the provider request is
 * built from the exact authorized operation: any divergence between the
 * instruction and the redemption throws BEFORE submission — never after
 * money moves. `executeAndReceipt` call sites stay untouched: they keep
 * passing an executor, an identity-free instruction, and a redemption.
 */
export function providerAsExecutor(
  provider: ProtectedProvider,
  redemption: Redemption
): PaymentExecutor {
  const op = requireRedemption(redemption);
  if (!isNonEmptyString(redemption.chainId)) {
    throw new Error("provider: capabilityId required");
  }
  if (op.cmd !== "/pay" && !op.cmd.startsWith("/pay/")) {
    throw new Error("provider: authorized cmd is not a payment");
  }
  return {
    async executePayment(
      instruction: PaymentInstruction
    ): Promise<{ readonly ok: true; readonly transaction: string }> {
      if (instruction.capabilityId !== redemption.chainId) {
        throw new Error(
          "provider: instruction is not bound to this capability"
        );
      }
      if (instruction.termsDigest !== op.termsDigest) {
        throw new Error(
          "provider: terms digest mismatch — new approval required"
        );
      }
      if (instruction.recipient !== op.recipient) {
        throw new Error("provider: recipient differs from authorized terms");
      }
      if (op.resource === undefined || instruction.resource !== op.resource) {
        throw new Error("provider: resource differs from authorized terms");
      }
      if (op.purpose === undefined || instruction.purpose !== op.purpose) {
        throw new Error("provider: purpose differs from authorized terms");
      }
      if (
        !fieldsEqual(op.args, {
          amount: instruction.amount,
          currency: instruction.currency,
        })
      ) {
        throw new Error(
          "provider: amount/currency differ from authorized terms"
        );
      }
      const req: ProviderRequest = {
        capabilityId: redemption.chainId,
        termsDigest: op.termsDigest,
        action: "/pay",
        recipient: instruction.recipient,
        resource: instruction.resource,
        purpose: instruction.purpose,
        context: {
          amount: instruction.amount,
          currency: instruction.currency,
        },
      };
      const sub = await provider.submit(req);
      const checked = provider.verify(sub, {
        capabilityId: redemption.chainId,
        termsDigest: op.termsDigest,
      });
      if (!checked.ok) throw new Error(`provider: ${checked.reason}`);
      return { ok: true, transaction: sub.externalRef };
    },
  };
}

/**
 * Domain-neutral provider execution (ADR-0018): any authorized action runs
 * here and returns an `ExecutionReceipt` with no payment-shaped fields —
 * email needs no amount, identity needs no currency. Payment flows keep
 * using `executeViaProvider` (explicit amount/currency, `Receipt`).
 * Requires proof of redemption carrying the exact authorized operation;
 * a verify failure throws before any receipt exists. `provider.verify` is
 * provider-attested: independent rail settlement checks
 * (`checkSettlement`, `verifyMandatePair`) remain host duty before trusting
 * `externalRef` for value movement (ADR-0005).
 */
export async function executeActionViaProvider(
  provider: ProtectedProvider,
  req: ProviderRequest,
  redemption: Redemption,
  at: number
): Promise<ExecutionReceipt> {
  checkRequest(req);
  const op = requireRedemption(redemption);
  if (redemption.chainId !== req.capabilityId) {
    throw new Error("provider: redemption is not bound to this request");
  }
  authorizedTermsCover(op, req);
  const sub = await provider.submit(req);
  const checked = provider.verify(sub, {
    capabilityId: req.capabilityId,
    termsDigest: req.termsDigest,
  });
  if (!checked.ok) throw new Error(`provider: ${checked.reason}`);
  return {
    receiptId: `rcpt-${randomHex(8)}`,
    capabilityId: req.capabilityId,
    recipient: req.recipient,
    resource: req.resource,
    purpose: req.purpose,
    transaction: sub.externalRef,
    at,
    termsDigest: req.termsDigest,
  };
}

/**
 * Payment-profile provider execution with receipt. Requires proof of
 * redemption bound to the request (`chainId === capabilityId`) and pins
 * `termsDigest` through `verify` — a verify failure throws before any receipt
 * exists. `provider.verify` is provider-attested: independent rail settlement
 * checks (`checkSettlement`, `verifyMandatePair`) remain host duty before
 * trusting `externalRef` for value movement (ADR-0005). Receipt reuses
 * `Receipt` with `transaction=externalRef`; amount/currency must ride
 * explicitly in context (0 and explicit values allowed) so the receipt never
 * invents terms the demand did not carry.
 */
export async function executeViaProvider(
  provider: ProtectedProvider,
  req: ProviderRequest,
  redemption: Redemption,
  at: number
): Promise<Receipt> {
  checkRequest(req);
  const op = requireRedemption(redemption);
  if (redemption.chainId !== req.capabilityId) {
    throw new Error("provider: redemption is not bound to this request");
  }
  if (op.cmd !== "/pay" && !op.cmd.startsWith("/pay/")) {
    throw new Error("provider: authorized cmd is not a payment");
  }
  authorizedTermsCover(op, req);
  const sub = await provider.submit(req);
  const checked = provider.verify(sub, {
    capabilityId: req.capabilityId,
    termsDigest: req.termsDigest,
  });
  if (!checked.ok) throw new Error(`provider: ${checked.reason}`);
  const amountRaw: unknown = (req.context as Record<string, unknown>)["amount"];
  const currencyRaw: unknown = (req.context as Record<string, unknown>)[
    "currency"
  ];
  if (
    typeof amountRaw !== "number" ||
    !Number.isFinite(amountRaw) ||
    amountRaw < 0
  ) {
    throw new Error(
      "provider: receipt needs context.amount as a non-negative finite number (pass explicitly; 0 allowed)"
    );
  }
  if (typeof currencyRaw !== "string" || currencyRaw.length === 0) {
    throw new Error(
      "provider: receipt needs context.currency as a non-empty string (pass explicitly)"
    );
  }
  const amount: number = amountRaw;
  const currency: string = currencyRaw;
  return {
    receiptId: `rcpt-${randomHex(8)}`,
    capabilityId: req.capabilityId,
    recipient: req.recipient,
    amount,
    currency,
    resource: req.resource,
    purpose: req.purpose,
    transaction: sub.externalRef,
    at,
    termsDigest: req.termsDigest,
  };
}

/** Canonical rendering for leak comparison; null when unrenderable. */
function tryCanonicalInstruction(v: unknown): string | null {
  try {
    return canonicalize(v);
  } catch {
    return null;
  }
}

/**
 * Orchestrator: use a `secret` vault record inside a provider call without
 * ever exposing the value (P0 agent data-delivery loop).
 *
 * Built ON TOP of the existing `useCredential` + `executeViaProvider`:
 * the secret value is visible only to the in-host `use` callback, which
 * builds a handles-only request, binds it to the redemption, executes,
 * and returns `{ receipt: receipt.transaction }` as the use-result
 * (leak-checked by `useCredential`). The captured `Receipt` is returned.
 *
 * `buildRequest` receives the full `SecretInstruction` (including `value`)
 * but MUST NEVER place the secret value in `context` — handles + refs
 * only (e.g. last-4, token refs, ids). This is enforced, not just
 * documented: the built request is scanned for the rendered secret before
 * submission (verbatim strings, canonical form when distinctive). Note the
 * trust boundary honestly: `buildRequest` runs in-host with the secret in
 * scope, exactly like a `useCredential` callback — review it like provider
 * code, with logging/egress controls. Receipts stay secret-free by
 * construction (`executeViaProvider` projects only amount/currency/etc),
 * and `useCredential` fails closed if the receipt echoes the secret.
 */
export async function executeWithCredential(
  vault: VaultStore,
  opts: {
    readonly ingress: VerifiedIdentity;
    readonly recordId: string;
    readonly purpose: string;
    readonly authority: Authority;
    readonly nowSec: number;
    readonly provider: ProtectedProvider;
    readonly redemption: Redemption;
    readonly buildRequest: (
      instr: SecretInstruction
    ) => Omit<ProviderRequest, "capabilityId">;
    readonly audit?: FileAuditLog;
    readonly at?: number;
  }
): Promise<Receipt> {
  let captured: Receipt | undefined;
  const at = opts.at ?? opts.nowSec;
  await useCredential(vault, {
    ingress: opts.ingress,
    recordId: opts.recordId,
    purpose: opts.purpose,
    authority: opts.authority,
    nowSec: opts.nowSec,
    ...(opts.audit !== undefined ? { audit: opts.audit } : {}),
    use: async (instr) => {
      const partial = opts.buildRequest(instr);
      // Enforcement for the handles-only rule above: distinctive secret
      // renderings (verbatim strings, canonical form >= 16 chars) must not
      // appear anywhere in the built request — including provider call logs,
      // which retain `context`. Short scalars stay uncovered (same residual
      // as the receipt leak guard; see limits.md vault row).
      const rendered =
        typeof instr.value === "string"
          ? instr.value
          : tryCanonicalInstruction(instr.value);
      const distinctive =
        rendered !== null &&
        (typeof instr.value === "string"
          ? rendered.length > 0
          : rendered.length >= 16);
      if (distinctive) {
        const encoded = canonicalize({ ...partial });
        if (encoded.includes(rendered as string)) {
          throw new Error(
            "provider: buildRequest leaked secret into provider request"
          );
        }
      }
      const req: ProviderRequest = {
        ...partial,
        capabilityId: opts.redemption.chainId,
      };
      const receipt = await executeViaProvider(
        opts.provider,
        req,
        opts.redemption,
        at
      );
      captured = receipt;
      return { receipt: receipt.transaction };
    },
  });
  if (captured === undefined) {
    throw new Error("provider: orchestrator produced no receipt");
  }
  return captured;
}

/**
 * Store-backed protected execution (ADR-0018): the production-safe path
 * for effectful secret use. Owns the full ordering — reload authority
 * fresh, consume, CAS-persist the consumption, THEN use the secret and
 * execute — so a crash between consumption and the external effect burns
 * a use instead of resurrecting one-time authority. A CAS conflict fails
 * closed before the secret is touched. Hosts supply the loaded vault
 * (they hold the DEK) and the provider; this function owns authority
 * freshness and persistence, which bare `useCredential` cannot
 * (persistence after success is already too late).
 */
export async function executeProtectedAction(opts: {
  readonly dir: string;
  readonly nowSec?: number;
  readonly ingress: VerifiedIdentity;
  readonly recordId: string;
  readonly purpose: string;
  readonly provider: ProtectedProvider;
  readonly redemption: Redemption;
  readonly buildRequest: (
    instr: SecretInstruction
  ) => Omit<ProviderRequest, "capabilityId">;
  readonly loadVaultState: () => VaultStore;
  readonly audit?: FileAuditLog;
  readonly at?: number;
}): Promise<Receipt> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const at = opts.at ?? nowSec;
  const authority = loadAuthority(opts.dir, { nowSec: () => nowSec });
  const vault = opts.loadVaultState();
  let captured: Receipt | undefined;
  await useCredential(vault, {
    ingress: opts.ingress,
    recordId: opts.recordId,
    purpose: opts.purpose,
    authority,
    nowSec,
    ...(opts.audit !== undefined ? { audit: opts.audit } : {}),
    onConsumed: () => {
      saveAuthority(opts.dir, authority);
    },
    use: async (instr) => {
      const partial = opts.buildRequest(instr);
      const rendered =
        typeof instr.value === "string"
          ? instr.value
          : tryCanonicalInstruction(instr.value);
      const distinctive =
        rendered !== null &&
        (typeof instr.value === "string"
          ? rendered.length > 0
          : rendered.length >= 16);
      if (distinctive) {
        const encoded = canonicalize({ ...partial });
        if (encoded.includes(rendered as string)) {
          throw new Error(
            "provider: buildRequest leaked secret into provider request"
          );
        }
      }
      const req: ProviderRequest = {
        ...partial,
        capabilityId: opts.redemption.chainId,
      };
      const receipt = await executeViaProvider(
        opts.provider,
        req,
        opts.redemption,
        at
      );
      captured = receipt;
      return { receipt: receipt.transaction };
    },
  });
  if (captured === undefined) {
    throw new Error("provider: orchestrator produced no receipt");
  }
  return captured;
}

/**
 * Provider outcome query for reconcile (ADR-0021): implemented by the host
 * rail (order lookup by idempotency key, receipt poll, ledger read). Fakes
 * in tests. "effected" carries the external ref as evidence; "absent"
 * permits exactly one safe retry with the same key; "unknown" quarantines.
 */
export interface ExecutionQuery {
  query(input: {
    readonly idempotencyKey: string;
    readonly capabilityId: string;
    readonly termsDigest: string;
  }): Promise<
    | { readonly state: "effected"; readonly externalRef: string }
    | { readonly state: "absent" }
    | { readonly state: "unknown" }
  >;
}

function receiptFromRecord(rec: ExecutionRecord): ExecutionReceipt {
  if (
    rec.state !== "SUCCEEDED" ||
    rec.receiptId === undefined ||
    rec.receiptAt === undefined ||
    rec.externalRef === undefined
  ) {
    throw new ExecutionError("journal: no succeeded receipt to return");
  }
  return {
    receiptId: rec.receiptId,
    capabilityId: rec.capabilityId,
    recipient: rec.recipient,
    resource: rec.resource,
    purpose: rec.purpose,
    transaction: rec.externalRef,
    at: rec.receiptAt,
    termsDigest: rec.termsDigest,
  };
}

/**
 * Journaled protected execution (ADR-0021, roadmap G3): every effectful run
 * persists an execution record before the provider call and reconciles
 * unknown outcomes via provider query instead of blind retry.
 *
 * Re-entrant by idempotency key: re-running identical terms returns the
 * stored SUCCEEDED receipt without touching the provider; FAILED_FINAL /
 * RECONCILED re-runs throw without touching the provider. Resume of an
 * unknown outcome REQUIRES the query result — without it, throws
 * `reconcile required` rather than guessing. Retries after a confirmed
 * absent outcome reuse the SAME derived key (budget fixed at create, then
 * quarantine). Authority consumption persistence stays the caller's duty
 * (see executeProtectedAction); the journal covers outcome safety. Note on
 * naming: journal AUTHORIZED means "validated redemption, cleared to
 * submit" — it is NOT the authority burn itself.
 */
export async function executeWithJournal(opts: {
  readonly dir: string;
  readonly provider: ProtectedProvider;
  readonly req: ProviderRequest;
  readonly redemption: Redemption;
  readonly query?: ExecutionQuery;
  readonly journal?: ExecutionRepository;
  readonly maxAttempts?: number;
  readonly nowSec?: number;
  readonly at?: number;
}): Promise<ExecutionReceipt> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const at = opts.at ?? nowSec;
  // Repository seam (ADR-0022): file backend by default; SQLite (or any
  // conforming store) opt-in. Same state machine either way.
  const J = opts.journal ?? FileExecutions;
  checkRequest(opts.req);
  const op = requireRedemption(opts.redemption);
  if (opts.redemption.chainId !== opts.req.capabilityId) {
    throw new Error("provider: redemption is not bound to this request");
  }
  authorizedTermsCover(op, opts.req);
  // Derived, never caller-supplied: same authorized terms always map to
  // the same key, so no caller can fork two effects from one terms set.
  const key = deriveIdempotencyKey(
    opts.req.termsDigest,
    opts.redemption.chainId
  );

  let rec = J.findByIdempotencyKey(opts.dir, key);
  if (rec !== null) {
    if (rec.state === "SUCCEEDED") return receiptFromRecord(rec);
    if (rec.state === "FAILED_FINAL") {
      throw new ExecutionError(
        "journal: execution already failed — new terms required"
      );
    }
    if (rec.state === "RECONCILED") {
      throw new AmbiguousExecutionError(
        rec.executionId,
        "journal: execution quarantined — manual reconciliation required"
      );
    }
    // Resume a live record from disk (fresh handle, never a stale copy).
    rec = J.load(opts.dir, rec.executionId);
  } else {
    rec = J.create(
      opts.dir,
      {
        idempotencyKey: key,
        capabilityId: opts.redemption.chainId,
        termsDigest: opts.req.termsDigest,
        action: opts.req.action,
        recipient: opts.req.recipient,
        resource: opts.req.resource,
        purpose: opts.req.purpose,
        context: opts.req.context,
        ...(opts.maxAttempts !== undefined
          ? { maxAttempts: opts.maxAttempts }
          : {}),
      },
      nowSec
    );
  }

  if (rec.state === "PREPARED") {
    rec = J.transition(opts.dir, rec.executionId, "AUTHORIZED", {}, nowSec);
  }
  if (rec.state === "SUBMITTING") {
    // Crash leftover: the provider may have been called with no persisted
    // result. Normalize to unknown before any further step.
    rec = J.transition(
      opts.dir,
      rec.executionId,
      "SUBMITTED_UNKNOWN",
      { lastError: "resume found submitting record: effect unknown" },
      nowSec
    );
  }
  if (rec.state === "SUBMITTED_UNKNOWN") {
    if (opts.query === undefined) {
      throw new AmbiguousExecutionError(
        rec.executionId,
        "journal: reconcile required — unknown outcome, query missing"
      );
    }
    const outcome = await opts.query.query({
      idempotencyKey: key,
      capabilityId: opts.redemption.chainId,
      termsDigest: opts.req.termsDigest,
    });
    if (outcome.state === "effected") {
      let externalRef: string;
      try {
        externalRef = assertExternalRef(outcome.externalRef);
      } catch {
        throw new ExecutionError("journal: query returned malformed ref");
      }
      rec = J.transition(
        opts.dir,
        rec.executionId,
        "SUCCEEDED",
        {
          externalRef,
          receiptId: `rcpt-${randomHex(8)}`,
          receiptAt: at,
        },
        nowSec
      );
      return receiptFromRecord(rec);
    }
    if (outcome.state === "unknown") {
      rec = J.transition(
        opts.dir,
        rec.executionId,
        "RECONCILED",
        {
          lastError: "reconcile: provider state unknowable",
          reconciledAt: nowSec,
        },
        nowSec
      );
      throw new AmbiguousExecutionError(
        rec.executionId,
        "journal: execution quarantined — manual reconciliation required"
      );
    }
    // Confirmed absent: exactly one safe retry, same key, budget fixed
    // at create (resume cannot re-arm it).
    if (rec.attempts >= rec.maxAttempts) {
      rec = J.transition(
        opts.dir,
        rec.executionId,
        "RECONCILED",
        {
          lastError: "reconcile: attempt budget exhausted",
          reconciledAt: nowSec,
        },
        nowSec
      );
      throw new AmbiguousExecutionError(
        rec.executionId,
        "journal: execution quarantined — manual reconciliation required"
      );
    }
    // Fall through to submit below with the same key.
  }
  if (isTerminal(rec)) {
    throw new ExecutionError("journal: unexpected terminal record on resume");
  }

  rec = J.transition(opts.dir, rec.executionId, "SUBMITTING", {}, nowSec);
  const reqWithKey: ProviderRequest = {
    ...opts.req,
    metadata: { ...(opts.req.metadata ?? {}), idempotencyKey: key },
  };
  let sub: ProviderSubmission;
  try {
    sub = await opts.provider.submit(reqWithKey);
  } catch {
    // Ambiguous: the call may or may not have taken effect server-side.
    // Persist unknown and surface the execution id — the caller reconciles,
    // never blind-retries. Fixed vocabulary: provider detail stays out.
    rec = J.transition(
      opts.dir,
      rec.executionId,
      "SUBMITTED_UNKNOWN",
      { lastError: "provider submission failed ambiguously" },
      nowSec
    );
    throw new AmbiguousExecutionError(
      rec.executionId,
      "journal: submission outcome unknown — reconcile required"
    );
  }
  const checked = opts.provider.verify(sub, {
    capabilityId: opts.req.capabilityId,
    termsDigest: opts.req.termsDigest,
  });
  if (!checked.ok) {
    // Attestation failure is NOT proof of no-effect: the rail may have
    // executed and only the confirmation is bad. Route to reconcile
    // (query decides), never to a terminal failure that would hide the ref.
    rec = J.transition(
      opts.dir,
      rec.executionId,
      "SUBMITTED_UNKNOWN",
      { lastError: "provider attestation failed" },
      nowSec
    );
    throw new AmbiguousExecutionError(
      rec.executionId,
      "journal: submission unverified — reconcile required"
    );
  }
  let externalRef: string;
  try {
    externalRef = assertExternalRef(sub.externalRef);
  } catch {
    rec = J.transition(
      opts.dir,
      rec.executionId,
      "SUBMITTED_UNKNOWN",
      { lastError: "provider returned malformed ref" },
      nowSec
    );
    throw new AmbiguousExecutionError(
      rec.executionId,
      "journal: submission unverified — reconcile required"
    );
  }
  rec = J.transition(
    opts.dir,
    rec.executionId,
    "SUCCEEDED",
    {
      externalRef,
      receiptId: `rcpt-${randomHex(8)}`,
      receiptAt: at,
    },
    nowSec
  );
  return receiptFromRecord(rec);
}
