import { canonicalize } from "../core/canonical.js";
import type { ExecutionReceipt } from "../core/execute.js";
import {
  deriveIdempotencyKey,
  type ExecutionRecord,
} from "../store/execution.js";
import {
  FileExecutions,
  type ExecutionRepository,
} from "../store/repositories.js";

/**
 * Read-only journal replay for a payment attempt. The caller must run this
 * before any live-authority preflight or capability challenge: a completed
 * effect is proven by the journal, and replaying it must not consume another
 * authority use or require a fresh recipient proof.
 *
 * The journal key is derived from the exact terms digest, but every stored
 * field is matched too. A same-key record whose content drifted is treated as
 * ambiguous evidence, never as a receipt.
 */

export interface PaymentJournalExpectation {
  readonly dir: string;
  readonly termsDigest: string;
  readonly action: "/pay";
  readonly recipient: string;
  readonly resource: string;
  readonly purpose: string;
  readonly context: Readonly<Record<string, unknown>>;
}

export type PaymentReceipt = ExecutionReceipt & {
  readonly amount: number;
  readonly currency: string;
};

export type PaymentJournalReplay =
  | { readonly kind: "none" }
  | {
      readonly kind: "succeeded";
      readonly record: ExecutionRecord;
      readonly receipt: PaymentReceipt;
    }
  | { readonly kind: "failed_final"; readonly record: ExecutionRecord }
  | {
      readonly kind: "unknown";
      readonly record: ExecutionRecord | null;
      /** Fixed-vocabulary reason suitable for sanitized MCP output. */
      readonly reason: "corrupt" | "live" | "mismatch" | "reconciled";
    };

function contextMatches(
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>
): boolean {
  try {
    return canonicalize(actual) === canonicalize(expected);
  } catch {
    return false;
  }
}

function receiptFromRecord(record: ExecutionRecord): PaymentReceipt {
  if (
    record.state !== "SUCCEEDED" ||
    typeof record.receiptId !== "string" ||
    record.receiptId.length === 0 ||
    typeof record.receiptAt !== "number" ||
    !Number.isFinite(record.receiptAt) ||
    typeof record.externalRef !== "string" ||
    record.externalRef.length === 0 ||
    record.receiptId.length > 256 ||
    record.externalRef.length > 256 ||
    record.capabilityId.length === 0 ||
    record.recipient.length === 0 ||
    record.resource.length === 0 ||
    record.purpose.length === 0
  ) {
    throw new Error("journal: no succeeded receipt to return");
  }
  const amount = record.context["amount"];
  const currency = record.context["currency"];
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    !(amount > 0) ||
    typeof currency !== "string" ||
    currency.length === 0 ||
    currency.length > 16
  ) {
    throw new Error("journal: malformed payment terms");
  }
  return {
    receiptId: record.receiptId,
    capabilityId: record.capabilityId,
    recipient: record.recipient,
    amount,
    currency,
    resource: record.resource,
    purpose: record.purpose,
    transaction: record.externalRef,
    at: record.receiptAt,
    termsDigest: record.termsDigest,
  };
}

export function inspectPaymentJournal(
  expected: PaymentJournalExpectation,
  journal: ExecutionRepository = FileExecutions
): PaymentJournalReplay {
  let record: ExecutionRecord | null;
  try {
    record = journal.findByIdempotencyKey(
      expected.dir,
      deriveIdempotencyKey(expected.termsDigest, "payment")
    );
  } catch {
    // A corrupt journal scan is ambiguous, never permission to spend again.
    return { kind: "unknown", record: null, reason: "corrupt" };
  }
  if (record === null) return { kind: "none" };
  if (
    record.termsDigest !== expected.termsDigest ||
    record.action !== expected.action ||
    record.recipient !== expected.recipient ||
    record.resource !== expected.resource ||
    record.purpose !== expected.purpose ||
    !contextMatches(record.context, expected.context)
  ) {
    return { kind: "unknown", record, reason: "mismatch" };
  }
  switch (record.state) {
    case "SUCCEEDED":
      try {
        return {
          kind: "succeeded",
          record,
          receipt: receiptFromRecord(record),
        };
      } catch {
        return { kind: "unknown", record, reason: "corrupt" };
      }
    case "FAILED_FINAL":
      return { kind: "failed_final", record };
    case "RECONCILED":
      return { kind: "unknown", record, reason: "reconciled" };
    case "PREPARED":
    case "AUTHORIZED":
    case "SUBMITTING":
    case "SUBMITTED_UNKNOWN":
      return { kind: "unknown", record, reason: "live" };
  }
}
