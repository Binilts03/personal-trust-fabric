import type { AuthorityRequest } from "../core/authority.js";
import { digestForOperation } from "../core/authority.js";
import {
  b64uDecode,
  publicKeyFromP256Jwk,
  sha256b64uUtf8,
  verifyEs256Key,
} from "./jws.js";
import { parseAtomicAmount } from "./x402.js";

/**
 * AP2 mandate-pair verifier: evidence in, never authority out (ADR-0005).
 * Checks follow the deep read (docs/research/2026-09-09-deep-payments-x402-ap2.md):
 * SD-JWT shape, checkout_hash recompute, transaction_id linkage, cnf.jwk
 * identity across the open pair, KB-JWT binding for autonomous mode,
 * open/closed/KB expiry, real ES256 throughout. Key material arrives via
 * explicit parameters; nothing is fetched and nothing is resolved.
 * Amounts are minor units end-to-end (same atomic-unit rule as x402).
 */

export interface EcJwk {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
}

export interface MandateSet {
  readonly openCheckout: string;
  readonly openPayment: string;
  readonly closedCheckout: string;
  readonly closedPayment: string;
  readonly kbPayment?: string;
}

export interface Ap2Keys {
  /** Verifies the open SD-JWTs and direct-mode closed mandates. */
  readonly userKey: EcJwk;
  /** Verifies the merchant checkout JWT. */
  readonly merchantKey: EcJwk;
}

export interface VerifiedMandate {
  readonly payeeId: string;
  readonly payeeName: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly agentKey: EcJwk;
  readonly transactionId: string;
  readonly mode: "direct" | "autonomous";
}

export class Ap2Error extends Error {
  constructor(reason: string) {
    super(`ap2: ${reason}`);
  }
}

/** JWK-shape verification via the shared JWS module; malformed keys verify false. */
function verifyEs256(
  jwk: EcJwk,
  signingInput: string,
  sigB64u: string
): boolean {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return false;
  if (
    typeof jwk.x !== "string" ||
    jwk.x.length === 0 ||
    typeof jwk.y !== "string" ||
    jwk.y.length === 0
  ) {
    return false;
  }
  try {
    return verifyEs256Key(publicKeyFromP256Jwk(jwk), signingInput, sigB64u);
  } catch {
    return false;
  }
}

function jwkEqual(a: EcJwk, b: EcJwk): boolean {
  return a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
}

interface ParsedSdJwt {
  readonly payload: Record<string, unknown>;
  /** Full serialization minus any trailing KB (jwt + selected disclosures, each ~-terminated). */
  readonly presented: string;
}

function parseSdJwt(serialization: string, what: string): ParsedSdJwt {
  const parts = serialization.split("~");
  if (parts.length < 2) throw new Ap2Error(`${what}: not SD-JWT serialization`);
  const compact = parts[0] as string;
  const segs = compact.split(".");
  if (segs.length !== 3) throw new Ap2Error(`${what}: malformed JWS`);
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(
      b64uDecode(segs[0] as string).toString("utf8")
    ) as Record<string, unknown>;
    payload = JSON.parse(
      b64uDecode(segs[1] as string).toString("utf8")
    ) as Record<string, unknown>;
  } catch {
    throw new Ap2Error(`${what}: malformed JWS JSON`);
  }
  if (header["alg"] !== "ES256")
    throw new Ap2Error(`${what}: only ES256 accepted`);
  const disclosures = parts.slice(1, -1);
  const digests = payload["_sd"];
  if (digests !== undefined) {
    if (!Array.isArray(digests))
      throw new Ap2Error(`${what}: _sd must be an array`);
    const set = new Set(digests as unknown[]);
    for (const d of disclosures) {
      const digest = sha256b64uUtf8(d);
      if (!set.has(digest)) throw new Ap2Error(`${what}: undisclosed digest`);
    }
  }
  return { payload, presented: `${parts.slice(0, -1).join("~")}~` };
}

function requireVct(
  payload: Record<string, unknown>,
  expected: string,
  what: string
): void {
  if (payload["vct"] !== expected)
    throw new Ap2Error(`${what}: expected vct ${expected}`);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Ap2Error(`${what}: must be an object`);
  }
  return value as Record<string, unknown>;
}

function checkSig(compact: string, jwk: EcJwk, what: string): void {
  const segs = compact.split(".");
  const sig = segs[2] as string;
  const signingInput = segs.slice(0, 2).join(".");
  if (!verifyEs256(jwk, signingInput, sig))
    throw new Ap2Error(`${what}: bad signature`);
}

function checkExp(
  payload: Record<string, unknown>,
  now: number,
  what: string
): void {
  const exp = payload["exp"];
  if (typeof exp !== "number" || !Number.isFinite(exp))
    throw new Ap2Error(`${what}: missing exp`);
  if (now > exp) throw new Ap2Error(`${what}: expired`);
}

function parseMinorAmount(value: unknown): number {
  // Reuses x402's atomic-unit parser for strings (same digit/safe-int rule);
  // messages stay ap2-prefixed (checked: ap2.test.ts has no direct message match).
  if (typeof value === "string") {
    try {
      return parseAtomicAmount(value);
    } catch {
      throw new Ap2Error(
        "payment_amount.amount must be a positive safe integer"
      );
    }
  }
  const n = value as number;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) {
    throw new Ap2Error("payment_amount.amount must be a positive safe integer");
  }
  return n;
}

function getConstraints(
  payload: Record<string, unknown>,
  what: string
): unknown[] {
  const raw = payload["constraints"];
  if (raw === undefined) return [];
  if (!Array.isArray(raw))
    throw new Ap2Error(`${what}: constraints must be an array`);
  return raw;
}

/**
 * Enforce open-mandate constraints against the closed payment.
 * Known shapes (amount_range/max, allowed_payees/payees, allowed_merchants/
 * merchants) are checked; any other non-empty constraint type fails closed
 * as `unresolved_constraint` — the host must fall back to human-present per
 * the AP2 spec instead of silently overspending.
 */
function checkOpenConstraints(
  openCheckout: Record<string, unknown>,
  openPayment: Record<string, unknown>,
  closed: {
    readonly amountMinor: number;
    readonly currency: string;
    readonly payeeId?: string;
    readonly payeeName?: string;
  }
): void {
  const all = [
    ...getConstraints(openCheckout, "open-checkout").map((c) => ({
      c,
      what: "open-checkout",
    })),
    ...getConstraints(openPayment, "open-payment").map((c) => ({
      c,
      what: "open-payment",
    })),
  ];
  for (const { c, what } of all) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) {
      throw new Ap2Error(`${what}: unresolved_constraint (malformed)`);
    }
    const rec = c as Record<string, unknown>;
    const type = typeof rec["type"] === "string" ? (rec["type"] as string) : "";
    const isAmountRange =
      type.includes("amount_range") ||
      rec["max_amount"] !== undefined ||
      rec["maxAmount"] !== undefined ||
      rec["amount_max"] !== undefined;
    if (isAmountRange) {
      const cap =
        rec["max_amount"] ??
        rec["maxAmount"] ??
        rec["amount_max"] ??
        rec["max"];
      const capAmount =
        typeof cap === "object" && cap !== null
          ? (cap as Record<string, unknown>)["amount"]
          : cap;
      const capCurrency =
        typeof cap === "object" && cap !== null
          ? (cap as Record<string, unknown>)["currency"]
          : rec["currency"];
      if (capAmount !== undefined) {
        const max = parseMinorAmount(capAmount);
        if (closed.amountMinor > max) {
          throw new Ap2Error(`${what}: amount exceeds open constraint`);
        }
      }
      if (capCurrency !== undefined && capCurrency !== closed.currency) {
        throw new Ap2Error(`${what}: currency violates open constraint`);
      }
      continue;
    }
    const payeeList =
      rec["allowed_payees"] ?? rec["payees"] ?? rec["allowedPayees"];
    if (payeeList !== undefined) {
      if (
        !Array.isArray(payeeList) ||
        !payeeList.every((e) => typeof e === "string")
      ) {
        throw new Ap2Error(`${what}: unresolved_constraint (bad payee list)`);
      }
      const ids = payeeList as string[];
      const hit =
        (closed.payeeId !== undefined && ids.includes(closed.payeeId)) ||
        (closed.payeeName !== undefined && ids.includes(closed.payeeName));
      if (!hit) throw new Ap2Error(`${what}: payee outside open constraint`);
      continue;
    }
    const merchantList =
      rec["allowed_merchants"] ?? rec["merchants"] ?? rec["allowedMerchants"];
    if (merchantList !== undefined) {
      if (
        !Array.isArray(merchantList) ||
        !merchantList.every((e) => typeof e === "string")
      ) {
        throw new Ap2Error(
          `${what}: unresolved_constraint (bad merchant list)`
        );
      }
      const ids = merchantList as string[];
      const hit =
        (closed.payeeId !== undefined && ids.includes(closed.payeeId)) ||
        (closed.payeeName !== undefined && ids.includes(closed.payeeName));
      if (!hit) throw new Ap2Error(`${what}: merchant outside open constraint`);
      continue;
    }
    throw new Ap2Error(
      `${what}: unresolved_constraint ${type || "(typeless)"}`
    );
  }
}

/** Verify the full mandate set. Throws on the first failure: fail-closed, no partial trust. */
export function verifyMandatePair(
  set: MandateSet,
  opts: Ap2Keys & {
    readonly expectedAud: string;
    readonly nowSec: number;
    /** Session nonce the KB-JWT must carry. Absent = presence-only (document the replay window). */
    readonly expectedNonce?: string;
  }
): VerifiedMandate {
  const openCheckout = parseSdJwt(set.openCheckout, "open-checkout");
  const openPayment = parseSdJwt(set.openPayment, "open-payment");
  const closedCheckout = parseSdJwt(set.closedCheckout, "closed-checkout");
  const closedPayment = parseSdJwt(set.closedPayment, "closed-payment");

  // Open pair: user-signed, cnf-identical, unexpired.
  requireVct(openCheckout.payload, "mandate.checkout.open.1", "open-checkout");
  requireVct(openPayment.payload, "mandate.payment.open.1", "open-payment");
  checkSig(
    set.openCheckout.split("~")[0] as string,
    opts.userKey,
    "open-checkout"
  );
  checkSig(
    set.openPayment.split("~")[0] as string,
    opts.userKey,
    "open-payment"
  );
  checkExp(openCheckout.payload, opts.nowSec, "open-checkout");
  checkExp(openPayment.payload, opts.nowSec, "open-payment");
  const cnfCheckout = asRecord(
    openCheckout.payload["cnf"],
    "open-checkout cnf"
  );
  const cnfPayment = asRecord(openPayment.payload["cnf"], "open-payment cnf");
  const agentJwk = asRecord(
    cnfCheckout["jwk"],
    "open-checkout cnf.jwk"
  ) as unknown as EcJwk;
  const agentJwkB = asRecord(
    cnfPayment["jwk"],
    "open-payment cnf.jwk"
  ) as unknown as EcJwk;
  // Order-insensitive compare (same key, different serialization, must pass).
  if (!jwkEqual(agentJwk, agentJwkB)) {
    throw new Ap2Error("cnf.jwk differs across the open pair");
  }
  if (agentJwk.kty !== "EC" || agentJwk.crv !== "P-256")
    throw new Ap2Error("cnf.jwk must be a P-256 key");

  // Closed checkout: linkage recompute first, then merchant signature, then freshness.
  requireVct(closedCheckout.payload, "mandate.checkout.1", "closed-checkout");
  const checkoutJwt = closedCheckout.payload["checkout_jwt"];
  if (typeof checkoutJwt !== "string" || checkoutJwt.length === 0)
    throw new Ap2Error("closed-checkout: missing checkout_jwt");
  const recomputed = sha256b64uUtf8(checkoutJwt);
  if (closedCheckout.payload["checkout_hash"] !== recomputed) {
    throw new Ap2Error("closed-checkout: checkout_hash mismatch");
  }
  checkExp(closedCheckout.payload, opts.nowSec, "closed-checkout");
  const merchantSegs = checkoutJwt.split(".");
  if (merchantSegs.length !== 3)
    throw new Ap2Error("checkout_jwt: malformed JWS");
  let merchantHeader: Record<string, unknown>;
  try {
    merchantHeader = JSON.parse(
      b64uDecode(merchantSegs[0] as string).toString("utf8")
    ) as Record<string, unknown>;
  } catch {
    throw new Ap2Error("checkout_jwt: malformed header");
  }
  if (merchantHeader["alg"] !== "ES256")
    throw new Ap2Error("checkout_jwt: only ES256 accepted");
  checkSig(checkoutJwt, opts.merchantKey, "checkout_jwt");
  let merchantPayload: Record<string, unknown>;
  try {
    merchantPayload = JSON.parse(
      b64uDecode(merchantSegs[1] as string).toString("utf8")
    ) as Record<string, unknown>;
  } catch {
    throw new Ap2Error("checkout_jwt: malformed payload");
  }
  if (merchantPayload["exp"] !== undefined) {
    checkExp(merchantPayload, opts.nowSec, "checkout_jwt");
  }
  if (typeof merchantPayload["exp"] !== "number") {
    throw new Ap2Error("checkout_jwt: exp required (no immortal mandates)");
  }

  // Closed payment: bound to the verified cart, fresh, fields extracted.
  requireVct(closedPayment.payload, "mandate.payment.1", "closed-payment");
  checkExp(closedPayment.payload, opts.nowSec, "closed-payment");
  if (closedPayment.payload["transaction_id"] !== recomputed) {
    throw new Ap2Error("closed-payment: transaction_id not bound to checkout");
  }
  const amountObj = asRecord(
    closedPayment.payload["payment_amount"],
    "payment_amount"
  );
  const amountMinor = parseMinorAmount(amountObj["amount"]);
  const currency = amountObj["currency"];
  if (typeof currency !== "string" || currency.length === 0)
    throw new Ap2Error("payment_amount.currency missing");
  const payee = asRecord(closedPayment.payload["payee"], "payee");
  const payeeId = payee["id"];
  const payeeName = payee["name"];
  if (
    payeeId !== undefined &&
    (typeof payeeId !== "string" || payeeId.length === 0)
  ) {
    throw new Ap2Error("payee id must be a non-empty string");
  }
  if (
    payeeName !== undefined &&
    (typeof payeeName !== "string" || payeeName.length === 0)
  ) {
    throw new Ap2Error("payee name must be a non-empty string");
  }
  if (payeeId === undefined && payeeName === undefined) {
    throw new Ap2Error("payee needs an id or name");
  }
  checkOpenConstraints(openCheckout.payload, openPayment.payload, {
    amountMinor,
    currency,
    ...(typeof payeeId === "string" ? { payeeId } : {}),
    ...(typeof payeeName === "string" ? { payeeName } : {}),
  });

  // Closed signatures: user key (direct) or cnf agent key + mandatory KB (autonomous).
  const closedCheckoutJwt = set.closedCheckout.split("~")[0] as string;
  const closedPaymentJwt = set.closedPayment.split("~")[0] as string;
  let mode: "direct" | "autonomous";
  if (signsWith(closedCheckoutJwt, closedPaymentJwt, opts.userKey)) {
    mode = "direct";
  } else if (signsWith(closedCheckoutJwt, closedPaymentJwt, agentJwk)) {
    mode = "autonomous";
    if (set.kbPayment === undefined)
      throw new Ap2Error("autonomous: KB-JWT required");
    if (opts.expectedNonce === undefined) {
      throw new Ap2Error(
        "autonomous: expectedNonce required (no presence-only replay window)"
      );
    }
    verifyKb(
      set.kbPayment,
      agentJwk,
      closedPayment.presented,
      opts.expectedAud,
      opts.expectedNonce,
      opts.nowSec
    );
  } else {
    throw new Ap2Error("closed mandates signed by neither user nor agent key");
  }
  return {
    payeeId: (payeeId as string | undefined) ?? (payeeName as string),
    payeeName: (payeeName as string | undefined) ?? (payeeId as string),
    amountMinor,
    currency,
    agentKey: agentJwk,
    transactionId: recomputed,
    mode,
  };
}

function signsWith(
  checkoutJwt: string,
  paymentJwt: string,
  jwk: EcJwk
): boolean {
  return [checkoutJwt, paymentJwt].every((compact) => {
    const segs = compact.split(".");
    return (
      segs.length === 3 &&
      verifyEs256(jwk, `${segs[0]}.${segs[1]}`, segs[2] as string)
    );
  });
}

function verifyKb(
  kbRaw: string,
  agentJwk: EcJwk,
  presentedSdJwt: string,
  expectedAud: string,
  expectedNonce: string | undefined,
  nowSec: number
): void {
  const segs = kbRaw.split(".");
  if (segs.length !== 3) throw new Ap2Error("KB-JWT: malformed JWS");
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(
      b64uDecode(segs[0] as string).toString("utf8")
    ) as Record<string, unknown>;
    payload = JSON.parse(
      b64uDecode(segs[1] as string).toString("utf8")
    ) as Record<string, unknown>;
  } catch {
    throw new Ap2Error("KB-JWT: malformed JSON");
  }
  if (header["alg"] !== "ES256")
    throw new Ap2Error("KB-JWT: only ES256 accepted");
  if (header["typ"] !== "kb+jwt")
    throw new Ap2Error("KB-JWT: typ must be kb+jwt");
  if (typeof payload["iat"] !== "number" || !Number.isFinite(payload["iat"]))
    throw new Ap2Error("KB-JWT: iat required");
  if (payload["aud"] !== expectedAud)
    throw new Ap2Error("KB-JWT: audience mismatch");
  if (
    typeof payload["nonce"] !== "string" ||
    (payload["nonce"] as string).length === 0
  ) {
    throw new Ap2Error("KB-JWT: nonce required");
  }
  if (expectedNonce !== undefined && payload["nonce"] !== expectedNonce) {
    throw new Ap2Error("KB-JWT: nonce not bound to this session");
  }
  // KB-JWTs always expire: freshness is part of the binding, not optional.
  checkExp(payload, nowSec, "KB-JWT");
  if (payload["sd_hash"] !== sha256b64uUtf8(presentedSdJwt))
    throw new Ap2Error("KB-JWT: sd_hash mismatch");
  if (!verifyEs256(agentJwk, `${segs[0]}.${segs[1]}`, segs[2] as string)) {
    throw new Ap2Error("KB-JWT: bad signature");
  }
}

export interface Ap2DemandContext {
  readonly principal: string;
  readonly agent: string;
  readonly purpose: string;
  readonly resource: string;
}

/**
 * Verified mandate -> PTF demand + capability args. Still evidence: must pass
 * Authority + Capabilities. AP2 exception to derive-never-trust: the verified
 * mandate cryptographically binds `transactionId` (== checkout_hash), so it is
 * folded into context and covered by the PTF-derived digest.
 */
export function toAp2PaymentDemand(
  verified: VerifiedMandate,
  ctx: Ap2DemandContext
): {
  readonly demand: AuthorityRequest;
  readonly capabilityArgs: {
    readonly amount: number;
    readonly currency: string;
  };
} {
  const operation = {
    principal: ctx.principal,
    actor: ctx.agent,
    action: { name: "/pay" as const },
    resource: { type: "ap2-payment", id: ctx.resource },
    context: {
      recipient: verified.payeeId,
      amount: verified.amountMinor,
      currency: verified.currency,
      transactionId: verified.transactionId,
    },
    purpose: ctx.purpose,
  };
  const demand: AuthorityRequest = {
    ...operation,
    termsDigest: digestForOperation(operation),
  };
  return {
    demand,
    capabilityArgs: {
      amount: verified.amountMinor,
      currency: verified.currency,
    },
  };
}
