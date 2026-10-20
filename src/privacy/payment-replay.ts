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
      /**
       * Fixed-vocabulary reason suitable for sanitized MCP output.
       *
       * `unsubmitted` means the row never reached the provider boundary:
       * no effect happened, and the authority use for these terms is spent.
       * `live` means the provider may or may not have been called.
       */
      readonly reason:
        "corrupt" | "live" | "mismatch" | "reconciled" | "unsubmitted";
    };

/** A corrupt journal scan is ambiguous evidence, never "no record". */
const CORRUPT = Symbol("corrupt-journal");

function isFilledString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function allFilled(values: readonly unknown[]): boolean {
  return values.every((value) => isFilledString(value));
}

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

function sameTerms(
  record: ExecutionRecord,
  expected: PaymentJournalExpectation
): boolean {
  return (
    record.termsDigest === expected.termsDigest &&
    record.action === expected.action &&
    record.recipient === expected.recipient &&
    record.resource === expected.resource &&
    record.purpose === expected.purpose &&
    contextMatches(record.context, expected.context)
  );
}

/** A succeeded journal row that carries a complete, bounded receipt. */
type SucceededRecord = ExecutionRecord & {
  readonly receiptId: string;
  readonly externalRef: string;
  readonly receiptAt: number;
};

function isSucceededRecord(record: ExecutionRecord): record is SucceededRecord {
  if (record.state !== "SUCCEEDED") return false;
  const { receiptId, externalRef, receiptAt } = record;
  if (typeof receiptAt !== "number") return false;
  if (!Number.isFinite(receiptAt)) return false;
  if (!isFilledString(receiptId) || receiptId.length > 256) return false;
  if (!isFilledString(externalRef) || externalRef.length > 256) return false;
  return allFilled([
    record.capabilityId,
    record.recipient,
    record.resource,
    record.purpose,
  ]);
}

function receiptContext(
  record: ExecutionRecord
): { readonly amount: number; readonly currency: string } | null {
  const amount = record.context["amount"];
  const currency = record.context["currency"];
  if (typeof amount !== "number") return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!isFilledString(currency) || currency.length > 16) return null;
  return { amount, currency };
}

function receiptFromRecord(record: ExecutionRecord): PaymentReceipt {
  if (!isSucceededRecord(record)) {
    throw new Error("journal: no succeeded receipt to return");
  }
  const terms = receiptContext(record);
  if (terms === null) throw new Error("journal: malformed payment terms");
  return {
    receiptId: record.receiptId,
    capabilityId: record.capabilityId,
    recipient: record.recipient,
    amount: terms.amount,
    currency: terms.currency,
    resource: record.resource,
    purpose: record.purpose,
    transaction: record.externalRef,
    at: record.receiptAt,
    termsDigest: record.termsDigest,
  };
}

function findRecord(
  expected: PaymentJournalExpectation,
  journal: ExecutionRepository
): ExecutionRecord | null | typeof CORRUPT {
  try {
    return journal.findByIdempotencyKey(
      expected.dir,
      deriveIdempotencyKey(expected.termsDigest, "payment")
    );
  } catch {
    return CORRUPT;
  }
}

function succeededReplay(record: ExecutionRecord): PaymentJournalReplay {
  try {
    return { kind: "succeeded", record, receipt: receiptFromRecord(record) };
  } catch {
    return { kind: "unknown", record, reason: "corrupt" };
  }
}

function classify(record: ExecutionRecord): PaymentJournalReplay {
  switch (record.state) {
    case "SUCCEEDED":
      return succeededReplay(record);
    case "FAILED_FINAL":
      return { kind: "failed_final", record };
    case "RECONCILED":
      return { kind: "unknown", record, reason: "reconciled" };
    case "PREPARED":
    case "AUTHORIZED":
      // The row was written before the submit boundary, so the provider was
      // provably never called: no effect happened. The authority use for
      // these terms was already spent, so this attempt cannot be retried
      // under the same grant.
      return { kind: "unknown", record, reason: "unsubmitted" };
    default:
      // SUBMITTING / SUBMITTED_UNKNOWN: the provider may or may not have
      // been called. Ambiguous, never a receipt.
      return { kind: "unknown", record, reason: "live" };
  }
}

export function inspectPaymentJournal(
  expected: PaymentJournalExpectation,
  journal: ExecutionRepository = FileExecutions
): PaymentJournalReplay {
  const record = findRecord(expected, journal);
  if (record === CORRUPT) {
    return { kind: "unknown", record: null, reason: "corrupt" };
  }
  if (record === null) return { kind: "none" };
  if (!sameTerms(record, expected)) {
    return { kind: "unknown", record, reason: "mismatch" };
  }
  return classify(record);
}
