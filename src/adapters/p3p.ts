import type { AuthorityOperation } from "../core/authority.js";
import { isRecord, reqString } from "./guards.js";

/**
 * P3P adapter — evidence in, never authority out (ADR-0005, ADR-0019).
 *
 * P3P (Pine Labs Payments Protocol) is an HTTP-native paid-resource flow:
 * request → `402` + `WWW-Authenticate: Payment <challenge>` → one-time
 * payment credential → retry with `P3P-Credential` (+ `X-Grantex-Token`
 * when the server enforces Grantex) → capture → `Payment-Receipt`.
 * Grantex supplies delegated authorization (agent id + scopes + grant JWT);
 * it is external evidence, never PTF authority.
 *
 * This adapter is intentionally thin and SDK-agnostic:
 * - It normalizes an SDK/host-decoded challenge into `P3pChallenge` and maps
 *   it to an identity-free PTF `/pay` operation (amounts in paise, minor
 *   units — no decimal shifting here, same discipline as x402 atomic units).
 * - It verifies a `Payment-Receipt` against the authorized operation.
 * - It NEVER touches provider credentials: no `PINELABS_CLIENT_SECRET`,
 *   Grantex API key, grant token, one-time payment token, PAN, or UPI
 *   credential appears in any input, output, receipt, or error string.
 *   Credential creation and capture live behind `P3pProtectedExecutor`
 *   (host duty, official Pine Labs SDK, trusted environment only).
 *
 * Challenge-id + method binding: `p3pChallengeId` and `p3pMethod` ride in
 * the operation context, so the PTF-derived terms digest covers them —
 * a swapped challenge or method fails closed on terms at evaluate/redeem
 * time. Execution itself uses the fixed-field `PaymentInstruction`
 * (recipient/amount/currency/resource/purpose/termsDigest); the digest
 * transitively binds the P3P fields.
 *
 * Sandbox: UAT base `https://pluraluat.v2.pinepg.in`, token via
 * `POST /api/auth/v1/token` (client_credentials). Credentials come from
 * the host environment, never from PTF stores or agent input.
 */

export class P3pError extends Error {
  constructor(reason: string) {
    super(`p3p: ${reason}`);
  }
}

/** Payment methods live on P3P today (challenge advertises a subset). */
export const P3P_METHODS = ["RESERVE_PAY", "OTM", "CARD"] as const;
export type P3pPaymentMethod = (typeof P3P_METHODS)[number];

function isMethod(v: unknown): v is P3pPaymentMethod {
  return (
    typeof v === "string" && (P3P_METHODS as readonly string[]).includes(v)
  );
}

/** Paise integer (minor units): positive safe integer, no decimals. */
export function parsePaiseAmount(raw: unknown): number {
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw <= 0)
      throw new P3pError(`amount out of safe range: ${String(raw)}`);
    return raw;
  }
  if (typeof raw === "string") {
    if (!/^\d+$/.test(raw))
      throw new P3pError(`amount must be a paise integer, got ${raw}`);
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n <= 0)
      throw new P3pError(`amount out of safe range: ${raw}`);
    return n;
  }
  throw new P3pError("amount must be a paise integer");
}

function parseCurrency(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Z]{3}$/.test(raw))
    throw new P3pError("currency must be a 3-letter ISO code");
  return raw;
}

export interface P3pChallenge {
  readonly challengeId: string;
  readonly amountPaise: number;
  readonly currency: string;
  readonly resource: string;
  readonly merchant: string;
  readonly expiresAt: number;
  readonly paymentMethods: readonly P3pPaymentMethod[];
}

/**
 * Validate a host/SDK-decoded P3P challenge. Unknown extra fields are
 * ignored AND never echoed into the normalized output (freshly built
 * below), so a grant token or PAN smuggled alongside the challenge cannot
 * propagate. Throws before any authority is involved.
 */
export function normalizeP3pChallenge(
  input: unknown,
  nowSec: number = Math.floor(Date.now() / 1000)
): P3pChallenge {
  if (!isRecord(input)) throw new P3pError("challenge must be an object");
  const challengeId = reqString(
    input["challengeId"],
    "p3p: missing/invalid challengeId"
  );
  if (challengeId.length > 256)
    throw new P3pError("challengeId exceeds 256 chars");
  const amountPaise = parsePaiseAmount(input["amountPaise"] ?? input["amount"]);
  const currency = parseCurrency(input["currency"]);
  const resource = reqString(
    input["resource"],
    "p3p: missing/invalid resource"
  );
  if (!resource.startsWith("/"))
    throw new P3pError("resource must be a route path starting with /");
  if (resource.length > 512) throw new P3pError("resource exceeds 512 chars");
  const merchant = reqString(
    input["merchant"],
    "p3p: missing/invalid merchant"
  );
  if (merchant.length > 256) throw new P3pError("merchant exceeds 256 chars");
  const expiresAt = input["expiresAt"];
  if (
    typeof expiresAt !== "number" ||
    !Number.isInteger(expiresAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= 0
  )
    throw new P3pError("missing/invalid expiresAt");
  if (expiresAt <= nowSec) throw new P3pError("challenge expired");
  const methods = input["paymentMethods"] ?? input["methods"];
  if (!Array.isArray(methods) || methods.length === 0)
    throw new P3pError("paymentMethods must be non-empty");
  for (const m of methods) {
    if (!isMethod(m))
      throw new P3pError(`unsupported payment method: ${String(m)}`);
  }
  return {
    challengeId,
    amountPaise,
    currency,
    resource,
    merchant,
    expiresAt,
    paymentMethods: [...(methods as P3pPaymentMethod[])],
  };
}

export interface P3pDemandContext {
  readonly purpose: string;
  readonly resource: string;
  readonly currency: string;
  /**
   * Bind the PTF resource id to the challenged route: the demand authorizes
   * exactly the route the server challenged, nothing else.
   */
  readonly expectedResourcePath?: string;
  readonly expectedMerchant?: string;
  readonly expectedMethod?: P3pPaymentMethod;
}

/**
 * One normalized challenge → identity-free PTF operation + capability args.
 * Still evidence: must pass Authority + Capabilities under the host's
 * verified ingress. Identity comes from ingress (ADR-0013), never here.
 */
export function toP3pPaymentDemand(
  challenge: P3pChallenge,
  ctx: P3pDemandContext
): {
  readonly operation: AuthorityOperation;
  readonly capabilityArgs: {
    readonly amount: number;
    readonly currency: string;
    readonly p3pChallengeId: string;
    readonly p3pMethod: P3pPaymentMethod;
  };
} {
  if (
    ctx.expectedResourcePath !== undefined &&
    ctx.resource !== ctx.expectedResourcePath
  )
    throw new P3pError("resource does not match challenged route");
  if (challenge.resource !== ctx.resource)
    throw new P3pError(
      "challenge is for a different resource: obtain a fresh challenge"
    );
  if (challenge.currency !== ctx.currency)
    throw new P3pError("challenge currency does not match authorized currency");
  if (
    ctx.expectedMerchant !== undefined &&
    challenge.merchant !== ctx.expectedMerchant
  )
    throw new P3pError(
      "merchant mismatch: challenge not from the authorized merchant"
    );
  const method =
    ctx.expectedMethod !== undefined
      ? ctx.expectedMethod
      : challenge.paymentMethods[0];
  if (method === undefined || !challenge.paymentMethods.includes(method))
    throw new P3pError("payment method not advertised by the challenge");
  const operation: AuthorityOperation = {
    action: { name: "/pay" as const },
    resource: { type: "p3p-payment", id: ctx.resource },
    context: {
      recipient: challenge.merchant,
      amount: challenge.amountPaise,
      currency: ctx.currency,
      p3pChallengeId: challenge.challengeId,
      p3pMethod: method,
    },
    purpose: ctx.purpose,
  };
  return {
    operation,
    capabilityArgs: {
      amount: challenge.amountPaise,
      currency: ctx.currency,
      p3pChallengeId: challenge.challengeId,
      p3pMethod: method,
    },
  };
}

export interface P3pReceipt {
  readonly success: boolean;
  readonly transactionId: string;
  readonly amountPaise: number;
  readonly currency: string;
  readonly resource: string;
  readonly merchant: string;
  readonly challengeId: string;
  readonly errorReason?: string;
}

/**
 * Verify a `Payment-Receipt` against the authorized operation. Any binding
 * mismatch fails closed; replay within the caller-supplied seen-set fails
 * closed (`seenChallengeIds` is host-owned, same duty as verifier nonces).
 * Unknown receipt fields are never trusted and never echoed.
 */
export function verifyP3pReceipt(
  receipt: unknown,
  expected: {
    readonly amountPaise: number;
    readonly currency: string;
    readonly resource: string;
    readonly merchant: string;
    readonly challengeId: string;
  },
  opts: {
    readonly nowSec?: number;
    readonly seenChallengeIds?: Set<string>;
    readonly maxReceiptAgeSec?: number;
    readonly capturedAt?: number;
  } = {}
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!isRecord(receipt)) return { ok: false, reason: "malformed receipt" };
  if (receipt["success"] !== true)
    return {
      ok: false,
      reason:
        typeof receipt["errorReason"] === "string" &&
        receipt["errorReason"].length > 0
          ? receipt["errorReason"]
          : "receipt reports failure",
    };
  const transactionId = receipt["transactionId"];
  if (typeof transactionId !== "string" || transactionId.length === 0)
    return { ok: false, reason: "missing transaction" };
  let amountPaise: number;
  try {
    amountPaise = parsePaiseAmount(receipt["amountPaise"] ?? receipt["amount"]);
  } catch {
    return { ok: false, reason: "malformed amount" };
  }
  if (amountPaise !== expected.amountPaise)
    return { ok: false, reason: "amount mismatch" };
  if (receipt["currency"] !== expected.currency)
    return { ok: false, reason: "currency mismatch" };
  if (receipt["resource"] !== expected.resource)
    return { ok: false, reason: "resource mismatch" };
  if (receipt["merchant"] !== expected.merchant)
    return { ok: false, reason: "merchant mismatch" };
  if (receipt["challengeId"] !== expected.challengeId)
    return { ok: false, reason: "challenge mismatch" };
  if (opts.capturedAt !== undefined && opts.maxReceiptAgeSec !== undefined) {
    const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
    if (
      !Number.isInteger(opts.capturedAt) ||
      now - opts.capturedAt > opts.maxReceiptAgeSec
    )
      return { ok: false, reason: "stale receipt" };
  }
  if (opts.seenChallengeIds !== undefined) {
    if (opts.seenChallengeIds.has(expected.challengeId))
      return { ok: false, reason: "replay" };
    opts.seenChallengeIds.add(expected.challengeId);
  }
  return { ok: true };
}

/**
 * Host-owned protected-execution seam. The host implements credential
 * creation (`POST /mpp/v1/token` via the official SDK), the retry with
 * `P3P-Credential` + `X-Grantex-Token`, and capture — all inside the
 * trusted environment holding `PINELABS_CLIENT_ID`, `PINELABS_CLIENT_SECRET`,
 * `GRANTEX_API_KEY`, and the server-side grant token. PTF supplies only the
 * normalized challenge, the selected method, the grant SCOPE NAME (never the
 * grant token), and a stable idempotency key. The result carries external
 * refs as evidence; verify with `verifyP3pReceipt` before trusting it.
 */
export interface P3pProtectedExecutor {
  executePaidRoute(input: {
    readonly challenge: P3pChallenge;
    readonly paymentMethod: P3pPaymentMethod;
    /** Scope NAME the grant must carry (e.g. "mpp:payment:initiate") — never a token. */
    readonly requiredScope: string;
    /** Stable per authorized terms (derive from termsDigest). */
    readonly idempotencyKey: string;
  }): Promise<P3pReceipt>;
}

/** Sandbox wiring contract (host duty): env-sourced config, secret-free instruction. */
export interface P3pSandboxConfig {
  readonly baseUrl: string;
  readonly clientIdRef: string;
  readonly grantexAgentRef: string;
}
