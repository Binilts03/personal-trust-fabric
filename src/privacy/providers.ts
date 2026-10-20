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
  readonly execute: () => Promise<ExecutionReceipt>;
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
  try {
    receipt = await opts.execute();
  } catch (error) {
    // The provider/journal may have effected before surfacing an error.
    // Privacy evidence records uncertainty and lets the execution journal
    // remain the authoritative outcome/reconciliation mechanism. A typed
    // pre-effect failure is different: no external change happened.
    const state =
      error instanceof PrivacyPreEffectError
        ? "FAILED_FINAL"
        : "OUTCOME_UNKNOWN";
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
