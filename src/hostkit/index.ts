/**
 * The curated host kit surface.
 *
 * A host adopts the effect boundary once and runs every effect through it.
 * The kit is a library boundary, not an interceptor: a host that does not
 * compose it is uncovered, not compliant (ADR-0025).
 *
 * The privacy store wiring lives in `src/privacy/host.ts` and stays out of
 * this barrel on purpose: the host binds its own stores.
 */
export { createEffectBoundary, createProtectedEffect, hostTermsDigest, ProtectedEffectOutcomeUnknownError } from "./boundary.js";
export type {
  HostEffectBoundary,
  HostEffectBoundaryOptions,
  ProcessingMode,
  EffectMode,
  ProtectedEffectOptions,
  ProtectedEffectReceipt,
  ProtectedEffect,
  HostEffectContext,
  HostEffectDecision,
  HostEffectDenialReason,
  HostEffectReceipt,
} from "./boundary.js";

export {
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

export { createHostRedemptionChallenge } from "./recipient-proof.js";
export type { HostRedemptionChallenge } from "./recipient-proof.js";
