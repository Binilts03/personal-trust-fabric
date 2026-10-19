import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FilePrivacyEventRepository,
  createPrivacyDek,
  type ProcessingEventPrepare,
} from "../src/index.js";

const NOW = 1_700_000_000;
function tmp(): string {
  return mkdtempSync(join(tmpdir(), "ptf-privacy-events-"));
}
const PREPARE: ProcessingEventPrepare = {
  profileId: "IN-DPDP-2025",
  profileRevision: "2025-r1",
  dataPrincipalRef: "subject:opaque-1",
  authorityPrincipal: "did:test:owner",
  actor: "did:test:agent",
  controllerId: "acme",
  activityId: "activity-1",
  basisId: "basis-1",
  purpose: "support",
  action: "/disclose",
  resource: { type: "vault", id: "personal-state" },
  dataCategories: ["email"],
  recipients: [{ id: "verifier", role: "third-party" }],
  termsDigest: "ab".repeat(32),
  authorityCitationIds: ["grant-1"],
  preparedAt: NOW,
};

describe("durable privacy processing events", () => {
  it("prepares idempotently and finalizes once", () => {
    const dir = tmp();
    const dek = createPrivacyDek();
    const repo = new FilePrivacyEventRepository({ dir, dek, nowSec: () => NOW });
    const a = repo.prepare(PREPARE);
    const b = repo.prepare(PREPARE);
    assert.equal(a.eventId, b.eventId);
    assert.equal(a.state, "PREPARED");

    const done = repo.transition(a.eventId, "SUCCEEDED", {
      finalizedAt: NOW + 1,
      evidenceRef: "presentation:1",
    });
    assert.equal(done.state, "SUCCEEDED");
    assert.deepEqual(
      repo.transition(a.eventId, "SUCCEEDED", {
        finalizedAt: NOW + 1,
        evidenceRef: "presentation:1",
      }),
      done
    );
    assert.throws(
      () =>
        repo.transition(a.eventId, "FAILED_FINAL", {
          finalizedAt: NOW + 2,
        }),
      /terminal|transition/
    );
  });

  it("records separate disclosure attempts with identical terms but different nonces", () => {
    const dir = tmp();
    const repo = new FilePrivacyEventRepository({
      dir, dek: createPrivacyDek(), nowSec: () => NOW,
    });
    const first = repo.prepare({ ...PREPARE, attemptRef: "nonce:first" });
    const second = repo.prepare({ ...PREPARE, attemptRef: "nonce:second" });
    assert.notEqual(first.eventId, second.eventId);
    assert.equal(repo.listBySubject("subject:opaque-1").length, 2);
  });

  it("reconciles OUTCOME_UNKNOWN to a final observed result", () => {
    const dir = tmp();
    const dek = createPrivacyDek();
    const repo = new FilePrivacyEventRepository({ dir, dek, nowSec: () => NOW });
    const prepared = repo.prepare(PREPARE);
    const unknown = repo.transition(prepared.eventId, "OUTCOME_UNKNOWN", {
      finalizedAt: NOW + 1,
    });
    assert.equal(unknown.state, "OUTCOME_UNKNOWN");
    const reconciled = repo.transition(prepared.eventId, "SUCCEEDED", {
      finalizedAt: NOW + 2,
      evidenceRef: "execution:confirmed",
    });
    assert.equal(reconciled.state, "SUCCEEDED");
    assert.equal(reconciled.evidenceRef, "execution:confirmed");
    assert.throws(
      () =>
        repo.transition(prepared.eventId, "FAILED_FINAL", {
          finalizedAt: NOW + 3,
        }),
      /terminal|transition/
    );
  });

  it("enforces a bounded event store before creating a new processing record", () => {
    const dir = tmp();
    const dek = createPrivacyDek();
    const repo = new FilePrivacyEventRepository({
      dir,
      dek,
      nowSec: () => NOW,
      maxRecords: 1,
    });
    repo.prepare(PREPARE);
    assert.throws(
      () =>
        repo.prepare({
          ...PREPARE,
          activityId: "activity-2",
          termsDigest: "cd".repeat(32),
        }),
      /privacy event store full/
    );
  });

  it("rejects direct identifiers as privacy subject references", () => {
    const dir = tmp();
    const dek = createPrivacyDek();
    const repo = new FilePrivacyEventRepository({ dir, dek, nowSec: () => NOW });
    assert.throws(
      () =>
        repo.prepare({
          ...PREPARE,
          dataPrincipalRef: "person@example.com",
        }),
      /opaque|dataPrincipalRef|subject/
    );
  });

  it("encrypts event payloads and recovers abandoned PREPARED as OUTCOME_UNKNOWN", () => {
    const dir = tmp();
    const dek = createPrivacyDek();
    const repo = new FilePrivacyEventRepository({ dir, dek, nowSec: () => NOW });
    const prepared = repo.prepare(PREPARE);
    const files = readdirSync(join(dir, "privacy-events"));
    assert.equal(files.length, 1);
    const blob = readFileSync(join(dir, "privacy-events", files[0] as string), "utf8");
    assert.ok(!blob.includes("subject:opaque-1"));
    assert.ok(!blob.includes("grant-1"));

    const recovered = repo.recoverPrepared(NOW + 10);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.eventId, prepared.eventId);
    assert.equal(recovered[0]?.state, "OUTCOME_UNKNOWN");
    assert.equal(repo.listBySubject("subject:opaque-1").length, 1);
  });
});
