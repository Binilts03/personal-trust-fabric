import type { ExecutionReceipt } from "../core/execute.js";
import {
  PrivacyRuntime,
  type PrivacyGateRequest,
  type PrivacyGateResult,
} from "./runtime.js";

function deny(result: Exclude<PrivacyGateResult, { allow: true }>): never {
  throw new Error(result.publicReason === "authority-denied" ? "authority denied" : "privacy denied");
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
  try {
    const receipt = await opts.execute();
    opts.runtime.finalizeEvent(event.eventId, "SUCCEEDED", {
      finalizedAt: receipt.at,
      evidenceRef: `execution-receipt:${receipt.receiptId}`,
    });
    return receipt;
  } catch (error) {
    // The provider/journal may have effected before surfacing an error.
    // Privacy evidence records uncertainty and lets the execution journal
    // remain the authoritative outcome/reconciliation mechanism.
    opts.runtime.finalizeEvent(event.eventId, "OUTCOME_UNKNOWN", {
      finalizedAt: Math.floor(Date.now() / 1000),
    });
    throw error;
  }
}
