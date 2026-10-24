import type { AuthorityRequest, VerifiedIdentity } from "../core/authority.js";
import type { ProtectedProvider } from "../adapters/providers.js";
import type { ProcessingMode } from "../hostkit/boundary.js";

/**
 * Registration belongs to the trusted MCP host, never the JSON-RPC caller.
 * The host validator must accept only opaque handles and effect-bearing
 * fields it can independently authorize; generic substring filters cannot
 * establish absence of private information.
 */
export interface RegisteredAction {
  readonly action: `/${string}`;
  readonly provider: ProtectedProvider;
  readonly processing: (
    demand: AuthorityRequest,
    ingress: VerifiedIdentity
  ) => ProcessingMode;
  readonly validate: (demand: AuthorityRequest) => void;
}
export function registeredActionMap(actions: readonly RegisteredAction[]):
  ReadonlyMap<string, RegisteredAction> {
  const result = new Map<string, RegisteredAction>();
  for (const entry of actions) {
    const name = entry.action;
    if (typeof name !== "string" ||
        !/^\/[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)+$/.test(name) ||
        name.includes("*") ||
        name === "/pay" || name.startsWith("/pay/") ||
        name === "/disclose" || name.startsWith("/disclose/") ||
        result.has(name) ||
        typeof entry.validate !== "function" ||
        typeof entry.processing !== "function" ||
        typeof entry.provider?.submit !== "function" ||
        typeof entry.provider?.verify !== "function") {
      throw new Error("mcp registration: invalid, reserved or duplicate action");
    }
    result.set(name, entry);
  }
  return result;
}

/** Exact, host-owned email schema used by the reference synthetic adapter. */
export function validateOpaqueEmailAction(
  demand: AuthorityRequest,
  recipient: string
): void {
  const context = demand.context;
  if (demand.action.name !== "/email/send" ||
      demand.resource.type !== "email-message" ||
      !/^msg:[A-Za-z0-9_-]{1,128}$/.test(demand.resource.id) ||
      demand.purpose === undefined ||
      Object.keys(context).sort().join(",") !== "messageId,recipient" ||
      context["messageId"] !== demand.resource.id ||
      context["recipient"] !== recipient) {
    throw new Error("mcp registration: invalid email handle or effect context");
  }
}
