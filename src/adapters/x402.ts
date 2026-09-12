import type { AuthorityDemand } from "../core/authority.js";

/**
 * x402 v2 adapter — evidence in, never authority out (ADR-0005).
 * Parses `PAYMENT-REQUIRED` challenges into PTF demands and checks settlement.
 * Field names follow the deep read (`docs/research/2026-09-09-deep-payments-x402-ap2.md`).
 * Amounts stay in atomic units end-to-end: PTF ceilings for x402 flows MUST be
 * expressed in the asset's atomic units (no decimal shifting here — shifting
 * silently changes value and belongs to no trust layer).
 */

export interface PaymentRequirement {
  readonly scheme: string;
  readonly network: string;
  readonly amount: string;
  readonly asset: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface ParsedChallenge {
  readonly x402Version: number;
  readonly resource: {
    readonly url: string;
    readonly description?: string;
    readonly mimeType?: string;
  };
  readonly accepts: readonly PaymentRequirement[];
}

export class X402Error extends Error {
  constructor(reason: string) {
    super(`x402: ${reason}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function reqString(obj: Record<string, unknown>, field: string): string {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0)
    throw new X402Error(`missing/invalid ${field}`);
  return v;
}

/** Atomic-unit integer string → number. Rejects decimals and unsafe magnitudes. */
export function parseAtomicAmount(raw: string): number {
  if (!/^\d+$/.test(raw))
    throw new X402Error(
      `amount must be an atomic-unit integer string, got ${raw}`
    );
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new X402Error(`amount out of safe range: ${raw}`);
  return n;
}

/** Decode + validate a base64 `PAYMENT-REQUIRED` header. Throws before touching authority. */
export function parsePaymentRequired(headerB64: string): ParsedChallenge {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(headerB64, "base64").toString("utf8"));
  } catch {
    throw new X402Error("header is not base64 JSON");
  }
  if (!isRecord(json)) throw new X402Error("challenge must be an object");
  if (json["x402Version"] !== 2)
    throw new X402Error("only x402Version 2 supported");
  const resource = json["resource"];
  if (!isRecord(resource)) throw new X402Error("missing resource");
  const url = reqString(resource, "url");
  if (!url.startsWith("https://") && !url.startsWith("http://"))
    throw new X402Error("resource url must be http(s)");
  const accepts = json["accepts"];
  if (!Array.isArray(accepts) || accepts.length === 0)
    throw new X402Error("accepts must be non-empty");
  const requirements: PaymentRequirement[] = accepts.map((entry: unknown) => {
    if (!isRecord(entry)) throw new X402Error("accept entry must be an object");
    const amount = reqString(entry, "amount");
    parseAtomicAmount(amount);
    const maxTimeout = entry["maxTimeoutSeconds"];
    if (typeof maxTimeout !== "number" || !(maxTimeout > 0))
      throw new X402Error("missing/invalid maxTimeoutSeconds");
    return {
      scheme: reqString(entry, "scheme"),
      network: reqString(entry, "network"),
      amount,
      asset: reqString(entry, "asset"),
      payTo: reqString(entry, "payTo"),
      maxTimeoutSeconds: maxTimeout,
    };
  });
  return { x402Version: 2, resource: { url }, accepts: requirements };
}

export interface DemandContext {
  readonly principal: string;
  readonly agent: string;
  readonly purpose: string;
  readonly resource: string;
  readonly currency: string;
  readonly termsDigest: string;
}

/** One accepted requirement → PTF demand + capability args. Still evidence: must pass Authority + Capabilities. */
export function toX402PaymentDemand(
  accepted: PaymentRequirement,
  ctx: DemandContext
): {
  readonly demand: AuthorityDemand;
  readonly capabilityArgs: {
    readonly amount: number;
    readonly currency: string;
  };
} {
  const amount = parseAtomicAmount(accepted.amount);
  const demand: AuthorityDemand = {
    principal: ctx.principal,
    agent: ctx.agent,
    cmd: "/pay",
    purpose: ctx.purpose,
    resource: ctx.resource,
    recipient: accepted.payTo,
    amount,
    currency: ctx.currency,
    termsDigest: ctx.termsDigest,
  };
  return { demand, capabilityArgs: { amount, currency: ctx.currency } };
}

export interface SettlementResult {
  readonly success: boolean;
  readonly transaction: string;
  readonly network: string;
  readonly payer: string;
  readonly errorReason?: string;
}

export function checkSettlement(
  result: SettlementResult,
  expected: { readonly network: string; readonly payTo: string }
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (!result.success)
    return { ok: false, reason: result.errorReason ?? "settlement failed" };
  if (result.transaction.length === 0)
    return { ok: false, reason: "missing transaction" };
  if (result.network !== expected.network)
    return { ok: false, reason: "network mismatch" };
  if (result.payer !== expected.payTo)
    return { ok: false, reason: "payer mismatch" };
  return { ok: true };
}

/** Facilitator boundary. Production wiring is out of v0.1; tests use the stub. */
export interface X402Facilitator {
  verify(
    payload: unknown,
    requirements: PaymentRequirement
  ): Promise<{ readonly isValid: boolean; readonly payer?: string }>;
  settle(
    payload: unknown,
    requirements: PaymentRequirement
  ): Promise<SettlementResult>;
}

export class StubFacilitator implements X402Facilitator {
  constructor(private readonly valid: boolean) {}
  async verify(
    _payload: unknown,
    _requirements: PaymentRequirement
  ): Promise<{ readonly isValid: boolean }> {
    return { isValid: this.valid };
  }
  async settle(
    _payload: unknown,
    requirements: PaymentRequirement
  ): Promise<SettlementResult> {
    if (!this.valid) {
      return {
        success: false,
        transaction: "",
        network: requirements.network,
        payer: "",
        errorReason: "insufficient_funds",
      };
    }
    return {
      success: true,
      transaction: "0xstub",
      network: requirements.network,
      payer: requirements.payTo,
    };
  }
}
