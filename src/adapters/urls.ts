/**
 * URL safety shared by the edge adapters (MCP metadata/redirects, A2A push).
 * Blocklists follow the MCP security guidance captured in the deep read
 * (`docs/research/2026-09-09-deep-interop-mcp-webmcp-a2a.md`): RFC 1918,
 * link-local, loopback and unique-local ranges, non-HTTP schemes.
 */

export class UrlError extends Error {
  constructor(reason: string) {
    super(`url: ${reason}`);
  }
}

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m === null) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((n) => n > 255)) return null;
  return octets;
}

/** WHATWG keeps brackets in IPv6 hostnames ([::1]); strip them before matching. */
function bareHost(host: string): string {
  const h = host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  // IPv4-mapped IPv6 arrives in hex WHATWG form (::ffff:a00:1) or dotted
  // (::ffff:10.0.0.1): judge the embedded IPv4 address in both cases.
  if (h.startsWith("::ffff:")) {
    const tail = h.slice("::ffff:".length);
    if (/^(\d+\.){3}\d+$/.test(tail)) return tail;
    const groups = tail.split(":").filter((g) => g.length > 0);
    if (groups.length >= 2) {
      const hi = Number.parseInt(groups[groups.length - 2] as string, 16);
      const lo = Number.parseInt(groups[groups.length - 1] as string, 16);
      if (
        Number.isInteger(hi) &&
        Number.isInteger(lo) &&
        hi >= 0 &&
        hi <= 0xffff &&
        lo >= 0 &&
        lo <= 0xffff
      ) {
        const v = hi * 65536 + lo;
        return `${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`;
      }
    }
  }
  return h;
}

/** Loopback only: localhost, 127/8, ::1. Everything else sensitive stays blocked. */
export function isLoopbackHost(host: string): boolean {
  const h = bareHost(host);
  if (h === "localhost") return true;
  const octets = ipv4Octets(h);
  if (octets !== null && octets[0] === 127) return true;
  return h === "::1";
}

function isAlwaysBlockedHost(host: string): boolean {
  const h = bareHost(host);
  // Unspecified and loopback are never fetchable: loopback HTTP is allowed
  // only through the explicit redirect exception below, never here.
  if (h === "::" || h === "0.0.0.0") return true;
  if (isLoopbackHost(h)) return true;
  const octets = ipv4Octets(h);
  if (octets !== null) {
    const a = octets[0] as number;
    const b = octets[1] as number;
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }
  if (h.includes(":")) {
    const first = (h.split(":")[0] ?? "").toLowerCase();
    if (first.startsWith("fc") || first.startsWith("fd")) return true; // fc00::/7
    if (/^fe[89ab]/.test(first)) return true; // fe80::/10
  }
  return false;
}

/**
 * Fail-closed URL check. HTTPS only, except explicit loopback-HTTP callers
 * (the MCP redirect case). Returns the parsed URL on success.
 *
 * STRING-CHECK LIMIT: this checks the hostname string only. An attacker
 * domain resolving to a private IP, or a clean URL 302-redirecting to one,
 * still passes here — that is what `fetchWithPinning` below closes
 * (DNS lookup per hop + manual-redirect re-check, no-follow by default).
 * Egress proxying stays host duty (accepted-risk for single-operator;
 * see `docs/audit/limits.md`). `userinfo` (user:pass@) is always
 * rejected — it leaks via logs and confuses origin equality.
 */
export function assertSafeUrl(
  raw: string,
  what: string,
  allowLoopbackHttp = false
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlError(`${what}: malformed URL`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new UrlError(`${what}: userinfo not allowed`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlError(`${what}: only http(s) allowed`);
  }
  if (
    url.protocol === "http:" &&
    allowLoopbackHttp &&
    isLoopbackHost(url.hostname)
  ) {
    return url;
  }
  if (isAlwaysBlockedHost(url.hostname))
    throw new UrlError(`${what}: blocked network range`);
  if (url.protocol !== "https:") throw new UrlError(`${what}: https required`);
  return url;
}

/** Strip a zone id (%eth0) and WHATWG brackets before IP matching. */
function bareIp(host: string): string {
  return (host.split("%")[0] ?? host).replace(/^\[/, "").replace(/\]$/, "");
}

/** True when a resolved/literal IP must never be fetched (v4 + v6). */
export function isBlockedIp(ip: string): boolean {
  return isAlwaysBlockedHost(bareIp(ip));
}

function ipLiteralOf(host: string): string | null {
  const bare = bareIp(host);
  if (ipv4Octets(bare) !== null) return bare;
  if (bare.includes(":")) return bare;
  return null;
}

/** Injectable DNS lookup (hostname → IP string) for tests and host pinning. */
export type PinnedLookup = (host: string) => Promise<string>;

/** Minimal fetch shape so hosts can inject a proxy-aware client in tests. */
export interface PinnedFetchResponse {
  readonly status: number;
  readonly location: string | null;
  readonly url: string;
  readonly text: () => Promise<string>;
}

export type PinnedFetchFn = (
  url: string,
  init: { readonly redirect: "manual" }
) => Promise<PinnedFetchResponse>;

export interface PinnedFetchOptions {
  readonly maxRedirects?: number;
  readonly allowLoopbackHttp?: boolean;
  /** Error-label prefix (same convention as `assertSafeUrl`'s `what`). */
  readonly what?: string;
  readonly lookup?: PinnedLookup;
  readonly fetchFn?: PinnedFetchFn;
  /** Host-pinned hostname → IP. Checked before DNS; still blocked-range enforced. */
  readonly pinnedIps?: Readonly<Record<string, string>>;
}

async function defaultLookup(host: string): Promise<string> {
  const dns = await import("node:dns/promises");
  const found = await dns.lookup(host);
  return found.address;
}

async function defaultFetchFn(
  url: string,
  init: { readonly redirect: "manual" }
): Promise<PinnedFetchResponse> {
  const g = globalThis as unknown as { readonly fetch?: unknown };
  if (typeof g.fetch !== "function")
    throw new UrlError("fetch: global fetch unavailable");
  const fetchFn = g.fetch as (
    input: string,
    init: { readonly redirect: "manual" }
  ) => Promise<{
    readonly status: number;
    readonly headers: { readonly get: (name: string) => string | null };
    readonly url: string;
    readonly text: () => Promise<string>;
  }>;
  const res = await fetchFn(url, init);
  return {
    status: res.status,
    location: res.headers.get("location"),
    url: res.url,
    text: () => res.text(),
  };
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Production fetch path (ticket 11, host-owned, behind `PinnedFetchOptions`).
 * Per hop: `assertSafeUrl` string check → DNS lookup (or `pinnedIps` /
 * IP-literal fast path) → `isBlockedIp` fail-closed → fetch with
 * `redirect: "manual"` → redirect targets re-resolved and re-checked.
 * Defaults to no-follow (`maxRedirects: 0`): any 3xx with a Location
 * fails closed unless the host explicitly opts into following.
 *
 * Residual (stated, not silent): lookup-then-connect is TOCTOU — DNS can
 * change between the check and the socket. Single-operator deployments
 * accept this with reputable DNS; high-value hosts must add OS-level
 * pinning or an egress proxy (accepted-risk, see `docs/audit/limits.md`).
 */
export async function fetchWithPinning(
  raw: string,
  opts?: PinnedFetchOptions
): Promise<PinnedFetchResponse> {
  const maxRedirects = opts?.maxRedirects ?? 0;
  const allowLoopbackHttp = opts?.allowLoopbackHttp ?? false;
  const what = opts?.what ?? "fetch";
  const lookup = opts?.lookup ?? defaultLookup;
  const fetchFn = opts?.fetchFn ?? defaultFetchFn;
  let current = raw;
  for (let hop = 0; ; hop += 1) {
    const url = assertSafeUrl(current, what, allowLoopbackHttp);
    const literal = ipLiteralOf(url.hostname);
    const pinned = opts?.pinnedIps?.[url.hostname.toLowerCase()];
    const ip =
      literal ?? pinned ?? (await lookup(url.hostname).catch(() => null));
    if (ip === null || ip.length === 0)
      throw new UrlError(`${what}: DNS lookup failed`);
    if (isBlockedIp(ip)) throw new UrlError(`${what}: DNS resolves private`);
    const res = await fetchFn(url.toString(), { redirect: "manual" });
    if (!REDIRECT_STATUS.has(res.status)) return res;
    const loc = res.location;
    if (loc === null || loc.length === 0)
      throw new UrlError(`${what}: redirect without location`);
    if (hop >= maxRedirects)
      throw new UrlError(`${what}: redirect blocked (no-follow)`);
    try {
      current = new URL(loc, url.toString()).toString();
    } catch {
      throw new UrlError(`${what}: malformed redirect target`);
    }
  }
}
