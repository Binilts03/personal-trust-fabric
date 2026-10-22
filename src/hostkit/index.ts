/**
 * The curated host kit surface.
 *
 * A host adopts the effect boundary once and runs every effect through it.
 * The kit is a library boundary, not an interceptor: a host that does not
 * compose it is uncovered, not compliant (ADR-0025).
 *
 * The privacy store wiring lives in `src/privacy/host.ts`. It is exposed
 * here on purpose: removing the store-wiring tax is the point of the kit
 * (ADR-0025, amendment of 2026-10-22). The curated `./privacy` subpath
 * remains the persistence-free library surface.
 */
export { createEffectBoundary, hostTermsDigest } from "./boundary.js";
export type {
  HostEffectBoundary,
  HostEffectBoundaryOptions,
  HostEffectContext,
  HostEffectDecision,
  HostEffectDenialReason,
  HostEffectReceipt,
} from "./boundary.js";

export {
  PrivacyEventConflictError,
  PrivacyOutcomeUnknownError,
  PrivacyPreEffectError,
} from "../privacy/errors.js";
export {
  makeHostPrivacyGate,
  privacyForHostOperation,
} from "../privacy/host.js";
export type { HostPrivacyConfig } from "../privacy/host.js";

export {
  buildHostConformanceScenario,
  referenceHostBoundary,
  runHostConformance,
} from "./conformance.js";
export type {
  HostConformanceBoundaryFactory,
  HostConformanceObservations,
  HostConformanceOptions,
  HostConformanceResult,
  HostConformanceScenario,
  HostConformanceScenarioOptions,
} from "./conformance.js";
