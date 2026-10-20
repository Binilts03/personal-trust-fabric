/**
 * Curated privacy-enforcement API.
 *
 * Stable contracts and runtime composition live here. File-backed privacy
 * configuration/event stores remain host internals and are intentionally not
 * re-exported from this package subpath.
 */
export * from "./model.js";
export { evaluateProcessing } from "./engine.js";
export {
  PrivacyEventConflictError,
  PrivacyOutcomeUnknownError,
  PrivacyPreEffectError,
} from "./errors.js";
export { resolveJournalOutcome } from "./recovery.js";
export { DPDP_PROFILE_ID, DPDP_PROFILE_REVISION, dpdpProfile } from "./dpdp.js";
export { PrivacyRuntime } from "./runtime.js";
export type {
  PrivacyRuntimeDeps,
  PrivacyGateRequest,
  PrivacyGateResult,
} from "./runtime.js";
export { discloseWithPrivacy, useCredentialWithPrivacy } from "./vault.js";
export { executeProtectedActionWithPrivacy } from "./providers.js";
export {
  MCP_PRIVACY_DENIED_PATHS,
  MCP_PRIVACY_GATED_PATHS,
  MCP_PRIVACY_UNCOVERED_PATHS,
  resolveMcpPrivacyConfig,
  makeMcpPrivacyDisclosureGate,
  makeMcpPrivacyPaymentGate,
} from "./mcp.js";
export type { McpPrivacyConfig } from "./mcp.js";
export { summarizeProcessing, planErasure } from "./rights.js";
export type { ProcessingSummary, ErasurePlanItem } from "./rights.js";
