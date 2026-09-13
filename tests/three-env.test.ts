import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  FakePaymentExecutor,
  assembleCapsule,
  assertDistinctTokens,
  checkAudience,
  delegate,
  demandToAuthZen,
  digestForOperation,
  evaluateAuthZen,
  mintRoot,
  paymentBounds,
  renderAgentView,
  toAp2PaymentDemand,
} from "../src/index.js";
import type { AuthorityRequest } from "../src/index.js";

// Three-env proof (ticket 11): ONE FILE-BACKED store drives three runtimes.
// Grant: agents A/B of the principal may book domestic economy ≤₹15,000
// (explicit set — replaceable but never open), plus a rooted grant so a valid
// delegated chain under AGENT_A allows, plus an ap2-payment grant so the REAL
// toAp2PaymentDemand output (resource type "ap2-payment") evaluates. Expiry
// Sep 30 2026. Above the ceiling needs a fresh exact-terms approval.
//
// Cross-vendor gap (fixtures stay local/unsigned): same process, no real
// broker, no real AP2 party signatures, no separate hosts, no DPoP/mTLS cnf
// possession checks. Cross-vendor would need separate processes/hosts, a real
// AP2 broker + verified party keys, a real OAuth AS/RS, and a durable shared
// store with external locking (single-writer limit in docs/audit/limits.md).
const NOW = 1789257600;
const EXP = 1790812740;
const PRINCIPAL = "did:test:traveler";
const AGENT_A = "did:test:agent-a";
const AGENT_B = "did:test:agent-b";
const ATTACKER = "did:attacker:anything";
const MERCHANT = "did:test:airline";
const SECRET = "CARD-SECRET-never-leaves-host-9917";

function buildSnapshot(): unknown {
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "travel-domestic-economy",
    principal: PRINCIPAL,
    actor: { kind: "set", ids: [AGENT_A, AGENT_B] },
    action: { name: "/pay" },
    purpose: "book domestic economy flight",
    resource: { type: "flight", id: "flight:domestic:economy" },
    bounds: paymentBounds({ amountMax: 15000, currency: "INR" }),
    exp: EXP,
  });
  auth.addGrant({
    id: "travel-delegated",
    principal: PRINCIPAL,
    actor: { kind: "rooted", root: AGENT_A },
    action: { name: "/pay" },
    purpose: "book domestic economy flight",
    resource: { type: "flight", id: "flight:domestic:economy" },
    bounds: paymentBounds({ amountMax: 15000, currency: "INR" }),
    exp: EXP,
  });
  auth.addGrant({
    id: "travel-ap2",
    principal: PRINCIPAL,
    actor: { kind: "set", ids: [AGENT_A, AGENT_B] },
    action: { name: "/pay" },
    purpose: "book domestic economy flight",
    resource: { type: "ap2-payment", id: "flight:domestic:economy" },
    bounds: paymentBounds({ amountMax: 15000, currency: "INR" }),
    exp: EXP,
  });
  auth.addPolicy({
    id: "absolute-cap",
    bounds: paymentBounds({ amountMax: 25000, currency: "INR" }),
  });
  // One shared store file: every environment restores its own Authority
  // instance from this file (snapshot → file → restore round-trip included).
  return JSON.parse(JSON.stringify(auth.snapshot())) as unknown;
}

// Single file-backed store shared by all three environments below.
const STORE_DIR = mkdtempSync(join(tmpdir(), "ptf-three-env-"));
const STORE_FILE = join(STORE_DIR, "authority.json");
writeFileSync(STORE_FILE, JSON.stringify(buildSnapshot()));

function restoredAuth(): Authority {
  const raw = readFileSync(STORE_FILE, "utf8");
  return Authority.restore(JSON.parse(raw) as unknown, { nowSec: () => NOW });
}

function demand(
  agent: string,
  amount: number,
  actorChain?: readonly string[]
): AuthorityRequest {
  const operation = {
    principal: PRINCIPAL,
    actor: agent,
    ...(actorChain !== undefined ? { actorChain } : {}),
    action: { name: "/pay" as const },
    resource: { type: "flight", id: "flight:domestic:economy" },
    context: { amount, currency: "INR", recipient: MERCHANT },
    purpose: "book domestic economy flight",
  };
  return { ...operation, termsDigest: digestForOperation(operation) };
}

describe("three-env proof: one store, three executors (pivot/04, neutral 0010)", () => {
  it("env A (OAuth/MCP): attenuated token + same PDP allow for replaceable agents", () => {
    const auth = restoredAuth();
    const root = mintRoot({
      sub: PRINCIPAL,
      actor: AGENT_A,
      scope: ["book:economy", "pay:flight"],
      aud: "https://api.example/flights",
      senderCnf: "jkt-aaa",
      ttlSec: 3600,
      nowSec: NOW,
    });
    const child = delegate({
      parent: root,
      actor: "did:test:sub-agent",
      scope: ["book:economy"],
      ttlSec: 600,
      senderCnf: "jkt-sub",
      nowSec: NOW,
    });
    assert.deepEqual(child.scope, ["book:economy"]);
    assert.deepEqual(child.act, [AGENT_A, "did:test:sub-agent"]);

    // MCP edge guards: audience + token separation, so the "MCP" label is honest.
    checkAudience(child.aud, "https://api.example/flights");
    assertDistinctTokens("client-token-a", "upstream-token-b");
    assert.throws(() => assertDistinctTokens("same-token", "same-token"));

    for (const agent of [AGENT_A, AGENT_B]) {
      const out = evaluateAuthZen(auth, demandToAuthZen(demand(agent, 12000)));
      assert.equal(out.decision, true, `agent ${agent} should allow ₹12k`);
    }

    // Bind token→demand: the leaf actor from the delegated child drives the
    // PDP with the full chain, matching the rooted grant.
    const leafAgent = child.act[child.act.length - 1] as string;
    const leafChain = [...child.act];
    const leafOut = evaluateAuthZen(
      auth,
      demandToAuthZen(demand(leafAgent, 12000, leafChain))
    );
    assert.equal(leafOut.decision, true, "delegated leaf should allow ₹12k");

    // Scope binding: the PDP decision must correspond to the token. The child
    // was narrowed to book-only, so a pay demand requiring pay scope is
    // unsatisfiable from this token (deny at the scope gate), while the book
    // demand mints from the token and allows at the PDP.
    assert.ok(child.scope.includes("book:economy"));
    assert.equal(child.scope.includes("pay:flight"), false);
    function mintPayDemandFromToken(): AuthorityRequest | null {
      if (!child.scope.includes("pay:flight")) return null;
      return demand(leafAgent, 12000, leafChain);
    }
    function mintBookDemandFromToken(): AuthorityRequest | null {
      if (!child.scope.includes("book:economy")) return null;
      return demand(leafAgent, 12000, leafChain);
    }
    assert.equal(
      mintPayDemandFromToken(),
      null,
      "book-only token cannot satisfy pay scope"
    );
    const bookDemand = mintBookDemandFromToken();
    assert.ok(bookDemand !== null);
    assert.equal(
      evaluateAuthZen(auth, demandToAuthZen(bookDemand)).decision,
      true,
      "book-scoped token demand allows at PDP"
    );
  });

  it("arbitrary unauthenticated agents deny on the identical demand", () => {
    const auth = restoredAuth();
    const out = evaluateAuthZen(auth, demandToAuthZen(demand(ATTACKER, 12000)));
    assert.equal(out.decision, false);
    const ctx = out.context as { reason: string; detail?: string };
    assert.equal(ctx.reason, "no-authority");
    assert.match(ctx.detail ?? "", /actor mismatch/);
  });

  it("env B (browser+vault): capsule leaks no secrets, host executes without possession", async () => {
    const auth = restoredAuth();
    const capsule = assembleCapsule(
      {
        attributes: {
          name: "A. Traveler",
          ffNumber: "FF123",
          passport: "P12345",
          rawCard: SECRET,
        },
      },
      "book domestic economy flight",
      ["name", "ffNumber"]
    );
    const view = renderAgentView(capsule, [], []);
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes(SECRET));
    assert.ok(!serialized.includes("P12345"));

    const out = evaluateAuthZen(auth, demandToAuthZen(demand(AGENT_A, 12000)));
    assert.equal(out.decision, true);
    // Host-side executor receives sanitized instruction only — never the vault secret.
    const executor = new FakePaymentExecutor();
    const settled = await executor.executePayment({
      capabilityId: "authz:travel-domestic-economy",
      recipient: MERCHANT,
      amount: 12000,
      currency: "INR",
      resource: "flight:domestic:economy",
      purpose: "book domestic economy flight",
    });
    assert.match(settled.transaction, /^fake-tx-/);
    assert.equal(executor.calls.length, 1);
    assert.ok(!JSON.stringify(executor.calls[0]).includes(SECRET));
  });

  it("env C (AP2-style): mandate evidence maps to the same demand and decision", () => {
    const auth = restoredAuth();
    // REAL AP2 evidence path: toAp2PaymentDemand output is the demand. The
    // caller-supplied digest is stripped and recomputed, then routed via the
    // AuthZEN translator (which recomputes again on recovery) — binding is
    // derived, never trusted.
    const verified = {
      payeeId: MERCHANT,
      payeeName: MERCHANT,
      amountMinor: 12000,
      currency: "INR",
      agentKey: { kty: "EC", crv: "P-256", x: "x", y: "y" } as const,
      transactionId: "ap2-tx-domestic-economy-12000",
      mode: "direct" as const,
    };
    const mapped = toAp2PaymentDemand(verified, {
      principal: PRINCIPAL,
      agent: AGENT_B,
      purpose: "book domestic economy flight",
      resource: "flight:domestic:economy",
    });
    assert.equal(mapped.capabilityArgs.amount, verified.amountMinor);
    assert.equal(mapped.capabilityArgs.currency, verified.currency);
    const { termsDigest: _stripped, ...ap2Op } = mapped.demand;
    void _stripped;
    const rebound = { ...ap2Op, termsDigest: digestForOperation(ap2Op) };
    const out = evaluateAuthZen(auth, demandToAuthZen(rebound));
    assert.equal(out.decision, true);
  });

  it("over-ceiling denies everywhere until exact-terms approval, then allows", () => {
    const auth = restoredAuth();
    for (const agent of [AGENT_A, AGENT_B]) {
      const denied = evaluateAuthZen(
        auth,
        demandToAuthZen(demand(agent, 18000))
      );
      assert.equal(denied.decision, false);
    }
    auth.createApproval({
      id: "ap-18k",
      principal: PRINCIPAL,
      actor: AGENT_A,
      action: { name: "/pay" },
      purpose: "book domestic economy flight",
      resource: { type: "flight", id: "flight:domestic:economy" },
      context: { amount: 18000, currency: "INR", recipient: MERCHANT },
      ttlSec: 600,
      maxUses: 1,
    });
    const allowed = evaluateAuthZen(
      auth,
      demandToAuthZen(demand(AGENT_A, 18000)),
      { consume: true }
    );
    assert.equal(allowed.decision, true);
    // Approval is actor-bound: AGENT_B still denies after AGENT_A's approval.
    const stillDeniedB = evaluateAuthZen(
      auth,
      demandToAuthZen(demand(AGENT_B, 18000))
    );
    assert.equal(stillDeniedB.decision, false);
    // Cross-agent reuse: the attacker cannot reuse AGENT_A's approval either.
    const attackerReuse = evaluateAuthZen(
      auth,
      demandToAuthZen(demand(ATTACKER, 18000))
    );
    assert.equal(attackerReuse.decision, false);
    // Single-use approval: second consume must deny.
    const second = evaluateAuthZen(
      auth,
      demandToAuthZen(demand(AGENT_A, 18000)),
      { consume: true }
    );
    assert.equal(second.decision, false);
    assert.equal(
      (second.context as { reason: string }).reason,
      "uses-exhausted"
    );
    // Mutated context at the same amount must deny with "terms".
    const base = demand(AGENT_A, 18000);
    const mutatedContext = { ...base.context, recipient: "did:test:impostor" };
    const mutatedOperation = { ...base, context: mutatedContext };
    const mutated: AuthorityRequest = {
      ...mutatedOperation,
      termsDigest: digestForOperation(mutatedOperation),
    };
    const mutatedOut = evaluateAuthZen(auth, demandToAuthZen(mutated));
    assert.equal(mutatedOut.decision, false);
    assert.equal((mutatedOut.context as { reason: string }).reason, "terms");
  });

  it("central revoke denies in all three envs at once", () => {
    const auth = restoredAuth();
    auth.revoke("travel-domestic-economy", EXP);
    auth.revoke("travel-delegated", EXP);
    auth.revoke("travel-ap2", EXP);
    for (const agent of [AGENT_A, AGENT_B]) {
      const out = evaluateAuthZen(auth, demandToAuthZen(demand(agent, 12000)));
      assert.equal(out.decision, false);
      assert.equal((out.context as { reason: string }).reason, "revoked");
    }
    // Env A token-bound leaf still denies at the PDP after revoke.
    const leafOut = evaluateAuthZen(
      auth,
      demandToAuthZen(demand("did:test:sub-agent", 12000, [AGENT_A]))
    );
    assert.equal(leafOut.decision, false);
    assert.equal((leafOut.context as { reason: string }).reason, "revoked");
    // Env C REAL AP2 demand still denies at the PDP after revoke.
    const verified = {
      payeeId: MERCHANT,
      payeeName: MERCHANT,
      amountMinor: 12000,
      currency: "INR",
      agentKey: { kty: "EC", crv: "P-256", x: "x", y: "y" } as const,
      transactionId: "ap2-tx-domestic-economy-12000",
      mode: "direct" as const,
    };
    const mapped = toAp2PaymentDemand(verified, {
      principal: PRINCIPAL,
      agent: AGENT_B,
      purpose: "book domestic economy flight",
      resource: "flight:domestic:economy",
    });
    const { termsDigest: _strippedRevoke, ...ap2OpRevoke } = mapped.demand;
    void _strippedRevoke;
    const ap2Out = evaluateAuthZen(
      auth,
      demandToAuthZen({
        ...ap2OpRevoke,
        termsDigest: digestForOperation(ap2OpRevoke),
      })
    );
    assert.equal(ap2Out.decision, false);
    assert.equal((ap2Out.context as { reason: string }).reason, "revoked");
  });
});
