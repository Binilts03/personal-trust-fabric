import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DPDP_PROFILE_ID,
  DPDP_PROFILE_REVISION,
  dpdpProfile,
  type ConsentEvidence,
  type NoticeEvidence,
  type ProcessingActivity,
  type ProcessingBasisEvidence,
  type TrustedProcessingContext,
} from "../src/index.js";

const NOW = 1_700_000_000;
const ACTIVITY: ProcessingActivity = {
  id: "act-1",
  profileId: "IN-DPDP-2025",
  authorityPrincipal: "org:acme",
  controllerId: "acme",
  subjects: { kind: "exact", ref: "subject:opaque" },
  action: "/disclose",
  resourceType: "employee-record",
  purpose: "payroll",
  dataCategories: ["bank-account"],
  recipients: [{ id: "processor", role: "data-processor" }],
  basisId: "basis-consent",
  active: true,
};
const CONTEXT: TrustedProcessingContext = {
  authorityPrincipal: "org:acme",
  actor: "agent-1",
  dataPrincipalRef: "subject:opaque",
  controllerId: "acme",
  action: "/disclose",
  resource: { type: "employee-record", id: "e-1" },
  purpose: "payroll",
  dataCategories: ["bank-account"],
  recipients: [{ id: "processor", role: "data-processor" }],
};
const NOTICE: NoticeEvidence = {
  id: "notice-1",
  controllerId: "acme",
  dataPrincipalRef: "subject:opaque",
  purpose: "payroll",
  dataCategories: ["bank-account"],
  noticeRef: "notice://payroll/v1",
  noticeHash: "a".repeat(64),
  presentedAt: NOW - 100,
  assertedBy: "privacy-office",
  language: "en",
  version: "1",
};
const CONSENT: ConsentEvidence = {
  id: "consent-1",
  noticeId: "notice-1",
  controllerId: "acme",
  dataPrincipalRef: "subject:opaque",
  purpose: "payroll",
  dataCategories: ["bank-account"],
  givenAt: NOW - 90,
  method: "affirmative-web",
  proofRef: "consent-proof:1",
  assertedBy: "privacy-office",
};
const BASIS: ProcessingBasisEvidence = {
  kind: "consent",
  id: "basis-consent",
  controllerId: "acme",
  dataPrincipalRef: "subject:opaque",
  purpose: "payroll",
  dataCategories: ["bank-account"],
  consentId: "consent-1",
  assertedBy: "privacy-office",
  active: true,
};

describe("IN-DPDP-2025 privacy profile", () => {
  it("is explicitly versioned", () => {
    assert.equal(DPDP_PROFILE_ID, "IN-DPDP-2025");
    assert.equal(DPDP_PROFILE_REVISION, "2025-r1");
    assert.equal(dpdpProfile.id, DPDP_PROFILE_ID);
    assert.equal(dpdpProfile.revision, DPDP_PROFILE_REVISION);
  });

  it("requires consent evidence to be notice-bound, scoped, affirmative, and active", () => {
    assert.deepEqual(
      dpdpProfile.validate({
        activity: ACTIVITY,
        basis: BASIS,
        notices: [NOTICE],
        consents: [CONSENT],
        context: CONTEXT,
        nowSec: NOW,
      }),
      {
        ok: true,
        controlRefs: ["dpdp:consent", "notice:notice-1", "consent:consent-1"],
      }
    );

    assert.deepEqual(
      dpdpProfile.validate({
        activity: ACTIVITY,
        basis: BASIS,
        notices: [],
        consents: [CONSENT],
        context: CONTEXT,
        nowSec: NOW,
      }),
      { ok: false, reason: "basis-invalid" }
    );

    const withdrawn: ConsentEvidence = {
      ...CONSENT,
      withdrawnAt: NOW - 1,
      withdrawalProofRef: "withdrawal:1",
      withdrawnBy: "subject",
    };
    assert.deepEqual(
      dpdpProfile.validate({
        activity: ACTIVITY,
        basis: BASIS,
        notices: [NOTICE],
        consents: [withdrawn],
        context: CONTEXT,
        nowSec: NOW,
      }),
      { ok: false, reason: "basis-inactive" }
    );
  });

  it("requires trusted guardian evidence for consent-based child/guardian-assisted processing", () => {
    assert.deepEqual(
      dpdpProfile.validate({
        activity: ACTIVITY,
        basis: BASIS,
        notices: [NOTICE],
        consents: [CONSENT],
        context: {
          ...CONTEXT,
          subjectAssurance: {
            classification: "child",
            proofRef: "",
            assertedBy: "",
          },
        },
        nowSec: NOW,
      }),
      { ok: false, reason: "guardian-evidence-required" }
    );
    const ok = dpdpProfile.validate({
      activity: ACTIVITY,
      basis: BASIS,
      notices: [NOTICE],
      consents: [CONSENT],
      context: {
        ...CONTEXT,
        subjectAssurance: {
          classification: "child",
          proofRef: "guardian-proof:7",
          assertedBy: "trusted-identity-service",
        },
      },
      nowSec: NOW,
    });
    assert.equal(ok.ok, true);
  });

  it("validates certain-legitimate-use as operator evidence, not inferred legal sufficiency", () => {
    const legitimate: ProcessingBasisEvidence = {
      kind: "certain-legitimate-use",
      id: "basis-lu",
      controllerId: "acme",
      purpose: "payroll",
      dataCategories: ["bank-account"],
      provisionRef: "dpdp:s7:employment",
      evidenceRef: "privacy-office:decision-17",
      assertedBy: "privacy-office",
      active: true,
    };
    const out = dpdpProfile.validate({
      activity: { ...ACTIVITY, basisId: "basis-lu" },
      basis: legitimate,
      notices: [],
      consents: [],
      context: CONTEXT,
      nowSec: NOW,
    });
    assert.deepEqual(out, {
      ok: true,
      controlRefs: ["dpdp:certain-legitimate-use", "dpdp:s7:employment"],
    });
    assert.deepEqual(
      dpdpProfile.validate({
        activity: { ...ACTIVITY, basisId: "basis-lu" },
        basis: { ...legitimate, evidenceRef: "" },
        notices: [],
        consents: [],
        context: CONTEXT,
        nowSec: NOW,
      }),
      { ok: false, reason: "basis-invalid" }
    );
  });

  it("checks transfers only when the operator supplied an allowed-destination constraint", () => {
    const legitimate: ProcessingBasisEvidence = {
      kind: "certain-legitimate-use",
      id: "basis-lu",
      controllerId: "acme",
      purpose: "payroll",
      dataCategories: ["bank-account"],
      provisionRef: "dpdp:s7:employment",
      evidenceRef: "privacy-office:decision-17",
      assertedBy: "privacy-office",
      active: true,
    };
    const unconstrained = dpdpProfile.validate({
      activity: { ...ACTIVITY, basisId: "basis-lu" },
      basis: legitimate,
      notices: [],
      consents: [],
      context: { ...CONTEXT, transferDestination: "XX" },
      nowSec: NOW,
    });
    assert.equal(unconstrained.ok, true);
    assert.deepEqual(
      dpdpProfile.validate({
        activity: {
          ...ACTIVITY,
          basisId: "basis-lu",
          allowedTransferDestinations: ["IN", "SG"],
        },
        basis: legitimate,
        notices: [],
        consents: [],
        context: { ...CONTEXT, transferDestination: "XX" },
        nowSec: NOW,
      }),
      { ok: false, reason: "transfer-forbidden" }
    );
  });
});
