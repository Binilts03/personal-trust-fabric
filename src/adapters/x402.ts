import type { AuthorityDemand } from "../core/authority.js";
import { isRecord, reqString } from "./guards.js";

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
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export class X402Error extends Error {
  constructor(reason: string) {
    super(`x402: ${reason}`);
  }
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
  if (
    headerB64.length === 0 ||
    headerB64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(headerB64)
  ) {
    throw new X402Error("header is not base64 JSON");
  }
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
  const url = reqString(
    (resource as Record<string, unknown>)["url"],
    "x402: missing/invalid url"
  );
  if (!url.startsWith("https://") && !url.startsWith("http://"))
    throw new X402Error("resource url must be http(s)");
  const description = resource["description"];
  const mimeType = resource["mimeType"];
  const extensions = json["extensions"];
  const accepts = json["accepts"];
  if (!Array.isArray(accepts) || accepts.length === 0)
    throw new X402Error("accepts must be non-empty");
  const requirements: PaymentRequirement[] = accepts.map((entry: unknown) => {
    if (!isRecord(entry)) throw new X402Error("accept entry must be an object");
    const amount = reqString(entry["amount"], "x402: missing/invalid amount");
    parseAtomicAmount(amount);
    const maxTimeout = entry["maxTimeoutSeconds"];
    if (
      typeof maxTimeout !== "number" ||
      !Number.isInteger(maxTimeout) ||
      !Number.isFinite(maxTimeout) ||
      maxTimeout <= 0 ||
      maxTimeout > 86400
    )
      throw new X402Error("missing/invalid maxTimeoutSeconds");
    const scheme = reqString(entry["scheme"], "x402: missing/invalid scheme");
    if (scheme !== "exact" && scheme !== "upto")
      throw new X402Error(`unsupported scheme ${scheme}`);
    const network = reqString(
      entry["network"],
      "x402: missing/invalid network"
    );
    if (!network.includes(":"))
      throw new X402Error(
        "network must be a namespaced id (e.g. eip155:84532)"
      );
    const extra = entry["extra"];
    return {
      scheme,
      network,
      amount,
      asset: reqString(entry["asset"], "x402: missing/invalid asset"),
      payTo: reqString(entry["payTo"], "x402: missing/invalid payTo"),
      maxTimeoutSeconds: maxTimeout,
      ...(extra !== undefined
        ? { extra: isRecord(extra) ? extra : { value: extra } }
        : {}),
    };
  });
  return {
    x402Version: 2,
    resource: {
      url,
      ...(typeof description === "string" ? { description } : {}),
      ...(typeof mimeType === "string" ? { mimeType } : {}),
    },
    accepts: requirements,
    ...(isRecord(extensions) ? { extensions } : {}),
  };
}

export interface DemandContext {
  readonly principal: string;
  readonly agent: string;
  readonly purpose: string;
  readonly resource: string;
  readonly currency: string;
  readonly termsDigest: string;
  /**
   * Bind the challenge URL to the demand: when the caller parsed a
   * `PAYMENT-REQUIRED` challenge, pass `parsed.resource.url` here. Mismatch
   * throws instead of authorizing a different resource for this challenge.
   * Asset/network/scheme stay on `accepted` and MUST be folded into the
   * caller's `termsDigest` (see `requirementMatches`): authority cannot tell
   * USDC/Base from junk-token/evil-chain on payTo+amount alone.
   */
  readonly expectedResourceUrl?: string;
  readonly expectedAsset?: string;
  readonly expectedNetwork?: string;
}

/**
 * Exact-match the requirement the principal is willing to pay against the
 * `accepts` entry. Seller-side check per the deep read: amount/asset/payTo/
 * network must match exactly before any demand is built.
 */
export function requirementMatches(
  accepted: PaymentRequirement,
  expected: { readonly asset: string; readonly network: string }
): boolean {
  return (
    accepted.asset === expected.asset && accepted.network === expected.network
  );
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
    readonly asset: string;
    readonly network: string;
    readonly scheme: string;
  };
} {
  if (
    ctx.expectedResourceUrl !== undefined &&
    ctx.resource !== ctx.expectedResourceUrl
  ) {
    throw new X402Error("resource does not match challenge url");
  }
  if (ctx.expectedAsset !== undefined && accepted.asset !== ctx.expectedAsset) {
    throw new X402Error("asset mismatch: requirement not selected by policy");
  }
  if (
    ctx.expectedNetwork !== undefined &&
    accepted.network !== ctx.expectedNetwork
  ) {
    throw new X402Error("network mismatch: requirement not selected by policy");
  }
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
  return {
    demand,
    capabilityArgs: {
      amount,
      currency: ctx.currency,
      asset: accepted.asset,
      network: accepted.network,
      scheme: accepted.scheme,
    },
  };
}

export interface SettlementResult {
  readonly success: boolean;
  readonly transaction: string;
  readonly network: string;
  /** Sender recovered from the payment authorization — never the merchant. */
  readonly payer: string;
  readonly amount?: string;
  readonly asset?: string;
  readonly errorReason?: string;
}

export function checkSettlement(
  result: SettlementResult,
  expected: {
    readonly network: string;
    readonly payer: string;
    readonly amount?: string;
    readonly asset?: string;
  }
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (typeof result !== "object" || result === null)
    return { ok: false, reason: "malformed settlement" };
  if (!result.success)
    return { ok: false, reason: result.errorReason ?? "settlement failed" };
  if (typeof result.transaction !== "string" || result.transaction.length === 0)
    return { ok: false, reason: "missing transaction" };
  if (typeof result.network !== "string" || typeof result.payer !== "string")
    return { ok: false, reason: "malformed settlement" };
  if (result.network !== expected.network)
    return { ok: false, reason: "network mismatch" };
  if (result.payer !== expected.payer)
    return { ok: false, reason: "payer mismatch" };
  if (expected.amount !== undefined && result.amount !== expected.amount)
    return { ok: false, reason: "amount mismatch" };
  if (expected.asset !== undefined && result.asset !== expected.asset)
    return { ok: false, reason: "asset mismatch" };
  return { ok: true };
}

/** Facilitator boundary. Production wiring is out of v0.1; tests use the stub in tests/fakes.ts. */
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
