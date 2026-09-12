import { createHash, createPublicKey, verify } from "node:crypto";
import type { AuthorityDemand } from "../core/authority.js";

/**
 * AP2 mandate-pair verifier — evidence in, never authority out (ADR-0005).
 * Checks follow the deep read (`docs/research/2026-09-09-deep-payments-x402-ap2.md`):
 * SD-JWT shape → checkout_hash recompute → transaction_id linkage → cnf.jwk
 * identity across the open pair → KB-JWT binding for autonomous mode →
 * open expiry → real ES256 throughout. Key material arrives via explicit
 * parameters; nothing is fetched and nothing is resolved.
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

const b64uDecode = (s: string): Buffer => Buffer.from(s, "base64url");
const sha256b64u = (ascii: string): string =>
  createHash("sha256").update(ascii, "ascii").digest().toString("base64url");

function rawToDer(raw: Buffer): Buffer {
  if (raw.length !== 64) throw new Ap2Error("ES256 signature must be 64 bytes");
  const norm = (b: Buffer): Buffer => {
    const t = b[0] === 0 ? b.slice(1) : b;
    return t.length < 32 ? Buffer.concat([Buffer.alloc(32 - t.length), t]) : t;
  };
  const r = norm(raw.slice(0, 32));
  const s = norm(raw.slice(32, 64));
  const enc = (b: Buffer): Buffer =>
    b[0] !== undefined && b[0] >= 0x80
      ? Buffer.concat([Buffer.from([0]), b])
      : b;
  const rb = enc(r);
  const sb = enc(s);
  return Buffer.concat([
    Buffer.from([0x30, 2 + rb.length + 2 + sb.length, 0x02, rb.length]),
    rb,
    Buffer.from([0x02, sb.length]),
    sb,
  ]);
}

function verifyEs256(
  jwk: EcJwk,
  signingInput: string,
  sigB64u: string
): boolean {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return false;
  try {
    const key = createPublicKey({ key: jwk as never, format: "jwk" });
    return verify(
      "sha256",
      Buffer.from(signingInput, "ascii"),
      key,
      rawToDer(b64uDecode(sigB64u))
    );
  } catch {
    return false;
  }
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
      const digest = sha256b64u(d);
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
  const n =
    typeof value === "string"
      ? /^\d+$/.test(value)
        ? Number(value)
        : NaN
      : (value as number);
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n <= 0) {
    throw new Ap2Error("payment_amount.amount must be a positive safe integer");
  }
  return n;
}

/** Verify the full mandate set. Throws on the first failure — fail-closed, no partial trust. */
export function verifyMandatePair(
  set: MandateSet,
  opts: Ap2Keys & { readonly expectedAud: string; readonly nowSec: number }
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
  if (JSON.stringify(agentJwk) !== JSON.stringify(agentJwkB)) {
    throw new Ap2Error("cnf.jwk differs across the open pair");
  }
  if (agentJwk.kty !== "EC" || agentJwk.crv !== "P-256")
    throw new Ap2Error("cnf.jwk must be a P-256 key");

  // Closed checkout: linkage recompute first, then merchant signature.
  requireVct(closedCheckout.payload, "mandate.checkout.1", "closed-checkout");
  const checkoutJwt = closedCheckout.payload["checkout_jwt"];
  if (typeof checkoutJwt !== "string" || checkoutJwt.length === 0)
    throw new Ap2Error("closed-checkout: missing checkout_jwt");
  const recomputed = sha256b64u(checkoutJwt);
  if (closedCheckout.payload["checkout_hash"] !== recomputed) {
    throw new Ap2Error("closed-checkout: checkout_hash mismatch");
  }
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

  // Closed payment: bound to the verified cart, fields extracted.
  requireVct(closedPayment.payload, "mandate.payment.1", "closed-payment");
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
  if (typeof payeeId !== "string" && typeof payeeName !== "string") {
    throw new Ap2Error("payee needs an id or name");
  }

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
    verifyKb(
      set.kbPayment,
      agentJwk,
      closedPayment.presented,
      opts.expectedAud
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
  expectedAud: string
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
  if (payload["aud"] !== expectedAud)
    throw new Ap2Error("KB-JWT: audience mismatch");
  if (
    typeof payload["nonce"] !== "string" ||
    (payload["nonce"] as string).length === 0
  ) {
    throw new Ap2Error("KB-JWT: nonce required");
  }
  if (payload["sd_hash"] !== sha256b64u(presentedSdJwt))
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
  readonly termsDigest: string;
}

/** Verified mandate → PTF demand + capability args. Still evidence: must pass Authority + Capabilities. */
export function toAp2PaymentDemand(
  verified: VerifiedMandate,
  ctx: Ap2DemandContext
): {
  readonly demand: AuthorityDemand;
  readonly capabilityArgs: {
    readonly amount: number;
    readonly currency: string;
  };
} {
  const demand: AuthorityDemand = {
    principal: ctx.principal,
    agent: ctx.agent,
    cmd: "/pay",
    purpose: ctx.purpose,
    resource: ctx.resource,
    recipient: verified.payeeId,
    amount: verified.amountMinor,
    currency: verified.currency,
    termsDigest: ctx.termsDigest,
  };
  return {
    demand,
    capabilityArgs: {
      amount: verified.amountMinor,
      currency: verified.currency,
    },
  };
}
