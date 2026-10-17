import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateProcessing,
  type PrivacyProfile,
  type ProcessingActivity,
  type ProcessingBasisEvidence,
  type TrustedProcessingContext,
} from "../src/index.js";

const NOW = 1_700_000_000;
const activity: ProcessingActivity = {
  id: "act-payroll",
  profileId: "test",
  authorityPrincipal: "org:acme",
  controllerId: "acme-india",
  subjects: { kind: "exact", ref: "subject:opaque-1" },
  action: "/disclose",
  resourceType: "employee-record",
  purpose: "payroll",
  dataCategories: ["bank-account", "tax-id"],
  recipients: [{ id: "payroll-provider", role: "data-processor" }],
  basisId: "basis-1",
  active: true,
};
const basis: ProcessingBasisEvidence = {
  kind: "certain-legitimate-use",
  id: "basis-1",
  controllerId: "acme-india",
  purpose: "payroll",
  dataCategories: ["bank-account", "tax-id"],
  provisionRef: "dpdp:s7:employment",
  evidenceRef: "privacy-office:42",
  assertedBy: "privacy-office",
  active: true,
};
const context: TrustedProcessingContext = {
  authorityPrincipal: "org:acme",
  actor: "payroll-agent",
  dataPrincipalRef: "subject:opaque-1",
  controllerId: "acme-india",
  action: "/disclose",
  resource: { type: "employee-record", id: "employee:428" },
  purpose: "payroll",
  dataCategories: ["bank-account"],
  recipients: [{ id: "payroll-provider", role: "data-processor" }],
};
const profile: PrivacyProfile = {
  id: "test",
  revision: "1",
  validate: () => ({ ok: true, controlRefs: ["test:configured"] }),
};

function decide(
  overrides: Partial<TrustedProcessingContext> = {},
  opts: {
    activities?: readonly ProcessingActivity[];
    bases?: readonly ProcessingBasisEvidence[];
    profile?: PrivacyProfile;
  } = {}
) {
  return evaluateProcessing({
    activities: opts.activities ?? [activity],
    bases: opts.bases ?? [basis],
    notices: [],
    consents: [],
    holds: [],
    context: { ...context, ...overrides },
    profile: opts.profile ?? profile,
    nowSec: NOW,
  });
}

describe("privacy narrowing engine", () => {
  it("fails closed when trusted context carries a direct subject identifier", () => {
    assert.deepEqual(
      decide({ dataPrincipalRef: "person@example.com" }),
      { allow: false, reason: "other" }
    );
  });

  it("defaults deny when processing activity or basis evidence is absent", () => {
    assert.deepEqual(decide({}, { activities: [] }), {
      allow: false,
      reason: "no-processing-activity",
    });
    assert.deepEqual(decide({}, { bases: [] }), {
      allow: false,
      reason: "basis-missing",
    });
  });

  it("allows only exact configured processing and returns evidence identifiers", () => {
    const out = decide();
    assert.equal(out.allow, true);
    if (!out.allow) throw new Error("expected allow");
    assert.equal(out.activityId, "act-payroll");
    assert.equal(out.basisId, "basis-1");
    assert.equal(out.profileId, "test");
    assert.deepEqual(out.controlRefs, ["test:configured"]);
  });

  it("denies mismatched principal, controller, purpose, action, resource, and subject", () => {
    assert.deepEqual(decide({ authorityPrincipal: "org:other" }), {
      allow: false,
      reason: "principal-mismatch",
    });
    assert.deepEqual(decide({ controllerId: "other-controller" }), {
      allow: false,
      reason: "controller-mismatch",
    });
    assert.deepEqual(decide({ purpose: "marketing" }), {
      allow: false,
      reason: "purpose-mismatch",
    });
    assert.deepEqual(decide({ action: "/use" }), {
      allow: false,
      reason: "action-mismatch",
    });
    assert.deepEqual(
      decide({ resource: { type: "other-record", id: "employee:428" } }),
      { allow: false, reason: "resource-mismatch" }
    );
    assert.deepEqual(decide({ dataPrincipalRef: "subject:opaque-2" }), {
      allow: false,
      reason: "no-processing-activity",
    });
  });

  it("mechanically enforces data-category and recipient minimisation", () => {
    assert.deepEqual(
      decide({ dataCategories: ["bank-account", "medical-history"] }),
      { allow: false, reason: "data-category-forbidden" }
    );
    assert.deepEqual(
      decide({
        recipients: [{ id: "marketing-vendor", role: "third-party" }],
      }),
      { allow: false, reason: "recipient-forbidden" }
    );
    assert.deepEqual(
      decide({
        recipients: [{ id: "payroll-provider", role: "third-party" }],
      }),
      { allow: false, reason: "recipient-forbidden" }
    );
  });

  it("treats profile validation as narrowing evidence, never as authority", () => {
    const denying: PrivacyProfile = {
      id: "test",
      revision: "1",
      validate: () => ({ ok: false, reason: "basis-invalid" }),
    };
    assert.deepEqual(decide({}, { profile: denying }), {
      allow: false,
      reason: "basis-invalid",
    });
  });
});
