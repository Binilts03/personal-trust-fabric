import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  authZenToDemand,
  coazMcpToAuthZen,
  demandToAuthZen,
  digestForOperation,
  evaluateAuthZen,
  paymentBounds,
  requestableContext,
} from "../src/index.js";
import type { AuthorityRequest } from "../src/index.js";

const NOW = 1_700_000_000;
const PRINCIPAL = "did:test:principal";
const AGENT = "did:test:agent";
const MERCHANT = "did:test:merchant";

function operation(amount = 1790) {
  return {
    principal: PRINCIPAL,
    actor: AGENT,
    action: { name: "/pay" as const },
    resource: { type: "invoice", id: "invoice:inv_8472" },
    context: { amount, currency: "INR", recipient: MERCHANT },
    purpose: "pay invoice",
  };
}

function demand(): AuthorityRequest {
  const op = operation();
  return { ...op, termsDigest: digestForOperation(op) };
}

function demandWithChain(): AuthorityRequest {
  const op = {
    ...operation(),
    actorChain: [AGENT, "did:test:sub-agent"] as readonly string[],
    action: {
      name: "/pay" as const,
      properties: { rail: "upi" },
    },
  };
  return { ...op, termsDigest: digestForOperation(op) };
}

function coveringGrant(auth: Authority, amountMax = 2000): void {
  auth.addGrant({
    id: "g1",
    principal: PRINCIPAL,
    actor: { kind: "exact", id: AGENT },
    action: { name: "/pay" },
    purpose: "pay invoice",
    resource: { type: "invoice", id: "invoice:inv_8472" },
    bounds: paymentBounds({ amountMax, currency: "INR" }),
    exp: NOW + 3600,
  });
}

describe("AuthZEN SARC translator, neutral model (pivot/01, 0010)", () => {
  it("round-trips demand through Final 1.0 SARC without loss", () => {
    const req = demandToAuthZen(demand());
    assert.equal(req.subject.id, PRINCIPAL);
    assert.equal(
      (req.subject.properties as Record<string, unknown>)["actor"],
      AGENT
    );
    // Final 1.0 (as far as known; unchanged from draft-01): action carries
    // `name`, not `type`/`id`.
    assert.equal(req.action.name, "/pay");
    assert.equal(
      (req.action.properties as Record<string, unknown>)["purpose"],
      "pay invoice"
    );
    assert.equal(req.resource.type, "invoice");
    assert.equal(req.resource.id, "invoice:inv_8472");
    const back = authZenToDemand(req);
    assert.deepEqual(back, demand());
  });

  it("round-trips chains, action properties, and generic context", () => {
    const req = demandToAuthZen(demandWithChain());
    assert.deepEqual(
      (req.subject.properties as Record<string, unknown>)["actorChain"],
      [AGENT, "did:test:sub-agent"]
    );
    const back = authZenToDemand(req);
    assert.deepEqual(back, demandWithChain());
  });

  it("allows via PDP with kind/policyIds/derived-termsDigest echo", () => {
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth);
    auth.addPolicy({
      id: "cap-loose",
      bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    });
    const out = evaluateAuthZen(auth, demandToAuthZen(demand()));
    assert.equal(out.decision, true);
    const ctx = out.context as {
      citations: {
        authorityId: string;
        kind: string;
        policyIds: string[];
      }[];
      termsDigest: string;
    };
    assert.equal(ctx.citations[0]?.authorityId, "g1");
    assert.equal(ctx.citations[0]?.kind, "grant");
    assert.deepEqual(ctx.citations[0]?.policyIds, ["cap-loose"]);
    assert.equal(ctx.termsDigest, demand().termsDigest);
  });

  it("ignores a tampered envelope digest: decision follows the true terms", () => {
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth);
    const honestReq = demandToAuthZen(demand());
    const tampered = {
      ...honestReq,
      context: {
        ...(honestReq.context as Record<string, unknown>),
        termsDigest: "ff".repeat(32),
      },
    };
    const out = evaluateAuthZen(auth, tampered);
    assert.equal(out.decision, true);
    // The echo is the DERIVED digest, not the supplied lie.
    assert.equal(
      (out.context as { termsDigest: string }).termsDigest,
      demand().termsDigest
    );
  });

  it("denies with reason terms on mutated terms", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.createApproval({
      id: "ap-1",
      principal: PRINCIPAL,
      actor: AGENT,
      action: { name: "/pay" },
      purpose: "pay invoice",
      resource: { type: "invoice", id: "invoice:inv_8472" },
      context: { amount: 1790, currency: "INR", recipient: MERCHANT },
      ttlSec: 3600,
      maxUses: 1,
    });
    // Exact terms allow — proves the approval covers this identity.
    const good = evaluateAuthZen(auth, demandToAuthZen(demand()));
    assert.equal(good.decision, true);

    // Same identity fields, different amount → terms mismatch, not a new ask.
    const mutatedOp = operation(1791);
    const mutatedDemand: AuthorityRequest = {
      ...mutatedOp,
      termsDigest: digestForOperation(mutatedOp),
    };
    const mutated = evaluateAuthZen(auth, demandToAuthZen(mutatedDemand));
    assert.equal(mutated.decision, false);
    assert.equal((mutated.context as { reason: string }).reason, "terms");
    assert.equal(
      (mutated.context as { authorityId: string }).authorityId,
      "ap-1"
    );
    assert.deepEqual(requestableContext(mutated), { reason: "terms" });
  });

  it("grant-only over-ceiling deny with no policy is no-authority", () => {
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth, 1000);
    const out = evaluateAuthZen(auth, demandToAuthZen(demand()));
    assert.equal(out.decision, false);
    assert.equal((out.context as { reason: string }).reason, "no-authority");
    assert.equal(requestableContext(out), null);
  });

  it("policy narrowing denies forbidden and is NOT requestable", () => {
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth, 2000);
    auth.addPolicy({
      id: "cap",
      bounds: paymentBounds({ amountMax: 1000, currency: "INR" }),
    });
    const out = evaluateAuthZen(auth, demandToAuthZen(demand()));
    assert.equal(out.decision, false);
    const ctx = out.context as { reason: string; policyId: string };
    assert.equal(ctx.reason, "forbidden");
    assert.equal(ctx.policyId, "cap");
    // A fresh approval cannot fix a policy forbid.
    assert.equal(requestableContext(out), null);

    auth.createApproval({
      id: "ap-fix",
      principal: PRINCIPAL,
      actor: AGENT,
      action: { name: "/pay" },
      purpose: "pay invoice",
      resource: { type: "invoice", id: "invoice:inv_8472" },
      context: { amount: 1790, currency: "INR", recipient: MERCHANT },
      ttlSec: 600,
      maxUses: 1,
    });
    const again = evaluateAuthZen(auth, demandToAuthZen(demand()));
    assert.equal(again.decision, false);
    assert.equal((again.context as { reason: string }).reason, "forbidden");
  });

  it("remediable denies are requestable with their reason value", () => {
    const expiredAuth = new Authority({ nowSec: () => NOW });
    expiredAuth.addGrant({
      id: "g-old",
      principal: PRINCIPAL,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/pay" },
      purpose: "pay invoice",
      resource: { type: "invoice", id: "invoice:inv_8472" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW - 3600,
    });
    const expired = evaluateAuthZen(expiredAuth, demandToAuthZen(demand()));
    assert.equal((expired.context as { reason: string }).reason, "expired");
    assert.deepEqual(requestableContext(expired), { reason: "expired" });

    const usesAuth = new Authority({ nowSec: () => NOW });
    usesAuth.addGrant({
      id: "g-once",
      principal: PRINCIPAL,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/pay" },
      purpose: "pay invoice",
      resource: { type: "invoice", id: "invoice:inv_8472" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
      maxUses: 1,
    });
    assert.equal(
      evaluateAuthZen(usesAuth, demandToAuthZen(demand()), { consume: true })
        .decision,
      true
    );
    const exhausted = evaluateAuthZen(usesAuth, demandToAuthZen(demand()));
    assert.equal(
      (exhausted.context as { reason: string }).reason,
      "uses-exhausted"
    );
    assert.deepEqual(requestableContext(exhausted), {
      reason: "uses-exhausted",
    });
  });

  it("actor-scoped near-miss denies no-authority with detail, not requestable", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-scoped",
      principal: PRINCIPAL,
      actor: { kind: "exact", id: "did:test:someone-else" },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
    });
    const out = evaluateAuthZen(auth, demandToAuthZen(demand()));
    assert.equal(out.decision, false);
    const ctx = out.context as { reason: string; detail: string };
    assert.equal(ctx.reason, "no-authority");
    assert.match(ctx.detail, /actor mismatch on grant g-scoped/);
    assert.equal(requestableContext(out), null);
  });

  it("no-authority deny is not requestable", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const out = evaluateAuthZen(auth, demandToAuthZen(demand()));
    assert.equal(out.decision, false);
    assert.equal(requestableContext(out), null);
  });

  it("malformed SARC fails closed via throws (never TypeError)", () => {
    const good = demandToAuthZen(demand());

    // Missing actor denies at recovery.
    assert.throws(() => {
      authZenToDemand({
        ...good,
        subject: { ...good.subject, properties: {} },
      });
    }, /actor/);

    // Bad actorChain shapes throw.
    for (const actorChain of ["x", [""], [42], []]) {
      assert.throws(() => {
        authZenToDemand({
          ...good,
          subject: {
            ...good.subject,
            properties: { actor: AGENT, actorChain },
          },
        });
      }, /actorChain/);
    }

    // Missing resource type throws (type now participates in matching).
    assert.throws(() => {
      const badResource = {
        id: "invoice:inv_8472",
      } as unknown as typeof good.resource;
      authZenToDemand({
        ...good,
        resource: badResource,
      });
    }, /type/);

    // Action without a leading slash throws; bare "/" is forbidden too.
    assert.throws(() => {
      authZenToDemand({
        ...good,
        action: { name: "pay", properties: { purpose: "pay invoice" } },
      });
    }, /\/-path/);
    assert.throws(() => {
      authZenToDemand({
        ...good,
        action: { name: "/", properties: { purpose: "pay invoice" } },
      });
    }, /forbidden/);
    assert.throws(() => {
      const op = operation();
      demandToAuthZen({
        ...op,
        action: { name: "/" as `/${string}` },
        termsDigest: digestForOperation(op),
      });
    }, /forbidden/);

    // Null envelopes throw Error, never TypeError.
    for (const malformed of [
      null,
      { ...good, subject: null },
      { ...good, action: null },
      { ...good, resource: null },
    ]) {
      try {
        authZenToDemand(malformed as never);
        assert.fail("expected throw");
      } catch (err) {
        assert.ok(err instanceof Error);
        assert.ok(!(err instanceof TypeError), "must not be TypeError");
      }
    }

    // Non-record properties bags throw on both projection and recovery.
    assert.throws(() => {
      const op = operation();
      demandToAuthZen({
        ...op,
        action: {
          name: "/pay",
          properties: 42 as unknown as Record<string, unknown>,
        },
        termsDigest: digestForOperation(op),
      });
    }, /action\.properties/);
    assert.throws(() => {
      authZenToDemand({
        ...good,
        subject: { ...good.subject, properties: 42 as never },
      });
    }, /subject\.properties/);
  });
});

describe("COAZ-MCP direction helper (live draft, PTF-local mapping)", () => {
  it("maps MCP tools/call → SARC (method→action, tool→resource, args→context)", () => {
    const req = coazMcpToAuthZen({
      subject: PRINCIPAL,
      toolName: "pay_invoice",
      method: "tools/call",
      args: { amount: 1790, currency: "INR", recipient: MERCHANT },
    });
    assert.equal(req.subject.id, PRINCIPAL);
    assert.equal(req.subject.type, "user");
    assert.equal(
      (req.subject.properties as Record<string, unknown>)["actor"],
      PRINCIPAL
    );
    // Declarative PTF-local default: method becomes /-path under /mcp.
    assert.equal(req.action.name, "/mcp/tools/call");
    assert.equal(req.resource.type, "mcp-tool");
    assert.equal(req.resource.id, "pay_invoice");
    assert.deepEqual(req.context, {
      amount: 1790,
      currency: "INR",
      recipient: MERCHANT,
    });
    // Recoverable via the neutral model: digest recomputed, no termsDigest
    // needed in the mapped request.
    const back = authZenToDemand(req);
    assert.equal(back.principal, PRINCIPAL);
    assert.equal(back.actor, PRINCIPAL);
    assert.equal(back.action.name, "/mcp/tools/call");
    assert.equal(back.resource.type, "mcp-tool");
    assert.equal(back.resource.id, "pay_invoice");
    assert.deepEqual(back.context, {
      amount: 1790,
      currency: "INR",
      recipient: MERCHANT,
    });
  });

  it("normalizes leading-slash methods; tokenSub equal passes and echoes", () => {
    const req = coazMcpToAuthZen({
      subject: PRINCIPAL,
      toolName: "pay_invoice",
      method: "/tools/call",
      args: { amount: 1 },
      tokenSub: PRINCIPAL,
    });
    assert.equal(req.action.name, "/mcp/tools/call");
    assert.equal(
      (req.subject.properties as Record<string, unknown>)["tokenSub"],
      PRINCIPAL
    );
  });

  it("tokenSub mismatch and reserved/shape violations fail closed", () => {
    const base = {
      subject: PRINCIPAL,
      toolName: "pay_invoice",
      method: "tools/call",
      args: { amount: 1 },
    } as const;
    assert.throws(
      () => coazMcpToAuthZen({ ...base, tokenSub: "did:test:someone-else" }),
      /tokenSub/
    );
    assert.throws(
      () =>
        coazMcpToAuthZen({
          ...base,
          args: { amount: 1, termsDigest: "ff".repeat(32) },
        }),
      /termsDigest/
    );
    assert.throws(() => coazMcpToAuthZen({ ...base, method: "/" }), /\/-path/);
    assert.throws(
      () => coazMcpToAuthZen({ ...base, method: "tools/call now" }),
      /whitespace/
    );
    assert.throws(() => coazMcpToAuthZen({ ...base, subject: "" }), /subject/);
    assert.throws(
      () => coazMcpToAuthZen({ ...base, toolName: "" }),
      /toolName/
    );
    assert.throws(
      () =>
        coazMcpToAuthZen({
          ...base,
          args: 42 as unknown as Readonly<Record<string, unknown>>,
        }),
      /args/
    );
  });

  it("out of scope: single evaluations only — no boxcar, no search APIs", () => {
    // Boxcarred (batched) evaluations and AuthZEN search APIs are explicitly
    // out of scope for this information-model adapter: the helper returns a
    // single AuthZenEvaluationRequest (never an array/batch), and this repo
    // exports no boxcar/search helpers. Transport (POST single evaluation)
    // stays host-owned per the module header.
    const req = coazMcpToAuthZen({
      subject: PRINCIPAL,
      toolName: "pay_invoice",
      method: "tools/call",
      args: { amount: 1 },
    });
    assert.ok(!Array.isArray(req));
    assert.equal(typeof req.action.name, "string");
  });
});
