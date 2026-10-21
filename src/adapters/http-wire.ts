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

/**
 * Header names and values are host-supplied, so they are checked before
 * they reach the socket:
 *
 * - CR/LF in a name or a value (header injection) is refused;
 * - a colon in a name is refused;
 * - `host`, `content-length`, `transfer-encoding`, and `connection` are
 *   refused — the transport owns the framing;
 * - `content-type` is refused — the adapter sets its own, and a host that
 *   overrides it changes what the server parses;
 * - names are capped at 64 characters and values at 4096.
 */
const DENIED_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
]);
const MAX_HEADER_NAME_LENGTH = 64;
const MAX_HEADER_VALUE_LENGTH = 4096;

export function assertSafeHeaders(
  headers: Readonly<Record<string, string>>,
  what: string,
  opts: { readonly allowContentType?: boolean } = {}
): void {
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!isNonEmptyString(name) || name.length > MAX_HEADER_NAME_LENGTH) {
      throw new HttpWireError(`${what}: invalid header name`);
    }
    if (/[\r\n:]/.test(name)) {
      throw new HttpWireError(`${what}: invalid header name`);
    }
    if (DENIED_HEADER_NAMES.has(lower)) {
      throw new HttpWireError(`${what}: the ${lower} header is not allowed`);
    }
    if (lower === "content-type" && opts.allowContentType !== true) {
      throw new HttpWireError(`${what}: the adapter sets the content type`);
    }
    if (typeof value !== "string") {
      throw new HttpWireError(`${what}: invalid header value`);
    }
    if (value.length > MAX_HEADER_VALUE_LENGTH) {
      throw new HttpWireError(`${what}: header value too long`);
    }
    if (/[\r\n]/.test(value)) {
      throw new HttpWireError(`${what}: invalid header value`);
    }
  }
}

/**
 * Merge header sets case-insensitively: HTTP header names are
 * case-insensitive, so the later set wins on the lowercased name. The
 * host's static headers go in before the signed ones, so the signed ones
 * win.
 */
export function mergeHeaders(
  ...parts: ReadonlyArray<Readonly<Record<string, string>>>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of parts) {
    for (const [name, value] of Object.entries(part)) {
      out[name.toLowerCase()] = value;
    }
  }
  return out;
}

/**
 * A server-controlled string on its way into an error message: control
 * characters out, length capped. A newline in a server field must never
 * reach a log line.
 */
export function safeText(raw: unknown, max = 80): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned;
}

/**
 * The endpoint is a host constant, never a request term. `https:` is the
 * only scheme that goes on the wire; `http:` needs the explicit
 * `allowInsecureHttp` opt-in (a local test server).
 */
export function assertEndpointUrl(
  url: string,
  allowInsecureHttp: boolean
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpWireError("the endpoint url is not a url");
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && allowInsecureHttp) return;
  throw new HttpWireError(
    parsed.protocol === "http:"
      ? "the endpoint url must be https (allowInsecureHttp for a local test server)"
      : "the endpoint url must be https"
  );
}

/** Every request gets a deadline; none is unbounded. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** A response body larger than this is refused, not buffered. */
export const MAX_RESPONSE_BYTES = 1_048_576;

export interface HttpCallOptions {
  readonly url: string;
  readonly method: "POST" | "PUT";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly maxBytes?: number;
}

export interface HttpCallResult {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  readonly text: string;
}

/** Read at most `maxBytes`; a bigger body is refused, not buffered. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new HttpWireError(`response body exceeds ${maxBytes} bytes`);
    }
  }
  const stream = res.body;
  if (stream === null) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const value = chunk.value;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpWireError(`response body exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * One HTTP round trip with a hard timeout and a response cap. Redirects
 * are refused, not followed: a redirect would carry the signed request to
 * a host the terms never named.
 *
 * A timeout, a network error, a refused redirect, and an oversized body
 * are all failed effects — the caller throws, never a fake success.
 */
export async function httpCall(opts: HttpCallOptions): Promise<HttpCallResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
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
    const text = await readCapped(res, maxBytes);
    return { status: res.status, ok: res.ok, headers: res.headers, text };
  } catch (err) {
    if (err instanceof HttpWireError) throw err;
    if (controller.signal.aborted) {
      throw new HttpWireError(`request timed out after ${String(timeoutMs)}ms`);
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
