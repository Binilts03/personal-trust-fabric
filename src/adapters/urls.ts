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
  return host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "");
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
 * Fail-closed URL check. HTTPS required unless `allowLoopbackHttp` and a
 * loopback host (the MCP redirect case). Returns the parsed URL on success.
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
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlError(`${what}: only http(s) allowed`);
  }
  if (isAlwaysBlockedHost(url.hostname))
    throw new UrlError(`${what}: blocked network range`);
  if (
    url.protocol === "http:" &&
    !(allowLoopbackHttp && isLoopbackHost(url.hostname))
  ) {
    throw new UrlError(`${what}: http allowed for loopback only`);
  }
  return url;
}
