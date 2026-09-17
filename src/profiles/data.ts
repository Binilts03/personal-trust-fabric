import { Authority, digestForOperation } from "../core/authority.js";
import type {
  AuthorityDecision,
  AuthorityOperation,
  AuthorityRequest,
  VerifiedIdentity,
} from "../core/authority.js";
import { renderProposal } from "../core/approve.js";
import { isNonEmptyString } from "../adapters/guards.js";

/**
 * General agent contract (P0 slice 2).
 *
 * Thin wrappers over `Authority.evaluate` + `digestForOperation` +
 * `renderProposal` for non-payment agents. Operations are identity-free —
 * the host binds a fixed `VerifiedIdentity` (ADR-0013) and the engine
 * derives the digest internally, so callers never choose identity or
 * self-certify terms.
 *
 * Disclose-vs-use tiers: disclosures go through `requestData` (`/disclose`
 * only); everything else goes through `requestExecution`, which rejects
 * `/disclose*` (use `requestData`) and dry-runs without consuming uses.
 * Neither wrapper mints authority — approvals stay human-side (CLI) or
 * ahead of time (standing grants). No-approve invariant holds.
 */

export interface DataRequest {
  readonly purpose: string;
  readonly resourceId: string;
  readonly resourceType?: string;
  readonly claims: readonly string[];
  readonly verifier: string;
}

export interface ActionRequest {
  readonly action: `/${string}`;
  readonly purpose?: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface AgentProposal {
  readonly demand: AuthorityRequest;
  readonly digest: string;
  readonly decision: AuthorityDecision;
  readonly proposal: string;
}

function checkActionName(name: unknown): asserts name is `/${string}` {
  if (typeof name !== "string" || !name.startsWith("/") || name === "/") {
    throw new Error('agent-contract: action must be a /-path ("/" forbidden)');
  }
}

/**
 * Disclosure dry-run: builds the `/disclose` operation, evaluates without
 * consuming, and renders the exact terms for human approval.
 */
export function requestData(
  authority: Authority,
  ingress: VerifiedIdentity,
  req: DataRequest,
  opts: { readonly nowSec?: number } = {}
): AgentProposal {
  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    throw new Error("agent-contract: request must be an object");
  }
  if (!isNonEmptyString(req.purpose))
    throw new Error("agent-contract: purpose required");
  if (!isNonEmptyString(req.resourceId))
    throw new Error("agent-contract: resourceId required");
  if (req.resourceType !== undefined && !isNonEmptyString(req.resourceType)) {
    throw new Error("agent-contract: resourceType must be non-empty");
  }
  if (!Array.isArray(req.claims) || req.claims.length === 0) {
    throw new Error("agent-contract: claims must be non-empty");
  }
  for (const c of req.claims) {
    if (!isNonEmptyString(c))
      throw new Error("agent-contract: claims must be non-empty strings");
  }
  if (!isNonEmptyString(req.verifier))
    throw new Error("agent-contract: verifier required");
  const op: AuthorityOperation = {
    action: { name: "/disclose" },
    resource: { type: req.resourceType ?? "credential", id: req.resourceId },
    context: { claims: [...req.claims], verifier: req.verifier },
    purpose: req.purpose,
  };
  const bound = {
    ...op,
    principal: ingress.principal,
    actor: ingress.id,
    ...(ingress.chain !== undefined ? { actorChain: [...ingress.chain] } : {}),
  };
  const digest = digestForOperation(bound);
  const demand: AuthorityRequest = { ...bound, termsDigest: digest };
  const decision = authority.evaluate(op, ingress, {
    ...(opts.nowSec !== undefined ? { nowSec: opts.nowSec } : {}),
  });
  const proposal = renderProposal({
    demand,
    citations: decision.allow ? decision.citations : [],
  });
  return { demand, digest, decision, proposal };
}

/**
 * General execution dry-run for any non-disclosure `/-path`.
 * Rejects `/disclose*` so the disclose tier stays separate.
 */
export function requestExecution(
  authority: Authority,
  ingress: VerifiedIdentity,
  req: ActionRequest,
  opts: { readonly nowSec?: number } = {}
): AgentProposal {
  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    throw new Error("agent-contract: request must be an object");
  }
  checkActionName(req.action);
  if (req.action === "/disclose" || req.action.startsWith("/disclose/")) {
    throw new Error(
      "agent-contract: use requestData for /disclose (tier separation)"
    );
  }
  if (!isNonEmptyString(req.resourceType))
    throw new Error("agent-contract: resourceType required");
  if (!isNonEmptyString(req.resourceId))
    throw new Error("agent-contract: resourceId required");
  if (req.purpose !== undefined && !isNonEmptyString(req.purpose)) {
    throw new Error("agent-contract: purpose must be non-empty");
  }
  if (req.context !== undefined) {
    if (
      typeof req.context !== "object" ||
      req.context === null ||
      Array.isArray(req.context)
    ) {
      throw new Error("agent-contract: context must be an object");
    }
  }
  const op: AuthorityOperation = {
    action: { name: req.action },
    resource: { type: req.resourceType, id: req.resourceId },
    context: { ...(req.context ?? {}) },
    ...(req.purpose !== undefined ? { purpose: req.purpose } : {}),
  };
  const bound = {
    ...op,
    principal: ingress.principal,
    actor: ingress.id,
    ...(ingress.chain !== undefined ? { actorChain: [...ingress.chain] } : {}),
  };
  const digest = digestForOperation(bound);
  const demand: AuthorityRequest = { ...bound, termsDigest: digest };
  const decision = authority.evaluate(op, ingress, {
    ...(opts.nowSec !== undefined ? { nowSec: opts.nowSec } : {}),
  });
  const proposal = renderProposal({
    demand,
    citations: decision.allow ? decision.citations : [],
  });
  return { demand, digest, decision, proposal };
}
