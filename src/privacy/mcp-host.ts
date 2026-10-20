import type {
  Authority,
  AuthorityRequest,
  VerifiedIdentity,
} from "../core/authority.js";
import { FilePrivacyEventRepository } from "../store/privacy-events.js";
import {
  loadPrivacyStore,
  readPrivacyKid,
  resolvePrivacyDek,
} from "../store/privacy.js";
import { dpdpProfile } from "./dpdp.js";
import {
  makeMcpPrivacyDisclosureGate,
  makeMcpPrivacyPaymentGate,
  type McpPrivacyConfig,
} from "./mcp.js";
import { PrivacyRuntime, type PrivacyGateRequest } from "./runtime.js";

/**
 * Host wiring for the reference MCP server. Policy construction stays in
 * `mcp.ts`; this module only binds it to the encrypted host stores. It is
 * intentionally not re-exported from the curated public privacy API.
 */
export function privacyForOperation(opts: {
  readonly dir: string;
  readonly keys: Record<string, Uint8Array>;
  readonly auth: Authority;
  readonly ingress: VerifiedIdentity;
  readonly demand: AuthorityRequest;
  readonly config: McpPrivacyConfig;
  readonly now: () => number;
}): { runtime: PrivacyRuntime; gate: PrivacyGateRequest } {
  let binding: Omit<PrivacyGateRequest, "authority">;
  if (opts.demand.action.name === "/pay") {
    binding = makeMcpPrivacyPaymentGate(opts.config, opts.ingress, opts.demand);
  } else if (opts.demand.action.name === "/disclose") {
    binding = makeMcpPrivacyDisclosureGate(
      opts.config,
      opts.ingress,
      opts.demand
    );
  } else {
    throw new Error("privacy denied");
  }
  const kid = readPrivacyKid(opts.dir);
  if (kid === null) throw new Error("privacy denied");
  const dek = resolvePrivacyDek(opts.keys, kid);
  return {
    gate: { ...binding, authority: opts.auth },
    runtime: new PrivacyRuntime({
      loadPrivacy: () =>
        loadPrivacyStore(opts.dir, {
          keys: opts.keys,
          nowSec: opts.now,
        }).snapshot(),
      events: new FilePrivacyEventRepository({
        dir: opts.dir,
        dek,
        nowSec: opts.now,
      }),
      profile: dpdpProfile,
      nowSec: opts.now,
    }),
  };
}
