import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  Capabilities,
  Disclose,
  digestForOperation,
  generateEd25519Keypair,
  leafCidHex,
  parsePaymentRequired,
  paymentBounds,
  signBytes,
  termsDigestOf,
  toX402PaymentDemand,
} from "../../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:p";
const A = "did:test:a";
const M = "did:test:m";
const X = "did:test:x";

function kit() {
  const mk = () => generateEd25519Keypair();
  const p = mk();
  const a = mk();
  const m = mk();
  const x = mk();
  const keys = new Map([
    [P, p.publicKeyRaw],
    [A, a.publicKeyRaw],
    [M, m.publicKeyRaw],
    [X, x.publicKeyRaw],
  ]);
  return { p, a, m, x, keys };
}

function payCap(
  caps: Capabilities,
  priv: import("node:crypto").KeyObject,
  digest: string,
  exp: number,
  uses = 1
) {
  return caps.issue(
    null,
    {
      iss: P,
      aud: A,
      sub: P,
      cmd: "/pay",
      pol: [["<=", ".amount", 100]],
      purpose: "p",
      resource: "r",
      recipient: M,
      amountMax: 100,
      currency: "INR",
      exp,
      maxUses: uses,
      termsDigest: digest,
    },
    priv
  );
}

describe("golden attack transcripts (ptf-v01/05)", () => {
  it("replay of a consumed capability is denied", () => {
    const k = kit();
    const caps = new Capabilities({
      resolveKey: (id) => k.keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const digest = termsDigestOf({ i: "replay" });
    const cap = payCap(caps, k.p.privateKey, digest, NOW + 300);
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 10, currency: "INR" },
      recipient: M,
      termsDigest: digest,
    };
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const proof = {
      key: k.m.publicKeyRaw,
      sig: signBytes(k.m.privateKey, cidBytes),
    };
    assert.equal(
      caps.authorize([cap], demand, { consume: true, proof }).ok,
      true
    );
    const replay = caps.authorize([cap], demand, { consume: true, proof });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "uses-exhausted");
  });

  it("over-spend beyond the grant ceiling is denied", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 100, currency: "INR" }),
    });
    const operation = {
      principal: P,
      actor: A,
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "r" },
      context: { amount: 5000, currency: "INR", recipient: M },
      purpose: "p",
    };
    const d = auth.evaluate({
      ...operation,
      termsDigest: digestForOperation(operation),
    });
    assert.equal(d.allow, false);
  });

  it("expired approvals and wrong-recipient redemptions are denied", () => {
    const k = kit();
    const auth = new Authority({ nowSec: () => NOW });
    const oldOp = {
      principal: P,
      actor: A,
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "r" },
      context: { amount: 10, currency: "INR", recipient: M },
      purpose: "p",
    };
    auth.addApproval({
      id: "old",
      ...oldOp,
      termsDigest: digestForOperation(oldOp),
      exp: NOW - 500,
      maxUses: 1,
    });
    const expired = auth.evaluate({
      ...oldOp,
      termsDigest: digestForOperation(oldOp),
    });
    assert.equal(expired.allow, false);

    const caps = new Capabilities({
      resolveKey: (id) => k.keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const digest = termsDigestOf({ i: "wrong-recipient" });
    const cap = payCap(caps, k.p.privateKey, digest, NOW + 300);
    const bad = caps.authorize(
      [cap],
      {
        cmd: "/pay",
        args: { amount: 10, currency: "INR" },
        recipient: X,
        termsDigest: digest,
      },
      { consume: false }
    );
    assert.equal(bad.ok, false);
    void signBytes;
    void k;
  });

  it("mutated terms fail at the authority gate", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const approval = auth.createApproval({
      id: "a1",
      principal: P,
      actor: A,
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "r" },
      context: { amount: 10, currency: "INR", recipient: M },
      purpose: "p",
      ttlSec: 300,
    });
    const mutatedOp = {
      principal: P,
      actor: A,
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "r" },
      context: { amount: 11, currency: "INR", recipient: M },
      purpose: "p",
    };
    const mutated = auth.evaluate({
      ...mutatedOp,
      termsDigest: digestForOperation(mutatedOp),
    });
    assert.equal(mutated.allow, false);
    if (!mutated.allow) assert.equal(mutated.reason, "terms");
    void approval;
  });

  it("verifier over-request and x402 payTo-swap both fail closed", () => {
    const k = kit();
    const pres = Disclose.present(
      {
        issuer: "did:test:iss",
        subject: P,
        claims: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 },
        cnf: P,
      },
      {
        verifier: M,
        nonce: "n",
        requested: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      },
      { recipient: M, allowed: ["a", "b"] },
      { id: P, privateKey: k.p.privateKey },
      NOW
    );
    assert.equal(pres.disclosures.length, 2);

    const header = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        resource: { url: "https://x.example/r" },
        accepts: [
          {
            scheme: "exact",
            network: "eip155:84532",
            amount: "50",
            asset: "0xT",
            payTo: X,
            maxTimeoutSeconds: 60,
          },
        ],
      }),
      "utf8"
    ).toString("base64");
    const parsed = parsePaymentRequired(header);
    const entry = parsed.accepts[0];
    assert.ok(entry);
    const { demand } = toX402PaymentDemand(entry, {
      principal: P,
      agent: A,
      purpose: "p",
      resource: "r",
      currency: "USDC",
    });
    assert.equal(demand.context["recipient"], X);
    assert.notEqual(demand.context["recipient"], M);

    const caps = new Capabilities({
      resolveKey: (id) => k.keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const digest = termsDigestOf({ swap: 1 });
    const cap = caps.issue(
      null,
      {
        iss: P,
        aud: A,
        sub: P,
        cmd: "/pay",
        pol: [["<=", ".amount", 50]],
        purpose: "p",
        resource: "r",
        recipient: M,
        amountMax: 50,
        currency: "USDC",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      k.p.privateKey
    );
    const swapped = caps.authorize(
      [cap],
      {
        cmd: "/pay",
        args: { amount: demand.context["amount"], currency: "USDC" },
        recipient: demand.context["recipient"] as string,
        termsDigest: digest,
      },
      { consume: false }
    );
    assert.equal(swapped.ok, false);
    if (!swapped.ok) assert.equal(swapped.reason, "recipient");
  });
});
