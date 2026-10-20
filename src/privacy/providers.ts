import type { ExecutionReceipt } from "../core/execute.js";
import { PrivacyOutcomeUnknownError } from "./errors.js";
import {
  denyGate as deny,
  PrivacyRuntime,
  type PrivacyGateRequest,
  type PrivacyGateResult,
} from "./runtime.js";

export { PrivacyPreEffectError } from "./errors.js";

/**
 * Privacy evidence wrapper around an existing protected/journaled execution.
 * The supplied execute callback remains responsible for the provider effect,
 * exact-operation binding, authority consumption and execution reconciliation.
 *
 * The callback receives two hooks: `markEffectStarted` (the caller's own
 * effect boundary) and `fence` (the privacy fence). The caller must invoke
 * `fence` immediately before the external effect and after any authority
 * consumption, so a withdrawal that lands in that window stops the attempt
 * instead of processing anyway.
 */
export async function executeProtectedActionWithPrivacy(opts: {
  readonly runtime: PrivacyRuntime;
  readonly gate: PrivacyGateRequest;
  readonly execute: (
    markEffectStarted: () => void,
    fence: () => void
  ) => Promise<ExecutionReceipt>;
  readonly attemptRef?: string;
}): Promise<ExecutionReceipt> {
  const first = opts.runtime.preflight(opts.gate);
  if (!first.allow) deny(first);

  let live: Extract<PrivacyGateResult, { allow: true }>;
  try {
    live = opts.runtime.recheck(first, opts.gate);
  } catch {
    throw new Error("privacy denied");
  }

  const event = opts.runtime.prepareEvent(live, opts.gate, opts.attemptRef);
  let receipt: ExecutionReceipt;
  let effectStarted = false;
  const markEffectStarted = () => {
    effectStarted = true;
  };
  const fence = () => {
    opts.runtime.fence(live, opts.gate);
  };
  try {
    receipt = await opts.execute(markEffectStarted, fence);
  } catch (error) {
    // A caller that has not crossed the effect boundary has provably not
    // changed external state. After that boundary, preserve ambiguity and
    // let the execution journal remain the reconciliation oracle.
    if (effectStarted) {
      try {
        opts.runtime.finalizeEvent(event.eventId, "OUTCOME_UNKNOWN", {
          finalizedAt: opts.runtime.now(),
        });
      } catch {
        // Never mask the original failure with a finalize error.
      }
      throw new PrivacyOutcomeUnknownError(error);
    }
    try {
      opts.runtime.finalizeEvent(event.eventId, "FAILED_FINAL", {
        finalizedAt: opts.runtime.now(),
      });
    } catch {
      // Never mask the original failure with a finalize error.
    }
    throw error;
  }
  // Finalize outside the execute catch: a bookkeeping failure here must not
  // be reclassified as a provable pre-effect failure. The journal already
  // holds the receipt, so the caller must reconcile rather than report a
  // denial. Same-state transitions are idempotent, so a retry can safely
  // repeat this call.
  try {
    opts.runtime.finalizeEvent(event.eventId, "SUCCEEDED", {
      finalizedAt: receipt.at,
      evidenceRef: `execution-receipt:${receipt.receiptId}`,
    });
  } catch (error) {
    throw new PrivacyOutcomeUnknownError(error);
  }
  return receipt;
}
