import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  authZenToDemand,
  demandToAuthZen,
  evaluateAuthZen,
  requestableContext,
  termsDigestOf,
} from "../src/index.js";

const NOW = 1_700_000_000;
const PRINCIPAL = "did:test:principal";
const AGENT = "did:test:agent";
const MERCHANT = "did:test:merchant";
const DIGEST = "ab".repeat(32);
const OTHER_DIGEST = "cc".repeat(32);

function demand() {
  return {
    principal: PRINCIPAL,
    agent: AGENT,
    cmd: "/pay" as const,
    purpose: "pay invoice",
    resource: "invoice:inv_8472",
    recipient: MERCHANT,
    amount: 1790,
    currency: "INR",
    termsDigest: DIGEST,
  };
}

function demandWithClaims() {
  return {
    ...demand(),
    claims: ["claim-a", "claim-b"] as const,
  };
}

function coveringGrant(auth: Authority, amountMax = 2000): void {
  auth.addGrant({
    id: "g1",
    principal: PRINCIPAL,
    agent: AGENT,
    cmd: "/pay",
    purpose: "pay invoice",
    resource: "invoice:inv_8472",
    recipient: MERCHANT,
    amountMax,
    currency: "INR",
    exp: NOW + 3600,
  });
}

describe("AuthZEN SARC translator (pivot/01)", () => {
  it("round-trips demand through draft-01 SARC without loss", () => {
    const req = demandToAuthZen(demand());
    assert.equal(req.subject.id, PRINCIPAL);
    // draft-01: action carries `name`, not `type`/`id`.
    assert.equal(req.action.name, "/pay");
    assert.equal(
      (req.action.properties as Record<string, unknown>)["purpose"],
      "pay invoice"
    );
    assert.equal(
      (req.action.properties as Record<string, unknown>)["ptf.cmd"],
      "/pay"
    );
    assert.equal(req.resource.id, "invoice:inv_8472");
    const back = authZenToDemand(req);
    assert.deepEqual(back, demand());
  });

  it("round-trips claims with and without claims", () => {
    const withClaims = demandToAuthZen(demandWithClaims());
    const backWith = authZenToDemand(withClaims);
    assert.deepEqual([...(backWith.claims ?? [])], ["claim-a", "claim-b"]);

    const withoutClaims = demandToAuthZen(demand());
    const backWithout = authZenToDemand(withoutClaims);
    assert.equal(backWithout.claims, undefined);
  });

  it("dedupes duplicate claims instead of dropping the request", () => {
    const req = demandToAuthZen({ ...demand(), claims: ["a", "a", "b"] });
    const back = authZenToDemand(req);
    assert.deepEqual([...(back.claims ?? [])], ["a", "b"]);
  });

  it("allows via PDP with kind/policyIds/termsDigest echo", () => {
    const auth = new Authority({ nowSec: () => NOW });
    coveringGrant(auth);
    auth.addPolicy({ id: "cap-loose", amountMax: 5000 });
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
    assert.equal(ctx.termsDigest, DIGEST);
  });

  it("denies with reason terms on a mutated termsDigest", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const approvalTerms = { invoice: "inv_8472", amount: 1790 };
    auth.createApproval({
      id: "ap-1",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
      purpose: "pay invoice",
      resource: "invoice:inv_8472",
      recipient: MERCHANT,
      amount: 1790,
      currency: "INR",
      terms: approvalTerms,
      ttlSec: 3600,
      maxUses: 1,
    });
    // Exact terms allow — proves the approval covers this identity.
    const good = evaluateAuthZen(
      auth,
      demandToAuthZen({
        ...demand(),
        termsDigest: termsDigestOf(approvalTerms),
      })
    );
    assert.equal(good.decision, true);

    // Same identity fields, different digest → terms mismatch, not a new ask.
    const mutated = evaluateAuthZen(
      auth,
      demandToAuthZen({ ...demand(), termsDigest: OTHER_DIGEST })
    );
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
    auth.addPolicy({ id: "cap", amountMax: 1000 });
    const out = evaluateAuthZen(auth, demandToAuthZen(demand()));
    assert.equal(out.decision, false);
    const ctx = out.context as { reason: string; policyId: string };
    assert.equal(ctx.reason, "forbidden");
    assert.equal(ctx.policyId, "cap");
    // A fresh approval cannot fix a policy forbid (authority.ts:560-569).
    assert.equal(requestableContext(out), null);

    auth.createApproval({
      id: "ap-fix",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
      purpose: "pay invoice",
      resource: "invoice:inv_8472",
      recipient: MERCHANT,
      amount: 1790,
      currency: "INR",
      terms: { invoice: "inv_8472", amount: 1790 },
      ttlSec: 600,
      maxUses: 1,
    });
    const again = evaluateAuthZen(
      auth,
      demandToAuthZen({
        ...demand(),
        termsDigest: termsDigestOf({ invoice: "inv_8472", amount: 1790 }),
      })
    );
    assert.equal(again.decision, false);
    assert.equal((again.context as { reason: string }).reason, "forbidden");
  });

  it("remediable denies are requestable with their reason value", () => {
    const expiredAuth = new Authority({ nowSec: () => NOW });
    expiredAuth.addGrant({
      id: "g-old",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
      purpose: "pay invoice",
      resource: "invoice:inv_8472",
      recipient: MERCHANT,
      amountMax: 2000,
      currency: "INR",
      exp: NOW - 3600,
    });
    const expired = evaluateAuthZen(expiredAuth, demandToAuthZen(demand()));
    assert.equal((expired.context as { reason: string }).reason, "expired");
    assert.deepEqual(requestableContext(expired), { reason: "expired" });

    const usesAuth = new Authority({ nowSec: () => NOW });
    usesAuth.addGrant({
      id: "g-once",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
      purpose: "pay invoice",
      resource: "invoice:inv_8472",
      recipient: MERCHANT,
      amountMax: 2000,
      currency: "INR",
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

  it("no-authority deny is not requestable", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const out = evaluateAuthZen(auth, demandToAuthZen(demand()));
    assert.equal(out.decision, false);
    assert.equal(requestableContext(out), null);
  });

  it("malformed SARC fails closed via throws (never TypeError)", () => {
    const good = demandToAuthZen(demand());
    const ctxOf = (r: typeof good) =>
      r.context as unknown as Record<string, unknown>;

    // Missing digest (deleted key and undefined context) denies at recovery.
    assert.throws(() => {
      const { termsDigest: _drop, ...rest } = ctxOf(good);
      void _drop;
      authZenToDemand({ ...good, context: rest });
    }, /termsDigest/);
    assert.throws(() => {
      const { context: _drop2, ...noCtx } = good;
      void _drop2;
      authZenToDemand(noCtx);
    }, /termsDigest/);

    // Zero / negative / string / non-finite amounts throw.
    for (const amount of [0, -5, "1790", Infinity, NaN]) {
      assert.throws(() => {
        authZenToDemand({
          ...good,
          context: { ...ctxOf(good), amount },
        });
      }, /amount/);
    }

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
      demandToAuthZen({ ...demand(), cmd: "/" as `/${string}` });
    }, /forbidden/);
    assert.throws(() => {
      demandToAuthZen({ ...demand(), amount: Infinity });
    }, /amount/);

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

    // Empty-string claims throw on both projection and recovery.
    assert.throws(() => {
      demandToAuthZen({ ...demand(), claims: [""] });
    }, /claims/);
    assert.throws(() => {
      authZenToDemand({
        ...good,
        context: { ...ctxOf(good), claims: [""] },
      });
    }, /claims/);
  });
});
