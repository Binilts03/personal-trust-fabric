import type { AuthorityOperation } from "../core/authority.js";
import { CLOCK_SKEW_SEC } from "../core/canonical.js";
import { isRecord, reqString } from "./guards.js";
import { parseAtomicAmount } from "./x402.js";

/**
 * P3P (Pine Labs Payments Protocol) adapter — evidence in, never authority
 * out (ADR-0005, ADR-0019).
 *
 * Thin translator only. It normalizes a P3P payment challenge into a PTF
 * `/pay` demand and checks a recorded P3P receipt against opt-in
 * expectations. It never touches the network, never holds secrets, and never
 * replicates `p3p-client-sdk` / `p3p-server-sdk` (challenge/token/retry/
 * capture mechanics stay host-side behind the existing
 * `ProtectedProvider` seam).
 *
 * Amounts stay in paise (INR minor units) end-to-end: PTF ceilings for P3P
 * flows MUST be expressed in paise. No decimal shifting here — shifting
 * silently changes value and belongs to no trust layer (same atomic-unit
 * rule as x402/AP2).
 *
 * Grantex JWT scopes (`mpp:payment:initiate`,
 * `mpp:payment:max_txn_paise:<n>`) and Pine mandates are EXTERNAL evidence:
 * `grantexScopeAllows` is a citation helper only. A PTF Standing Grant is
 * still required — external scopes never mint local authority.
 *
 * Wire note (spike limit): the exact `WWW-Authenticate` challenge encoding
 * is host-parsed (server SDK `decidePayment` problemDetails or the host's
 * own header parser). Hosts pass the decoded challenge OBJECT to
 * `parseP3PChallenge`; this adapter does not guess header string formats.
 */

export type P3PPaymentMethod = "RESERVE_PAY" | "OTM" | "CARD";

const PAYMENT_METHODS: readonly P3PPaymentMethod[] = [
  "RESERVE_PAY",
  "OTM",
  "CARD",
];

/** Scope that gates an agent's ability to initiate payments (evidence). */
export const GRANTEX_SCOPE_INITIATE = "mpp:payment:initiate";

/** Prefix for concrete per-transaction caps, value in paise (evidence). */
export const GRANTEX_SCOPE_MAX_TXN_PREFIX = "mpp:payment:max_txn_paise:";

export class P3PError extends Error {
  constructor(reason: string) {
    super(`p3p: ${reason}`);
  }
}

/**
 * Normalized P3P payment challenge (host-decoded). `amountPaise` is a paise
 * integer STRING (same digit/safe-int rule as x402 atomic amounts).
 * `mandateRef` / `idempotencyKey` are evidence pointers folded into the
 * demand context — never authority by themselves.
 */
export interface P3PChallenge {
  readonly amountPaise: string;
  readonly currency: string;
  readonly resource: string;
  readonly recipient: string;
  readonly expiresAt: number;
  readonly paymentMethod: P3PPaymentMethod;
  readonly mandateRef?: string;
  readonly idempotencyKey?: string;
}

function checkExpiresAt(v: unknown): number {
  if (
    typeof v !== "number" ||
    !Number.isSafeInteger(v) ||
    v <= 0
  ) {
    throw new P3PError("expiresAt must be a positive epoch integer");
  }
  return v;
}

function checkResource(v: unknown): string {
  const s = reqString(v, "p3p: missing/invalid resource");
  if (
    !s.startsWith("/") &&
    !s.startsWith("https://") &&
    !s.startsWith("http://")
  ) {
    throw new P3PError("resource must be a /-path or http(s) URL");
  }
  return s;
}

function checkPaymentMethod(v: unknown): P3PPaymentMethod {
  if (typeof v !== "string" || !PAYMENT_METHODS.includes(v as P3PPaymentMethod)) {
    throw new P3PError(
      `paymentMethod must be one of ${PAYMENT_METHODS.join("|")}`
    );
  }
  return v as P3PPaymentMethod;
}

/**
 * Validate a host-decoded challenge object. Throws before touching
 * authority. Unknown fields are ignored; known fields fail closed.
 */
export function parseP3PChallenge(value: unknown): P3PChallenge {
  if (!isRecord(value)) throw new P3PError("challenge must be an object");
  const amountPaise = reqString(
    value["amountPaise"] ?? value["amount"],
    "p3p: missing/invalid amountPaise"
  );
  try {
    parseAtomicAmount(amountPaise);
  } catch {
    throw new P3PError(
      "amountPaise must be a positive safe-integer paise string"
    );
  }
  const currency = reqString(value["currency"], "p3p: missing/invalid currency");
  const resource = checkResource(value["resource"]);
  const recipient = reqString(value["recipient"] ?? value["payee"], "p3p: missing/invalid recipient");
  const expiresAt = checkExpiresAt(value["expiresAt"] ?? value["exp"]);
  const paymentMethod = checkPaymentMethod(
    value["paymentMethod"] ?? value["method"]
  );
  const mandateRaw = value["mandateRef"];
  const idemRaw = value["idempotencyKey"];
  let mandateRef: string | undefined;
  let idempotencyKey: string | undefined;
  if (mandateRaw !== undefined) {
    mandateRef = reqString(mandateRaw, "p3p: invalid mandateRef");
  }
  if (idemRaw !== undefined) {
    idempotencyKey = reqString(idemRaw, "p3p: invalid idempotencyKey");
  }
  return {
    amountPaise,
    currency,
    resource,
    recipient,
    expiresAt,
    paymentMethod,
    ...(mandateRef !== undefined ? { mandateRef } : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  };
}

/**
 * Evidence-only Grantex scope check (citation helper, never authority).
 * Requires `mpp:payment:initiate` plus at least one concrete
 * `mpp:payment:max_txn_paise:<n>` cap with `n >= amountPaise`. A missing or
 * insufficient cap fails closed HERE so the host can cite it — the PTF
 * Standing Grant check still runs independently in `Authority.evaluate`.
 */
export function grantexScopeAllows(
  scopes: readonly string[],
  amountPaise: number
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!Array.isArray(scopes) || !scopes.every((s) => typeof s === "string")) {
    return { ok: false, reason: "malformed scopes" };
  }
  if (!scopes.includes(GRANTEX_SCOPE_INITIATE)) {
    return { ok: false, reason: "missing mpp:payment:initiate" };
  }
  let best: number | undefined;
  for (const s of scopes) {
    if (!s.startsWith(GRANTEX_SCOPE_MAX_TXN_PREFIX)) continue;
    const raw = s.slice(GRANTEX_SCOPE_MAX_TXN_PREFIX.length);
    if (!/^\d+$/.test(raw)) continue;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n <= 0) continue;
    if (best === undefined || n > best) best = n;
  }
  if (best === undefined) {
    return { ok: false, reason: "missing max_txn cap (evidence only)" };
  }
  if (amountPaise > best) {
    return { ok: false, reason: "amount exceeds Grantex max_txn cap" };
  }
  return { ok: true };
}

/**
 * Identity-free demand context (ADR-0013): identity comes from verified
 * ingress, never from the adapter. The caller supplies only terms
 * (purpose/resource/currency + policy-selected expectations); the host
 * binds identity at `evaluate` time.
 */
export interface P3PDemandContext {
  readonly purpose: string;
  readonly resource: string;
  readonly currency: string;
  /**
   * Bind the external route to the demand: pass the challenge's resource
   * here (or the route the host selected). Mismatch throws instead of
   * authorizing a different resource for this challenge.
   */
  readonly expectedResource?: string;
  readonly expectedPaymentMethod?: P3PPaymentMethod;
  readonly expectedRecipient?: string;
}

/**
 * One challenge → identity-free PTF operation + capability args.
 * Still evidence: must pass Authority + Capabilities under the host's
 * verified ingress. Fail-closed checks (freshness, resource/currency/
 * recipient/method match, paise amount) are unchanged from the x402/AP2
 * pattern. `nowSec` is REQUIRED (epoch seconds): an expired challenge never
 * reaches authority, and a caller that forgets freshness does not compile.
 */
export function toP3PPaymentDemand(
  challenge: P3PChallenge,
  ctx: P3PDemandContext,
  nowSec: number
): {
  readonly operation: AuthorityOperation;
  readonly capabilityArgs: {
    readonly amount: number;
    readonly currency: string;
    readonly paymentMethod: P3PPaymentMethod;
  };
} {
  if (!Number.isSafeInteger(nowSec) || nowSec < 0) {
    throw new P3PError("nowSec must be a non-negative epoch integer");
  }
  if (nowSec > challenge.expiresAt + CLOCK_SKEW_SEC) {
    throw new P3PError("challenge expired — request a fresh challenge");
  }
  const ctxRec = ctx as unknown as Record<string, unknown>;
  const purpose = reqString(ctxRec["purpose"], "p3p: missing purpose");
  const resource = reqString(ctxRec["resource"], "p3p: missing resource");
  const currency = reqString(ctxRec["currency"], "p3p: missing currency");
  if (ctx.expectedResource !== undefined && challenge.resource !== ctx.expectedResource) {
    throw new P3PError("resource mismatch: challenge not selected by policy");
  }
  if (resource !== challenge.resource) {
    throw new P3PError("resource does not match challenge resource");
  }
  if (currency !== challenge.currency) {
    throw new P3PError("currency mismatch: demand must use challenge currency");
  }
  if (
    ctx.expectedPaymentMethod !== undefined &&
    challenge.paymentMethod !== ctx.expectedPaymentMethod
  ) {
    throw new P3PError("paymentMethod mismatch: challenge not selected by policy");
  }
  if (
    ctx.expectedRecipient !== undefined &&
    challenge.recipient !== ctx.expectedRecipient
  ) {
    throw new P3PError("recipient mismatch: challenge not selected by policy");
  }
  let amount: number;
  try {
    amount = parseAtomicAmount(challenge.amountPaise);
  } catch {
    throw new P3PError("amountPaise must be a positive safe-integer paise string");
  }
  const operation: AuthorityOperation = {
    action: { name: "/pay" as const },
    resource: { type: "p3p-payment", id: resource },
    context: {
      recipient: challenge.recipient,
      amount,
      currency,
      paymentMethod: challenge.paymentMethod,
      ...(challenge.mandateRef !== undefined
        ? { mandateRef: challenge.mandateRef }
        : {}),
      ...(challenge.idempotencyKey !== undefined
        ? { idempotencyKey: challenge.idempotencyKey }
        : {}),
    },
    purpose,
  };
  return {
    operation,
    capabilityArgs: {
      amount,
      currency,
      paymentMethod: challenge.paymentMethod,
    },
  };
}

export interface P3PReceipt {
  readonly success: boolean;
  readonly transaction: string;
  readonly paymentMethod?: string;
  readonly amountPaise?: string;
  readonly currency?: string;
  readonly idempotencyKey?: string;
  readonly mandateRef?: string;
  readonly errorReason?: string;
}

/**
 * Evidence-only receipt check, mirroring `checkSettlement`: success must be
 * true, transaction non-empty, opt-in expectations enforced when supplied.
 * `provider.verify` stays provider-attested — independent Pine debit-status
 * confirmation (`getDebitStatus` until terminal SUCCESS/FAILED) remains host
 * duty before trusting `transaction` for value movement (ADR-0005).
 */
export function checkP3PReceipt(
  result: P3PReceipt,
  expected: {
    readonly amountPaise?: string;
    readonly currency?: string;
    readonly paymentMethod?: string;
    readonly idempotencyKey?: string;
  }
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (typeof result !== "object" || result === null) {
    return { ok: false, reason: "malformed receipt" };
  }
  if (!result.success) {
    return { ok: false, reason: result.errorReason ?? "capture failed" };
  }
  if (typeof result.transaction !== "string" || result.transaction.length === 0) {
    return { ok: false, reason: "missing transaction" };
  }
  if (
    expected.amountPaise !== undefined &&
    result.amountPaise !== undefined &&
    result.amountPaise !== expected.amountPaise
  ) {
    return { ok: false, reason: "amount mismatch" };
  }
  if (
    expected.currency !== undefined &&
    result.currency !== undefined &&
    result.currency !== expected.currency
  ) {
    return { ok: false, reason: "currency mismatch" };
  }
  if (
    expected.paymentMethod !== undefined &&
    result.paymentMethod !== undefined &&
    result.paymentMethod !== expected.paymentMethod
  ) {
    return { ok: false, reason: "paymentMethod mismatch" };
  }
  if (
    expected.idempotencyKey !== undefined &&
    result.idempotencyKey !== undefined &&
    result.idempotencyKey !== expected.idempotencyKey
  ) {
    return { ok: false, reason: "idempotencyKey mismatch" };
  }
  return { ok: true };
}

/**
 * Host-owned P3P execution boundary (spike shape, no network here): the
 * external system executes via the host's own `p3p-client-sdk` /
 * `p3p-server-sdk` wiring with vault-held secrets, PTF only verifies the
 * recorded receipt with `checkP3PReceipt`. Production wiring is host-side;
 * tests use `FakeProvider("payment")` + a recorded `P3PReceipt`.
 */
export interface P3PHost {
  capture(credential: string): Promise<P3PReceipt>;
  getDebitStatus(idempotencyKey: string): Promise<P3PReceipt>;
}
