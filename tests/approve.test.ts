import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  parseDecision,
  renderProposal,
  termsDigestOf,
} from "../src/index.js";

const NOW = 1_700_000_000;
const DIGEST = termsDigestOf({ invoice: "inv_8472", amount: 1790 });

function demand() {
  return {
    principal: "did:test:principal",
    agent: "did:test:grocery",
    cmd: "/pay" as const,
    purpose: "pay invoice",
    resource: "invoice:inv_8472",
    recipient: "did:test:merchant-b",
    amount: 1790,
    currency: "INR",
    termsDigest: DIGEST,
  };
}

describe("approval presenter (ptf-v02/02)", () => {
  it("renders every binding field, the full digest, and citations", () => {
    const text = renderProposal({
      demand: demand(),
      citations: [
        {
          authorityId: "grocery-weekly",
          kind: "grant",
          policyIds: ["frugal-cap"],
        },
      ],
      expiresAt: NOW + 300,
      maxUses: 1,
    });
    for (const needle of [
      "/pay",
      "1790",
      "INR",
      "did:test:merchant-b",
      "pay invoice",
      "invoice:inv_8472",
      "did:test:grocery",
      "grocery-weekly",
      "frugal-cap",
      DIGEST,
    ]) {
      assert.ok(text.includes(needle), `missing ${needle}`);
    }
  });

  it("strips control and ANSI sequences from rendered fields", () => {
    const text = renderProposal({
      demand: { ...demand(), purpose: "pay\x1b[31m invoice\x07" },
      citations: [],
    });
    assert.ok(!text.includes("\x1b") && !text.includes("\x07"));
    assert.ok(text.includes("pay invoice"));
  });

  it("parses explicit decisions and rejects anything else", () => {
    for (const yes of ["y", "Y", "yes", "YES ", " approve", "OK", "confirm"]) {
      assert.equal(parseDecision(yes), "approve");
    }
    for (const no of ["n", "N", "no", " deny", "CANCEL", "reject"]) {
      assert.equal(parseDecision(no), "deny");
    }
    for (const garbage of ["", "maybe", "yes please!", "yess", "11"]) {
      assert.throws(() => parseDecision(garbage));
    }
  });

  it("wires render → approve → minted approval → authority allow", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const terms = { invoice: "inv_8472", amount: 1790 };
    const text = renderProposal({
      demand: { ...demand(), termsDigest: termsDigestOf(terms) },
      citations: [],
      expiresAt: NOW + 300,
      maxUses: 1,
    });
    assert.ok(text.includes(termsDigestOf(terms)));
    assert.equal(parseDecision("yes"), "approve");
    auth.createApproval({
      id: "a-human",
      principal: "did:test:principal",
      agent: "did:test:grocery",
      cmd: "/pay",
      purpose: "pay invoice",
      resource: "invoice:inv_8472",
      recipient: "did:test:merchant-b",
      amount: 1790,
      currency: "INR",
      terms,
      ttlSec: 300,
    });
    const decision = auth.evaluate({
      ...demand(),
      termsDigest: termsDigestOf(terms),
    });
    assert.equal(decision.allow, true);
  });
});
