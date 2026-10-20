import type { ProcessingEventState } from "./model.js";

/** A failure proven to occur before any external effect. */
export class PrivacyPreEffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyPreEffectError";
  }
}

/**
 * The processing boundary was crossed, but the outcome cannot be proven.
 * Callers must not report this as a denial: the execution journal (for
 * payments) or an operator reconciliation (for disclosures) is the oracle.
 */
export class PrivacyOutcomeUnknownError extends Error {
  readonly original: unknown;

  constructor(original: unknown) {
    super("privacy outcome unknown");
    this.name = "PrivacyOutcomeUnknownError";
    this.original = original;
  }
}

/**
 * An existing Processing Event with the same attempt identity is not
 * PREPARED. A new external effect must not run against it; the caller must
 * inspect/reconcile the existing evidence instead.
 */
export class PrivacyEventConflictError extends Error {
  readonly eventId: string;
  readonly state: ProcessingEventState;

  constructor(eventId: string, state: ProcessingEventState) {
    super(`privacy event: attempt already ${state} (${eventId})`);
    this.name = "PrivacyEventConflictError";
    this.eventId = eventId;
    this.state = state;
  }
}
