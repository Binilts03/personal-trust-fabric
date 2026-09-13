import { assertSafeUrl, isLoopbackHost } from "./urls.js";

/**
 * WebMCP edge guards — registration shape, origin exposure, confirmation policy.
 * Follows the spec surface from the deep read
 * (`docs/research/2026-09-09-deep-interop-mcp-webmcp-a2a.md`): name charset and
 * length, same-origin-by-default exposure, `consequentialHint` confirmation.
 * Chrome's character budgets are guidance, deliberately NOT enforced.
 *
 * TRUST LIMIT: `consequentialHint` is tool-author self-attestation. A lying
 * tool that omits it on a mutating action bypasses confirmation. Hosts must
 * treat tool metadata/outputs as untrusted (tool-poisoning, over-parameter
 * profiling) and gate irreversible effects independently — this module only
 * enforces the declared hint, it does not detect mutation.
 */

export class WebMcpError extends Error {
  constructor(reason: string) {
    super(`webmcp: ${reason}`);
  }
}

const NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export interface ToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
  readonly consequentialHint?: boolean;
}

export interface ToolRegistration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  readonly annotations?: ToolAnnotations;
  readonly exposedTo?: readonly string[];
  readonly origin: string;
}

/** Origins are scheme + host (+port) over https, or http loopback. Nothing else is exposable. */
export function checkSecureOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new WebMcpError(`insecure origin: ${origin}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new WebMcpError(`origin must not carry userinfo: ${origin}`);
  }
  if (url.pathname !== "/" && url.pathname !== "")
    throw new WebMcpError(`origin must not carry a path: ${origin}`);
  if (url.search !== "" || url.hash !== "")
    throw new WebMcpError(`origin must not carry query/fragment: ${origin}`);
  if (url.protocol === "https:") {
    // Block literal private IPs here; names still need DNS-pinning by the
    // fetcher (see urls.ts limit note).
    try {
      assertSafeUrl(origin, "origin");
    } catch (e) {
      throw new WebMcpError(
        e instanceof Error ? e.message : `insecure origin: ${origin}`
      );
    }
    return;
  }
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return;
  throw new WebMcpError(`insecure origin: ${origin}`);
}

export function checkToolRegistration(tool: ToolRegistration): void {
  if (typeof tool.name !== "string" || !NAME_RE.test(tool.name))
    throw new WebMcpError(`bad tool name: ${String(tool.name)}`);
  if (
    typeof tool.description !== "string" ||
    tool.description.trim().length === 0
  )
    throw new WebMcpError("description required");
  for (const origin of tool.exposedTo ?? []) checkSecureOrigin(origin);
}

/** Default-deny exposure: same-origin always allowed; explicit grants add callers. */
export function isExposedTo(
  tool: Pick<ToolRegistration, "origin" | "exposedTo">,
  caller: string
): boolean {
  if (caller === tool.origin) return true;
  const grants = tool.exposedTo ?? [];
  return grants.includes(caller);
}

/** Mutating or irreversible tools run only after explicit confirmation. */
export function requiresConfirmation(
  annotations: ToolAnnotations | undefined
): boolean {
  return annotations?.consequentialHint === true;
}
