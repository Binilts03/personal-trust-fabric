import { canonicalize } from "../core/canonical.js";
import { isNonEmptyString, isRecord } from "./guards.js";

/**
 * Shared wire helpers for the HTTP provider transports (`http-provider`,
 * `x402-provider`). One leaf so both transports build the same body, sign
 * the same bytes, and fail the same way.
 *
 * The body is the AUTHORIZED terms plus the capability id and the terms
 * digest — nothing else. A secret in the body would cross the trust
 * boundary, and an extra effect-bearing key would widen the operation past
 * what the approval covered (ADR-0018).
 *
 * Nothing here logs. The response body is read, parsed, and handed to the
 * host's interpreter; it is never printed, never echoed into an error
 * message, and never written anywhere by this module.
 */

export class HttpWireError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`http-wire: ${reason}`);
    this.reason = reason;
  }
}

/**
 * Canonical JSON of a request body — the exact bytes that go on the wire.
 * Hosts sign this string so the server can recompute it from the body it
 * received and verify the signature.
 */
export function canonicalRequestBody(
  body: Readonly<Record<string, unknown>>
): string {
  return canonicalize(body);
}

export interface TermsBody {
  /** The object the host signs. */
  readonly body: Readonly<Record<string, unknown>>;
  /** The canonical JSON of `body` — the bytes on the wire. */
  readonly canonical: string;
}

const BINDING_KEYS = ["capabilityId", "termsDigest"] as const;

/**
 * The authorized terms + the capability id + the terms digest, and nothing
 * else. A term named `capabilityId` or `termsDigest` is refused: the
 * binding fields are the adapter's own, and a collision would either
 * shadow the binding or be shadowed by it.
 */
export function buildTermsBody(
  context: Readonly<Record<string, unknown>>,
  capabilityId: string,
  termsDigest: string
): TermsBody {
  if (!isNonEmptyString(capabilityId)) {
    throw new HttpWireError("capabilityId required");
  }
  if (!isNonEmptyString(termsDigest)) {
    throw new HttpWireError("termsDigest required");
  }
  if (!isRecord(context)) {
    throw new HttpWireError("context must be an object");
  }
  for (const key of BINDING_KEYS) {
    if (key in context) {
      throw new HttpWireError(`authorized terms must not carry ${key}`);
    }
  }
  const body: Record<string, unknown> = {
    ...context,
    capabilityId,
    termsDigest,
  };
  return { body, canonical: canonicalize(body) };
}

/** Header names and values are host-supplied: refuse CR/LF (header injection). */
export function assertSafeHeaders(
  headers: Readonly<Record<string, string>>,
  what: string
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!isNonEmptyString(name) || /[\r\n:]/.test(name)) {
      throw new HttpWireError(`${what}: invalid header name`);
    }
    if (typeof value !== "string" || /[\r\n]/.test(value)) {
      throw new HttpWireError(`${what}: invalid header value`);
    }
  }
}

export interface HttpCallOptions {
  readonly url: string;
  readonly method: "POST" | "PUT";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface HttpCallResult {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  readonly text: string;
}

/**
 * One HTTP round trip with a hard timeout. Redirects are refused, not
 * followed: a redirect would carry the signed request to a host the terms
 * never named.
 *
 * A timeout, a network error, and a refused redirect are all failed
 * effects — the caller throws, never a fake success.
 */
export async function httpCall(opts: HttpCallOptions): Promise<HttpCallResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    // The pending timer must not hold the process open after the call.
    timer.unref?.();
  }
  try {
    const res = await doFetch(opts.url, {
      method: opts.method,
      headers: { ...opts.headers },
      body: opts.body,
      signal: controller.signal,
      redirect: "error",
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, headers: res.headers, text };
  } catch {
    if (controller.signal.aborted) {
      throw new HttpWireError(
        `request timed out after ${String(opts.timeoutMs ?? 0)}ms`
      );
    }
    // The underlying error may carry the URL or a query token: it is not
    // echoed. The host's own fetch wrapper can log what it needs.
    throw new HttpWireError("request failed");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Parse a response body as a JSON object. A missing or unparsable body fails. */
export function parseJsonObject(
  text: string,
  what: string
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new HttpWireError(`${what}: response body is not JSON`);
  }
  if (!isRecord(parsed)) {
    throw new HttpWireError(`${what}: response body must be a JSON object`);
  }
  return parsed;
}
