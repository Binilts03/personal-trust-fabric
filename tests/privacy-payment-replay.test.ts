import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  PrivacyEventConflictError,
  PrivacyRuntime,
  createExecution,
  deriveIdempotencyKey,
  digestForOperation,
  transitionExecution,
  type PrivacyEventRepository,
  type PrivacyProfile,
  type ProcessingEventFinalize,
  type ProcessingEventPrepare,
  type ProcessingEventRecord,
} from "../src/index.js";
import { inspectPaymentJournal } from "../src/privacy/payment-replay.js";

const NOW = 1_700_000_000;
const P = "did:test:owner";
const A = "did:test:agent";
const TERMS = "ab".repeat(32);
const INGRESS = {
  id: A,
  principal: P,
  source: "local-registration" as const,
  proofRef: "replay-test",
};
const OPERATION = {
  action: { name: "/email/send" as const },
  resource: { type: "message", id: "msg-1" },
  context: { recipient: "customer@example.invalid", template: "support-reply" },
  purpose: "support",
};
const PROCESSING = {
  authorityPrincipal: P,
  actor: A,
  dataPrincipalRef: "subject:opaque-1",
  controllerId: "acme",
  action: "/email/send" as const,
  resource: { type: "message", id: "msg-1" },
  purpose: "support",
  dataCategories: ["email"],
  recipients: [{ id: "mail-provider", role: "data-processor" as const }],
};
const PROFILE: PrivacyProfile = {
  id: "test",
  revision: "1",
  validate: () => ({ ok: true, controlRefs: ["configured:test"] }),
};

function auth(): Authority {
  const value = new Authority({ nowSec: () => NOW });
  value.addGrant({
    id: "g-send",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/email/send" },
    resource: { type: "message", id: "msg-1" },
    purpose: "support",
    bounds: [],
    exp: NOW + 100,
  });
  return value;
}

function seedJournal(
  dir: string,
  state: "SUCCEEDED" | "FAILED_FINAL" | "SUBMITTED_UNKNOWN" | "RECONCILED",
  overrides: { readonly context?: Readonly<Record<string, unknown>> } = {}
) {
  const record = createExecution(
    dir,
    {
      idempotencyKey: deriveIdempotencyKey(TERMS, "payment"),
      capabilityId: "cap-1",
      termsDigest: TERMS,
      action: "/pay",
      recipient: "merchant-1",
      resource: "invoice:1",
      purpose: "payment",
      context: overrides.context ?? { amount: 250, currency: "USD" },
    },
    NOW
  );
  transitionExecution(dir, record.executionId, "AUTHORIZED", {}, NOW);
  transitionExecution(dir, record.executionId, "SUBMITTING", {}, NOW);
  if (state === "SUBMITTED_UNKNOWN") {
    return transitionExecution(
      dir,
      record.executionId,
      "SUBMITTED_UNKNOWN",
      {},
      NOW
    );
  }
  if (state === "RECONCILED") {
    transitionExecution(dir, record.executionId, "SUBMITTED_UNKNOWN", {}, NOW);
    return transitionExecution(
      dir,
      record.executionId,
      "RECONCILED",
      { reconciledAt: NOW, lastError: "provider state unknowable" },
      NOW
    );
  }
  return transitionExecution(
    dir,
    record.executionId,
    state,
    state === "SUCCEEDED"
      ? {
          externalRef: "provider-tx-1",
          receiptId: "receipt-1",
          receiptAt: NOW,
        }
      : { lastError: "provider declined finally" },
    NOW
  );
}

function expectation(context: Readonly<Record<string, unknown>>) {
  return {
    dir: "",
    termsDigest: TERMS,
    action: "/pay" as const,
    recipient: "merchant-1",
    resource: "invoice:1",
    purpose: "payment",
    context,
  };
}

describe("payment journal replay", () => {
  it("returns the exact succeeded receipt without mutating the journal", () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-replay-"));
    seedJournal(dir, "SUCCEEDED");
    const replay = inspectPaymentJournal({
      ...expectation({ amount: 250, currency: "USD" }),
      dir,
    });
    assert.equal(replay.kind, "succeeded");
    if (replay.kind !== "succeeded") return;
    assert.deepEqual(replay.receipt, {
      receiptId: "receipt-1",
      capabilityId: "cap-1",
      recipient: "merchant-1",
      amount: 250,
      currency: "USD",
      resource: "invoice:1",
      purpose: "payment",
      transaction: "provider-tx-1",
      at: NOW,
      termsDigest: TERMS,
    });
  });

  it("treats terms drift as ambiguous evidence, never a receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-replay-"));
    seedJournal(dir, "SUCCEEDED");
    const replay = inspectPaymentJournal({
      ...expectation({ amount: 250, currency: "USD" }),
      dir,
      recipient: "other-merchant",
    });
    assert.equal(replay.kind, "unknown");
    if (replay.kind !== "unknown") return;
    assert.equal(replay.reason, "mismatch");
  });

  it("treats a live or reconciled journal as outcome unknown", () => {
    for (const state of ["SUBMITTED_UNKNOWN", "RECONCILED"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "ptf-replay-"));
      seedJournal(dir, state);
      const replay = inspectPaymentJournal({
        ...expectation({ amount: 250, currency: "USD" }),
        dir,
      });
      assert.equal(replay.kind, "unknown");
      if (replay.kind !== "unknown") return;
      assert.equal(
        replay.reason,
        state === "RECONCILED" ? "reconciled" : "live"
      );
    }
  });

  it("reports a final failure only when the journal proves it", () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-replay-"));
    seedJournal(dir, "FAILED_FINAL");
    const replay = inspectPaymentJournal({
      ...expectation({ amount: 250, currency: "USD" }),
      dir,
    });
    assert.equal(replay.kind, "failed_final");
  });

  it("does not silently skip a corrupt journal", () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-replay-"));
    mkdirSync(join(dir, "executions"), { recursive: true });
    writeFileSync(join(dir, "executions", "deadbeef.json"), "{not-json");
    const replay = inspectPaymentJournal({
      ...expectation({ amount: 250, currency: "USD" }),
      dir,
    });
    assert.equal(replay.kind, "unknown");
    if (replay.kind !== "unknown") return;
    assert.equal(replay.reason, "corrupt");
  });
});

class ReplayEvents implements PrivacyEventRepository {
  record: ProcessingEventRecord;
  constructor(record: ProcessingEventRecord) {
    this.record = record;
  }
  prepare(input: ProcessingEventPrepare): ProcessingEventRecord {
    return { ...this.record, ...input };
  }
  load(id: string): ProcessingEventRecord | null {
    return id === this.record.eventId ? this.record : null;
  }
  transition(
    id: string,
    to: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN",
    patch: ProcessingEventFinalize
  ): ProcessingEventRecord {
    if (id !== this.record.eventId) throw new Error("missing");
    this.record = {
      ...this.record,
      state: to,
      finalizedAt: patch.finalizedAt,
      ...(patch.evidenceRef !== undefined
        ? { evidenceRef: patch.evidenceRef }
        : {}),
    };
    return this.record;
  }
  findByKey(): ProcessingEventRecord | null {
    return this.record;
  }
  listBySubject(): readonly ProcessingEventRecord[] {
    return [this.record];
  }
  recoverPrepared(): readonly ProcessingEventRecord[] {
    return [];
  }
  findByAttempt(
    termsDigest: string,
    attemptRef: string
  ): readonly ProcessingEventRecord[] {
    return this.record.termsDigest === termsDigest &&
      this.record.attemptRef === attemptRef
      ? [this.record]
      : [];
  }
}

function eventRecord(
  state: ProcessingEventRecord["state"],
  termsDigest: string
): ProcessingEventRecord {
  return {
    eventId: "pev-1",
    idempotencyKey: "key-1",
    profileId: PROFILE.id,
    profileRevision: PROFILE.revision,
    dataPrincipalRef: PROCESSING.dataPrincipalRef,
    authorityPrincipal: P,
    actor: A,
    controllerId: PROCESSING.controllerId,
    activityId: "activity-1",
    basisId: "basis-1",
    purpose: PROCESSING.purpose,
    action: PROCESSING.action,
    resource: { ...PROCESSING.resource },
    dataCategories: [...PROCESSING.dataCategories],
    recipients: PROCESSING.recipients.map((r) => ({ ...r })),
    termsDigest,
    authorityCitationIds: ["g-send"],
    attemptRef: "attempt-1",
    preparedAt: NOW,
    state,
    ...(state === "OUTCOME_UNKNOWN" ? { finalizedAt: NOW } : {}),
  };
}

function runtimeFor(events: ReplayEvents) {
  return new PrivacyRuntime({
    loadPrivacy: () => ({
      notices: [],
      consents: [],
      holds: [],
      revision: 1,
      bases: [
        {
          kind: "certain-legitimate-use",
          id: "basis-1",
          controllerId: "acme",
          purpose: "support",
          dataCategories: ["email"],
          provisionRef: "configured",
          evidenceRef: "privacy-office:1",
          assertedBy: "privacy-office",
          active: true,
        },
      ],
      activities: [
        {
          id: "activity-1",
          profileId: PROFILE.id,
          authorityPrincipal: P,
          controllerId: "acme",
          subjects: { kind: "exact", ref: PROCESSING.dataPrincipalRef },
          action: OPERATION.action.name,
          resourceType: "message",
          purpose: "support",
          dataCategories: ["email"],
          recipients: [{ id: "mail-provider", role: "data-processor" }],
          basisId: "basis-1",
          active: true,
        },
      ],
    }),
    events,
    profile: PROFILE,
    nowSec: () => NOW,
  });
}

function gate() {
  return {
    authority: auth(),
    ingress: INGRESS,
    operation: OPERATION,
    processing: PROCESSING,
  };
}

describe("privacy event journal reconciliation", () => {
  it("finalizes an OUTCOME_UNKNOWN event from a succeeded journal", () => {
    const events = new ReplayEvents(eventRecord("OUTCOME_UNKNOWN", TERMS));
    const runtime = runtimeFor(events);
    const result = runtime.reconcileAttemptEvent(gate(), {
      termsDigest: events.record.termsDigest,
      attemptRef: "attempt-1",
      state: "SUCCEEDED",
      finalizedAt: NOW + 10,
      evidenceRef: "journal:receipt-1",
    });
    assert.equal(result, "finalized");
    assert.equal(events.record.state, "SUCCEEDED");
    assert.equal(events.record.evidenceRef, "journal:receipt-1");
  });

  it("reconstructs a missing event from the current privacy decision", () => {
    const terms = digestForOperation({
      principal: P,
      actor: A,
      action: OPERATION.action,
      resource: OPERATION.resource,
      context: OPERATION.context,
      purpose: OPERATION.purpose,
    });
    const events = new ReplayEvents(eventRecord("OUTCOME_UNKNOWN", TERMS));
    // Make the lookup miss, but let prepare return the reconstructed record.
    events.findByAttempt = () => [];
    const runtime = runtimeFor(events);
    const result = runtime.reconcileAttemptEvent(gate(), {
      termsDigest: terms,
      attemptRef: "attempt-1",
      state: "SUCCEEDED",
      finalizedAt: NOW + 10,
      preparedAt: NOW - 5,
      createIfMissing: true,
    });
    assert.equal(result, "finalized");
    assert.equal(events.record.state, "SUCCEEDED");
  });

  it("reports terminal event conflicts instead of overwriting them", () => {
    const events = new ReplayEvents(eventRecord("FAILED_FINAL", TERMS));
    const runtime = runtimeFor(events);
    assert.throws(
      () =>
        runtime.reconcileAttemptEvent(gate(), {
          termsDigest: events.record.termsDigest,
          attemptRef: "attempt-1",
          state: "SUCCEEDED",
          finalizedAt: NOW + 10,
        }),
      PrivacyEventConflictError
    );
    assert.equal(events.record.state, "FAILED_FINAL");
  });
});
