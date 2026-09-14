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
import type {
  AuthorityOperation,
  AuthorityRequest,
  AuthZenEvaluationRequest,
  VerifiedIdentity,
} from "../src/index.js";

const NOW = 1_700_000_000;
const PRINCIPAL = "did:test:principal";
const AGENT = "did:test:agent";
const MERCHANT = "did:test:merchant";
const SUB_AGENT = "did:test:sub-agent";

const INGRESS: VerifiedIdentity = {
  id: AGENT,
  principal: PRINCIPAL,
  source: "local-registration",
  proofRef: "authzen-test",
};

const CHAIN: readonly string[] = [AGENT, SUB_AGENT];

const INGRESS_CHAIN: VerifiedIdentity = {
  ...INGRESS,
  chain: [...CHAIN],
};

/** Identity-free operation: identity binds from the ingress at evaluation. */
function operation(amount = 1790): AuthorityOperation {
  return {
    action: { name: "/pay" as const },
    resource: { type: "invoice", id: "invoice:inv_8472" },
    context: { amount, currency: "INR", recipient: MERCHANT },
    purpose: "pay invoice",
  };
}

/** Engine-bound demand (what the engine assembles from operation+ingress). */
function boundDemand(
  amount = 1790,
  ingress: VerifiedIdentity = INGRESS
): AuthorityRequest {
  const bound = {
    ...operation(amount),
    principal: ingress.principal,
    actor: ingress.id,
    ...(ingress.chain !== undefined ? { actorChain: [...ingress.chain] } : {}),
  };
  return { ...bound, termsDigest: digestForOperation(bound) };
}

function req(
  amount = 1790,
  ingress: VerifiedIdentity = INGRESS
): AuthZenEvaluationRequest {
  return demandToAuthZen(boundDemand(amount, ingress));
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

describe("AuthZEN SARC translator, neutral model with verified ingress (pivot/01, 0010, 0013)", () => {
  it("round-trips demand through Final 1.0 SARC without loss", () => {
    const projected = demandToAuthZen(boundDemand());
    assert.equal(projected.subject.id, PRINCIPAL);
    assert.equal(
      (projected.subject.properties as Record<string, unknown>)["actor"],
      AGENT
    );
    // Final 1.0 (as far as known; unchanged from draft-01): action carries
    // `name`, not `type`/`id`.
    assert.equal(projected.action.name, "/pay");
    assert.equal(
      (projected.action.properties as Record<string, unknown>)["purpose"],
      "pay invoice"
    );
    assert.equal(projected.resource.type, "invoice");
    assert.equal(projected.resource.id, "invoice:inv_8472");
    const back = authZenToDemand(projected, INGRESS);
    assert.deepEqual(back, boundDemand());
  });

  it("round-trips chains, action properties, and generic context", () => {
    const chainedOp: AuthorityOperation = {
      ...operation(),
      action: { name: "/pay", properties: { rail: "upi" } },
    };
    const chainedBound = (() => {
      const bound = {
        ...chainedOp,
        principal: PRINCIPAL,
        actor: AGENT,
        actorChain: [...CHAIN],
      };
      return { ...bound, termsDigest: digestForOperation(bound) };
    })();
    const projected = demandToAuthZen(chainedBound);
    assert.deepEqual(
      (projected.subject.properties as Record<string, unknown>)["actorChain"],
      [AGENT, SUB_AGENT]
    );
    const back = authZenToDemand(projected, INGRESS_CHAIN);
    assert.deepEqual(back, chainedBound);
  });

  it("allows via PDP with kind/policyIds/derived-termsDigest echo", () => {
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth);
    auth.addPolicy({
      id: "cap-loose",
      bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    });
    const out = evaluateAuthZen(auth, req(), INGRESS);
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
    assert.equal(ctx.termsDigest, boundDemand().termsDigest);
  });

  it("ignores a tampered envelope digest: decision follows the true terms", () => {
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth);
    const honestReq = req();
    const tampered = {
      ...honestReq,
      context: {
        ...(honestReq.context as Record<string, unknown>),
        termsDigest: "ff".repeat(32),
      },
    };
    const out = evaluateAuthZen(auth, tampered, INGRESS);
    assert.equal(out.decision, true);
    // The echo is the DERIVED digest, not the supplied lie.
    assert.equal(
      (out.context as { termsDigest: string }).termsDigest,
      boundDemand().termsDigest
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
    const good = evaluateAuthZen(auth, req(), INGRESS);
    assert.equal(good.decision, true);

    // Same identity, different amount → terms mismatch, not a new ask.
    const mutated = evaluateAuthZen(auth, req(1791), INGRESS);
    assert.equal(mutated.decision, false);
    assert.equal((mutated.context as { reason: string }).reason, "terms");
    assert.equal(
      (mutated.context as { authorityId: string }).authorityId,
      "ap-1"
    );
    assert.deepEqual(requestableContext(mutated), { reason: "terms" });
  });

  it("echoes a verified external binding in citations and the digest", () => {
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth);
    const binding = {
      scheme: "ap2" as const,
      value: "ap2-tx-domestic-economy-12000",
      evidenceRef: "ap2-mandate",
    };
    const out = evaluateAuthZen(auth, req(), INGRESS, { binding });
    assert.equal(out.decision, true);
    const ctx = out.context as {
      citations: {
        authorityId: string;
        kind: string;
        policyIds: string[];
        binding?: typeof binding;
      }[];
      termsDigest: string;
    };
    assert.deepEqual(ctx.citations[0]?.binding, binding);
    const { termsDigest: _dropped, ...bound } = boundDemand();
    void _dropped;
    assert.equal(ctx.termsDigest, digestForOperation(bound, binding));
  });

  it("request identity hints are untrusted: spoofs throw, absence binds ingress", () => {
    const good = req();
    // Spoofed actor hint — a PEP echoing a trusted-looking agent it was
    // never verified as — fails closed instead of evaluating.
    assert.throws(() => {
      authZenToDemand(
        {
          ...good,
          subject: {
            ...good.subject,
            properties: { actor: "did:agent:trusted-payments" },
          },
        },
        INGRESS
      );
    }, /spoof/);
    // Spoofed principal hint fails closed too.
    assert.throws(() => {
      authZenToDemand(
        {
          ...good,
          subject: { ...good.subject, id: "did:test:impostor" },
        },
        INGRESS
      );
    }, /spoof/);
    // Spoofed chain hint (no verified chain on the ingress) fails closed.
    assert.throws(() => {
      authZenToDemand(
        {
          ...good,
          subject: {
            ...good.subject,
            properties: {
              actor: AGENT,
              actorChain: ["did:agent:trusted-payments"],
            },
          },
        },
        INGRESS
      );
    }, /spoof/);
    // Chain hint unequal to the verified chain fails closed.
    const chainedReq = req(1790, INGRESS_CHAIN);
    assert.throws(() => {
      authZenToDemand(
        {
          ...chainedReq,
          subject: {
            ...chainedReq.subject,
            properties: {
              actor: AGENT,
              actorChain: ["did:agent:trusted-payments", SUB_AGENT],
            },
          },
        },
        INGRESS_CHAIN
      );
    }, /spoof/);
    // evaluateAuthZen throws on spoofs too — never a decision.
    assert.throws(() => {
      evaluateAuthZen(
        new Authority({ nowSec: () => NOW }),
        {
          ...good,
          subject: {
            ...good.subject,
            properties: { actor: "did:agent:trusted-payments" },
          },
        },
        INGRESS
      );
    }, /spoof/);

    // Absence is fine (normal generic-PEP case): everything binds from
    // the ingress, and the evaluation allows under the covering grant.
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth);
    const generic: AuthZenEvaluationRequest = {
      subject: { type: "user", id: PRINCIPAL },
      action: { name: "/pay", properties: { purpose: "pay invoice" } },
      resource: { type: "invoice", id: "invoice:inv_8472" },
      context: { amount: 1790, currency: "INR", recipient: MERCHANT },
    };
    const recovered = authZenToDemand(generic, INGRESS);
    assert.deepEqual(recovered, boundDemand());
    assert.equal(evaluateAuthZen(auth, generic, INGRESS).decision, true);
  });

  it("grant-only over-ceiling deny with no policy is no-authority", () => {
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth, 1000);
    const out = evaluateAuthZen(auth, req(), INGRESS);
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
    const out = evaluateAuthZen(auth, req(), INGRESS);
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
    const again = evaluateAuthZen(auth, req(), INGRESS);
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
    const expired = evaluateAuthZen(expiredAuth, req(), INGRESS);
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
      evaluateAuthZen(usesAuth, req(), INGRESS, { consume: true }).decision,
      true
    );
    const exhausted = evaluateAuthZen(usesAuth, req(), INGRESS);
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
    const out = evaluateAuthZen(auth, req(), INGRESS);
    assert.equal(out.decision, false);
    const ctx = out.context as { reason: string; detail: string };
    assert.equal(ctx.reason, "no-authority");
    assert.match(ctx.detail, /actor mismatch on grant g-scoped/);
    assert.equal(requestableContext(out), null);
  });

  it("no-authority deny is not requestable", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const out = evaluateAuthZen(auth, req(), INGRESS);
    assert.equal(out.decision, false);
    assert.equal(requestableContext(out), null);
  });

  it("malformed SARC fails closed via throws (never TypeError)", () => {
    const good = req();

    // Bad actorChain shapes (present-but-malformed) throw.
    for (const actorChain of ["x", [""], [42], []]) {
      assert.throws(() => {
        authZenToDemand(
          {
            ...good,
            subject: {
              ...good.subject,
              properties: { actor: AGENT, actorChain },
            },
          },
          INGRESS
        );
      }, /actorChain/);
    }

    // Missing resource type throws (type now participates in matching).
    assert.throws(() => {
      const badResource = {
        id: "invoice:inv_8472",
      } as unknown as typeof good.resource;
      authZenToDemand(
        {
          ...good,
          resource: badResource,
        },
        INGRESS
      );
    }, /type/);

    // Action without a leading slash throws; bare "/" is forbidden too.
    assert.throws(() => {
      authZenToDemand(
        {
          ...good,
          action: { name: "pay", properties: { purpose: "pay invoice" } },
        },
        INGRESS
      );
    }, /\/-path/);
    assert.throws(() => {
      authZenToDemand(
        {
          ...good,
          action: { name: "/", properties: { purpose: "pay invoice" } },
        },
        INGRESS
      );
    }, /forbidden/);
    assert.throws(() => {
      const bound = {
        action: { name: "/" as `/${string}` },
        resource: { type: "invoice", id: "invoice:inv_8472" },
        context: {},
        principal: PRINCIPAL,
        actor: AGENT,
      };
      demandToAuthZen({ ...bound, termsDigest: digestForOperation(bound) });
    }, /forbidden/);

    // Null envelopes throw Error, never TypeError.
    for (const malformed of [
      null,
      { ...good, subject: null },
      { ...good, action: null },
      { ...good, resource: null },
    ]) {
      try {
        authZenToDemand(malformed as never, INGRESS);
        assert.fail("expected throw");
      } catch (err) {
        assert.ok(err instanceof Error);
        assert.ok(!(err instanceof TypeError), "must not be TypeError");
      }
    }

    // Non-record properties bags throw on both projection and recovery.
    assert.throws(() => {
      const bound = {
        principal: PRINCIPAL,
        actor: AGENT,
        action: {
          name: "/pay" as `/${string}`,
          properties: 42 as unknown as Record<string, unknown>,
        },
        resource: { type: "invoice", id: "invoice:inv_8472" },
        context: {},
      };
      demandToAuthZen({ ...bound, termsDigest: digestForOperation(bound) });
    }, /action\.properties/);
    assert.throws(() => {
      authZenToDemand(
        {
          ...good,
          subject: { ...good.subject, properties: 42 as never },
        },
        INGRESS
      );
    }, /subject\.properties/);
  });
});

describe("COAZ-MCP direction helper (live draft, PTF-local mapping)", () => {
  const COAZ_INGRESS: VerifiedIdentity = {
    id: PRINCIPAL,
    principal: PRINCIPAL,
    source: "mcp-token",
    proofRef: "coaz-test",
  };

  it("maps MCP tools/call → SARC (method→action, tool→resource, args→context)", () => {
    const mapped = coazMcpToAuthZen({
      subject: PRINCIPAL,
      toolName: "pay_invoice",
      method: "tools/call",
      args: { amount: 1790, currency: "INR", recipient: MERCHANT },
    });
    assert.equal(mapped.subject.id, PRINCIPAL);
    assert.equal(mapped.subject.type, "user");
    assert.equal(
      (mapped.subject.properties as Record<string, unknown>)["actor"],
      PRINCIPAL
    );
    // Declarative PTF-local default: method becomes /-path under /mcp.
    assert.equal(mapped.action.name, "/mcp/tools/call");
    assert.equal(mapped.resource.type, "mcp-tool");
    assert.equal(mapped.resource.id, "pay_invoice");
    assert.deepEqual(mapped.context, {
      amount: 1790,
      currency: "INR",
      recipient: MERCHANT,
    });
    // Recoverable via the neutral model under the matching ingress: digest
    // recomputed, no termsDigest needed in the mapped request.
    const back = authZenToDemand(mapped, COAZ_INGRESS);
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
    const mapped = coazMcpToAuthZen({
      subject: PRINCIPAL,
      toolName: "pay_invoice",
      method: "/tools/call",
      args: { amount: 1 },
      tokenSub: PRINCIPAL,
    });
    assert.equal(mapped.action.name, "/mcp/tools/call");
    assert.equal(
      (mapped.subject.properties as Record<string, unknown>)["tokenSub"],
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
    const mapped = coazMcpToAuthZen({
      subject: PRINCIPAL,
      toolName: "pay_invoice",
      method: "tools/call",
      args: { amount: 1 },
    });
    assert.ok(!Array.isArray(mapped));
    assert.equal(typeof mapped.action.name, "string");
  });
});
