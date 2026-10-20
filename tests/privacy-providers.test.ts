import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  PrivacyRuntime,
  PrivacyPreEffectError,
  executeProtectedActionWithPrivacy,
  type ExecutionReceipt,
  type PrivacyEventRepository,
  type PrivacyProfile,
  type PrivacySnapshot,
  type ProcessingEventFinalize,
  type ProcessingEventPrepare,
  type ProcessingEventRecord,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:owner";
const A = "did:test:agent";
const INGRESS = {
  id: A,
  principal: P,
  source: "local-registration" as const,
  proofRef: "provider-test",
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
const profile: PrivacyProfile = {
  id: "test",
  revision: "1",
  validate: () => ({ ok: true, controlRefs: ["configured:test"] }),
};
function snapshot(active = true): PrivacySnapshot {
  return {
    notices: [],
    consents: [],
    holds: [],
    revision: active ? 1 : 2,
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
        active,
      },
    ],
    activities: [
      {
        id: "activity-1",
        profileId: "test",
        authorityPrincipal: P,
        controllerId: "acme",
        subjects: { kind: "exact", ref: "subject:opaque-1" },
        action: "/email/send",
        resourceType: "message",
        purpose: "support",
        dataCategories: ["email"],
        recipients: [{ id: "mail-provider", role: "data-processor" }],
        basisId: "basis-1",
        active: true,
      },
    ],
  };
}
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
class Events implements PrivacyEventRepository {
  readonly values = new Map<string, ProcessingEventRecord>();
  readonly order: string[] = [];
  prepare(input: ProcessingEventPrepare): ProcessingEventRecord {
    this.order.push("prepared");
    const existing = [...this.values.values()][0];
    if (existing !== undefined) return existing;
    const value: ProcessingEventRecord = {
      ...input,
      resource: { ...input.resource },
      dataCategories: [...input.dataCategories],
      recipients: input.recipients.map((r) => ({ ...r })),
      authorityCitationIds: [...input.authorityCitationIds],
      eventId: "pev-1",
      idempotencyKey: "key-1",
      state: "PREPARED",
    };
    this.values.set(value.eventId, value);
    return value;
  }
  load(id: string) {
    return this.values.get(id) ?? null;
  }
  transition(
    id: string,
    to: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN",
    patch: ProcessingEventFinalize
  ) {
    const current = this.values.get(id);
    if (current === undefined) throw new Error("missing");
    const next: ProcessingEventRecord = {
      ...current,
      state: to,
      finalizedAt: patch.finalizedAt,
      ...(patch.evidenceRef !== undefined
        ? { evidenceRef: patch.evidenceRef }
        : {}),
    };
    this.values.set(id, next);
    return next;
  }
  findByKey() {
    return [...this.values.values()][0] ?? null;
  }
  listBySubject(ref: string) {
    return [...this.values.values()].filter((v) => v.dataPrincipalRef === ref);
  }
  recoverPrepared() {
    return [];
  }
}
function receipt(): ExecutionReceipt {
  return {
    receiptId: "receipt-1",
    capabilityId: "cap-1",
    recipient: "mail-provider",
    resource: "message:msg-1",
    purpose: "support",
    transaction: "mail-1",
    at: NOW,
    termsDigest: "ab".repeat(32),
  };
}

describe("privacy-wrapped protected execution", () => {
  it("precommits privacy evidence before the provider callback and finalizes success", async () => {
    const events = new Events();
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => snapshot(),
      events,
      profile,
      nowSec: () => NOW,
    });
    const out = await executeProtectedActionWithPrivacy({
      runtime,
      gate: {
        authority: auth(),
        ingress: INGRESS,
        operation: OPERATION,
        processing: PROCESSING,
      },
      execute: async () => {
        events.order.push("executed");
        return receipt();
      },
    });
    assert.equal(out.receiptId, "receipt-1");
    assert.deepEqual(events.order, ["prepared", "executed"]);
    assert.equal(events.load("pev-1")?.state, "SUCCEEDED");
  });

  it("records OUTCOME_UNKNOWN when the provider callback can have effected then throws", async () => {
    const events = new Events();
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => snapshot(),
      events,
      profile,
      nowSec: () => NOW,
    });
    await assert.rejects(
      () =>
        executeProtectedActionWithPrivacy({
          runtime,
          gate: {
            authority: auth(),
            ingress: INGRESS,
            operation: OPERATION,
            processing: PROCESSING,
          },
          execute: async (markEffectStarted) => {
            markEffectStarted();
            throw new Error("ambiguous provider failure");
          },
        }),
      /ambiguous provider failure/
    );
    assert.equal(events.load("pev-1")?.state, "OUTCOME_UNKNOWN");
  });

  it("records a typed pre-effect failure as FAILED_FINAL", async () => {
    const events = new Events();
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => snapshot(),
      events,
      profile,
      nowSec: () => NOW,
    });
    await assert.rejects(
      () =>
        executeProtectedActionWithPrivacy({
          runtime,
          gate: {
            authority: auth(),
            ingress: INGRESS,
            operation: OPERATION,
            processing: PROCESSING,
          },
          execute: async () => {
            throw new PrivacyPreEffectError("authority denied at redeem time");
          },
        }),
      /authority denied/
    );
    assert.equal(events.load("pev-1")?.state, "FAILED_FINAL");
  });

  it("does not invoke the provider when the live privacy recheck fails", async () => {
    let reads = 0;
    let called = false;
    const events = new Events();
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => {
        reads += 1;
        return snapshot(reads < 2);
      },
      events,
      profile: {
        ...profile,
        validate: ({ basis }) =>
          basis.active
            ? { ok: true, controlRefs: [] }
            : { ok: false, reason: "basis-inactive" },
      },
      nowSec: () => NOW,
    });
    await assert.rejects(
      () =>
        executeProtectedActionWithPrivacy({
          runtime,
          gate: {
            authority: auth(),
            ingress: INGRESS,
            operation: OPERATION,
            processing: PROCESSING,
          },
          execute: async () => {
            called = true;
            return receipt();
          },
        }),
      /privacy denied/
    );
    assert.equal(called, false);
    assert.equal(events.values.size, 0);
  });
});
