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
import type {
  AuthorityOperation,
  AuthorityRequest,
  VerifiedExternalBinding,
  VerifiedIdentity,
} from "../src/index.js";

// Three-env proof (ticket 11, ingress model tickets 15+16): ONE FILE-BACKED
// store drives three runtimes. Grant: agents A/B of the principal may book
// domestic economy ≤₹15,000 (explicit set — replaceable but never open),
// plus a delegated grant explicitly naming AGENT_A's sub-agent (set —
// chains are provenance only, never authority, since ADR-0013 removed
// `rooted`), plus an ap2-payment grant so the REAL toAp2PaymentDemand output
// (resource type "ap2-payment") evaluates. Expiry Sep 30 2026. Above the
// ceiling needs a fresh exact-terms approval.
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
const SUB_AGENT = "did:test:sub-agent";
const OTHER_SUB = "did:test:sub-agent-2";
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
    actor: { kind: "set", ids: [AGENT_A, SUB_AGENT] },
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

/** Identity-free operation: identity binds from the ingress at evaluation. */
function operation(amount: number): AuthorityOperation {
  return {
    action: { name: "/pay" as const },
    resource: { type: "flight", id: "flight:domestic:economy" },
    context: { amount, currency: "INR", recipient: MERCHANT },
    purpose: "book domestic economy flight",
  };
}

function ingressFor(
  agent: string,
  source: VerifiedIdentity["source"],
  proofRef: string,
  chain?: readonly string[]
): VerifiedIdentity {
  return {
    id: agent,
    principal: PRINCIPAL,
    source,
    proofRef,
    ...(chain !== undefined ? { chain } : {}),
  };
}

/** Engine-bound demand (what the engine assembles from operation+ingress). */
function bind(
  operation_: AuthorityOperation,
  ingress: VerifiedIdentity
): AuthorityRequest {
  const bound = {
    ...operation_,
    principal: ingress.principal,
    actor: ingress.id,
    ...(ingress.chain !== undefined ? { actorChain: [...ingress.chain] } : {}),
  };
  return { ...bound, termsDigest: digestForOperation(bound) };
}

function decide(
  auth: Authority,
  operation_: AuthorityOperation,
  ingress: VerifiedIdentity,
  opts: {
    readonly consume?: boolean;
    readonly binding?: VerifiedExternalBinding;
  } = {}
) {
  return evaluateAuthZen(
    auth,
    demandToAuthZen(bind(operation_, ingress)),
    ingress,
    opts
  );
}

describe("three-env proof: one store, three executors (pivot/04, neutral 0010, ingress 0013)", () => {
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
      const out = decide(
        auth,
        operation(12000),
        ingressFor(agent, "oauth", "three-env-a-token")
      );
      assert.equal(out.decision, true, `agent ${agent} should allow ₹12k`);
    }

    // Token-bound leaf: the delegated child's leaf actor drives the PDP
    // with the full chain as provenance. It allows because travel-delegated
    // explicitly names the leaf (set) — the chain itself confers nothing.
    const leafAgent = child.act[child.act.length - 1] as string;
    const leafChain = [...child.act];
    const leafIngress = ingressFor(
      leafAgent,
      "oauth",
      "three-env-a-token",
      leafChain
    );
    const leafOut = decide(auth, operation(12000), leafIngress);
    assert.equal(leafOut.decision, true, "delegated leaf should allow ₹12k");

    // Chain-alone grants nothing: a different sub-agent riding the same
    // root chain denies (provenance, not authorization — ADR-0013).
    const impostorOut = decide(
      auth,
      operation(12000),
      ingressFor(OTHER_SUB, "oauth", "three-env-a-token", [AGENT_A, OTHER_SUB])
    );
    assert.equal(impostorOut.decision, false);

    // Scope binding: the PDP decision must correspond to the token. The child
    // was narrowed to book-only, so a pay demand requiring pay scope is
    // unsatisfiable from this token (deny at the scope gate), while the book
    // demand mints from the token and allows at the PDP.
    assert.ok(child.scope.includes("book:economy"));
    assert.equal(child.scope.includes("pay:flight"), false);
    function mintPayDemandFromToken(): AuthorityOperation | null {
      if (!child.scope.includes("pay:flight")) return null;
      return operation(12000);
    }
    function mintBookDemandFromToken(): AuthorityOperation | null {
      if (!child.scope.includes("book:economy")) return null;
      return operation(12000);
    }
    assert.equal(
      mintPayDemandFromToken(),
      null,
      "book-only token cannot satisfy pay scope"
    );
    const bookDemand = mintBookDemandFromToken();
    assert.ok(bookDemand !== null);
    assert.equal(
      decide(auth, bookDemand, leafIngress).decision,
      true,
      "book-scoped token demand allows at PDP"
    );
  });

  it("arbitrary unauthenticated agents deny on the identical demand", () => {
    const auth = restoredAuth();
    const out = decide(
      auth,
      operation(12000),
      ingressFor(ATTACKER, "oauth", "three-env-a-token")
    );
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

    const out = decide(
      auth,
      operation(12000),
      ingressFor(AGENT_A, "local-registration", "three-env-b")
    );
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
      termsDigest: "cd".repeat(32),
    });
    assert.match(settled.transaction, /^fake-tx-/);
    assert.equal(executor.calls.length, 1);
    assert.ok(!JSON.stringify(executor.calls[0]).includes(SECRET));
  });

  it("env C (AP2-style): mandate evidence maps to the same demand and decision", () => {
    const auth = restoredAuth();
    // REAL AP2 evidence path: toAp2PaymentDemand output is evidence. The
    // adapter-built bound form is stripped back to the identity-free
    // operation, and the verified transaction id travels as a binding via
    // opts (never as wire) — digest derivation folds it in, citations echo
    // it.
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
      purpose: "book domestic economy flight",
      resource: "flight:domestic:economy",
    });
    assert.equal(mapped.capabilityArgs.amount, verified.amountMinor);
    assert.equal(mapped.capabilityArgs.currency, verified.currency);
    // Identity-free operation + separate verified binding (ADR-0013):
    // identity binds from the host-verified ingress at evaluate time.
    const binding: VerifiedExternalBinding = mapped.binding;
    assert.equal(binding.scheme, "ap2");
    assert.equal(binding.value, verified.transactionId);
    const ingressB = ingressFor(AGENT_B, "local-registration", "three-env-c");
    const out = evaluateAuthZen(
      auth,
      demandToAuthZen(bind(mapped.operation, ingressB)),
      ingressB,
      { binding }
    );
    assert.equal(out.decision, true);
    const ctx = out.context as {
      citations: {
        authorityId: string;
        binding?: VerifiedExternalBinding;
      }[];
    };
    assert.equal(ctx.citations[0]?.authorityId, "travel-ap2");
    assert.deepEqual(ctx.citations[0]?.binding, binding);
  });

  it("over-ceiling denies everywhere until exact-terms approval, then allows", () => {
    const auth = restoredAuth();
    for (const agent of [AGENT_A, AGENT_B]) {
      const denied = decide(
        auth,
        operation(18000),
        ingressFor(agent, "oauth", "three-env-a-token")
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
    const ingressA = ingressFor(AGENT_A, "oauth", "three-env-a-token");
    const allowed = decide(auth, operation(18000), ingressA, {
      consume: true,
    });
    assert.equal(allowed.decision, true);
    // Approval is actor-bound: AGENT_B still denies after AGENT_A's approval.
    const stillDeniedB = decide(
      auth,
      operation(18000),
      ingressFor(AGENT_B, "oauth", "three-env-a-token")
    );
    assert.equal(stillDeniedB.decision, false);
    // Cross-agent reuse: the attacker cannot reuse AGENT_A's approval either.
    const attackerReuse = decide(
      auth,
      operation(18000),
      ingressFor(ATTACKER, "oauth", "three-env-a-token")
    );
    assert.equal(attackerReuse.decision, false);
    // Single-use approval: second consume must deny.
    const second = decide(auth, operation(18000), ingressA, {
      consume: true,
    });
    assert.equal(second.decision, false);
    assert.equal(
      (second.context as { reason: string }).reason,
      "uses-exhausted"
    );
    // Mutated context at the same amount must deny with "terms".
    const mutatedOperation: AuthorityOperation = {
      ...operation(18000),
      context: {
        amount: 18000,
        currency: "INR",
        recipient: "did:test:impostor",
      },
    };
    const mutatedOut = decide(auth, mutatedOperation, ingressA);
    assert.equal(mutatedOut.decision, false);
    assert.equal((mutatedOut.context as { reason: string }).reason, "terms");
  });

  it("central revoke denies in all three envs at once", () => {
    const auth = restoredAuth();
    auth.revoke("travel-domestic-economy", EXP);
    auth.revoke("travel-delegated", EXP);
    auth.revoke("travel-ap2", EXP);
    for (const agent of [AGENT_A, AGENT_B]) {
      const out = decide(
        auth,
        operation(12000),
        ingressFor(agent, "oauth", "three-env-a-token")
      );
      assert.equal(out.decision, false);
      assert.equal((out.context as { reason: string }).reason, "revoked");
    }
    // Env A token-bound leaf still denies at the PDP after revoke.
    const leafOut = decide(
      auth,
      operation(12000),
      ingressFor(SUB_AGENT, "oauth", "three-env-a-token", [AGENT_A])
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
      purpose: "book domestic economy flight",
      resource: "flight:domestic:economy",
    });
    const ingressB = ingressFor(AGENT_B, "local-registration", "three-env-c");
    const ap2Out = evaluateAuthZen(
      auth,
      demandToAuthZen(bind(mapped.operation, ingressB)),
      ingressB,
      {
        binding: mapped.binding,
      }
    );
    assert.equal(ap2Out.decision, false);
    assert.equal((ap2Out.context as { reason: string }).reason, "revoked");
  });
});
