import { canonicalize } from "../core/canonical.js";
import type { ExecutionReceipt } from "../core/execute.js";
import { deriveIdempotencyKey, type ExecutionRecord } from "./execution.js";
import { FileExecutions, type ExecutionRepository } from "./repositories.js";

/** The journal is evidence of outcomes, not new authority. No writes here. */
export interface JournalExpectation {
  readonly dir: string;
  readonly namespace: string;
  readonly termsDigest: string;
  readonly action: string;
  readonly recipient: string;
  readonly resource: string;
  readonly purpose: string;
  readonly context: Readonly<Record<string, unknown>>;
}
export type JournalInspection =
  | { readonly kind: "none" }
  | { readonly kind: "succeeded"; readonly record: ExecutionRecord; readonly receipt: ExecutionReceipt }
  | { readonly kind: "failed_final"; readonly record: ExecutionRecord }
  | { readonly kind: "unknown"; readonly reason: "corrupt" | "mismatch" | "unsubmitted" | "live" | "reconciled"; readonly record: ExecutionRecord | null };

function same(record: ExecutionRecord, wanted: JournalExpectation): boolean {
  try {
    return record.termsDigest === wanted.termsDigest &&
      record.action === wanted.action &&
      record.recipient === wanted.recipient &&
      record.resource === wanted.resource &&
      record.purpose === wanted.purpose &&
      canonicalize(record.context) === canonicalize(wanted.context);
  } catch { return false; }
}
function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 256;
}
function receipt(rec: ExecutionRecord): ExecutionReceipt | null {
  if (rec.state !== "SUCCEEDED" || !nonEmpty(rec.receiptId) ||
      !nonEmpty(rec.externalRef) || !nonEmpty(rec.capabilityId) ||
      !nonEmpty(rec.recipient) || !nonEmpty(rec.resource) ||
      !nonEmpty(rec.purpose) ||
      typeof rec.receiptAt !== "number" || !Number.isFinite(rec.receiptAt)) return null;
  return {
    receiptId: rec.receiptId,
    capabilityId: rec.capabilityId,
    recipient: rec.recipient,
    resource: rec.resource,
    purpose: rec.purpose,
    transaction: rec.externalRef,
    at: rec.receiptAt,
    termsDigest: rec.termsDigest
  };
}

/** Read first; a same-key mismatch/corruption is ambiguous, never an absent effect. */
export function inspectExecutionJournal(
  wanted: JournalExpectation,
  store: ExecutionRepository = FileExecutions
): JournalInspection {
  let rec: ExecutionRecord | null;
  try {
    rec = store.findByIdempotencyKey(
      wanted.dir, deriveIdempotencyKey(wanted.termsDigest, wanted.namespace)
    );
  } catch { return { kind: "unknown", reason: "corrupt", record: null }; }
  if (rec === null) return { kind: "none" };
  if (!same(rec, wanted)) return { kind: "unknown", reason: "mismatch", record: rec };
  switch (rec.state) {
    case "SUCCEEDED": {
      const result = receipt(rec);
      return result === null ? { kind: "unknown", reason: "corrupt", record: rec } :
        { kind: "succeeded", record: rec, receipt: result };
    }
    case "FAILED_FINAL": return { kind: "failed_final", record: rec };
    case "PREPARED":
    case "AUTHORIZED": return { kind: "unknown", reason: "unsubmitted", record: rec };
    case "SUBMITTING":
    case "SUBMITTED_UNKNOWN": return { kind: "unknown", reason: "live", record: rec };
    case "RECONCILED": return { kind: "unknown", reason: "reconciled", record: rec };
  }
}
