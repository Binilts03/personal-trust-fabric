/**
 * Curated public entry (ticket 09, ADR-0011). EXPLICIT NAMED re-exports only:
 * the Authority engine, the human-approval presenter, agent-view shaping,
 * receipt-bound execution, and the recipient registry.
 *
 * INTERNAL BY PACKAGING (still importable via deep paths, never from here):
 * - capability envelope (`core/capability.js`, `core/types.js`:
 *   Capabilities, SealedCapability, CapabilityPayload) — local-only receipt
 *   machinery, never wire (ADR-0009);
 * - canonical/crypto machinery (`core/canonical.js`, `core/crypto.js`:
 *   canonicalize, sha256Hex, termsDigestOf, key functions) — bind operations
 *   with `digestForOperation`, not raw digests;
 * - disclosure engine (`core/disclose.js`), policy predicates
 *   (`core/policy.js`), host stores (`store/*`) and evidence adapters —
 *   translators live on subpaths (`./authzen`, `./oauth`,
 *   `./profiles/payment`) or deep paths.
 *
 * When unsure, a symbol stays OUT of this file (narrower is the point).
 * Tests keep importing the full barrel (`../src/index.js`); hosts needing
 * internals import deep paths or use the bins.
 */

export {
  Authority,
  paymentBounds,
  claimsSubset,
  digestForOperation,
} from "./core/authority.js";
export type {
  AuthorityRequest,
  AuthorityOperation,
  VerifiedIdentity,
  VerifiedExternalBinding,
  ActorSelector,
  AttributeBound,
  StandingGrant,
  OneTimeApproval,
  PolicyConstraint,
  AuthorityDecision,
} from "./core/authority.js";

export { renderProposal, parseDecision } from "./core/approve.js";
export type { ProposalView } from "./core/approve.js";

export { assembleCapsule, renderAgentView } from "./core/persona.js";
export type {
  PersonalState,
  PersonaCapsule,
  AgentView,
} from "./core/persona.js";

export { executeAndReceipt } from "./core/execute.js";
export type {
  Receipt,
  PaymentInstruction,
  PaymentExecutor,
} from "./core/execute.js";

export { signAndReceipt } from "./core/signing.js";
export type {
  SignReceipt,
  SignInstruction,
  SigningExecutor,
} from "./core/signing.js";

export { RecipientRegistry } from "./core/identity.js";
