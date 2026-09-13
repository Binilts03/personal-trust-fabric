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
 * DNS LIMIT (documented, not code-fixable here): this checks the hostname
 * string only. An attacker domain resolving to a private IP, or a clean URL
 * 302-redirecting to one, still passes. Callers that fetch must pin DNS,
 * disable redirect-following (or re-check every hop), and prefer an egress
 * proxy (see deep read). `userinfo` (user:pass@) is always rejected — it
 * leaks via logs and confuses origin equality.
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
