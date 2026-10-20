import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  PrivacyRuntime,
  claimsSubset,
  type PrivacyEventRepository,
  type ProcessingEventFinalize,
  type ProcessingEventPrepare,
  type ProcessingEventRecord,
  type PrivacySnapshot,
  type PrivacyProfile,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:owner";
const A = "did:test:agent";
const INGRESS = {
  id: A,
  principal: P,
  source: "local-registration" as const,
  proofRef: "privacy-runtime-test",
};
const OPERATION = {
  action: { name: "/disclose" as const },
  resource: { type: "vault", id: "personal-state" },
  context: { claims: ["email"], verifier: "verifier" },
  purpose: "support",
};
const PROCESSING = {
  authorityPrincipal: P,
  actor: A,
  dataPrincipalRef: "subject:opaque-1",
  controllerId: "acme",
  action: "/disclose" as const,
  resource: { type: "vault", id: "personal-state" },
  purpose: "support",
  dataCategories: ["email"],
  recipients: [{ id: "verifier", role: "third-party" as const }],
};

function snapshot(active = true): PrivacySnapshot {
  return {
    notices: [],
    consents: [],
    bases: [
      {
        kind: "certain-legitimate-use",
        id: "basis-1",
        controllerId: "acme",
        purpose: "support",
        dataCategories: ["email"],
        provisionRef: "configured-basis",
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
        action: "/disclose",
        resourceType: "vault",
        purpose: "support",
        dataCategories: ["email"],
        recipients: [{ id: "verifier", role: "third-party" }],
        basisId: "basis-1",
        active: true,
      },
    ],
    holds: [],
    revision: active ? 1 : 2,
  };
}

const profile: PrivacyProfile = {
  id: "test",
  revision: "1",
  validate: ({ basis }) =>
    basis.active
      ? { ok: true, controlRefs: ["configured:test"] }
      : { ok: false, reason: "basis-inactive" },
};

class MemoryEvents implements PrivacyEventRepository {
  readonly values = new Map<string, ProcessingEventRecord>();
  prepare(input: ProcessingEventPrepare): ProcessingEventRecord {
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
  load(id: string): ProcessingEventRecord | null {
    return this.values.get(id) ?? null;
  }
  transition(
    id: string,
    to: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN",
    patch: ProcessingEventFinalize
  ): ProcessingEventRecord {
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
  findByKey(): ProcessingEventRecord | null {
    return [...this.values.values()][0] ?? null;
  }
  listBySubject(ref: string): readonly ProcessingEventRecord[] {
    return [...this.values.values()].filter((v) => v.dataPrincipalRef === ref);
  }
  recoverPrepared(): readonly ProcessingEventRecord[] {
    return [];
  }
}

function authority(allow: boolean): Authority {
  const auth = new Authority({ nowSec: () => NOW });
  if (allow) {
    auth.addGrant({
      id: "g-disclose",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/disclose" },
      bounds: claimsSubset(["email"]),
      purpose: "support",
      exp: NOW + 1000,
    });
  }
  return auth;
}

describe("privacy runtime ordering", () => {
  it("short-circuits on Authority deny before reading privacy state", () => {
    let reads = 0;
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => {
        reads += 1;
        return snapshot();
      },
      events: new MemoryEvents(),
      profile,
      nowSec: () => NOW,
    });
    const out = runtime.preflight(
      {
        authority: authority(false),
        ingress: INGRESS,
        operation: OPERATION,
        processing: PROCESSING,
      },
      { operatorDetail: true }
    );
    assert.deepEqual(out, { allow: false, publicReason: "authority-denied" });
    assert.equal(reads, 0);
  });

  it("privacy evidence can deny but never turn an Authority denial into allow", () => {
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => snapshot(false),
      events: new MemoryEvents(),
      profile,
      nowSec: () => NOW,
    });
    const out = runtime.preflight(
      {
        authority: authority(true),
        ingress: INGRESS,
        operation: OPERATION,
        processing: PROCESSING,
      },
      { operatorDetail: true }
    );
    assert.deepEqual(out, {
      allow: false,
      publicReason: "privacy-denied",
      operatorReason: "basis-inactive",
    });
  });

  it("reloads privacy state on recheck so withdrawal/deactivation races fail closed", () => {
    let live = snapshot(true);
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => live,
      events: new MemoryEvents(),
      profile,
      nowSec: () => NOW,
    });
    const req = {
      authority: authority(true),
      ingress: INGRESS,
      operation: OPERATION,
      processing: PROCESSING,
    };
    const first = runtime.preflight(req);
    assert.equal(first.allow, true);
    if (!first.allow) throw new Error("expected allow");
    live = snapshot(false);
    assert.throws(
      () => runtime.recheck(first, req),
      /privacy denied|basis-inactive/
    );
  });

  it("rejects changed trusted privacy terms during live recheck even when Authority operation is identical", () => {
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => snapshot(true),
      events: new MemoryEvents(),
      profile,
      nowSec: () => NOW,
    });
    const req = {
      authority: authority(true),
      ingress: INGRESS,
      operation: OPERATION,
      processing: PROCESSING,
    };
    const first = runtime.preflight(req);
    assert.equal(first.allow, true);
    if (!first.allow) throw new Error("expected allow");

    assert.throws(
      () =>
        runtime.recheck(first, {
          ...req,
          processing: { ...PROCESSING, dataCategories: [] },
        }),
      /privacy runtime: processing (context|terms) changed/
    );
  });

  it("prepares secret-free processing evidence from exact terms and authority citations", () => {
    const events = new MemoryEvents();
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => snapshot(true),
      events,
      profile,
      nowSec: () => NOW,
    });
    const req = {
      authority: authority(true),
      ingress: INGRESS,
      operation: OPERATION,
      processing: PROCESSING,
    };
    const allowed = runtime.preflight(req);
    assert.equal(allowed.allow, true);
    if (!allowed.allow) throw new Error("expected allow");
    const event = runtime.prepareEvent(allowed, req);
    assert.equal(event.state, "PREPARED");
    assert.deepEqual(event.authorityCitationIds, ["g-disclose"]);
    assert.equal(event.dataPrincipalRef, "subject:opaque-1");
    assert.match(event.termsDigest, /^[0-9a-f]{64}$/);
    // Each call is a distinct attempt unless the caller supplies a retry ref;
    // the terms digest alone is not an attempt identity.
    assert.match(
      event.attemptRef ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("refuses to prepare evidence when the request changed after recheck", () => {
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => snapshot(true),
      events: new MemoryEvents(),
      profile,
      nowSec: () => NOW,
    });
    const req = {
      authority: authority(true),
      ingress: INGRESS,
      operation: OPERATION,
      processing: PROCESSING,
    };
    const allowed = runtime.preflight(req);
    assert.equal(allowed.allow, true);
    if (!allowed.allow) throw new Error("expected allow");
    assert.throws(
      () =>
        runtime.prepareEvent(allowed, {
          ...req,
          processing: { ...PROCESSING, dataCategories: ["phone"] },
        }),
      /processing context changed/
    );
  });
});
