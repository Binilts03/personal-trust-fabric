import type { ExecutionReceipt } from "../core/execute.js";
import type { ExecutionRecord } from "../store/execution.js";
import { inspectExecutionJournal } from "../store/execution-replay.js";
import {
  FileExecutions,
  type ExecutionRepository,
} from "../store/repositories.js";

/**
 * Payment presentation of the shared read-only journal inspection.
 * The underlying state classification and exact-term comparison is identical
 * for payment and non-payment protected providers. This adapter adds only
 * the legacy amount/currency receipt fields.
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
  | { readonly kind: "succeeded"; readonly record: ExecutionRecord; readonly receipt: PaymentReceipt }
  | { readonly kind: "failed_final"; readonly record: ExecutionRecord }
  | { readonly kind: "unknown"; readonly record: ExecutionRecord | null;
      readonly reason: "corrupt" | "live" | "mismatch" | "reconciled" | "unsubmitted" };

export function inspectPaymentJournal(
  expected: PaymentJournalExpectation,
  journal: ExecutionRepository = FileExecutions
): PaymentJournalReplay {
  const result = inspectExecutionJournal({
    ...expected,
    namespace: "payment",
  }, journal);
  switch (result.kind) {
    case "none": return result;
    case "failed_final": return result;
    case "unknown": {
      if (result.reason === "corrupt") {
        return { kind: "unknown", reason: "corrupt", record: null };
      }
      // Preserve legacy record visibility for operator replay tools.
      const record = journal.findByIdempotencyKey(
        expected.dir,
        "ptf-" + expected.termsDigest + "-payment"
      );
      return { ...result, record };
    }
    case "succeeded": {
      const amount = result.record.context["amount"];
      const currency = result.record.context["currency"];
      if (typeof amount !== "number" || !Number.isFinite(amount) ||
          amount <= 0 || typeof currency !== "string" ||
          currency.length < 1 || currency.length > 16) {
        return { kind: "unknown", record: result.record, reason: "corrupt" };
      }
      return {
        kind: "succeeded",
        record: result.record,
        receipt: { ...result.receipt, amount, currency }
      };
    }
  }
}
