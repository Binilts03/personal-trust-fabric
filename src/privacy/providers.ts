import type { ExecutionReceipt } from "../core/execute.js";
import {
  PrivacyRuntime,
  type PrivacyGateRequest,
  type PrivacyGateResult,
} from "./runtime.js";

/** A failure proven to occur before any external effect. */
export class PrivacyPreEffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyPreEffectError";
  }
}

function deny(result: Exclude<PrivacyGateResult, { allow: true }>): never {
  throw new Error(
    result.publicReason === "authority-denied"
      ? "authority denied"
      : "privacy denied"
  );
}

/**
 * Privacy evidence wrapper around an existing protected/journaled execution.
 * The supplied execute callback remains responsible for the provider effect,
 * exact-operation binding, authority consumption and execution reconciliation.
 */
export async function executeProtectedActionWithPrivacy(opts: {
  readonly runtime: PrivacyRuntime;
  readonly gate: PrivacyGateRequest;
  readonly execute: (
    markEffectStarted: () => void
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
  try {
    receipt = await opts.execute(markEffectStarted);
  } catch (error) {
    // A caller that has not crossed the effect boundary has provably not
    // changed external state. After that boundary, preserve ambiguity and
    // let the execution journal remain the reconciliation oracle.
    const state = effectStarted ? "OUTCOME_UNKNOWN" : "FAILED_FINAL";
    try {
      opts.runtime.finalizeEvent(event.eventId, state, {
        finalizedAt: Math.floor(Date.now() / 1000),
      });
    } catch {
      // Never mask the original failure with a finalize error.
    }
    throw error;
  }
  // Finalize outside the execute catch: a bookkeeping failure here must not
  // be reclassified as an ambiguous external effect. Same-state transitions
  // are idempotent, so a crash/retry can safely repeat this call.
  opts.runtime.finalizeEvent(event.eventId, "SUCCEEDED", {
    finalizedAt: receipt.at,
    evidenceRef: `execution-receipt:${receipt.receiptId}`,
  });
  return receipt;
}
