import type { ExecutionRecord } from "../store/execution.js";
import type {
  PreparedEventResolution,
  ProcessingEventRecord,
} from "./model.js";

/**
 * Resolve a PREPARED/OUTCOME_UNKNOWN Processing Event from the execution
 * journal only when exactly one terminal record proves the same operation.
 *
 * `attemptRef` is deliberately not a lookup key: it is an event idempotency
 * reference (and, for disclosures, may derive from an agent-supplied nonce),
 * not authority-bound journal identity. Every compared field is part of the
 * authorized terms or the effect destination.
 */
export function resolveJournalOutcome(
  event: Pick<
    ProcessingEventRecord,
    "termsDigest" | "action" | "resource" | "purpose" | "recipients"
  >,
  records: readonly ExecutionRecord[]
): PreparedEventResolution | null {
  const resourceMatches = (resource: string): boolean =>
    resource === event.resource.id ||
    resource === `${event.resource.type}:${event.resource.id}`;
  const matches = records.filter(
    (record) =>
      record.termsDigest === event.termsDigest &&
      record.action === event.action &&
      resourceMatches(record.resource) &&
      record.purpose === event.purpose
  );
  if (matches.length !== 1) return null;
  const record = matches[0]!;
  // Journal recipient is a single effect destination. Require the event to
  // carry that exact destination; a multi-recipient processing context is
  // not precise enough to adopt a single journal receipt.
  if (
    event.recipients.length !== 1 ||
    event.recipients[0]?.id !== record.recipient
  ) {
    return null;
  }
  if (record.state === "SUCCEEDED" && record.receiptId !== undefined) {
    return {
      state: "SUCCEEDED",
      finalizedAt: record.receiptAt ?? record.updatedAt,
      evidenceRef: `execution-receipt:${record.receiptId}`,
    };
  }
  if (record.state === "FAILED_FINAL") {
    return {
      state: "FAILED_FINAL",
      finalizedAt: record.updatedAt,
      evidenceRef: `execution:${record.executionId}`,
    };
  }
  return null;
}
