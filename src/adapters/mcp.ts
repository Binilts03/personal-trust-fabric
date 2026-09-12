import { assertSafeUrl } from "./urls.js";

/**
 * MCP edge guards — audience, token separation, redirects.
 * Quotes the spec posture from the deep read
 * (`docs/research/2026-09-09-deep-interop-mcp-webmcp-a2a.md`): audience must
 * validate, the server MUST NOT pass the client token through, redirects are
 * pre-registered and exact-matched. Minting upstream tokens is host business;
 * this module solely refuses the unsafe shapes.
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
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= (a.charCodeAt(i) ^ b.charCodeAt(i)) & 0xffff;
  return diff === 0;
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

/** Pre-registered redirects with exact-match checks. No normalization, no wildcards. */
export class ExplicitRedirects {
  private readonly registered = new Set<string>();

  register(uri: string): void {
    assertSafeUrl(uri, "redirect", true);
    this.registered.add(uri);
  }

  check(uri: string): void {
    if (!this.registered.has(uri))
      throw new McpError("redirect not pre-registered");
  }
}
