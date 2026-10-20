import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveJournalOutcome, type ExecutionRecord } from "../src/index.js";

const NOW = 1_700_000_000;
const TERMS = "ab".repeat(32);

const EVENT = {
  termsDigest: TERMS,
  action: "/pay",
  resource: { type: "ptf-resource", id: "order-1" },
  purpose: "support",
  recipients: [{ id: "seller-1", role: "third-party" as const }],
} as const;

function journal(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    executionId: "a".repeat(32),
    idempotencyKey: `ptf-${TERMS}-pay`,
    capabilityId: "cap-1",
    termsDigest: TERMS,
    action: "/pay",
    recipient: "seller-1",
    resource: "ptf-resource:order-1",
    purpose: "support",
    context: {},
    state: "SUCCEEDED",
    createdAt: NOW,
    updatedAt: NOW,
    attempts: 1,
    maxAttempts: 3,
    receiptId: "receipt-1",
    receiptAt: NOW,
    ...overrides,
  };
}

function withoutReceipt(record: ExecutionRecord): ExecutionRecord {
  const { receiptId: _receiptId, receiptAt: _receiptAt, ...rest } = record;
  return rest;
}

describe("execution-journal privacy recovery", () => {
  it("adopts exactly one terminal record matching every authorized term", () => {
    assert.deepEqual(resolveJournalOutcome(EVENT, [journal()]), {
      state: "SUCCEEDED",
      finalizedAt: NOW,
      evidenceRef: "execution-receipt:receipt-1",
    });
    assert.deepEqual(
      resolveJournalOutcome(EVENT, [
        withoutReceipt(
          journal({
            state: "FAILED_FINAL",
            updatedAt: NOW + 4,
          })
        ),
      ]),
      {
        state: "FAILED_FINAL",
        finalizedAt: NOW + 4,
        evidenceRef: `execution:${"a".repeat(32)}`,
      }
    );
  });

  it("refuses two matching journal rows instead of choosing one", () => {
    assert.equal(
      resolveJournalOutcome(EVENT, [
        journal(),
        journal({
          executionId: "b".repeat(32),
          idempotencyKey: `ptf-${TERMS}-pay-retry`,
          receiptId: "receipt-2",
        }),
      ]),
      null
    );
  });

  it("rejects action, destination, resource, terms, and multi-recipient mismatches", () => {
    assert.equal(
      resolveJournalOutcome(EVENT, [journal({ action: "/use" })]),
      null
    );
    assert.equal(
      resolveJournalOutcome(EVENT, [journal({ recipient: "seller-2" })]),
      null
    );
    assert.equal(
      resolveJournalOutcome(EVENT, [
        journal({ resource: "ptf-resource:order-2" }),
      ]),
      null
    );
    assert.equal(
      resolveJournalOutcome(EVENT, [journal({ termsDigest: "cd".repeat(32) })]),
      null
    );
    assert.equal(
      resolveJournalOutcome(
        {
          ...EVENT,
          recipients: [
            { id: "seller-1", role: "third-party" },
            { id: "seller-2", role: "third-party" },
          ],
        },
        [journal()]
      ),
      null
    );
  });

  it("does not adopt a journal row that is not terminal", () => {
    assert.equal(
      resolveJournalOutcome(EVENT, [
        withoutReceipt(journal({ state: "SUBMITTED_UNKNOWN" })),
      ]),
      null
    );
  });
});
