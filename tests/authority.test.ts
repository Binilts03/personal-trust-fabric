import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Authority, termsDigestOf } from "../src/index.js";

const NOW = 1_700_000_000;
const PRINCIPAL = "did:test:principal";
const AGENT = "did:test:agent";
const OTHER_AGENT = "did:test:other-agent";
const MERCHANT = "did:test:merchant";

function terms() {
  return {
    invoice: "inv_8472",
    amount: 1790,
    currency: "INR",
    merchant: MERCHANT,
  };
}

function demand(digest: string, amount = 1790) {
  return {
    principal: PRINCIPAL,
    agent: AGENT,
    cmd: "/pay" as const,
    purpose: "pay invoice",
    resource: "invoice:inv_8472",
    recipient: MERCHANT,
    amount,
    currency: "INR",
    termsDigest: digest,
  };
}

describe("policy authority with digest-bound approval (ptf-v01/01)", () => {
  it("allows under a covering grant with citation; policy alone never allows", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addPolicy({ id: "business-hours", amountMax: 100_000 });
    const lonely = auth.evaluate(demand("00".repeat(32)));
    assert.equal(lonely.allow, false);
    if (!lonely.allow) assert.equal(lonely.reason, "no-authority");

    auth.addGrant({
      id: "grocery-weekly",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
      purpose: "pay invoice",
      resource: "invoice:inv_8472",
      recipient: MERCHANT,
      amountMax: 2000,
      currency: "INR",
      exp: NOW + 3600,
    });
    const ok = auth.evaluate(demand(termsDigestOf(terms())));
    assert.equal(ok.allow, true);
    if (ok.allow) {
      assert.equal(ok.citations[0]?.authorityId, "grocery-weekly");
      assert.equal(ok.citations[0]?.kind, "grant");
    }
  });

  it("narrowing policy overrides the grant; compliant demands still pass", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "grocery-weekly",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
      amountMax: 2000,
      currency: "INR",
      exp: NOW + 3600,
    });
    auth.addPolicy({ id: "frugal-cap", cmd: "/pay", amountMax: 1000 });

    const over = auth.evaluate(demand(termsDigestOf(terms()), 1500));
    assert.equal(over.allow, false);
    if (!over.allow) {
      assert.equal(over.reason, "forbidden");
      assert.equal(over.policyId, "frugal-cap");
    }
    const under = auth.evaluate(
      demand(termsDigestOf({ ...terms(), amount: 500 }), 500)
    );
    assert.equal(under.allow, true);
  });

  it("one-time approval binds exact terms; mutations fail closed with terms reason", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const approval = auth.createApproval({
      id: "appr-1",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
      purpose: "pay invoice",
      resource: "invoice:inv_8472",
      recipient: MERCHANT,
      amount: 1790,
      currency: "INR",
      terms: terms(),
      ttlSec: 300,
    });
    const ok = auth.evaluate(demand(approval.termsDigest));
    assert.equal(ok.allow, true);
    if (ok.allow) assert.equal(ok.citations[0]?.kind, "approval");

    const mutated = auth.evaluate({
      ...demand(termsDigestOf({ ...terms(), amount: 1791 })),
      amount: 1791,
    });
    assert.equal(mutated.allow, false);
    if (!mutated.allow) assert.equal(mutated.reason, "terms");
  });

  it("enforces expiry, single use, and revocation", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "stale",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
      exp: NOW - 3600,
    });
    const expired = auth.evaluate(demand("ab".repeat(32)));
    assert.equal(expired.allow, false);
    if (!expired.allow) assert.equal(expired.reason, "expired");

    auth.addGrant({
      id: "once",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
      maxUses: 1,
    });
    assert.equal(
      auth.evaluate(demand("cd".repeat(32)), { consume: true }).allow,
      true
    );
    const replay = auth.evaluate(demand("cd".repeat(32)), { consume: true });
    assert.equal(replay.allow, false);
    if (!replay.allow) assert.equal(replay.reason, "uses-exhausted");

    auth.addGrant({
      id: "doomed",
      principal: PRINCIPAL,
      agent: AGENT,
      cmd: "/pay",
    });
    auth.revoke("doomed");
    const revoked = auth.evaluate(demand("ef".repeat(32)));
    assert.equal(revoked.allow, false);
    if (!revoked.allow) assert.equal(revoked.reason, "revoked");
  });

  it("scopes authority to the bound agent", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "scoped",
      principal: PRINCIPAL,
      agent: OTHER_AGENT,
      cmd: "/pay",
    });
    const wrongAgent = auth.evaluate(demand("12".repeat(32)));
    assert.equal(wrongAgent.allow, false);
    if (!wrongAgent.allow) assert.equal(wrongAgent.reason, "no-authority");
  });
});
