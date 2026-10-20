import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  planErasure,
  summarizeProcessing,
  type ConsentEvidence,
  type ProcessingEventRecord,
  type RetentionHold,
  type VaultRecordMetadata,
} from "../src/index.js";

const NOW = 1_700_000_000;
const BASE_EVENT: ProcessingEventRecord = {
  profileId: "IN-DPDP-2025",
  profileRevision: "2025-r1",
  dataPrincipalRef: "subject:opaque-1",
  authorityPrincipal: "org:acme",
  actor: "agent-1",
  controllerId: "acme",
  activityId: "activity-1",
  basisId: "basis-1",
  purpose: "support",
  action: "/disclose",
  resource: { type: "vault", id: "personal-state" },
  dataCategories: ["email"],
  recipients: [{ id: "verifier", role: "third-party" }],
  termsDigest: "ab".repeat(32),
  authorityCitationIds: ["g1"],
  preparedAt: NOW,
  eventId: "pev-1",
  idempotencyKey: "key-1",
  state: "SUCCEEDED",
  finalizedAt: NOW + 1,
  evidenceRef: "presentation:1",
};
const RECORDS: VaultRecordMetadata[] = [
  {
    id: "r-email",
    owner: "owner",
    type: "email",
    sensitivity: "general",
    source: "user",
    dataPrincipalRef: "subject:opaque-1",
    allowedPurposes: ["support"],
    allowedAgents: ["agent-1"],
    expiresAt: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "r-phone",
    owner: "owner",
    type: "phone",
    sensitivity: "general",
    source: "user",
    dataPrincipalRef: "subject:opaque-1",
    allowedPurposes: ["support"],
    allowedAgents: ["agent-1"],
    expiresAt: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

describe("PTF-observed privacy rights support", () => {
  it("summarizes succeeded and unknown processing without raw values", () => {
    const unknown: ProcessingEventRecord = {
      ...BASE_EVENT,
      eventId: "pev-2",
      idempotencyKey: "key-2",
      state: "OUTCOME_UNKNOWN",
      finalizedAt: NOW + 2,
      dataCategories: ["phone"],
    };
    const other: ProcessingEventRecord = {
      ...BASE_EVENT,
      eventId: "pev-other",
      idempotencyKey: "key-other",
      dataPrincipalRef: "subject:other",
    };
    const summary = summarizeProcessing(
      [BASE_EVENT, unknown, other],
      "subject:opaque-1"
    );
    assert.deepEqual(summary.categories, ["email", "phone"]);
    assert.deepEqual(summary.purposes, ["support"]);
    assert.equal(summary.events.length, 2);
    assert.ok(summary.events.some((e) => e.state === "OUTCOME_UNKNOWN"));
    assert.ok(!JSON.stringify(summary).includes("owner@example.com"));
  });

  it("plans exact erasure and treats holds as erasure-only constraints", () => {
    const holds: RetentionHold[] = [
      {
        id: "hold-1",
        dataPrincipalRef: "subject:opaque-1",
        recordIds: ["r-email"],
        dataCategories: [],
        reasonRef: "tax-retention:1",
        assertedBy: "records-office",
        effectiveAt: NOW - 10,
        retainUntil: NOW + 100,
      },
    ];
    const plan = planErasure({
      records: RECORDS,
      holds,
      dataPrincipalRef: "subject:opaque-1",
      nowSec: NOW,
    });
    assert.deepEqual(
      plan.map((p) => [p.record.id, p.status]),
      [
        ["r-email", "held"],
        ["r-phone", "eligible"],
      ]
    );
    assert.deepEqual(plan[0]?.holdIds, ["hold-1"]);

    const released: RetentionHold[] = [
      {
        ...holds[0]!,
        releasedAt: NOW - 1,
        releasedBy: "records-office",
      },
    ];
    assert.ok(
      planErasure({
        records: RECORDS,
        holds: released,
        dataPrincipalRef: "subject:opaque-1",
        nowSec: NOW,
      }).every((item) => item.status === "eligible")
    );
  });

  it("summarizes consent state and record-level erasure eligibility", () => {
    const consent: ConsentEvidence = {
      id: "consent-1",
      noticeId: "notice-1",
      controllerId: "acme",
      dataPrincipalRef: "subject:opaque-1",
      purpose: "support",
      dataCategories: ["email"],
      givenAt: NOW - 5,
      method: "web",
      proofRef: "proof:1",
      assertedBy: "privacy-office",
      withdrawnAt: NOW - 1,
      withdrawalProofRef: "withdraw:1",
      withdrawnBy: "subject",
    };
    const hold: RetentionHold = {
      id: "hold-1",
      dataPrincipalRef: "subject:opaque-1",
      recordIds: ["r-email"],
      dataCategories: [],
      reasonRef: "tax-retention:1",
      assertedBy: "records-office",
      effectiveAt: NOW - 10,
      retainUntil: NOW + 100,
    };
    const summary = summarizeProcessing([BASE_EVENT], "subject:opaque-1", {
      consents: [consent],
      records: RECORDS,
      holds: [hold],
      nowSec: NOW,
    });
    assert.deepEqual(summary.consentState, [
      {
        consentId: "consent-1",
        noticeId: "notice-1",
        purpose: "support",
        status: "withdrawn",
        givenAt: NOW - 5,
        withdrawnAt: NOW - 1,
      },
    ]);
    assert.deepEqual(summary.erasure, {
      status: "computed",
      eligibleRecordIds: ["r-phone"],
      heldRecords: [{ recordId: "r-email", holdIds: ["hold-1"] }],
      unscopedRecordIds: [],
    });
  });

  it("does not let a mismatched subject reference bypass a record hold", () => {
    const hold: RetentionHold = {
      id: "hold-1",
      dataPrincipalRef: "subject:other",
      recordIds: ["r-email"],
      dataCategories: [],
      reasonRef: "tax-retention:1",
      assertedBy: "records-office",
      effectiveAt: NOW - 10,
      retainUntil: NOW + 100,
    };
    const plan = planErasure({
      records: RECORDS,
      holds: [hold],
      dataPrincipalRef: "subject:opaque-1",
      nowSec: NOW,
    });
    assert.deepEqual(
      plan.map((item) => [item.record.id, item.status]),
      [
        ["r-email", "held"],
        ["r-phone", "eligible"],
      ]
    );
  });

  it("never plans another subject's record and marks unbound records unscoped", () => {
    const other: VaultRecordMetadata = {
      ...RECORDS[0]!,
      id: "r-other",
      dataPrincipalRef: "subject:other",
    };
    const { dataPrincipalRef: _boundTo, ...unbound } = RECORDS[1]!;
    const unscoped: VaultRecordMetadata = {
      ...unbound,
      id: "r-unscoped",
    };
    const plan = planErasure({
      records: [...RECORDS, other, unscoped],
      holds: [],
      dataPrincipalRef: "subject:opaque-1",
      nowSec: NOW,
    });
    assert.deepEqual(
      plan.map((item) => [item.record.id, item.status]),
      [
        ["r-email", "eligible"],
        ["r-phone", "eligible"],
        ["r-unscoped", "unscoped"],
      ]
    );
  });

  it("does not present an empty erasure result when eligibility was not computed", () => {
    const noOwner = summarizeProcessing([BASE_EVENT], "subject:opaque-1");
    assert.deepEqual(noOwner.erasure, {
      status: "not-computed",
      reason: "owner-required",
    });
    const noHolds = summarizeProcessing([BASE_EVENT], "subject:opaque-1", {
      records: RECORDS,
    });
    assert.deepEqual(noHolds.erasure, {
      status: "not-computed",
      reason: "holds-required",
    });
  });

  it("rejects direct identifiers instead of echoing them in a rights summary", () => {
    assert.throws(
      () => summarizeProcessing([], "email:person@example.com"),
      /opaque dataPrincipalRef required/
    );
    assert.throws(
      () =>
        planErasure({
          records: RECORDS,
          holds: [],
          dataPrincipalRef: "email:person@example.com",
          nowSec: NOW,
        }),
      /opaque dataPrincipalRef required/
    );
  });

  it("reports consent that starts in the future as pending", () => {
    const consent: ConsentEvidence = {
      id: "consent-future",
      noticeId: "notice-1",
      controllerId: "acme",
      dataPrincipalRef: "subject:opaque-1",
      purpose: "support",
      dataCategories: ["email"],
      givenAt: NOW + 100,
      method: "web",
      proofRef: "proof:1",
      assertedBy: "privacy-office",
    };
    const summary = summarizeProcessing([BASE_EVENT], "subject:opaque-1", {
      consents: [consent],
      nowSec: NOW,
    });
    assert.equal(summary.consentState[0]?.status, "pending");
  });
});
