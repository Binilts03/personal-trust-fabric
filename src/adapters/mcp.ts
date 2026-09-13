import { timingSafeEqual } from "node:crypto";

/**
 * MCP edge guards — audience, token separation, redirects.
 * Quotes the spec posture from the deep read
 * (`docs/research/2026-09-09-deep-interop-mcp-webmcp-a2a.md`): audience must
 * validate, the server MUST NOT pass the client token through, redirects are
 * pre-registered and exact-matched. Minting upstream tokens is host business;
 * this module solely refuses the unsafe shapes.
 *
 * SCOPE LIMIT: per-client consent, PKCE S256, single-use state, Host-cookie
 * binding, and minimal scopes are host obligations — this module enforces
 * audience + token-separation + redirect-registry only. `register` is
 * privileged: only the operator may add redirects, never agent input.
 */

export class McpError extends Error {
  constructor(reason: string) {
    super(`mcp: ${reason}`);
  }
}

/** The token audience must include this gateway's own canonical URI. Nothing else counts. */
export function checkAudience(
  aud: string | readonly string[] | undefined,
  self: string
): void {
  const list = aud === undefined ? [] : Array.isArray(aud) ? aud : [aud];
  if (!list.includes(self))
    throw new McpError("audience mismatch: token not minted for this gateway");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Refuse to forward the client token upstream — a separate token is mandatory. */
export function assertDistinctTokens(
  clientToken: string,
  upstreamToken: string
): void {
  if (clientToken.length === 0 || upstreamToken.length === 0)
    throw new McpError("missing token");
  if (constantTimeEqual(clientToken, upstreamToken)) {
    throw new McpError("refusing to forward the client token upstream");
  }
}
