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
 * Host wiring for the privacy plane, without the MCP surface.
 *
 * `mcp-host.ts` is the reference host's wiring; this module is the generic
 * one. Both call the same functions, so a third-party host and the reference
 * host cannot drift apart (ADR-0025: enforcement is per-host, explicit and
 * composed at the effect boundary).
 */

/**
 * Operator configuration for the host privacy gate. One shape for every
 * host: the reference MCP host and a third-party host read the same fields,
 * so a configuration that works for one works for the other.
 */
export type HostPrivacyConfig = McpPrivacyConfig;

/**
 * The privacy binding for one operation, without the Authority instance.
 *
 * Only the two reference actions are covered. A host that owns another
 * action composes its own gate from `TrustedProcessingContext` - the
 * runtime, the stores and the ordering are unchanged, only the binding
 * differs. An unknown action fails closed: there is no default binding.
 */
export function makeHostPrivacyGate(
  config: HostPrivacyConfig,
  ingress: VerifiedIdentity,
  demand: AuthorityRequest
): Omit<PrivacyGateRequest, "authority"> {
  if (demand.action.name === "/pay") {
    return makeMcpPrivacyPaymentGate(config, ingress, demand);
  }
  if (demand.action.name === "/disclose") {
    return makeMcpPrivacyDisclosureGate(config, ingress, demand);
  }
  throw new Error("privacy denied");
}

/**
 * The privacy runtime and gate for one host operation, bound to the
 * encrypted host stores.
 *
 * The DEK is resolved from the store's envelope kid, so a rotated privacy
 * key keeps working. A missing privacy store fails closed rather than
 * running the operation ungated.
 */
export function privacyForHostOperation(opts: {
  readonly dir: string;
  readonly keys: Record<string, Uint8Array>;
  readonly auth: Authority;
  readonly ingress: VerifiedIdentity;
  readonly demand: AuthorityRequest;
  readonly config: HostPrivacyConfig;
  readonly now: () => number;
}): { runtime: PrivacyRuntime; gate: PrivacyGateRequest } {
  const binding = makeHostPrivacyGate(opts.config, opts.ingress, opts.demand);
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
