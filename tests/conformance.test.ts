/**
 * PTF Normative Conformance Suite (M6).
 *
 * Extracted from the 297-test public-seam suite. Each test verifies one or
 * more MUST/SHOULD obligations from docs/spec/. Tests are self-contained:
 * they import only from src/index.ts (the public seam).
 *
 * Non-normative behaviors (performance, ergonomics, CLI UX) are NOT tested
 * here — they belong in the existing test suite.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { KeyObject } from "node:crypto";
import {
  Authority,
  Capabilities,
  Disclose,
  MapUseLedger,
  canonicalize,
  executeAndReceipt,
  FakePaymentExecutor,
  generateEd25519Keypair,
  leafCidHex,
  paymentBounds,
  sha256Hex,
  signBytes,
  termsDigestOf,
  toX402PaymentDemand,
} from "../src/index.js";
import type {
  AuthorityOperation,
  VerifiedIdentity,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:conformance-principal";
const AGENT = "did:test:conformance-agent";
const OTHER = "did:test:conformance-other";
const MERCHANT = "did:test:conformance-merchant";

function ingress(id = AGENT): VerifiedIdentity {
  return {
    id,
    principal: P,
    source: "local-registration",
    proofRef: "conformance-test",
  };
}

function op(amount = 1790): AuthorityOperation {
  return {
    action: { name: "/pay" },
    resource: { type: "invoice", id: "invoice:inv_8472" },
    context: { amount, currency: "INR", recipient: MERCHANT },
    purpose: "pay invoice",
  };
}

/* ──────────────────────────── AUTHORITY ──────────────────────────── */

describe("CONFORMANCE: Authority engine (authority.md)", () => {
  it("eval: standing grant with matching bounds allows", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-allow",
      principal: P,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
    });
    const r = auth.evaluate(op(), ingress());
    assert.equal(r.allow, true);
  });

  it("eval: no covering authority denies with reason no-authority", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const r = auth.evaluate(op(), ingress());
    assert.equal(r.allow, false);
    if (!r.allow) assert.equal(r.reason, "no-authority");
  });

  it("eval: expired grant denies (beyond clock skew)", () => {
    const auth = new Authority({ nowSec: () => NOW });
    // CLOCK_SKEW_SEC = 60, so exp must be >60s in the past
    auth.addGrant({
      id: "g-expired",
      principal: P,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW - 120,
    });
    const r = auth.evaluate(op(), ingress());
    assert.equal(r.allow, false);
  });

  it("eval: wrong actor denies", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-wrong-actor",
      principal: P,
      actor: { kind: "exact", id: OTHER },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
    });
    const r = auth.evaluate(op(), ingress());
    assert.equal(r.allow, false);
  });

  it("eval: amount exceeds grant ceiling denies", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-low-ceiling",
      principal: P,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 1000, currency: "INR" }),
      exp: NOW + 3600,
    });
    const r = auth.evaluate(op(1790), ingress());
    assert.equal(r.allow, false);
  });

  it("eval: policy narrowing — grant allows but policy forbids", () => {
    const auth = new Authority({ nowSec: () => NOW });
    // Grant allows up to 2000
    auth.addGrant({
      id: "g-policy-test",
      principal: P,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
    });
    // Policy restricts to max 500 — conflicts with demand of 600
    auth.addPolicy({
      id: "p-max-500",
      bounds: [{ path: ".context.amount", op: "<=", value: 500 }],
    });
    const r = auth.evaluate(op(600), ingress());
    assert.equal(r.allow, false);
    if (!r.allow) assert.equal(r.reason, "forbidden");
  });

  it("eval: prototype-pollution path throws (fail-closed)", () => {
    const auth = new Authority({ nowSec: () => NOW });
    assert.throws(() => {
      auth.evaluate(
        {
          action: { name: "/pay" },
          resource: { type: "x", id: "y" },
          context: { __proto__: { polluted: true } },
          purpose: "test",
        } as AuthorityOperation,
        ingress()
      );
    });
  });

  it("eval: revoked grant denies", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-revocable",
      principal: P,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
    });
    auth.revoke("g-revocable");
    const r = auth.evaluate(op(), ingress());
    assert.equal(r.allow, false);
  });

  it("eval: duplicate authority id throws", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-dup",
      principal: P,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
    });
    assert.throws(() => {
      auth.addGrant({
        id: "g-dup",
        principal: P,
        actor: { kind: "exact", id: AGENT },
        action: { name: "/pay" },
        bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
        exp: NOW + 3600,
      });
    });
  });
});

/* ──────────────────────────── CAPABILITY ──────────────────────────── */

describe("CONFORMANCE: Capability system (capability.md)", () => {
  interface Kit {
    caps: Capabilities;
    priv: Map<string, KeyObject>;
    pub: Map<string, Uint8Array>;
  }

  function kit(): Kit {
    const pub = new Map<string, Uint8Array>();
    const priv = new Map<string, KeyObject>();
    const add = (id: string) => {
      const kp = generateEd25519Keypair();
      pub.set(id, kp.publicKeyRaw);
      priv.set(id, kp.privateKey);
    };
    add(P);
    add(AGENT);
    add(OTHER);
    add(MERCHANT);
    const caps = new Capabilities({
      resolveKey: (id) => pub.get(id) ?? null,
      nowSec: () => NOW,
    });
    return { caps, priv, pub };
  }

  function demand(digest: string, amount = 1790) {
    return {
      cmd: "/pay" as const,
      args: { amount, currency: "INR", recipient: MERCHANT },
      recipient: MERCHANT,
      resource: "r",
      purpose: "p",
      termsDigest: digest,
    };
  }

  it("cap: issue → check succeeds with valid terms", () => {
    const k = kit();
    const digest = termsDigestOf({ i: "cap-check" });
    const cap = k.caps.issue(null, {
      iss: P, aud: AGENT, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "p", resource: "r", recipient: MERCHANT,
      amountMax: 2000, currency: "INR", exp: NOW + 300, maxUses: 1,
      termsDigest: digest,
    }, k.priv.get(P)!);
    const check = k.caps.check([cap], demand(digest));
    assert.equal(check.ok, true);
  });

  it("cap: consumed capability check returns ok:false", () => {
    const k = kit();
    const digest = termsDigestOf({ i: "cap-consumed" });
    const cap = k.caps.issue(null, {
      iss: P, aud: AGENT, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "p", resource: "r", recipient: MERCHANT,
      amountMax: 2000, currency: "INR", exp: NOW + 300, maxUses: 1,
      termsDigest: digest,
    }, k.priv.get(P)!);
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const proof = {
      key: k.pub.get(MERCHANT)!,
      sig: signBytes(k.priv.get(MERCHANT)!, cidBytes),
    };
    const redeemed = k.caps.redeem([cap], demand(digest), { proof });
    assert.equal(redeemed.ok, true);
    const check = k.caps.check([cap], demand(digest));
    assert.equal(check.ok, false);
  });

  it("cap: attenuated child respects child<=parent narrowing", () => {
    const k = kit();
    const digest = termsDigestOf({ i: "cap-attenuate" });
    const root = k.caps.issue(null, {
      iss: P, aud: AGENT, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "p", resource: "r", recipient: MERCHANT,
      amountMax: 2000, currency: "INR", exp: NOW + 3600, maxUses: 5,
      termsDigest: digest,
    }, k.priv.get(P)!);
    const child = k.caps.issue([root], {
      iss: AGENT, aud: OTHER, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 1000]],
      purpose: "p", resource: "r", recipient: MERCHANT,
      amountMax: 1000, currency: "INR", exp: NOW + 1800, maxUses: 2,
      termsDigest: digest,
    }, k.priv.get(AGENT)!);
    const check = k.caps.check([root, child], demand(digest, 900));
    assert.equal(check.ok, true);
  });

  it("cap: child amount exceeding parent is rejected", () => {
    const k = kit();
    const digest = termsDigestOf({ i: "cap-exceed" });
    const root = k.caps.issue(null, {
      iss: P, aud: AGENT, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 1000]],
      purpose: "p", resource: "r", recipient: MERCHANT,
      amountMax: 1000, currency: "INR", exp: NOW + 3600, maxUses: 5,
      termsDigest: digest,
    }, k.priv.get(P)!);
    assert.throws(() => {
      k.caps.issue([root], {
        iss: AGENT, aud: OTHER, sub: P, cmd: "/pay",
        pol: [["<=", ".amount", 2000]],
        purpose: "p", resource: "r", recipient: MERCHANT,
        amountMax: 2000, currency: "INR", exp: NOW + 3600, maxUses: 5,
        termsDigest: digest,
      }, k.priv.get(AGENT)!);
    });
  });

  it("cap: invalid signature is rejected", () => {
    const k = kit();
    const digest = termsDigestOf({ i: "cap-badsig" });
    const cap = k.caps.issue(null, {
      iss: P, aud: AGENT, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "p", resource: "r", recipient: MERCHANT,
      amountMax: 2000, currency: "INR", exp: NOW + 300, maxUses: 1,
      termsDigest: digest,
    }, k.priv.get(P)!);
    const tampered = { ...cap, sig: new Uint8Array(64) };
    const check = k.caps.check([tampered], demand(digest));
    assert.equal(check.ok, false);
  });

  it("cap: expired capability is rejected (beyond clock skew)", () => {
    const k = kit();
    const digest = termsDigestOf({ i: "cap-expired" });
    // CLOCK_SKEW_SEC = 60, so exp must be >60s in the past
    const cap = k.caps.issue(null, {
      iss: P, aud: AGENT, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "p", resource: "r", recipient: MERCHANT,
      amountMax: 2000, currency: "INR", exp: NOW - 120, maxUses: 1,
      termsDigest: digest,
    }, k.priv.get(P)!);
    const check = k.caps.check([cap], demand(digest));
    assert.equal(check.ok, false);
  });
});

/* ──────────────────────────── DISCLOSURE ──────────────────────────── */

describe("CONFORMANCE: Selective disclosure (disclosure.md)", () => {
  it("disclose: exactly requested intersect available intersect allowed", () => {
    const holder = generateEd25519Keypair();
    const cred = {
      issuer: "did:test:ca",
      subject: "did:test:holder",
      claims: {
        name: "Alice",
        age: 30,
        email: "alice@example.com",
        ssn: "123-45-6789",
      },
      cnf: "did:test:holder",
    };
    const pres = Disclose.present(
      cred,
      {
        verifier: "did:test:verifier",
        nonce: "n-conformance-1",
        requested: ["name", "email", "ssn"],
      },
      { recipient: "did:test:verifier", allowed: ["name", "email"] },
      { id: "did:test:holder", privateKey: holder.privateKey },
      NOW
    );
    const names = pres.disclosures.map((d) => d.name).sort();
    assert.deepEqual(names, ["email", "name"]);
    const blob = canonicalize(pres);
    assert.ok(!blob.includes("123-45-6789"));
  });

  it("disclose: bearer presentation (empty sig) is rejected", () => {
    const holder = generateEd25519Keypair();
    const cred = {
      issuer: "did:test:ca",
      subject: "did:test:holder",
      claims: { name: "Alice" },
      cnf: "did:test:holder",
    };
    const pres = Disclose.present(
      cred,
      { verifier: "did:test:v", nonce: "n-2", requested: ["name"] },
      { recipient: "did:test:v", allowed: ["name"] },
      { id: "did:test:holder", privateKey: holder.privateKey },
      NOW
    );
    const bearer = { ...pres, sig: new Uint8Array(0) };
    const result = Disclose.verify(bearer, {
      holderKey: holder.publicKeyRaw,
      expectedAud: "did:test:v",
      nowSec: NOW,
    });
    assert.equal(result.ok, false);
  });

  it("disclose: wrong-key signature is rejected", () => {
    const holder = generateEd25519Keypair();
    const wrong = generateEd25519Keypair();
    const cred = {
      issuer: "did:test:ca",
      subject: "did:test:holder",
      claims: { name: "Alice" },
      cnf: "did:test:holder",
    };
    const pres = Disclose.present(
      cred,
      { verifier: "did:test:v", nonce: "n-3", requested: ["name"] },
      { recipient: "did:test:v", allowed: ["name"] },
      { id: "did:test:holder", privateKey: holder.privateKey },
      NOW
    );
    const result = Disclose.verify(pres, {
      holderKey: wrong.publicKeyRaw,
      expectedAud: "did:test:v",
      nowSec: NOW,
    });
    assert.equal(result.ok, false);
  });

  it("disclose: stale presentation (past iat+maxAge) is rejected", () => {
    const holder = generateEd25519Keypair();
    const cred = {
      issuer: "did:test:ca",
      subject: "did:test:holder",
      claims: { name: "Alice" },
      cnf: "did:test:holder",
    };
    const pres = Disclose.present(
      cred,
      { verifier: "did:test:v", nonce: "n-4", requested: ["name"] },
      { recipient: "did:test:v", allowed: ["name"] },
      { id: "did:test:holder", privateKey: holder.privateKey },
      NOW
    );
    const result = Disclose.verify(pres, {
      holderKey: holder.publicKeyRaw,
      expectedAud: "did:test:v",
      nowSec: NOW + 600,
    });
    assert.equal(result.ok, false);
  });
});

/* ──────────────────────────── EXECUTION ──────────────────────────── */

describe("CONFORMANCE: Execution engine (execution.md)", () => {
  it("exec: CHECK != REDEEM — check does not consume uses", () => {
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const merchant = generateEd25519Keypair();
    const keys = new Map([
      [P, principal.publicKeyRaw],
      [AGENT, agent.publicKeyRaw],
      [MERCHANT, merchant.publicKeyRaw],
    ]);
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const digest = termsDigestOf({ i: "exec-check" });
    const cap = caps.issue(null, {
      iss: P, aud: AGENT, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "p", resource: "r", recipient: MERCHANT,
      amountMax: 2000, currency: "INR", exp: NOW + 300, maxUses: 1,
      termsDigest: digest,
    }, principal.privateKey);
    const check = caps.check([cap], {
      cmd: "/pay", args: { amount: 1790, currency: "INR" },
      recipient: MERCHANT, resource: "r", purpose: "p", termsDigest: digest,
    });
    assert.equal(check.ok, true);
    // Second CHECK still passes (no consumption)
    const check2 = caps.check([cap], {
      cmd: "/pay", args: { amount: 1790, currency: "INR" },
      recipient: MERCHANT, resource: "r", purpose: "p", termsDigest: digest,
    });
    assert.equal(check2.ok, true);
  });

  it("exec: full flow — issue → approve → redeem → executeAndReceipt", async () => {
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const merchant = generateEd25519Keypair();
    const keys = new Map([
      [P, principal.publicKeyRaw],
      [AGENT, agent.publicKeyRaw],
      [MERCHANT, merchant.publicKeyRaw],
    ]);
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const digest = termsDigestOf({ i: "exec-flow" });
    const cap = caps.issue(null, {
      iss: P, aud: AGENT, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "p", resource: "invoice:inv_8472", recipient: MERCHANT,
      amountMax: 2000, currency: "INR", exp: NOW + 300, maxUses: 1,
      termsDigest: digest,
    }, principal.privateKey);
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const proof = {
      key: merchant.publicKeyRaw,
      sig: signBytes(merchant.privateKey, cidBytes),
    };
    const redeemed = caps.redeem([cap], {
      cmd: "/pay", args: { amount: 1790, currency: "INR" },
      recipient: MERCHANT, resource: "invoice:inv_8472",
      purpose: "p", termsDigest: digest,
    }, { proof });
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("redeem must succeed");

    const executor = new FakePaymentExecutor();
      const receipt = await executeAndReceipt(
      executor,
      {
        capabilityId: leafCidHex(cap),
        recipient: MERCHANT,
        amount: 1790,
        currency: "INR",
        resource: "invoice:inv_8472",
        purpose: "p",
        termsDigest: digest,
      },
      redeemed,
      NOW
    );
    assert.equal(receipt.amount, 1790);
    assert.equal(receipt.currency, "INR");
    assert.equal(receipt.recipient, MERCHANT);
  });

  it("exec: receipt does not leak secrets from executor", async () => {
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const merchant = generateEd25519Keypair();
    const keys = new Map([
      [P, principal.publicKeyRaw],
      [AGENT, agent.publicKeyRaw],
      [MERCHANT, merchant.publicKeyRaw],
    ]);
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const digest = termsDigestOf({ i: "exec-nosecret" });
    const cap = caps.issue(null, {
      iss: P, aud: AGENT, sub: P, cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "p", resource: "r", recipient: MERCHANT,
      amountMax: 2000, currency: "INR", exp: NOW + 300, maxUses: 1,
      termsDigest: digest,
    }, principal.privateKey);
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const proof = {
      key: merchant.publicKeyRaw,
      sig: signBytes(merchant.privateKey, cidBytes),
    };
    const redeemed = caps.redeem([cap], {
      cmd: "/pay", args: { amount: 1790, currency: "INR" },
      recipient: MERCHANT, resource: "r",
      purpose: "p", termsDigest: digest,
    }, { proof });
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("redeem must succeed");

    const executor = new FakePaymentExecutor();
    const receipt = await executeAndReceipt(
      executor,
      {
        capabilityId: leafCidHex(cap),
        recipient: MERCHANT,
        amount: 1790,
        currency: "INR",
        resource: "r",
        purpose: "p",
        termsDigest: digest,
      },
      redeemed,
      NOW
    );
    const blob = canonicalize(receipt);
    assert.ok(!blob.includes("SECRET"));
  });
});

/* ──────────────────────────── ADAPTERS ──────────────────────────── */

describe("CONFORMANCE: Adapter invariants (adapters.md)", () => {
  const X402_ACCEPT = {
    scheme: "stablecoin-usdc",
    network: "base",
    amount: "1000",
    asset: "USDC",
    payTo: "0xabc",
    maxTimeoutSeconds: 60,
  };

  it("adapter: x402 parse → translate → operation is identity-free", () => {
    const demand = toX402PaymentDemand(X402_ACCEPT, {
      purpose: "test pay",
      resource: "x402:test",
      currency: "USDC",
    });
    assert.equal(demand.operation.action.name, "/pay");
    assert.ok(!("actor" in demand.operation));
    assert.ok(!("principal" in demand.operation));
  });

  it("adapter: adapter does not create authority", () => {
    const auth = new Authority({ nowSec: () => NOW });
    // No grants added — evaluate should deny
    const demand = toX402PaymentDemand(X402_ACCEPT, {
      purpose: "test pay",
      resource: "x402:test",
      currency: "USDC",
    });
    const r = auth.evaluate(demand.operation, ingress());
    assert.equal(r.allow, false);
  });
});

/* ──────────────────────────── DIGEST VECTORS ──────────────────────────── */

describe("CONFORMANCE: Digest derivation (authority.md §3)", () => {
  it("digest: canonicalize pins key ordering", () => {
    assert.equal(canonicalize({ b: "x", a: 1 }), '{"a":1,"b":"x"}');
  });

  it("digest: termsDigestOf is deterministic", () => {
    const d1 = termsDigestOf({ b: "x", a: 1 });
    const d2 = termsDigestOf({ b: "x", a: 1 });
    assert.equal(d1, d2);
    assert.equal(
      d1,
      "ecf9e98ec0641e23113ff3ce8bdc78d0ddd249886517fd4a7f68cc83d4e65667"
    );
  });

  it("digest: sha256Hex pins hash", () => {
    assert.equal(
      sha256Hex(canonicalize({ a: 1 })),
      "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"
    );
  });
});
