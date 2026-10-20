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
  type PrivacyGateRequest,
  type PrivacyGateResult,
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

/**
 * A runtime that counts completed rechecks, so a test can move the privacy
 * state exactly between the recheck and the effect-boundary fence without
 * depending on how many evaluations a path performs.
 */
class FenceRuntime extends PrivacyRuntime {
  completedRechecks = 0;
  override recheck(
    prior: Extract<PrivacyGateResult, { allow: true }>,
    req: PrivacyGateRequest
  ): Extract<PrivacyGateResult, { allow: true }> {
    const result = super.recheck(prior, req);
    this.completedRechecks += 1;
    return result;
  }
}

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
  load(id: string) {
    return this.values.get(id) ?? null;
  }
  transition(
    id: string,
    to: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN",
    patch: ProcessingEventFinalize
  ) {
    const current = this.values.get(id);
    if (current === undefined) throw new Error("missing event");
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
    return null;
  }
  listBySubject(ref: string) {
    return [...this.values.values()].filter((v) => v.dataPrincipalRef === ref);
  }
  recoverPrepared() {
    return [];
  }
}

function privacySnapshot(
  categories: readonly string[],
  active = true
): PrivacySnapshot {
  return {
    notices: [],
    consents: [],
    bases: [
      {
        kind: "certain-legitimate-use",
        id: "basis-1",
        controllerId: "acme",
        purpose: "support",
        dataCategories: [...categories],
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
        action: "/disclose",
        resourceType: "vault",
        purpose: "support",
        dataCategories: [...categories],
        recipients: [{ id: "verifier", role: "third-party" }],
        basisId: "basis-1",
        active: true,
      },
    ],
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
      onAuthorityConsumed: () => {
        order.push("authority-persisted");
      },
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
        id,
        owner: P,
        type,
        value,
        sensitivity: "general",
        source: "user",
        allowedPurposes: ["support"],
        allowedAgents: [A],
        expiresAt: null,
      });
    }
    const auth = disclosureAuth();
    await assert.rejects(
      () =>
        discloseWithPrivacy({
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
            requested: ["email", "phone"],
            verifier: "verifier",
            nonce: "nonce-privacy-2",
            nowSec: NOW,
            authority: auth,
            resource: { type: "vault", id: "personal-state" },
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
    await assert.rejects(
      () =>
        discloseWithPrivacy({
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
            nonce: "nonce-privacy-3",
            nowSec: NOW,
            authority: auth,
            resource: { type: "vault", id: "personal-state" },
            holder: { id: P, privateKey: holder.privateKey },
          },
          onAuthorityConsumed: () => {},
        }),
      /basis-inactive|privacy denied/
    );
    assert.equal(events.values.size, 0);
  });

  it("fences the disclosure: a withdrawal after the recheck releases no claim", async () => {
    const holder = generateEd25519Keypair();
    const events = new Events();
    // The privacy state flips to withdrawn as soon as the first recheck has
    // completed, so the change lands after the recheck and before the
    // effect-boundary fence.
    let runtime: FenceRuntime;
    runtime = new FenceRuntime({
      loadPrivacy: () =>
        runtime.completedRechecks >= 1
          ? privacySnapshot(["email"], false)
          : privacySnapshot(["email"]),
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
    await assert.rejects(
      () =>
        discloseWithPrivacy({
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
            nonce: "nonce-privacy-fence",
            nowSec: NOW,
            authority: auth,
            resource: { type: "vault", id: "personal-state" },
            holder: { id: P, privateKey: holder.privateKey },
          },
          onAuthorityConsumed: () => {},
        }),
      /privacy denied/
    );
    // The claim was never released: the evidence is a pre-effect failure.
    const recorded = [...events.values.values()];
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.state, "FAILED_FINAL");
  });

  it("does not inspect secret-record metadata before Authority preflight denies", async () => {
    let metadataReads = 0;
    let privacyReads = 0;
    class TracedVault extends VaultStore {
      override listMetadata(owner: string) {
        metadataReads += 1;
        return super.listMetadata(owner);
      }
    }
    const denied = new Authority({ nowSec: () => NOW });
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => {
        privacyReads += 1;
        return privacySnapshot(["pan"]);
      },
      events: new Events(),
      profile,
      nowSec: () => NOW,
    });
    await assert.rejects(
      () =>
        useCredentialWithPrivacy({
          runtime,
          gate: {
            authority: denied,
            ingress: INGRESS,
            operation: {
              action: { name: "/use" },
              resource: { type: "vault-record", id: "missing" },
              context: { claim: "pan" },
              purpose: "support",
            },
            processing: {
              authorityPrincipal: P,
              actor: A,
              dataPrincipalRef: "subject:opaque-1",
              controllerId: "acme",
              action: "/use",
              resource: { type: "vault-record", id: "missing" },
              purpose: "support",
              dataCategories: ["pan"],
              recipients: [],
            },
          },
          vault: new TracedVault(() => NOW),
          secret: {
            ingress: INGRESS,
            recordId: "missing",
            purpose: "support",
            authority: denied,
            nowSec: NOW,
            onConsumed: () => {},
            use: async () => ({ receipt: "never" }),
          },
        }),
      /authority denied/
    );
    assert.equal(metadataReads, 0);
    assert.equal(privacyReads, 0);
  });

  it("derives secret data category from vault metadata and never records the secret value", async () => {
    const events = new Events();
    const secretSnapshot: PrivacySnapshot = {
      ...privacySnapshot(["pan"]),
      activities: [
        {
          ...privacySnapshot(["pan"]).activities[0]!,
          action: "/use",
          resourceType: "vault-record",
          recipients: [],
        },
      ],
      bases: [
        {
          ...privacySnapshot(["pan"]).bases[0]!,
          dataCategories: ["pan"],
        },
      ],
    };
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => secretSnapshot,
      events,
      profile,
      nowSec: () => NOW,
    });
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-pan",
      owner: P,
      type: "pan",
      value: "PAN-SECRET-NEVER-EVENT",
      sensitivity: "secret",
      source: "issuer",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-use",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/use" },
      purpose: "support",
      resource: { type: "vault-record", id: "r-pan" },
      bounds: [{ path: ".context.claim", op: "==", value: "pan" }],
      exp: NOW + 100,
    });
    const result = await useCredentialWithPrivacy({
      runtime,
      gate: {
        authority: auth,
        ingress: INGRESS,
        operation: {
          action: { name: "/use" },
          resource: { type: "vault-record", id: "r-pan" },
          context: { claim: "pan" },
          purpose: "support",
        },
        processing: {
          authorityPrincipal: P,
          actor: A,
          dataPrincipalRef: "subject:opaque-1",
          controllerId: "acme",
          action: "/use",
          resource: { type: "vault-record", id: "r-pan" },
          purpose: "support",
          dataCategories: [],
          recipients: [],
        },
      },
      vault,
      secret: {
        ingress: INGRESS,
        recordId: "r-pan",
        purpose: "support",
        authority: auth,
        nowSec: NOW,
        onConsumed: () => {},
        use: async () => ({ receipt: "secret-use-ok" }),
      },
    });
    assert.equal(result.receipt, "secret-use-ok");
    const event = [...events.values.values()][0];
    assert.deepEqual(event?.dataCategories, ["pan"]);
    assert.ok(!JSON.stringify(event).includes("PAN-SECRET-NEVER-EVENT"));

    // A second, independently authorized use under the same terms is a
    // distinct attempt and must produce its own evidence record.
    const secondAuth = new Authority({ nowSec: () => NOW });
    secondAuth.addGrant({
      id: "g-use-2",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/use" },
      purpose: "support",
      resource: { type: "vault-record", id: "r-pan" },
      bounds: [{ path: ".context.claim", op: "==", value: "pan" }],
      exp: NOW + 100,
    });
    await useCredentialWithPrivacy({
      runtime,
      gate: {
        authority: secondAuth,
        ingress: INGRESS,
        operation: {
          action: { name: "/use" },
          resource: { type: "vault-record", id: "r-pan" },
          context: { claim: "pan" },
          purpose: "support",
        },
        processing: {
          authorityPrincipal: P,
          actor: A,
          dataPrincipalRef: "subject:opaque-1",
          controllerId: "acme",
          action: "/use",
          resource: { type: "vault-record", id: "r-pan" },
          purpose: "support",
          dataCategories: [],
          recipients: [],
        },
      },
      vault,
      secret: {
        ingress: INGRESS,
        recordId: "r-pan",
        purpose: "support",
        authority: secondAuth,
        nowSec: NOW,
        onConsumed: () => {},
        use: async () => ({ receipt: "secret-use-ok-2" }),
      },
    });
    assert.equal(events.values.size, 2);
    const attempts = new Set(
      [...events.values.values()].map((value) => value.attemptRef)
    );
    assert.equal(attempts.size, 2);
    assert.ok(
      [...events.values.values()].every((value) => value.state === "SUCCEEDED")
    );
  });

  it("requires an opaque subject binding that cannot be changed or removed", () => {
    const vault = new VaultStore(() => NOW);
    const input = {
      id: "r-bound",
      owner: P,
      type: "email",
      value: "person@example.com",
      sensitivity: "sensitive" as const,
      source: "user",
      dataPrincipalRef: "subject:opaque-1",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    };
    vault.putRecord(input);
    assert.equal(
      vault.listMetadata(P)[0]?.dataPrincipalRef,
      "subject:opaque-1"
    );
    assert.throws(
      () => vault.putRecord({ ...input, dataPrincipalRef: "subject:opaque-2" }),
      /immutable/
    );
    const { dataPrincipalRef: _binding, ...unbound } = input;
    assert.throws(() => vault.putRecord(unbound), /immutable/);
    assert.throws(
      () =>
        vault.putRecord({
          ...input,
          id: "r-bad",
          dataPrincipalRef: "email:person@example.com",
        }),
      /opaque/
    );
  });

  it("records FAILED_FINAL when persistence fails before any secret release", async () => {
    const events = new Events();
    const secretSnapshot: PrivacySnapshot = {
      ...privacySnapshot(["pan"]),
      activities: [
        {
          ...privacySnapshot(["pan"]).activities[0]!,
          action: "/use",
          resourceType: "vault-record",
          recipients: [],
        },
      ],
      bases: [
        {
          ...privacySnapshot(["pan"]).bases[0]!,
          dataCategories: ["pan"],
        },
      ],
    };
    const runtime = new PrivacyRuntime({
      loadPrivacy: () => secretSnapshot,
      events,
      profile,
      nowSec: () => NOW,
    });
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-pan",
      owner: P,
      type: "pan",
      value: "PAN-SECRET-NEVER-EVENT",
      sensitivity: "secret",
      source: "issuer",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-use",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/use" },
      purpose: "support",
      resource: { type: "vault-record", id: "r-pan" },
      bounds: [{ path: ".context.claim", op: "==", value: "pan" }],
      exp: NOW + 100,
    });
    let released = false;
    await assert.rejects(
      () =>
        useCredentialWithPrivacy({
          runtime,
          gate: {
            authority: auth,
            ingress: INGRESS,
            operation: {
              action: { name: "/use" },
              resource: { type: "vault-record", id: "r-pan" },
              context: { claim: "pan" },
              purpose: "support",
            },
            processing: {
              authorityPrincipal: P,
              actor: A,
              dataPrincipalRef: "subject:opaque-1",
              controllerId: "acme",
              action: "/use",
              resource: { type: "vault-record", id: "r-pan" },
              purpose: "support",
              dataCategories: [],
              recipients: [],
            },
          },
          vault,
          secret: {
            ingress: INGRESS,
            recordId: "r-pan",
            purpose: "support",
            authority: auth,
            nowSec: NOW,
            onConsumed: () => {
              throw new Error("authority persistence failed");
            },
            use: async () => {
              released = true;
              return { receipt: "never-released" };
            },
          },
        }),
      /authority persistence failed/
    );
    assert.equal(released, false);
    const event = [...events.values.values()][0];
    assert.equal(event?.state, "FAILED_FINAL");
  });

  it("fences the protected use: a withdrawal after the recheck releases no secret", async () => {
    const events = new Events();
    const secretSnapshot: PrivacySnapshot = {
      ...privacySnapshot(["pan"]),
      activities: [
        {
          ...privacySnapshot(["pan"]).activities[0]!,
          action: "/use",
          resourceType: "vault-record",
          recipients: [],
        },
      ],
      bases: [
        {
          ...privacySnapshot(["pan"]).bases[0]!,
          dataCategories: ["pan"],
        },
      ],
    };
    const withdrawn: PrivacySnapshot = {
      ...secretSnapshot,
      bases: secretSnapshot.bases.map((basis) => ({ ...basis, active: false })),
    };
    let runtime: FenceRuntime;
    runtime = new FenceRuntime({
      loadPrivacy: () =>
        runtime.completedRechecks >= 1 ? withdrawn : secretSnapshot,
      events,
      profile,
      nowSec: () => NOW,
    });
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-pan",
      owner: P,
      type: "pan",
      value: "PAN-SECRET-NEVER-EVENT",
      sensitivity: "secret",
      source: "issuer",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-use",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/use" },
      purpose: "support",
      resource: { type: "vault-record", id: "r-pan" },
      bounds: [{ path: ".context.claim", op: "==", value: "pan" }],
      exp: NOW + 100,
    });
    let released = false;
    await assert.rejects(
      () =>
        useCredentialWithPrivacy({
          runtime,
          gate: {
            authority: auth,
            ingress: INGRESS,
            operation: {
              action: { name: "/use" },
              resource: { type: "vault-record", id: "r-pan" },
              context: { claim: "pan" },
              purpose: "support",
            },
            processing: {
              authorityPrincipal: P,
              actor: A,
              dataPrincipalRef: "subject:opaque-1",
              controllerId: "acme",
              action: "/use",
              resource: { type: "vault-record", id: "r-pan" },
              purpose: "support",
              dataCategories: [],
              recipients: [],
            },
          },
          vault,
          secret: {
            ingress: INGRESS,
            recordId: "r-pan",
            purpose: "support",
            authority: auth,
            nowSec: NOW,
            use: async () => {
              released = true;
              return { receipt: "never-released" };
            },
          },
        }),
      /privacy denied/
    );
    assert.equal(released, false);
    const event = [...events.values.values()][0];
    assert.equal(event?.state, "FAILED_FINAL");
  });
});
