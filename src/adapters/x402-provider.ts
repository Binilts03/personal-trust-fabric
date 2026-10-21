import type {
  ProtectedProvider,
  ProviderRequest,
  ProviderSubmission,
} from "./providers.js";
import { canonicalize } from "../core/canonical.js";
import { isRecord } from "./guards.js";
import {
  parseAtomicAmount,
  parsePaymentRequired,
  type ParsedChallenge,
  type PaymentRequirement,
} from "./x402.js";
import {
  HttpWireError,
  buildTermsBody,
  httpCall,
  parseJsonObject,
  type TermsBody,
} from "./http-wire.js";

/**
 * The HTTP 402 agent-payment transport — x402 Protocol Version 2.
 *
 * Implemented from the x402 Foundation spec: `specs/x402-specification-v2.md`
 * and `specs/transports-v2/http.md` (x402 Foundation, Linux Foundation).
 * The v2 transport uses three headers, none of them `X-` prefixed:
 *
 * | header              | direction       | carries                     |
 * | ------------------- | --------------- | --------------------------- |
 * | `PAYMENT-REQUIRED`  | server → client | base64 `PaymentRequired`    |
 * | `PAYMENT-SIGNATURE` | client → server | base64 `PaymentPayload`     |
 * | `PAYMENT-RESPONSE`  | server → client | base64 `SettlementResponse` |
 *
 * `X-PAYMENT` is v1 and is not sent. `WWW-Authenticate` is not part of x402
 * at any version and is not read.
 *
 * Flow: POST the authorized terms → `402 Payment Required` → read the
 * challenge → pick the `accepts` entry that matches the authorised scheme,
 * network, and EXACT amount → `settle(challenge)` → retry ONCE with the
 * `PAYMENT-SIGNATURE` header → decode `PAYMENT-RESPONSE` and check
 * `success`, a non-empty `transaction`, and the network.
 *
 * The adapter refuses rather than adapts. Amounts are atomic-unit decimal
 * strings in the asset's own units. The core spec does not define an
 * asset's decimals and does not define a conversion, so the adapter never
 * converts, scales, or infers units: the host states the exact authorised
 * atomic amount and the challenge must match it exactly. A challenge for
 * more, a challenge for a different amount, a different scheme, a
 * different network, a failed settlement, a missing transaction, or a
 * server that never challenged all throw — nothing is settled, no payment
 * is sent, no reference is minted.
 *
 * PTF decides; the rail executes (ADR-0009). `settle` is host-owned: it
 * holds the wallet key, signs the authorization, and pays. The adapter
 * never sees a key and never moves value itself.
 */

export class X402ProviderError extends Error {
  constructor(reason: string) {
    super(`x402-provider: ${reason}`);
  }
}

/** The challenge handed to `settle`: the accepted requirement and its context. */
export interface X402Challenge {
  /** The requirement that matches the authorised scheme, network, and amount. */
  readonly accepted: PaymentRequirement;
  /** Every requirement the server advertised. */
  readonly accepts: readonly PaymentRequirement[];
  /** The resource the challenge is for. */
  readonly resource: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/**
 * The payment the host produces for a challenge. The adapter builds the
 * v2 `PaymentPayload` wrapper itself — the host returns the signed
 * authorization, and the terms in the wrapper come from the challenge the
 * adapter selected.
 */
export interface X402Payment {
  /** The signed authorization (the `payload` object of the v2 wire shape). */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Optional wire extensions for the `PaymentPayload`. */
  readonly extensions?: Readonly<Record<string, unknown>>;
  /** The amount the host is paying. Must equal the authorised amount. */
  readonly amount?: string;
  /** The network the host is paying on. Must equal the authorised network. */
  readonly network?: string;
  /** The reference the host expects the server to echo. */
  readonly reference?: string;
}

/** A diagnostic hook. Status only — never the body, never headers. */
export interface X402ProviderDiagnostic {
  readonly phase: "request" | "challenge" | "payment" | "response" | "error";
  readonly status?: number;
}

export interface X402ProviderOptions {
  readonly url: string;
  /**
   * The exact amount the host authorised, in the asset's atomic units
   * (decimal string, e.g. `"10000"`). Never scaled, never converted.
   */
  readonly authorizedAmount: string;
  /** The authorised CAIP-2 network (e.g. `"eip155:84532"`). */
  readonly authorizedNetwork: string;
  /** The authorised scheme. Defaults to `"exact"`. */
  readonly authorizedScheme?: string;
  /** Pay a 402 challenge. Called only after the server asks for payment. */
  readonly settle: (challenge: X402Challenge) => Promise<X402Payment>;
  /** The resource the host expects to be challenged for. Exact match. */
  readonly resource?: string;
  /** Human description of the resource. Informational, not a binding. */
  readonly description?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly nowSec?: () => number;
  /** Rail scope for journal keying. Defaults to `x402`. */
  readonly namespace?: string;
  /** Static headers (the credential stays in the host's own store). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Opt-in diagnostics. Status only: the adapter never logs a body. */
  readonly onDiagnostic?: (event: X402ProviderDiagnostic) => void;
}

/** The settlement the server reports back. */
interface Settlement {
  readonly success?: boolean;
  readonly transaction?: string;
  readonly network?: string;
  readonly payer?: string;
  readonly errorReason?: string;
}

function hostMessage(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  return "unknown error";
}

function optionalString(
  source: Record<string, unknown>,
  key: string
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Atomic-unit decimal string → integer. No scaling, no decimals. */
function atomicUnits(raw: string, what: string): number {
  try {
    return parseAtomicAmount(raw);
  } catch {
    throw new X402ProviderError(
      `${what} must be an atomic-unit integer string`
    );
  }
}

function normalizedAmount(raw: string, what: string): string {
  return String(atomicUnits(raw, what));
}

/**
 * The challenge. The `PAYMENT-REQUIRED` header is preferred; the JSON body
 * is the fallback for a v1-style server that carried the challenge in the
 * body. Both are parsed with the shared x402 field validation — the body
 * fallback only differs in that its version marker is not authoritative.
 */
function readChallenge(headers: Headers, text: string): ParsedChallenge {
  const header = headers.get("payment-required");
  if (header !== null && header.trim().length > 0) {
    try {
      return parsePaymentRequired(header.trim());
    } catch (err) {
      throw new X402ProviderError(
        `PAYMENT-REQUIRED is not a valid payment requirement: ${hostMessage(err)}`
      );
    }
  }
  if (text.trim().length === 0) {
    throw new X402ProviderError("no payment challenge in the 402 response");
  }
  let body: Record<string, unknown>;
  try {
    body = parseJsonObject(text, "challenge");
  } catch (err) {
    throw new X402ProviderError(
      err instanceof HttpWireError ? err.reason : "no payment challenge"
    );
  }
  const list = body["accepts"] ?? body["paymentRequirements"];
  if (!Array.isArray(list) || list.length === 0) {
    throw new X402ProviderError("no payment challenge in the 402 response");
  }
  try {
    // The v1 wire carried the challenge in the body with the same field
    // shapes. The version marker differs and is not authoritative there.
    const encoded = Buffer.from(
      JSON.stringify({ ...body, x402Version: 2 }),
      "utf8"
    ).toString("base64");
    return parsePaymentRequired(encoded);
  } catch (err) {
    throw new X402ProviderError(
      `challenge body is not a valid payment requirement: ${hostMessage(err)}`
    );
  }
}

interface Authorized {
  readonly amount: number;
  readonly amountText: string;
  readonly network: string;
  readonly scheme: string;
}

/**
 * The authorised terms. The options carry them: the amount is an atomic
 * decimal string, the network is CAIP-2, the scheme defaults to `exact`.
 *
 * The request terms must agree with them. The provider seam binds the
 * context to the approved operation (ADR-0018); a context that names a
 * different amount, network, or scheme than the transport was configured
 * with is drift, and drift is refused before anything is settled.
 */
function authorizedTerms(
  req: ProviderRequest,
  opts: X402ProviderOptions
): Authorized {
  const amountText = normalizedAmount(
    opts.authorizedAmount,
    "the authorised amount"
  );
  const network = opts.authorizedNetwork;
  if (typeof network !== "string" || network.length === 0) {
    throw new X402ProviderError("the authorised network is required");
  }
  const scheme = opts.authorizedScheme ?? "exact";
  const context = req.context;
  const contextAmount = context["amount"];
  if (contextAmount !== undefined) {
    if (
      typeof contextAmount !== "number" ||
      !Number.isSafeInteger(contextAmount) ||
      String(contextAmount) !== amountText
    ) {
      throw new X402ProviderError(
        "the request terms carry a different amount than the authorised amount"
      );
    }
  }
  const contextNetwork = optionalString(context, "network");
  if (contextNetwork !== undefined && contextNetwork !== network) {
    throw new X402ProviderError(
      "the request terms carry a different network than the authorised network"
    );
  }
  const contextScheme = optionalString(context, "scheme");
  if (contextScheme !== undefined && contextScheme !== scheme) {
    throw new X402ProviderError(
      "the request terms carry a different scheme than the authorised scheme"
    );
  }
  return {
    amount: atomicUnits(amountText, "the authorised amount"),
    amountText,
    network,
    scheme,
  };
}

/**
 * The one requirement that matches the authorised scheme, network, and
 * exact amount. Anything else is refused — never scaled, never rounded,
 * never rounded up to the nearest accepted requirement.
 */
function selectRequirement(
  accepts: readonly PaymentRequirement[],
  authorized: Authorized
): PaymentRequirement {
  let sawLargerAmount = false;
  let sawOtherAmount = false;
  let sawScheme = false;
  let sawNetwork = false;
  for (const entry of accepts) {
    let amount: number;
    try {
      amount = parseAtomicAmount(entry.amount);
    } catch {
      continue;
    }
    if (amount !== authorized.amount) {
      if (amount > authorized.amount) sawLargerAmount = true;
      else sawOtherAmount = true;
      continue;
    }
    if (entry.scheme !== authorized.scheme) {
      sawScheme = true;
      continue;
    }
    if (entry.network !== authorized.network) {
      sawNetwork = true;
      continue;
    }
    return entry;
  }
  // The overspend case is reported first: it is the one an operator must
  // never miss.
  if (sawLargerAmount) {
    throw new X402ProviderError(
      "the challenge demands more than the authorised amount — refusing to settle"
    );
  }
  if (sawOtherAmount) {
    throw new X402ProviderError(
      "the challenge amount differs from the authorised amount — refusing to settle"
    );
  }
  if (sawScheme) {
    throw new X402ProviderError(
      "the challenge asks for an unsupported payment scheme — refusing to settle"
    );
  }
  if (sawNetwork) {
    throw new X402ProviderError(
      "the challenge asks for an unsupported network — refusing to settle"
    );
  }
  throw new X402ProviderError(
    "the challenge carries no requirement for the authorised terms"
  );
}

/**
 * The host's signed authorization must name the same amount and payee the
 * challenge named. A `value` that is not the authorised amount, or a `to`
 * that is not the challenged payee, is refused before the payload is sent.
 */
function assertPaymentTerms(
  payload: Readonly<Record<string, unknown>>,
  accepted: PaymentRequirement,
  authorized: Authorized
): void {
  const authorization = payload["authorization"];
  if (authorization !== undefined && !isRecord(authorization)) {
    throw new X402ProviderError(
      "the payment authorization is malformed — refusing to settle"
    );
  }
  if (!isRecord(authorization)) return;
  const value = authorization["value"];
  if (value !== undefined) {
    const text = typeof value === "number" ? String(value) : (value as string);
    if (typeof text !== "string") {
      throw new X402ProviderError(
        "the payment authorization carries a malformed amount — refusing to settle"
      );
    }
    if (
      normalizedAmount(text, "the payment amount") !== authorized.amountText
    ) {
      throw new X402ProviderError(
        "the payment amount differs from the authorised amount — refusing to settle"
      );
    }
  }
  const to = authorization["to"];
  if (
    typeof to === "string" &&
    to.length > 0 &&
    accepted.payTo.length > 0 &&
    to !== accepted.payTo
  ) {
    throw new X402ProviderError(
      "the payment payee differs from the challenged payee — refusing to settle"
    );
  }
}

/** The v2 `PaymentPayload`, built by the adapter from the selected requirement. */
function buildPaymentPayload(
  challenge: X402Challenge,
  payment: X402Payment
): Record<string, unknown> {
  const accepted = challenge.accepted;
  return {
    x402Version: 2,
    resource: { url: challenge.resource },
    accepted: {
      scheme: accepted.scheme,
      network: accepted.network,
      amount: accepted.amount,
      asset: accepted.asset,
      payTo: accepted.payTo,
      maxTimeoutSeconds: accepted.maxTimeoutSeconds,
      ...(accepted.extra !== undefined ? { extra: accepted.extra } : {}),
    },
    payload: payment.payload,
    extensions: payment.extensions ?? {},
  };
}

/** The settlement the server reported. The header wins; the body is the fallback. */
function readSettlement(
  headers: Headers,
  body: Record<string, unknown>
): Settlement {
  const header = headers.get("payment-response");
  if (header !== null && header.trim().length > 0) {
    let decoded: string;
    try {
      decoded = Buffer.from(header.trim(), "base64").toString("utf8");
    } catch {
      throw new X402ProviderError(
        "the PAYMENT-RESPONSE header is not readable"
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded) as unknown;
    } catch {
      throw new X402ProviderError(
        "the PAYMENT-RESPONSE header is not readable"
      );
    }
    if (!isRecord(parsed)) {
      throw new X402ProviderError(
        "the PAYMENT-RESPONSE header is not a settlement object"
      );
    }
    return parsed as Settlement;
  }
  return body as Settlement;
}

function buildOrThrow(req: ProviderRequest): TermsBody {
  try {
    return buildTermsBody(req.context, req.capabilityId, req.termsDigest);
  } catch (err) {
    throw new X402ProviderError(
      err instanceof HttpWireError ? err.reason : "invalid request"
    );
  }
}

/**
 * Build the 402 transport. The returned provider refuses rather than
 * adapts: nothing is settled unless the challenge matches the authorised
 * terms exactly.
 */
export function createX402Provider(
  opts: X402ProviderOptions
): ProtectedProvider {
  const kind = "payment" as const;
  const namespace = opts.namespace ?? "x402";

  function diagnose(event: X402ProviderDiagnostic): void {
    try {
      opts.onDiagnostic?.(event);
    } catch {
      // A broken diagnostic hook must not change the effect's outcome.
    }
  }

  async function submit(req: ProviderRequest): Promise<ProviderSubmission> {
    const authorized = authorizedTerms(req, opts);
    const built = buildOrThrow(req);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    };

    diagnose({ phase: "request" });
    let first;
    try {
      first = await httpCall({
        url: opts.url,
        method: "POST",
        headers,
        body: built.canonical,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      });
    } catch (err) {
      diagnose({ phase: "error" });
      throw new X402ProviderError(
        err instanceof HttpWireError ? err.reason : "request failed"
      );
    }
    diagnose({ phase: "response", status: first.status });

    if (first.status !== 402) {
      if (first.ok) {
        throw new X402ProviderError(
          "the server did not challenge with a payment requirement"
        );
      }
      throw new X402ProviderError(
        `unexpected status ${first.status} before any challenge`
      );
    }

    const parsed = readChallenge(first.headers, first.text);
    diagnose({ phase: "challenge", status: 402 });
    const accepted = selectRequirement(parsed.accepts, authorized);

    const resource = parsed.resource.url;
    if (opts.resource !== undefined && opts.resource !== resource) {
      throw new X402ProviderError(
        "the challenge is for a different resource — refusing to settle"
      );
    }
    const description = parsed.resource.description ?? opts.description;
    const challenge: X402Challenge = {
      accepted,
      accepts: parsed.accepts,
      resource,
      ...(description !== undefined ? { description } : {}),
      ...(parsed.resource.mimeType !== undefined
        ? { mimeType: parsed.resource.mimeType }
        : {}),
    };

    let payment: X402Payment;
    try {
      payment = await opts.settle(challenge);
    } catch (err) {
      throw new X402ProviderError(`settlement failed: ${hostMessage(err)}`);
    }
    if (
      typeof payment !== "object" ||
      payment === null ||
      !isRecord(payment.payload)
    ) {
      throw new X402ProviderError("settlement produced no payment payload");
    }
    if (payment.amount !== undefined) {
      if (
        normalizedAmount(payment.amount, "the payment amount") !==
        authorized.amountText
      ) {
        throw new X402ProviderError(
          "the payment amount differs from the authorised amount — refusing to settle"
        );
      }
    }
    if (
      payment.network !== undefined &&
      payment.network !== authorized.network
    ) {
      throw new X402ProviderError(
        "the payment network differs from the authorised network — refusing to settle"
      );
    }
    assertPaymentTerms(payment.payload, accepted, authorized);

    let encoded: string;
    try {
      encoded = Buffer.from(
        canonicalize(buildPaymentPayload(challenge, payment)),
        "utf8"
      ).toString("base64");
    } catch (err) {
      throw new X402ProviderError(
        `the payment payload is not wire-safe: ${hostMessage(err)}`
      );
    }

    diagnose({ phase: "payment" });
    let second;
    try {
      second = await httpCall({
        url: opts.url,
        method: "POST",
        headers: { ...headers, "PAYMENT-SIGNATURE": encoded },
        body: built.canonical,
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      });
    } catch (err) {
      diagnose({ phase: "error" });
      throw new X402ProviderError(
        err instanceof HttpWireError ? err.reason : "request failed"
      );
    }
    diagnose({ phase: "response", status: second.status });

    if (!second.ok) {
      throw new X402ProviderError(
        `unexpected status ${second.status} after payment`
      );
    }

    let body: Record<string, unknown> = {};
    if (second.text.trim().length > 0) {
      try {
        body = parseJsonObject(second.text, "payment response");
      } catch {
        body = {};
      }
    }
    const settlement = readSettlement(second.headers, body);
    if (settlement.success === false) {
      throw new X402ProviderError(
        `the settlement failed${settlement.errorReason !== undefined ? `: ${settlement.errorReason}` : ""}`
      );
    }
    const transaction = settlement.transaction;
    if (typeof transaction !== "string" || transaction.length === 0) {
      throw new X402ProviderError("the settlement carries no transaction");
    }
    if (
      settlement.network !== undefined &&
      settlement.network !== authorized.network
    ) {
      throw new X402ProviderError(
        "the settlement reports a different network than the authorised one"
      );
    }
    if (payment.reference !== undefined && payment.reference !== transaction) {
      throw new X402ProviderError(
        "the settlement echoes a different transaction"
      );
    }

    const now = opts.nowSec?.() ?? Math.floor(Date.now() / 1000);
    return {
      kind,
      capabilityId: req.capabilityId,
      termsDigest: req.termsDigest,
      externalRef: transaction,
      at: now,
    };
  }

  function verify(
    sub: ProviderSubmission,
    expected: { readonly capabilityId: string; readonly termsDigest: string }
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (typeof sub !== "object" || sub === null) {
      return { ok: false, reason: "malformed submission" };
    }
    if (sub.kind !== kind) return { ok: false, reason: "kind mismatch" };
    if (sub.capabilityId !== expected.capabilityId) {
      return { ok: false, reason: "capability mismatch" };
    }
    if (sub.termsDigest !== expected.termsDigest) {
      return { ok: false, reason: "terms mismatch" };
    }
    if (
      typeof sub.externalRef !== "string" ||
      sub.externalRef.length === 0 ||
      sub.externalRef.length > 256
    ) {
      return { ok: false, reason: "missing externalRef" };
    }
    return { ok: true };
  }

  return {
    kind,
    namespace,
    submit,
    verify,
  };
}
