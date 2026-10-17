import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  PrivacyRuntime,
  VaultStore,
  claimsSubset,
  discloseWithPrivacy,
  generateEd25519Keypair,
  useCredentialWithPrivacy,
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
  proofRef: "privacy-vault-test",
};
const profile: PrivacyProfile = {
  id: "test",
  revision: "1",
  validate: ({ basis }) =>
    basis.active
      ? { ok: true, controlRefs: ["configured:test"] }
      : { ok: false, reason: "basis-inactive" },
};

class Events implements PrivacyEventRepository {
  readonly values = new Map<string, ProcessingEventRecord>();
  prepare(input: ProcessingEventPrepare): ProcessingEventRecord {
    const value: ProcessingEventRecord = {
      ...input,
      resource: { ...input.resource },
      dataCategories: [...input.dataCategories],
      recipients: input.recipients.map((r) => ({ ...r })),
      authorityCitationIds: [...input.authorityCitationIds],
      eventId: `pev-${this.values.size + 1}`,
      idempotencyKey: `key-${this.values.size + 1}`,
      state: "PREPARED",
    };
    this.values.set(value.eventId, value);
    return value;
  }
  load(id: string) { return this.values.get(id) ?? null; }
  transition(id: string, to: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN", patch: ProcessingEventFinalize) {
    const current = this.values.get(id);
    if (current === undefined) throw new Error("missing event");
    const next: ProcessingEventRecord = {
      ...current,
      state: to,
      finalizedAt: patch.finalizedAt,
      ...(patch.evidenceRef !== undefined ? { evidenceRef: patch.evidenceRef } : {}),
    };
    this.values.set(id, next);
    return next;
  }
  findByKey() { return null; }
  listBySubject(ref: string) { return [...this.values.values()].filter((v) => v.dataPrincipalRef === ref); }
  recoverPrepared() { return []; }
}

function privacySnapshot(categories: readonly string[], active = true): PrivacySnapshot {
  return {
    notices: [],
    consents: [],
    bases: [{
      kind: "certain-legitimate-use",
      id: "basis-1",
      controllerId: "acme",
      purpose: "support",
      dataCategories: [...categories],
      provisionRef: "configured",
      evidenceRef: "privacy-office:1",
      assertedBy: "privacy-office",
      active,
    }],
    activities: [{
      id: "activity-1",
      profileId: "test",
      authorityPrincipal: P,
      controllerId: "acme",
      subjects: { kind: "exact", ref: "subject:opaque-1" },
      action: "/disclose",
      resourceType: "vault",
      purpose: "support",
      dataCategories: [...categories],
      recipients: [{ id: "verifier", role: "third-party" }],
      basisId: "basis-1",
      active: true,
    }],
    holds: [],
    revision: active ? 1 : 2,
  };
}

function disclosureAuth(): Authority {
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "g-disc",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/disclose" },
    purpose: "support",
    bounds: claimsSubset(["email", "phone"]),
    exp: NOW + 100,
  });
  return auth;
}

describe("privacy-wrapped vault processing", () => {
  it("precommits evidence, persists consumed authority before delivery, and finalizes success", async () => {
    const holder = generateEd25519Keypair();
    const events = new Events();
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => privacySnapshot(["email"]),
      events,
      profile,
      nowSec: () => NOW,
    });
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-email",
      owner: P,
      type: "email",
      value: "owner@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    const auth = disclosureAuth();
    const order: string[] = [];
    const presentation = await discloseWithPrivacy({
      runtime,
      gate: {
        authority: auth,
        ingress: INGRESS,
        operation: {
          action: { name: "/disclose" },
          resource: { type: "vault", id: "personal-state" },
          context: { claims: ["email"], verifier: "verifier" },
          purpose: "support",
        },
        processing: {
          authorityPrincipal: P,
          actor: A,
          dataPrincipalRef: "subject:opaque-1",
          controllerId: "acme",
          action: "/disclose",
          resource: { type: "vault", id: "personal-state" },
          purpose: "support",
          dataCategories: ["email"],
          recipients: [{ id: "verifier", role: "third-party" }],
        },
      },
      vault,
      disclosure: {
        ingress: INGRESS,
        purpose: "support",
        requested: ["email"],
        verifier: "verifier",
        nonce: "nonce-privacy-1",
        nowSec: NOW,
        authority: auth,
        resource: { type: "vault", id: "personal-state" },
        holder: { id: P, privateKey: holder.privateKey },
      },
      onAuthorityConsumed: () => order.push("authority-persisted"),
    });
    assert.equal(presentation.disclosures.length, 1);
    assert.deepEqual(order, ["authority-persisted"]);
    const event = [...events.values.values()][0];
    assert.equal(event?.state, "SUCCEEDED");
    assert.deepEqual(event?.dataCategories, ["email"]);
    assert.ok(!JSON.stringify(event).includes("owner@example.com"));
  });

  it("derives actual requested claims for minimisation and denies one extra claim", async () => {
    const holder = generateEd25519Keypair();
    const events = new Events();
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => privacySnapshot(["email"]),
      events,
      profile,
      nowSec: () => NOW,
    });
    const vault = new VaultStore(() => NOW);
    for (const [id, type, value] of [
      ["r-email", "email", "owner@example.com"],
      ["r-phone", "phone", "+91-999"],
    ] as const) {
      vault.putRecord({
        id, owner: P, type, value, sensitivity: "general", source: "user",
        allowedPurposes: ["support"], allowedAgents: [A], expiresAt: null,
      });
    }
    const auth = disclosureAuth();
    await assert.rejects(
      () => discloseWithPrivacy({
        runtime,
        gate: {
          authority: auth,
          ingress: INGRESS,
          operation: {
            action: { name: "/disclose" },
            resource: { type: "vault", id: "personal-state" },
            context: { claims: ["email", "phone"], verifier: "verifier" },
            purpose: "support",
          },
          processing: {
            authorityPrincipal: P, actor: A, dataPrincipalRef: "subject:opaque-1",
            controllerId: "acme", action: "/disclose",
            resource: { type: "vault", id: "personal-state" }, purpose: "support",
            dataCategories: ["email"],
            recipients: [{ id: "verifier", role: "third-party" }],
          },
        },
        vault,
        disclosure: {
          ingress: INGRESS, purpose: "support", requested: ["email", "phone"],
          verifier: "verifier", nonce: "nonce-privacy-2", nowSec: NOW,
          authority: auth, resource: { type: "vault", id: "personal-state" },
          holder: { id: P, privateKey: holder.privateKey },
        },
        onAuthorityConsumed: () => {},
      }),
      /privacy denied|data-category-forbidden/
    );
    assert.equal(events.values.size, 0);
  });

  it("rechecks privacy immediately before disclosure and blocks a withdrawal race", async () => {
    const holder = generateEd25519Keypair();
    let reads = 0;
    const events = new Events();
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => {
        reads += 1;
        return privacySnapshot(["email"], reads < 2);
      },
      events,
      profile,
      nowSec: () => NOW,
    });
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-email", owner: P, type: "email", value: "owner@example.com",
      sensitivity: "general", source: "user", allowedPurposes: ["support"],
      allowedAgents: [A], expiresAt: null,
    });
    const auth = disclosureAuth();
    await assert.rejects(
      () => discloseWithPrivacy({
        runtime,
        gate: {
          authority: auth, ingress: INGRESS,
          operation: {
            action: { name: "/disclose" },
            resource: { type: "vault", id: "personal-state" },
            context: { claims: ["email"], verifier: "verifier" },
            purpose: "support",
          },
          processing: {
            authorityPrincipal: P, actor: A, dataPrincipalRef: "subject:opaque-1",
            controllerId: "acme", action: "/disclose",
            resource: { type: "vault", id: "personal-state" }, purpose: "support",
            dataCategories: ["email"],
            recipients: [{ id: "verifier", role: "third-party" }],
          },
        },
        vault,
        disclosure: {
          ingress: INGRESS, purpose: "support", requested: ["email"],
          verifier: "verifier", nonce: "nonce-privacy-3", nowSec: NOW,
          authority: auth, resource: { type: "vault", id: "personal-state" },
          holder: { id: P, privateKey: holder.privateKey },
        },
        onAuthorityConsumed: () => {},
      }),
      /basis-inactive|privacy denied/
    );
    assert.equal(events.values.size, 0);
  });

  it("derives secret data category from vault metadata and never records the secret value", async () => {
    const events = new Events();
    const secretSnapshot: PrivacySnapshot = {
      ...privacySnapshot(["pan"]),
      activities: [{
        ...privacySnapshot(["pan"]).activities[0]!,
        action: "/use",
        resourceType: "vault-record",
        recipients: [],
      }],
      bases: [{
        ...privacySnapshot(["pan"]).bases[0]!,
        dataCategories: ["pan"],
      }],
    };
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => secretSnapshot,
      events,
      profile,
      nowSec: () => NOW,
    });
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-pan", owner: P, type: "pan", value: "PAN-SECRET-NEVER-EVENT",
      sensitivity: "secret", source: "issuer", allowedPurposes: ["support"],
      allowedAgents: [A], expiresAt: null,
    });
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-use", principal: P, actor: { kind: "exact", id: A },
      action: { name: "/use" }, purpose: "support",
      resource: { type: "vault-record", id: "r-pan" },
      bounds: [{ path: ".context.claim", op: "==", value: "pan" }],
      exp: NOW + 100,
    });
    const result = await useCredentialWithPrivacy({
      runtime,
      gate: {
        authority: auth, ingress: INGRESS,
        operation: {
          action: { name: "/use" },
          resource: { type: "vault-record", id: "r-pan" },
          context: { claim: "pan" },
          purpose: "support",
        },
        processing: {
          authorityPrincipal: P, actor: A, dataPrincipalRef: "subject:opaque-1",
          controllerId: "acme", action: "/use",
          resource: { type: "vault-record", id: "r-pan" }, purpose: "support",
          dataCategories: [], recipients: [],
        },
      },
      vault,
      secret: {
        ingress: INGRESS, recordId: "r-pan", purpose: "support",
        authority: auth, nowSec: NOW,
        onConsumed: () => {},
        use: async () => ({ receipt: "secret-use-ok" }),
      },
    });
    assert.equal(result.receipt, "secret-use-ok");
    const event = [...events.values.values()][0];
    assert.deepEqual(event?.dataCategories, ["pan"]);
    assert.ok(!JSON.stringify(event).includes("PAN-SECRET-NEVER-EVENT"));
  });
});
