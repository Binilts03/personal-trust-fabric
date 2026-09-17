import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  Capabilities,
  Disclose,
  canonicalize,
  claimsSubset,
  digestForOperation,
  generateEd25519Keypair,
  leafCidHex,
  loadAuthority,
  paymentBounds,
  requestData,
  requestExecution,
  saveAuthority,
  saveRegistry,
  signBytes,
  RecipientRegistry,
} from "../src/index.js";
import { createPtfServer } from "../src/mcp-server.js";

const NOW = 1_700_000_000;
const P = "did:test:owner";
const A = "did:test:agent";
const OTHER = "did:test:other";
const M = "did:test:merchant";
const V = "did:test:verifier";

function ingressFor(actor: string) {
  return {
    id: actor,
    principal: P,
    source: "local-registration" as const,
    proofRef: "agent-contract-test",
  };
}

function seedAuth(): Authority {
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "g-disclose",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/disclose" },
    bounds: claimsSubset(["email", "phone"]),
    exp: NOW + 3600,
  });
  auth.addGrant({
    id: "g-pay",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/pay" },
    bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
    exp: NOW + 3600,
  });
  auth.addGrant({
    id: "g-use",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/use" },
    bounds: [{ path: ".context.claim", op: "==", value: "pan" }],
    exp: NOW + 3600,
  });
  return auth;
}

function setupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ptf-agent-"));
  saveAuthority(dir, seedAuth());
  const reg = new RecipientRegistry(() => NOW);
  saveRegistry(dir, reg);
  return dir;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(
  server: any,
  name: string,
  args: unknown
): Promise<unknown> {
  const tool = server._registeredTools[name];
  assert.ok(tool, `tool ${name} registered`);
  const res = await tool.handler(args);
  const text = (res.content[0] as { text: string }).text;
  return JSON.parse(text) as unknown;
}

describe("general agent contract (P0 slice 2)", () => {
  it("requestData dry-runs disclosure without consuming", () => {
    const auth = seedAuth();
    const out = requestData(
      auth,
      ingressFor(A),
      {
        purpose: "support",
        resourceId: "credential:issuer-1",
        claims: ["email"],
        verifier: V,
      },
      { nowSec: NOW }
    );
    assert.equal(out.decision.allow, true);
    assert.equal(out.digest.length, 64);
    assert.ok(out.proposal.includes("/disclose"));
    // No consumption: repeated dry-runs still allow (grants have no maxUses).
    const again = requestData(
      auth,
      ingressFor(A),
      {
        purpose: "support",
        resourceId: "credential:issuer-1",
        claims: ["email"],
        verifier: V,
      },
      { nowSec: NOW }
    );
    assert.equal(again.decision.allow, true);
    assert.equal(again.digest, out.digest);
  });

  it("requestExecution covers any /-path but rejects the disclose tier", () => {
    const auth = seedAuth();
    const pay = requestExecution(
      auth,
      ingressFor(A),
      {
        action: "/pay",
        purpose: "widgets",
        resourceType: "ptf-resource",
        resourceId: "order:7",
        context: { amount: 100, currency: "INR", recipient: M },
      },
      { nowSec: NOW }
    );
    assert.equal(pay.decision.allow, true);
    assert.throws(
      () =>
        requestExecution(
          auth,
          ingressFor(A),
          {
            action: "/disclose",
            resourceType: "credential",
            resourceId: "credential:issuer-1",
            context: { claims: ["email"] },
          },
          { nowSec: NOW }
        ),
      /use requestData/
    );
  });

  it("wrong actor denies; mutated terms fail closed", () => {
    const auth = seedAuth();
    const wrong = requestData(
      auth,
      ingressFor(OTHER),
      {
        purpose: "support",
        resourceId: "credential:issuer-1",
        claims: ["email"],
        verifier: V,
      },
      { nowSec: NOW }
    );
    assert.equal(wrong.decision.allow, false);
    if (!wrong.decision.allow)
      assert.equal(wrong.decision.reason, "no-authority");

    const over = requestExecution(
      auth,
      ingressFor(A),
      {
        action: "/pay",
        purpose: "widgets",
        resourceType: "ptf-resource",
        resourceId: "order:7",
        context: { amount: 9999, currency: "INR", recipient: M },
      },
      { nowSec: NOW }
    );
    assert.equal(over.decision.allow, false);
  });

  it("capability abuse: mutated digest, missing proof, bearer disclosure", () => {
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const merchant = generateEd25519Keypair();
    const attacker = generateEd25519Keypair();
    const keys = new Map([
      [P, principal.publicKeyRaw],
      [A, agent.publicKeyRaw],
      [M, merchant.publicKeyRaw],
      ["did:test:attacker", attacker.publicKeyRaw],
    ]);
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const bound = {
      principal: P,
      actor: A,
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "invoice:1" },
      context: { amount: 100, currency: "INR", recipient: M },
      purpose: "p",
    };
    const digest = digestForOperation(bound);
    const cap = caps.issue(
      null,
      {
        iss: P,
        aud: A,
        sub: P,
        cmd: "/pay",
        pol: [["<=", ".amount", 2000]],
        purpose: "p",
        resource: "invoice:1",
        recipient: M,
        amountMax: 2000,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      principal.privateKey
    );
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 100, currency: "INR" },
      recipient: M,
      termsDigest: digest,
    };
    // Missing proof on redeem fails closed.
    const noProof = caps.authorize([cap], demand, { consume: true });
    assert.equal(noProof.ok, false);
    // Mutated digest fails with terms.
    const mutated = caps.authorize(
      [cap],
      { ...demand, termsDigest: "00".repeat(32) },
      { consume: false }
    );
    assert.equal(mutated.ok, false);
    if (!mutated.ok) assert.equal(mutated.reason, "terms");
    // Wrong-actor proof key fails with recipient.
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const badProof = {
      key: attacker.publicKeyRaw,
      sig: signBytes(attacker.privateKey, cidBytes),
    };
    const wrongActor = caps.authorize([cap], demand, {
      consume: true,
      proof: badProof,
    });
    assert.equal(wrongActor.ok, false);
    if (!wrongActor.ok) assert.equal(wrongActor.reason, "recipient");
    // Bearer disclosure (empty sig) is rejected.
    const holder = generateEd25519Keypair();
    const pres = Disclose.present(
      {
        issuer: "iss",
        subject: "sub",
        claims: { email: "a@b.c" },
        cnf: "did:test:holder",
      },
      { verifier: V, nonce: "n-bearer", requested: ["email"] },
      { recipient: V, allowed: ["email"] },
      { id: "did:test:holder", privateKey: holder.privateKey },
      NOW
    );
    const bearer = { ...pres, sig: new Uint8Array(0) };
    assert.equal(
      Disclose.verify(bearer, {
        holderKey: holder.publicKeyRaw,
        expectedAud: V,
        nowSec: NOW,
      }).ok,
      false
    );
    assert.ok(!canonicalize(pres).includes("Bearer"));
  });

  it("MCP tools via createPtfServer: data/action/receipt/capabilities/revoke", async () => {
    const dir = setupDir();
    const server = createPtfServer({
      dir,
      env: {},
      principal: P,
      actor: A,
      now: () => NOW,
    });
    const names = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })
        ._registeredTools
    );
    for (const t of [
      "ptf_request_data",
      "ptf_request_action",
      "ptf_get_receipt",
      "ptf_list_capabilities",
      "ptf_revoke",
    ]) {
      assert.ok(names.includes(t), `missing ${t}`);
    }
    const data = (await callTool(server, "ptf_request_data", {
      purpose: "support",
      resource: "credential:issuer-1",
      verifier: V,
      claims: ["email"],
    })) as { allowed?: boolean; termsDigest?: string };
    assert.equal(data.allowed, true);
    assert.ok(data.termsDigest);
    const digest = data.termsDigest as string;

    const receipt = (await callTool(server, "ptf_get_receipt", {
      termsDigest: digest,
    })) as { status?: string };
    assert.equal(receipt.status, "pending");

    const action = (await callTool(server, "ptf_request_action", {
      cmd: "/pay",
      purpose: "widgets",
      resource: "order:7",
      context: { amount: 100, currency: "INR", recipient: M },
    })) as { allowed?: boolean };
    assert.equal(action.allowed, true);

    const caps = (await callTool(server, "ptf_list_capabilities", {})) as {
      capabilities?: { id: string }[];
    };
    assert.ok(Array.isArray(caps.capabilities));
    assert.ok(
      (caps.capabilities as { id: string }[]).some((c) => c.id === "g-pay")
    );
    const blob = JSON.stringify(caps);
    assert.ok(!blob.includes("SealedCapability"));
    assert.ok(!blob.includes("privateKey"));

    const revoke = (await callTool(server, "ptf_revoke", { id: "g-pay" })) as {
      requested?: boolean;
      id?: string;
    };
    assert.equal(revoke.requested, true);
    assert.equal(revoke.id, "g-pay");
    // Request-only: authority still allows after the request.
    const still = requestExecution(
      seedAuth(),
      ingressFor(A),
      {
        action: "/pay",
        purpose: "widgets",
        resourceType: "ptf-resource",
        resourceId: "order:7",
        context: { amount: 100, currency: "INR", recipient: M },
      },
      { nowSec: NOW }
    );
    assert.equal(still.decision.allow, true);
  });

  it("list_capabilities shows only this identity's live grants", async () => {
    const dir = setupDir();
    const auth = loadAuthority(dir, { nowSec: () => NOW });
    auth.addGrant({
      id: "g-foreign",
      principal: OTHER,
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 50, currency: "INR" }),
      exp: NOW + 3600,
    });
    auth.addGrant({
      id: "g-wrong-actor",
      principal: P,
      actor: { kind: "exact", id: OTHER },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 50, currency: "INR" }),
      exp: NOW + 3600,
    });
    auth.addGrant({
      id: "g-doomed",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 50, currency: "INR" }),
      exp: NOW + 3600,
    });
    auth.revoke("g-doomed");
    saveAuthority(dir, auth);
    const server = createPtfServer({ dir, env: {}, principal: P, actor: A });
    const caps = (await callTool(server, "ptf_list_capabilities", {})) as {
      capabilities?: { id: string }[];
    };
    const ids = (caps.capabilities ?? []).map((c) => c.id);
    assert.ok(ids.includes("g-pay"), "own grant listed");
    assert.ok(!ids.includes("g-foreign"), "foreign principal excluded");
    assert.ok(!ids.includes("g-wrong-actor"), "other agent excluded");
    assert.ok(!ids.includes("g-doomed"), "revoked grant excluded");
  });

  it("MCP abuse: wrong actor denies, unknown digest is unknown, restart forgets", async () => {
    const dir = setupDir();
    const good = createPtfServer({
      dir,
      env: {},
      principal: P,
      actor: A,
      now: () => NOW,
    });
    const evil = createPtfServer({
      dir,
      env: {},
      principal: P,
      actor: OTHER,
      now: () => NOW,
    });
    const allowed = (await callTool(good, "ptf_request_data", {
      purpose: "support",
      resource: "credential:issuer-1",
      verifier: V,
      claims: ["email"],
    })) as { allowed?: boolean };
    assert.equal(allowed.allowed, true);
    const denied = (await callTool(evil, "ptf_request_data", {
      purpose: "support",
      resource: "credential:issuer-1",
      verifier: V,
      claims: ["email"],
    })) as { allowed?: boolean; reason?: string };
    assert.equal(denied.allowed, false);

    const unknown = (await callTool(good, "ptf_get_receipt", {
      termsDigest: "00".repeat(32),
    })) as {
      status?: string;
    };
    assert.equal(unknown.status, "unknown");

    // Restart forgets in-memory proposals (ADR-0014): a fresh server knows nothing.
    const fresh = createPtfServer({
      dir,
      env: {},
      principal: P,
      actor: A,
      now: () => NOW,
    });
    const data = (await callTool(good, "ptf_request_action", {
      cmd: "/use",
      purpose: "pay",
      resource: "record:r-pan",
      context: { claim: "pan" },
    })) as { termsDigest?: string };
    const pending = (await callTool(good, "ptf_get_receipt", {
      termsDigest: data.termsDigest as string,
    })) as {
      status?: string;
    };
    assert.equal(pending.status, "pending");
    const forgotten = (await callTool(fresh, "ptf_get_receipt", {
      termsDigest: data.termsDigest as string,
    })) as { status?: string };
    assert.equal(forgotten.status, "unknown");
  });
});
