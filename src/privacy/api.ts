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
  DPDP_PROFILE_ID,
  DPDP_PROFILE_REVISION,
  dpdpProfile,
} from "./dpdp.js";
export {
  PrivacyRuntime,
} from "./runtime.js";
export type {
  PrivacyRuntimeDeps,
  PrivacyGateRequest,
  PrivacyGateResult,
} from "./runtime.js";
export {
  discloseWithPrivacy,
  useCredentialWithPrivacy,
} from "./vault.js";
export { executeProtectedActionWithPrivacy } from "./providers.js";
export {
  summarizeProcessing,
  planErasure,
} from "./rights.js";
export type {
  ProcessingSummary,
  ErasurePlanItem,
} from "./rights.js";
