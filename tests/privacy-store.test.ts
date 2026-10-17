import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PrivacyStore,
  createPrivacyDek,
  loadPrivacyStore,
  savePrivacyStore,
  FileAuditLog,
  type ConsentEvidence,
  type NoticeEvidence,
  type ProcessingActivity,
  type ProcessingBasisEvidence,
} from "../src/index.js";

const NOW = 1_700_000_000;
function tmp(): string {
  return mkdtempSync(join(tmpdir(), "ptf-privacy-"));
}
const NOTICE: NoticeEvidence = {
  id: "notice-1",
  controllerId: "acme",
  dataPrincipalRef: "subject:opaque-1",
  purpose: "support",
  dataCategories: ["email"],
  noticeRef: "notice://1",
  noticeHash: "a".repeat(64),
  presentedAt: NOW - 10,
  assertedBy: "privacy-office",
};
const CONSENT: ConsentEvidence = {
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
};
const BASIS: ProcessingBasisEvidence = {
  kind: "consent",
  id: "basis-1",
  controllerId: "acme",
  dataPrincipalRef: "subject:opaque-1",
  purpose: "support",
  dataCategories: ["email"],
  consentId: "consent-1",
  assertedBy: "privacy-office",
  active: true,
};
const ACTIVITY: ProcessingActivity = {
  id: "activity-1",
  profileId: "IN-DPDP-2025",
  authorityPrincipal: "did:test:owner",
  controllerId: "acme",
  subjects: { kind: "exact", ref: "subject:opaque-1" },
  action: "/disclose",
  resourceType: "vault",
  purpose: "support",
  dataCategories: ["email"],
  recipients: [{ id: "verifier", role: "third-party" }],
  basisId: "basis-1",
  active: true,
};

describe("encrypted privacy configuration store", () => {
  it("persists configuration encrypted and withdraws consent without touching authority", () => {
    const dir = tmp();
    const dek = createPrivacyDek();
    const store = new PrivacyStore(() => NOW);
    store.addNotice(NOTICE);
    store.addConsent(CONSENT);
    store.addBasis(BASIS);
    store.addActivity(ACTIVITY);
    savePrivacyStore(dir, store, { dek });

    const blob = readFileSync(join(dir, "privacy-state.json"), "utf8");
    assert.ok(!blob.includes("subject:opaque-1"));
    assert.ok(!blob.includes("privacy-office"));

    const loaded = loadPrivacyStore(dir, { dek });
    const withdrawn = loaded.withdrawConsent("consent-1", {
      at: NOW + 1,
      proofRef: "withdrawal:1",
      assertedBy: "subject",
    });
    assert.equal(withdrawn.withdrawnAt, NOW + 1);
    savePrivacyStore(dir, loaded, { dek });
    const again = loadPrivacyStore(dir, { dek });
    assert.equal(again.snapshot().consents[0]?.withdrawnAt, NOW + 1);
  });

  it("fails closed on wrong keys and stale writers", () => {
    const dir = tmp();
    const dek = createPrivacyDek();
    const seed = new PrivacyStore(() => NOW);
    seed.addNotice(NOTICE);
    savePrivacyStore(dir, seed, { dek });
    assert.throws(
      () => loadPrivacyStore(dir, { dek: createPrivacyDek() }),
      /decryption failed/
    );
    const a = loadPrivacyStore(dir, { dek });
    const b = loadPrivacyStore(dir, { dek });
    a.addConsent(CONSENT);
    savePrivacyStore(dir, a, { dek });
    b.addBasis(BASIS);
    assert.throws(() => savePrivacyStore(dir, b, { dek }), /changed under us/);
  });

  it("fails closed when privacy state is rolled back behind generic audit freshness", () => {
    const dir = tmp();
    const dek = createPrivacyDek();
    const audit = FileAuditLog.open(join(dir, "audit.jsonl"), () => NOW);
    const store = new PrivacyStore(() => NOW);
    store.addNotice(NOTICE);
    savePrivacyStore(dir, store, { dek });
    audit.append({
      actor: "operator",
      action: "privacy.notice.add",
      stateRevisions: { privacy: store.loadedRevision() },
    });
    const oldBlob = readFileSync(join(dir, "privacy-state.json"), "utf8");

    const live = loadPrivacyStore(dir, { dek });
    live.addConsent(CONSENT);
    savePrivacyStore(dir, live, { dek });
    audit.append({
      actor: "operator",
      action: "privacy.consent.add",
      stateRevisions: { privacy: live.loadedRevision() },
    });

    writeFileSync(join(dir, "privacy-state.json"), oldBlob);
    assert.throws(
      () => loadPrivacyStore(dir, { dek }),
      /privacy store.*predates audit history|partial rollback/
    );
  });
});
