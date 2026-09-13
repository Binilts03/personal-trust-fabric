import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  FakePaymentExecutor,
  assembleCapsule,
  assertDistinctTokens,
  checkAudience,
  delegate,
  demandToAuthZen,
  evaluateAuthZen,
  mintRoot,
  renderAgentView,
  termsDigestOf,
  toAp2PaymentDemand,
} from "../src/index.js";

// Falsifiable run per investigation §17: one grant drives three executors.
// Grant: any agent of the principal may book domestic economy ≤₹15,000,
// expiring Sep 30 2026. Above ceiling needs a fresh exact-terms approval.
const NOW = 1789257600;
const EXP = 1790812740;
const PRINCIPAL = "did:test:traveler";
const AGENT_A = "did:test:agent-a";
const AGENT_B = "did:test:agent-b";
const MERCHANT = "did:test:airline";
const SECRET = "CARD-SECRET-never-leaves-host-9917";

function authorityWithGrant(): Authority {
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "travel-domestic-economy",
    principal: PRINCIPAL,
    cmd: "/pay",
    purpose: "book domestic economy flight",
    resource: "flight:domestic:economy",
    recipient: MERCHANT,
    amountMax: 15000,
    currency: "INR",
    exp: EXP,
  });
  auth.addPolicy({ id: "absolute-cap", amountMax: 25000 });
  return auth;
}

function terms(amount: number) {
  return {
    flight: "domestic-economy",
    amount,
    currency: "INR",
    merchant: MERCHANT,
  };
}

function demand(agent: string, amount: number) {
  return {
    principal: PRINCIPAL,
    agent,
    cmd: "/pay" as const,
    purpose: "book domestic economy flight",
    resource: "flight:domestic:economy",
    recipient: MERCHANT,
    amount,
    currency: "INR",
    termsDigest: termsDigestOf(terms(amount)),
  };
}

describe("three-env proof: one grant, three executors (pivot/04)", () => {
  it("env A (OAuth/MCP): attenuated token + same PDP allow for replaceable agents", () => {
    const auth = authorityWithGrant();
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

    // Bind token→demand: the leaf actor from the delegated child drives the PDP.
    const leafAgent = child.act[child.act.length - 1] as string;
    const leafOut = evaluateAuthZen(
      auth,
      demandToAuthZen(demand(leafAgent, 12000))
    );
    assert.equal(leafOut.decision, true, "delegated leaf should allow ₹12k");
  });

  it("env B (browser+vault): capsule leaks no secrets, host executes without possession", async () => {
    const auth = authorityWithGrant();
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
    const auth = authorityWithGrant();
    // AP2 mandate evidence reduced to a demand via the real ap2.ts mapper.
    const mandate = {
      payeeId: MERCHANT,
      amountMinor: 12000,
      currency: "INR",
      transactionId: termsDigestOf(terms(12000)),
    };
    const verified = {
      payeeId: mandate.payeeId,
      payeeName: mandate.payeeId,
      amountMinor: mandate.amountMinor,
      currency: mandate.currency,
      agentKey: { kty: "EC", crv: "P-256", x: "x", y: "y" } as const,
      transactionId: mandate.transactionId,
      mode: "direct" as const,
    };
    const mapped = toAp2PaymentDemand(verified, {
      principal: PRINCIPAL,
      agent: AGENT_B,
      purpose: "book domestic economy flight",
      resource: "flight:domestic:economy",
    });
    assert.equal(mapped.demand.recipient, mandate.payeeId);
    assert.equal(mapped.demand.amount, mandate.amountMinor);
    assert.equal(mapped.demand.currency, mandate.currency);
    assert.equal(mapped.demand.termsDigest, mandate.transactionId);
    assert.equal(mapped.capabilityArgs.amount, mandate.amountMinor);
    assert.equal(mapped.capabilityArgs.currency, mandate.currency);
    const out = evaluateAuthZen(auth, demandToAuthZen(mapped.demand));
    assert.equal(out.decision, true);
  });

  it("over-ceiling denies everywhere until exact-terms approval, then allows", () => {
    const auth = authorityWithGrant();
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
      agent: AGENT_A,
      cmd: "/pay",
      purpose: "book domestic economy flight",
      resource: "flight:domestic:economy",
      recipient: MERCHANT,
      amount: 18000,
      currency: "INR",
      terms: terms(18000),
      ttlSec: 600,
      maxUses: 1,
    });
    const allowed = evaluateAuthZen(
      auth,
      demandToAuthZen(demand(AGENT_A, 18000)),
      { consume: true }
    );
    assert.equal(allowed.decision, true);
    // Approval is agent-bound: AGENT_B still denies after AGENT_A's approval.
    const stillDeniedB = evaluateAuthZen(
      auth,
      demandToAuthZen(demand(AGENT_B, 18000))
    );
    assert.equal(stillDeniedB.decision, false);
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
    // Mutated termsDigest at the same amount must deny with "terms".
    const mutatedTerms = { ...terms(18000), flight: "domestic-business" };
    const mutatedDemand = {
      ...demand(AGENT_A, 18000),
      termsDigest: termsDigestOf(mutatedTerms),
    };
    const mutated = evaluateAuthZen(auth, demandToAuthZen(mutatedDemand));
    assert.equal(mutated.decision, false);
    assert.equal((mutated.context as { reason: string }).reason, "terms");
  });

  it("central revoke denies in all three envs at once", () => {
    const auth = authorityWithGrant();
    auth.revoke("travel-domestic-economy", EXP);
    for (const agent of [AGENT_A, AGENT_B]) {
      const out = evaluateAuthZen(auth, demandToAuthZen(demand(agent, 12000)));
      assert.equal(out.decision, false);
      assert.equal((out.context as { reason: string }).reason, "revoked");
    }
    // Env A token-bound leaf still denies at the PDP after revoke.
    const leafOut = evaluateAuthZen(
      auth,
      demandToAuthZen(demand("did:test:sub-agent", 12000))
    );
    assert.equal(leafOut.decision, false);
    assert.equal((leafOut.context as { reason: string }).reason, "revoked");
    // Env C AP2-mapped demand still denies at the PDP after revoke.
    const verified = {
      payeeId: MERCHANT,
      payeeName: MERCHANT,
      amountMinor: 12000,
      currency: "INR",
      agentKey: { kty: "EC", crv: "P-256", x: "x", y: "y" } as const,
      transactionId: termsDigestOf(terms(12000)),
      mode: "direct" as const,
    };
    const mapped = toAp2PaymentDemand(verified, {
      principal: PRINCIPAL,
      agent: AGENT_B,
      purpose: "book domestic economy flight",
      resource: "flight:domestic:economy",
    });
    const ap2Out = evaluateAuthZen(auth, demandToAuthZen(mapped.demand));
    assert.equal(ap2Out.decision, false);
    assert.equal((ap2Out.context as { reason: string }).reason, "revoked");
  });
});
