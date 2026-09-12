import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { KeyObject } from "node:crypto";
import { termsDigestOf } from "../src/core/canonical.js";
import { generateEd25519Keypair, signBytes } from "../src/core/crypto.js";
import { Capabilities, leafCidHex } from "../src/core/capability.js";
import type { SealedCapability } from "../src/core/types.js";

const PRINCIPAL = "did:test:principal";
const AGENT = "did:test:agent";
const CHECKOUT = "did:test:checkout";
const MERCHANT = "did:test:merchant";
const ATTACKER = "did:test:attacker";

interface Keys {
  id: string;
  pub: Uint8Array;
  priv: KeyObject;
}

function setup(nowSec = 1_700_000_000) {
  const mk = (id: string): Keys => {
    const kp = generateEd25519Keypair();
    return { id, pub: kp.publicKeyRaw, priv: kp.privateKey };
  };
  const principal = mk(PRINCIPAL);
  const agent = mk(AGENT);
  const checkout = mk(CHECKOUT);
  const merchant = mk(MERCHANT);
  const attacker = mk(ATTACKER);
  const keys = new Map<string, Uint8Array>([
    [principal.id, principal.pub],
    [agent.id, agent.pub],
    [checkout.id, checkout.pub],
    [merchant.id, merchant.pub],
    [attacker.id, attacker.pub],
  ]);
  const caps = new Capabilities({
    resolveKey: (id) => keys.get(id) ?? null,
    nowSec: () => nowSec,
  });
  return { caps, principal, agent, checkout, merchant, attacker };
}

function payTerms() {
  return {
    invoice: "inv_8472",
    amount: 1790,
    currency: "INR",
    merchant: MERCHANT,
  };
}

function issueRoot(
  caps: ReturnType<typeof setup>["caps"],
  k: Keys,
  exp: number,
  terms: string
) {
  return caps.issue(
    null,
    {
      iss: PRINCIPAL,
      aud: AGENT,
      sub: PRINCIPAL,
      cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "pay invoice",
      resource: "invoice:inv_8472",
      recipient: MERCHANT,
      amountMax: 2000,
      currency: "INR",
      exp,
      maxUses: 1,
      termsDigest: terms,
    },
    k.priv
  );
}

function proofFor(leaf: SealedCapability, signer: Keys) {
  const cid = leafCidHex(leaf);
  const cidBytes = new Uint8Array(Buffer.from(cid, "hex"));
  return { key: signer.pub, sig: signBytes(signer.priv, cidBytes) };
}

describe("capability runtime (ticket 01)", () => {
  it("issues, dry-runs, and redeems a single-use payment once", () => {
    const { caps, principal, merchant } = setup();
    const terms = termsDigestOf(payTerms());
    const root = issueRoot(caps, principal, 1_700_003_600, terms);
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 1790, currency: "INR" },
      recipient: MERCHANT,
      termsDigest: terms,
    };

    assert.equal(caps.authorize([root], demand, { consume: false }).ok, true);
    const proof = proofFor(root, merchant);
    const first = caps.authorize([root], demand, { consume: true, proof });
    assert.equal(first.ok, true);
    assert.equal(caps.authorize([root], demand, { consume: false }).ok, false);
  });

  it("attenuates downward only; widening is rejected at issue", () => {
    const { caps, principal, agent } = setup();
    const terms = termsDigestOf(payTerms());
    const root = issueRoot(caps, principal, 1_700_003_600, terms);
    const child = caps.issue(
      [root],
      {
        iss: AGENT,
        aud: CHECKOUT,
        sub: PRINCIPAL,
        cmd: "/pay",
        pol: [["<=", ".amount", 500]],
        purpose: "pay invoice",
        resource: "invoice:inv_8472",
        recipient: MERCHANT,
        amountMax: 500,
        currency: "INR",
        exp: 1_700_000_600,
        maxUses: 1,
        termsDigest: terms,
      },
      agent.priv
    );
    assert.equal(child.payload.amountMax, 500);
    assert.throws(() =>
      caps.issue(
        [root],
        {
          iss: AGENT,
          aud: CHECKOUT,
          sub: PRINCIPAL,
          cmd: "/pay",
          pol: [["<=", ".amount", 9000]],
          purpose: "pay invoice",
          resource: "invoice:inv_8472",
          recipient: MERCHANT,
          amountMax: 9000,
          currency: "INR",
          exp: 1_700_003_600,
          maxUses: 1,
          termsDigest: terms,
        },
        agent.priv
      )
    );
  });

  it("denies expired capabilities and wrong recipients / mutated terms", () => {
    const { caps, principal } = setup();
    const terms = termsDigestOf(payTerms());
    const root = issueRoot(caps, principal, 1_699_999_000, terms);
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 10, currency: "INR" },
      recipient: MERCHANT,
      termsDigest: terms,
    };
    assert.deepEqual(caps.authorize([root], demand, { consume: false }), {
      ok: false,
      reason: "expired",
      detail: "exp 1699999000",
    });
    const fresh = issueRoot(caps, principal, 1_700_003_600, terms);
    const wrongRecipient = caps.authorize(
      [fresh],
      { ...demand, recipient: ATTACKER },
      { consume: false }
    );
    assert.equal(wrongRecipient.ok, false);
    if (!wrongRecipient.ok) assert.equal(wrongRecipient.reason, "recipient");
    const mutated = caps.authorize(
      [fresh],
      { ...demand, termsDigest: "00".repeat(32) },
      { consume: false }
    );
    assert.equal(mutated.ok, false);
    if (!mutated.ok) assert.equal(mutated.reason, "terms");
  });

  it("denies over-ceiling amounts and requires recipient proof on redeem", () => {
    const { caps, principal, merchant, attacker } = setup();
    const terms = termsDigestOf(payTerms());
    const root = issueRoot(caps, principal, 1_700_003_600, terms);
    const over = {
      cmd: "/pay" as const,
      args: { amount: 5000, currency: "INR" },
      recipient: MERCHANT,
      termsDigest: terms,
    };
    const denied = caps.authorize([root], over, { consume: false });
    assert.equal(denied.ok, false);
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 100, currency: "INR" },
      recipient: MERCHANT,
      termsDigest: terms,
    };
    assert.equal(caps.authorize([root], demand, { consume: true }).ok, false);
    const badProof = proofFor(root, attacker);
    assert.equal(
      caps.authorize([root], demand, { consume: true, proof: badProof }).ok,
      false
    );
    assert.equal(
      caps.authorize([root], demand, {
        consume: true,
        proof: proofFor(root, merchant),
      }).ok,
      true
    );
  });

  it("revoking a parent cascades to attenuated children", () => {
    const { caps, principal, agent, merchant } = setup();
    const terms = termsDigestOf(payTerms());
    const root = issueRoot(caps, principal, 1_700_003_600, terms);
    const child = caps.issue(
      [root],
      {
        iss: AGENT,
        aud: CHECKOUT,
        sub: PRINCIPAL,
        cmd: "/pay",
        pol: [["<=", ".amount", 500]],
        purpose: "pay invoice",
        resource: "invoice:inv_8472",
        recipient: MERCHANT,
        amountMax: 500,
        currency: "INR",
        exp: 1_700_000_600,
        maxUses: 1,
        termsDigest: terms,
      },
      agent.priv
    );
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 100, currency: "INR" },
      recipient: MERCHANT,
      termsDigest: terms,
    };
    caps.revoke(root.payload.revocationId);
    assert.equal(
      caps.authorize([root, child], demand, { consume: false }).ok,
      false
    );
  });

  it("rejects wildcard cmd and non-self-rooted chains at issue", () => {
    const { caps, principal } = setup();
    const terms = termsDigestOf(payTerms());
    assert.throws(() =>
      caps.issue(
        null,
        {
          iss: PRINCIPAL,
          aud: AGENT,
          sub: PRINCIPAL,
          cmd: "/" as never,
          pol: [],
          purpose: "x",
          resource: "r",
          recipient: MERCHANT,
          exp: 1_700_003_600,
          maxUses: 1,
          termsDigest: terms,
        },
        principal.priv
      )
    );
    assert.throws(() =>
      caps.issue(
        null,
        {
          iss: AGENT,
          aud: CHECKOUT,
          sub: PRINCIPAL,
          cmd: "/pay",
          pol: [],
          purpose: "x",
          resource: "r",
          recipient: MERCHANT,
          amountMax: 10,
          currency: "INR",
          exp: 1_700_003_600,
          maxUses: 1,
          termsDigest: terms,
        },
        principal.priv
      )
    );
  });
});
