import type {
  ProtectedProvider,
  ProviderRequest,
  ProviderSubmission,
} from "./providers.js";
import { checkRequest } from "./providers.js";
import { canonicalize } from "../core/canonical.js";
import { isRecord } from "./guards.js";
import {
  parseAtomicAmount,
  parsePaymentRequired,
  type ParsedChallenge,
  type PaymentRequirement,
} from "./x402.js";
import {
  DEFAULT_TIMEOUT_MS,
  HttpWireError,
  assertEndpointUrl,
  assertSafeHeaders,
  buildTermsBody,
  httpCall,
  mergeHeaders,
  parseJsonObject,
  safeText,
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
 * challenge → pick the `accepts` entry that matches the authorised amount,
 * scheme, network, asset, and payee EXACTLY → `settle(challenge)` signs the
 * authorization → retry ONCE with the `PAYMENT-SIGNATURE` header → decode
 * `PAYMENT-RESPONSE` and check `success`, a non-empty `transaction`, the
 * network, the payer, and the amount.
 *
 * The adapter refuses rather than adapts. Amounts are atomic-unit decimal
 * strings in the asset's own units. The core spec does not define an
 * asset's decimals and does not define a conversion, so the adapter never
 * converts, scales, or infers units: the host states the exact authorised
 * atomic amount and the challenge must match it exactly.
 *
 * The asset and the payee are bound the same way. `payTo` and the amount
 * alone cannot tell USDC on Base from a worthless token with the same
 * count, so a challenge naming another asset, another network, another
 * scheme, another amount, another payee, or another resource is refused
 * before anything is signed, and the payment payload always carries the
 * AUTHORISED asset and payee — never the server's.
 *
 * PTF decides; the rail executes (ADR-0009). `settle` only signs: it never
 * broadcasts, never moves value. The adapter decides whether the signed
 * payload is sent.
 */

export class X402ProviderError extends Error {
  constructor(reason: string) {
    super(`x402-provider: ${reason}`);
  }
}

/** The challenge handed to `settle`: the accepted requirement and its context. */
export interface X402Challenge {
  /** The requirement that matches the authorised terms exactly. */
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
 * authorization, and the terms in the wrapper are the AUTHORISED terms.
 */
export interface X402Payment {
  /**
   * The signed authorization (the `payload` object of the v2 wire shape).
   * It must authorize the AUTHORISED asset, payee, and amount — the
   * adapter refuses a payload that names anything else.
   */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Optional wire extensions for the `PaymentPayload`. */
  readonly extensions?: Readonly<Record<string, unknown>>;
  /** The amount the host is signing. Must equal the authorised amount. */
  readonly amount?: string;
  /** The network the host is signing on. Must equal the authorised network. */
  readonly network?: string;
  /** The asset the host is signing. Must equal the authorised asset. */
  readonly asset?: string;
  /** The reference the host expects the server to echo. */
  readonly reference?: string;
}

/** A diagnostic hook. Status only — never the body, never headers. */
export interface X402ProviderDiagnostic {
  readonly phase: "request" | "challenge" | "payment" | "response" | "error";
  readonly status?: number;
}

export interface X402ProviderOptions {
  /**
   * The endpoint. A host constant, never a request term, and `https:`
   * unless the host opts into `allowInsecureHttp`.
   */
  readonly url: string;
  /**
   * The exact amount the host authorised, in the asset's atomic units
   * (decimal string, e.g. `"10000"`). Never scaled, never converted.
   */
  readonly authorizedAmount: string;
  /** The authorised CAIP-2 network (e.g. `"eip155:84532"`). */
  readonly authorizedNetwork: string;
  /**
   * The authorised asset: the token contract address, or the fiat
   * currency code for a fiat asset. A challenge naming another asset is
   * refused — the atomic count alone says nothing about what is paid.
   */
  readonly authorizedAsset: string;
  /**
   * The authorised payee. A challenge naming another payee is refused, and
   * the signed payload always pays this one.
   */
  readonly authorizedPayTo: string;
  /** The authorised scheme. Defaults to `"exact"`. */
  readonly authorizedScheme?: string;
  /** The payer the host authorised, when it knows one. */
  readonly authorizedPayer?: string;
  /**
   * The exact resource URL the host expects to be challenged for. The
   * challenge's resource must match it.
   */
  readonly resource: string;
  /**
   * Sign a challenge. It must ONLY sign and return the authorization — it
   * must never broadcast, submit, or move value. The adapter decides
   * whether the signed payload is sent.
   */
  readonly settle: (challenge: X402Challenge) => Promise<X402Payment>;
  /** Human description of the resource. Informational, not a binding. */
  readonly description?: string;
  readonly fetchImpl?: typeof fetch;
  /** The whole submit (both requests) gets this deadline. Defaults to 30s. */
  readonly timeoutMs?: number;
  readonly nowSec?: () => number;
  /** Rail scope for journal keying. Defaults to `x402`. */
  readonly namespace?: string;
  /** Static headers (the credential stays in the host's own store). */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * The idempotency key sent as a header on both requests. Defaults to
   * the terms digest.
   */
  readonly idempotencyKey?: string;
  /**
   * Allow an `http:` endpoint (a local test server). Off by default.
   */
  readonly allowInsecureHttp?: boolean;
  /**
   * The checked settlement, before the submission is returned. The host
   * runs its own rail check (`checkSettlement`) here. A hook that throws
   * fails the effect: the settlement happened, and the host must not see
   * a success it did not verify.
   */
  readonly onSettlement?: (
    settlement: Readonly<Record<string, unknown>>
  ) => void;
  /** Opt-in diagnostics. Status only: the adapter never logs a body. */
  readonly onDiagnostic?: (event: X402ProviderDiagnostic) => void;
}

/** The settlement the server reports back. */
interface Settlement {
  readonly success?: unknown;
  readonly transaction?: unknown;
  readonly network?: unknown;
  readonly payer?: unknown;
  readonly amount?: unknown;
  readonly errorReason?: unknown;
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
 * One challenge entry → the internal requirement shape. The rules mirror
 * the shared x402 parser: a known scheme, a namespaced network, an
 * atomic-unit amount, an asset, a payee, and a timeout.
 */
function toPaymentRequirement(entry: unknown): PaymentRequirement {
  if (!isRecord(entry)) {
    throw new X402ProviderError("challenge entry must be an object");
  }
  const scheme = entry["scheme"];
  if (scheme !== "exact" && scheme !== "upto") {
    throw new X402ProviderError("the challenge names an unsupported scheme");
  }
  const network = entry["network"];
  if (typeof network !== "string" || !network.includes(":")) {
    throw new X402ProviderError("the challenge names an unsupported network");
  }
  // v1 spelled the amount `maxAmountRequired`; v2 spells it `amount`.
  const rawAmount = entry["amount"] ?? entry["maxAmountRequired"];
  if (typeof rawAmount !== "string" || !/^\d+$/.test(rawAmount)) {
    throw new X402ProviderError(
      "the challenge names an amount that is not an atomic-unit integer"
    );
  }
  atomicUnits(rawAmount, "the challenge amount");
  const asset = entry["asset"];
  if (typeof asset !== "string" || asset.length === 0) {
    throw new X402ProviderError("the challenge names no asset");
  }
  const payTo = entry["payTo"];
  if (typeof payTo !== "string" || payTo.length === 0) {
    throw new X402ProviderError("the challenge names no payee");
  }
  const maxTimeoutSeconds = entry["maxTimeoutSeconds"];
  if (
    typeof maxTimeoutSeconds !== "number" ||
    !Number.isInteger(maxTimeoutSeconds) ||
    !Number.isFinite(maxTimeoutSeconds) ||
    maxTimeoutSeconds <= 0 ||
    maxTimeoutSeconds > 86400
  ) {
    throw new X402ProviderError("the challenge names no valid timeout");
  }
  const extra = entry["extra"];
  return {
    scheme,
    network,
    amount: rawAmount,
    asset,
    payTo,
    maxTimeoutSeconds,
    ...(extra !== undefined
      ? { extra: isRecord(extra) ? extra : { value: extra } }
      : {}),
  };
}

/** The challenge resource. */
interface ChallengeResource {
  readonly url: string;
  readonly description?: string;
  readonly mimeType?: string;
}

function toResource(raw: unknown): ChallengeResource {
  if (!isRecord(raw)) {
    throw new X402ProviderError("the challenge names no resource");
  }
  const url = raw["url"];
  if (typeof url !== "string" || url.length === 0) {
    throw new X402ProviderError("the challenge names no resource url");
  }
  if (!url.startsWith("https://") && !url.startsWith("http://")) {
    throw new X402ProviderError("the challenge resource url must be http(s)");
  }
  const description = optionalString(raw, "description");
  const mimeType = optionalString(raw, "mimeType");
  return {
    url,
    ...(description !== undefined ? { description } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
  };
}

/**
 * The challenge body. x402 v1 carried the challenge in the body with the
 * field name `paymentRequirements` and the amount field
 * `maxAmountRequired`; v2 uses `accepts` and `amount`. Both versions are
 * accepted and mapped to the internal shape — the version marker the
 * server sent is checked, never rewritten.
 */
function parseChallengeBody(body: Record<string, unknown>): {
  readonly accepts: readonly PaymentRequirement[];
  readonly resource: ChallengeResource;
} {
  const list = body["accepts"] ?? body["paymentRequirements"];
  if (!Array.isArray(list) || list.length === 0) {
    throw new X402ProviderError("no payment challenge in the 402 response");
  }
  const version = body["x402Version"];
  if (version !== 1 && version !== 2) {
    throw new X402ProviderError(
      "the challenge declares an unsupported x402 version"
    );
  }
  const accepts = list.map(toPaymentRequirement);
  return { accepts, resource: toResource(body["resource"]) };
}

/**
 * The challenge. The `PAYMENT-REQUIRED` header is preferred and is parsed
 * with the shared x402 v2 parser. The JSON body is the fallback for a
 * v1-style server that carried the challenge in the body.
 */
function readChallenge(
  headers: Headers,
  text: string
): {
  readonly accepts: readonly PaymentRequirement[];
  readonly resource: ChallengeResource;
} {
  const header = headers.get("payment-required");
  if (header !== null && header.trim().length > 0) {
    let parsed: ParsedChallenge;
    try {
      parsed = parsePaymentRequired(header.trim());
    } catch (err) {
      throw new X402ProviderError(
        `PAYMENT-REQUIRED is not a valid payment requirement: ${safeText(hostMessage(err))}`
      );
    }
    return {
      accepts: parsed.accepts,
      resource: {
        url: parsed.resource.url,
        ...(parsed.resource.description !== undefined
          ? { description: parsed.resource.description }
          : {}),
        ...(parsed.resource.mimeType !== undefined
          ? { mimeType: parsed.resource.mimeType }
          : {}),
      },
    };
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
  return parseChallengeBody(body);
}

interface Authorized {
  readonly amount: number;
  readonly amountText: string;
  readonly network: string;
  readonly scheme: string;
  readonly asset: string;
  readonly payTo: string;
  readonly payer?: string;
}

/**
 * The authorised terms. The options carry them: the amount is an atomic
 * decimal string, the network is CAIP-2, the asset is the token contract
 * or the fiat currency code, the payee is the address the payment goes to.
 *
 * The request terms must agree with them. The provider seam binds the
 * context to the approved operation (ADR-0018); a context that names a
 * different amount, network, or scheme than the transport was configured
 * with is drift, and drift is refused before anything is signed.
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
  const asset = opts.authorizedAsset;
  if (typeof asset !== "string" || asset.length === 0) {
    throw new X402ProviderError("the authorised asset is required");
  }
  const payTo = opts.authorizedPayTo;
  if (typeof payTo !== "string" || payTo.length === 0) {
    throw new X402ProviderError("the authorised payee is required");
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
    asset,
    payTo,
    ...(opts.authorizedPayer !== undefined
      ? { payer: opts.authorizedPayer }
      : {}),
  };
}

/**
 * The one requirement that matches the authorised amount, scheme, network,
 * asset, and payee. Anything else is refused — never scaled, never
 * rounded, never rounded up to the nearest accepted requirement, and never
 * pointed at another asset or another payee.
 */
function selectRequirement(
  accepts: readonly PaymentRequirement[],
  authorized: Authorized
): PaymentRequirement {
  let sawLargerAmount = false;
  let sawOtherAmount = false;
  let sawScheme = false;
  let sawNetwork = false;
  let sawAsset = false;
  let sawPayTo = false;
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
    if (entry.asset !== authorized.asset) {
      sawAsset = true;
      continue;
    }
    if (entry.payTo !== authorized.payTo) {
      sawPayTo = true;
      continue;
    }
    return entry;
  }
  // The overspend case is reported first: it is the one an operator must
  // never miss.
  if (sawLargerAmount) {
    throw new X402ProviderError(
      "the challenge demands more than the authorised amount — refusing to pay"
    );
  }
  if (sawOtherAmount) {
    throw new X402ProviderError(
      "the challenge amount differs from the authorised amount — refusing to pay"
    );
  }
  if (sawScheme) {
    throw new X402ProviderError(
      "the challenge asks for an unsupported payment scheme — refusing to pay"
    );
  }
  if (sawNetwork) {
    throw new X402ProviderError(
      "the challenge asks for an unsupported network — refusing to pay"
    );
  }
  if (sawAsset) {
    throw new X402ProviderError(
      "the challenge names another asset — refusing to pay"
    );
  }
  if (sawPayTo) {
    throw new X402ProviderError(
      "the challenge names another payee — refusing to pay"
    );
  }
  throw new X402ProviderError(
    "the challenge carries no requirement for the authorised terms"
  );
}

/**
 * The host's signed authorization must name the authorised amount and the
 * authorised payee. A `value` that is not the authorised amount, or a `to`
 * that is not the authorised payee, is refused before the payload is sent.
 */
function assertPaymentTerms(
  payload: Readonly<Record<string, unknown>>,
  authorized: Authorized
): void {
  const authorization = payload["authorization"];
  if (authorization !== undefined && !isRecord(authorization)) {
    throw new X402ProviderError(
      "the payment authorization is malformed — refusing to send the payment"
    );
  }
  if (!isRecord(authorization)) return;
  const value = authorization["value"];
  if (value !== undefined) {
    const text = typeof value === "number" ? String(value) : value;
    if (typeof text !== "string") {
      throw new X402ProviderError(
        "the payment authorization carries a malformed amount — refusing to send the payment"
      );
    }
    if (
      normalizedAmount(text, "the payment amount") !== authorized.amountText
    ) {
      throw new X402ProviderError(
        "the payment amount differs from the authorised amount — refusing to send the payment"
      );
    }
  }
  const to = authorization["to"];
  if (typeof to === "string" && to.length > 0 && to !== authorized.payTo) {
    throw new X402ProviderError(
      "the payment payee differs from the authorised payee — refusing to send the payment"
    );
  }
}

/** The v2 `PaymentPayload`, built by the adapter from the AUTHORISED terms. */
function buildPaymentPayload(
  challenge: X402Challenge,
  payment: X402Payment,
  authorized: Authorized
): Record<string, unknown> {
  return {
    x402Version: 2,
    resource: { url: challenge.resource },
    accepted: {
      scheme: authorized.scheme,
      network: authorized.network,
      amount: authorized.amountText,
      asset: authorized.asset,
      payTo: authorized.payTo,
      maxTimeoutSeconds: challenge.accepted.maxTimeoutSeconds,
      ...(challenge.accepted.extra !== undefined
        ? { extra: challenge.accepted.extra }
        : {}),
    },
    payload: payment.payload,
    extensions: payment.extensions ?? {},
  };
}

/** The settlement the server reported. The header wins; the body is the fallback. */
function readSettlement(
  headers: Headers,
  body: Record<string, unknown>
): Record<string, unknown> {
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
    return parsed;
  }
  return body;
}

/**
 * The settlement is evidence, and it is checked before it can become a
 * receipt: success must be true, the transaction must be there, the
 * network must be the authorised one, and the payer and the amount must
 * match when the server sent them.
 */
function checkSettlementTerms(
  settlement: Record<string, unknown>,
  authorized: Authorized
): void {
  const s = settlement as Settlement;
  if (s.success !== true) {
    const reason = safeText(s.errorReason);
    throw new X402ProviderError(
      reason.length > 0
        ? `the settlement failed: ${reason}`
        : "the settlement does not report success"
    );
  }
  const transaction = s.transaction;
  if (typeof transaction !== "string" || transaction.length === 0) {
    throw new X402ProviderError("the settlement carries no transaction");
  }
  const network = s.network;
  if (typeof network !== "string" || network.length === 0) {
    throw new X402ProviderError("the settlement names no network");
  }
  if (network !== authorized.network) {
    throw new X402ProviderError(
      "the settlement reports a different network than the authorised one"
    );
  }
  if (
    authorized.payer !== undefined &&
    s.payer !== undefined &&
    s.payer !== authorized.payer
  ) {
    throw new X402ProviderError(
      "the settlement reports a different payer than the authorised one"
    );
  }
  if (s.amount !== undefined) {
    const raw = typeof s.amount === "number" ? String(s.amount) : s.amount;
    if (typeof raw !== "string") {
      throw new X402ProviderError("the settlement carries a malformed amount");
    }
    let normalized: string;
    try {
      normalized = normalizedAmount(raw, "the settlement amount");
    } catch {
      throw new X402ProviderError("the settlement carries a malformed amount");
    }
    if (normalized !== authorized.amountText) {
      throw new X402ProviderError(
        "the settlement reports a different amount than the authorised one"
      );
    }
  }
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
 * adapts: nothing is signed unless the challenge matches the authorised
 * terms exactly.
 */
export function createX402Provider(
  opts: X402ProviderOptions
): ProtectedProvider {
  const kind = "payment" as const;
  const namespace = opts.namespace ?? "x402";
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    assertEndpointUrl(opts.url, opts.allowInsecureHttp === true);
  } catch (err) {
    throw new X402ProviderError(
      err instanceof HttpWireError ? err.reason : "invalid endpoint url"
    );
  }

  function diagnose(event: X402ProviderDiagnostic): void {
    try {
      opts.onDiagnostic?.(event);
    } catch {
      // A broken diagnostic hook must not change the effect's outcome.
    }
  }

  async function submit(req: ProviderRequest): Promise<ProviderSubmission> {
    // The seam's own request rule applies on the direct-call path too.
    checkRequest(req);
    const authorized = authorizedTerms(req, opts);
    const built = buildOrThrow(req);

    // One deadline for the whole submit: the challenge request and the
    // retry together may not take twice the timeout.
    const deadline = Date.now() + timeoutMs;
    const remaining = (): number => {
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new X402ProviderError("the submit deadline passed");
      }
      return left;
    };

    const staticHeaders = opts.headers ?? {};
    let headers: Record<string, string>;
    try {
      assertSafeHeaders(staticHeaders, "request headers");
      headers = mergeHeaders(
        {
          "content-type": "application/json",
          "idempotency-key": opts.idempotencyKey ?? req.termsDigest,
        },
        staticHeaders
      );
      assertSafeHeaders(headers, "request headers", {
        allowContentType: true,
      });
    } catch (err) {
      throw new X402ProviderError(
        err instanceof HttpWireError ? err.reason : "invalid headers"
      );
    }

    diagnose({ phase: "request" });
    let first;
    try {
      first = await httpCall({
        url: opts.url,
        method: "POST",
        headers,
        body: built.canonical,
        timeoutMs: remaining(),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      });
    } catch (err) {
      diagnose({ phase: "error" });
      if (err instanceof X402ProviderError) throw err;
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

    if (parsed.resource.url !== opts.resource) {
      throw new X402ProviderError(
        "the challenge is for a different resource — refusing to pay"
      );
    }
    const description = parsed.resource.description ?? opts.description;
    const challenge: X402Challenge = {
      accepted,
      accepts: parsed.accepts,
      resource: parsed.resource.url,
      ...(description !== undefined ? { description } : {}),
      ...(parsed.resource.mimeType !== undefined
        ? { mimeType: parsed.resource.mimeType }
        : {}),
    };

    let payment: X402Payment;
    try {
      payment = await opts.settle(challenge);
    } catch (err) {
      throw new X402ProviderError(
        `settlement failed: ${safeText(hostMessage(err))}`
      );
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
          "the payment amount differs from the authorised amount — refusing to send the payment"
        );
      }
    }
    if (
      payment.network !== undefined &&
      payment.network !== authorized.network
    ) {
      throw new X402ProviderError(
        "the payment network differs from the authorised network — refusing to send the payment"
      );
    }
    if (payment.asset !== undefined && payment.asset !== authorized.asset) {
      throw new X402ProviderError(
        "the payment asset differs from the authorised asset — refusing to send the payment"
      );
    }
    assertPaymentTerms(payment.payload, authorized);

    let encoded: string;
    try {
      encoded = Buffer.from(
        canonicalize(buildPaymentPayload(challenge, payment, authorized)),
        "utf8"
      ).toString("base64");
    } catch (err) {
      throw new X402ProviderError(
        `the payment payload is not wire-safe: ${safeText(hostMessage(err))}`
      );
    }

    diagnose({ phase: "payment" });
    let second;
    try {
      second = await httpCall({
        url: opts.url,
        method: "POST",
        headers: mergeHeaders(headers, {
          "payment-signature": encoded,
        }),
        body: built.canonical,
        timeoutMs: remaining(),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      });
    } catch (err) {
      diagnose({ phase: "error" });
      if (err instanceof X402ProviderError) throw err;
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
    checkSettlementTerms(settlement, authorized);

    // The host gets the checked settlement before the submission: it is
    // where `checkSettlement` runs.
    if (opts.onSettlement !== undefined) {
      try {
        opts.onSettlement(settlement);
      } catch (err) {
        throw new X402ProviderError(
          `the settlement was rejected by the host: ${safeText(hostMessage(err))}`
        );
      }
    }

    const transaction = settlement["transaction"];
    if (typeof transaction !== "string" || transaction.length === 0) {
      throw new X402ProviderError("the settlement carries no transaction");
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
