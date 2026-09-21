import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  Capabilities,
  canonicalize,
  checkP3PReceipt,
  digestForOperation,
  executeViaProvider,
  generateEd25519Keypair,
  grantexScopeAllows,
  leafCidHex,
  makeFakeProviders,
  parseP3PChallenge,
  paymentBounds,
  signBytes,
  toP3PPaymentDemand,
  recipientBounds,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:principal";
const A = "did:test:agent";
const M = "did:test:merchant";
const RESOURCE = "/api/weather";

function challenge(overrides: Record<string, unknown> = {}) {
  return {
    amountPaise: "10000",
    currency: "INR",
    resource: RESOURCE,
    recipient: M,
    expiresAt: NOW + 300,
    paymentMethod: "RESERVE_PAY",
    mandateRef: "mandate-7",
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

describe("p3p adapter as evidence (M5A spike)", () => {
  it("maps a P3P challenge to a bounded /pay demand (paise, identity-free)", () => {
    const parsed = parseP3PChallenge(challenge());
    assert.equal(parsed.amountPaise, "10000");
    assert.equal(parsed.paymentMethod, "RESERVE_PAY");
    const { operation, capabilityArgs } = toP3PPaymentDemand(
      parsed,
      {
        purpose: "weather",
        resource: RESOURCE,
        currency: "INR",
      },
      NOW
    );
    assert.ok(!("principal" in operation));
    assert.ok(!("actor" in operation));
    assert.ok(!("termsDigest" in operation));
    assert.equal(operation.action.name, "/pay");
    assert.deepEqual(operation.resource, {
      type: "p3p-payment",
      id: RESOURCE,
    });
    assert.equal(operation.context["recipient"], M);
    assert.equal(operation.context["amount"], 10000);
    assert.equal(operation.context["currency"], "INR");
    assert.equal(operation.context["paymentMethod"], "RESERVE_PAY");
    assert.equal(operation.context["mandateRef"], "mandate-7");
    assert.deepEqual(capabilityArgs, {
      amount: 10000,
      currency: "INR",
      paymentMethod: "RESERVE_PAY",
    });
  });

  it("rejects malformed challenges before any authority is involved", () => {
    assert.throws(() => parseP3PChallenge(null));
    assert.throws(() => parseP3PChallenge(challenge({ amountPaise: "10.5" })));
    assert.throws(() => parseP3PChallenge(challenge({ amountPaise: "0" })));
    assert.throws(() => parseP3PChallenge(challenge({ recipient: "" })));
    assert.throws(() => parseP3PChallenge(challenge({ paymentMethod: "EMI" })));
    assert.throws(() => parseP3PChallenge(challenge({ resource: "nope" })));
    assert.throws(() => parseP3PChallenge(challenge({ expiresAt: -1 })));
    assert.throws(() => parseP3PChallenge(challenge({ currency: "" })));
  });

  it("grantex scopes are evidence-only: initiate + concrete cap required", () => {
    assert.equal(
      grantexScopeAllows(
        ["mpp:payment:initiate", "mpp:payment:max_txn_paise:50000"],
        10000
      ).ok,
      true
    );
    assert.equal(
      grantexScopeAllows(["mpp:payment:max_txn_paise:50000"], 10000).ok,
      false
    );
    assert.equal(
      grantexScopeAllows(["mpp:payment:initiate"], 10000).ok,
      false
    );
    const over = grantexScopeAllows(
      ["mpp:payment:initiate", "mpp:payment:max_txn_paise:5000"],
      10000
    );
    assert.equal(over.ok, false);
    if (!over.ok) assert.match(over.reason, /exceeds/);
  });

  it("demand mapping fails closed on resource/currency/recipient/method swap", () => {
    const parsed = parseP3PChallenge(challenge());
    assert.throws(() =>
      toP3PPaymentDemand(
        parsed,
        {
          purpose: "weather",
          resource: "/api/other",
          currency: "INR",
        },
        NOW
      )
    );
    assert.throws(() =>
      toP3PPaymentDemand(
        parsed,
        {
          purpose: "weather",
          resource: RESOURCE,
          currency: "USD",
        },
        NOW
      )
    );
    assert.throws(() =>
      toP3PPaymentDemand(
        parsed,
        {
          purpose: "weather",
          resource: RESOURCE,
          currency: "INR",
          expectedRecipient: "did:test:attacker",
        },
        NOW
      )
    );
    assert.throws(() =>
      toP3PPaymentDemand(
        parsed,
        {
          purpose: "weather",
          resource: RESOURCE,
          currency: "INR",
          expectedPaymentMethod: "CARD",
        },
        NOW
      )
    );
  });

  it("checks recorded receipts against opt-in expectations", () => {
    const good = {
      success: true,
      transaction: "pine-debit-1",
      paymentMethod: "RESERVE_PAY",
      amountPaise: "10000",
      currency: "INR",
      idempotencyKey: "idem-1",
    };
    assert.equal(
      checkP3PReceipt(good, {
        amountPaise: "10000",
        currency: "INR",
        paymentMethod: "RESERVE_PAY",
        idempotencyKey: "idem-1",
      }).ok,
      true
    );
    assert.equal(
      checkP3PReceipt({ ...good, success: false }, {}).ok,
      false
    );
    assert.equal(
      checkP3PReceipt({ ...good, transaction: "" }, {}).ok,
      false
    );
    assert.equal(
      checkP3PReceipt(good, { amountPaise: "9999" }).ok,
      false
    );
    assert.equal(
      checkP3PReceipt(good, { paymentMethod: "CARD" }).ok,
      false
    );
    // A receipt that OMITS a set expectation fails: absence proves nothing
    // (same semantics as x402 checkSettlement).
    const { amountPaise: _dropped, ...noAmount } = good;
    void _dropped;
    assert.equal(checkP3PReceipt(noAmount, { amountPaise: "10000" }).ok, false);
    const { idempotencyKey: _droppedIdem, ...noIdem } = good;
    void _droppedIdem;
    assert.equal(
      checkP3PReceipt(noIdem, { idempotencyKey: "idem-1" }).ok,
      false
    );
    // Unset expectations are not checked.
    assert.equal(checkP3PReceipt(good, {}).ok, true);
  });

  it("standing grant -> redeem -> provider execute -> receipt (no secrets leak)", async () => {
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const merchant = generateEd25519Keypair();
    const keys = new Map([
      [P, principal.publicKeyRaw],
      [A, agent.publicKeyRaw],
      [M, merchant.publicKeyRaw],
    ]);
    const parsed = parseP3PChallenge(challenge());
    const { operation } = toP3PPaymentDemand(
      parsed,
      {
        purpose: "weather",
        resource: RESOURCE,
        currency: "INR",
      },
      NOW
    );

    // CHECK: PTF Standing Grant covers the external demand. The Grantex
    // evidence check passes too, but it never substitutes for this grant.
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-p3p",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: [
        ...paymentBounds({ amountMax: 50000, currency: "INR" }),
        ...recipientBounds([M]),
      ],
      exp: NOW + 3600,
      maxUses: 1,
    });
    const ingress = {
      id: A,
      principal: P,
      source: "local-registration" as const,
      proofRef: "p3p-spike",
    };
    const decision = auth.evaluate(operation, ingress, { consume: false });
    assert.equal(decision.allow, true);
    assert.equal(
      grantexScopeAllows(
        ["mpp:payment:initiate", "mpp:payment:max_txn_paise:50000"],
        10000
      ).ok,
      true
    );

    // A swapped recipient denies at the grant gate, not in the adapter.
    const swapped = toP3PPaymentDemand(
      parseP3PChallenge(challenge({ recipient: "did:test:attacker" })),
      {
        purpose: "weather",
        resource: RESOURCE,
        currency: "INR",
      },
      NOW
    );
    const denied = auth.evaluate(swapped.operation, ingress, {
      consume: false,
    });
    assert.equal(denied.allow, false);

    // REDEEM + EXECUTE: capability-bound provider call with the exact
    // authorized terms (amount/currency/paymentMethod travel; secrets never
    // do — the live SDK wiring stays host-side behind this seam).
    const digest = digestForOperation({
      principal: P,
      actor: A,
      action: { name: "/pay" as const },
      resource: { type: "p3p-payment", id: RESOURCE },
      context: {
        amount: 10000,
        currency: "INR",
        recipient: M,
        paymentMethod: "RESERVE_PAY",
        mandateRef: "mandate-7",
        idempotencyKey: "idem-1",
      },
      purpose: "weather",
    });
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const cap = caps.issue(
      null,
      {
        iss: P,
        aud: A,
        sub: P,
        cmd: "/pay",
        pol: [["<=", ".amount", 50000]],
        purpose: "weather",
        resource: RESOURCE,
        recipient: M,
        amountMax: 50000,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      principal.privateKey
    );
    const cid = leafCidHex(cap);
    const redeemed = caps.redeem(
      [cap],
      {
        cmd: "/pay",
        args: {
          amount: 10000,
          currency: "INR",
          paymentMethod: "RESERVE_PAY",
          mandateRef: "mandate-7",
          idempotencyKey: "idem-1",
        },
        recipient: M,
        resource: RESOURCE,
        purpose: "weather",
        termsDigest: digest,
      },
      {
        proof: {
          key: merchant.publicKeyRaw,
          sig: signBytes(
            merchant.privateKey,
            new Uint8Array(Buffer.from(cid, "hex"))
          ),
        },
      }
    );
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("redeem must succeed");

    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const receipt = await executeViaProvider(
      fakes.payment,
      {
        capabilityId: cid,
        termsDigest: digest,
        action: "/pay",
        recipient: M,
        resource: RESOURCE,
        purpose: "weather",
        context: {
          amount: 10000,
          currency: "INR",
          paymentMethod: "RESERVE_PAY",
          mandateRef: "mandate-7",
          idempotencyKey: "idem-1",
        },
      },
      redeemed,
      NOW
    );
    assert.ok(receipt.transaction.startsWith("fake-payment-"));

    // Recorded external receipt verifies; nothing secret-bearing enters the
    // PTF receipt or logs (grant tokens / client secrets stay host-held).
    const external = {
      success: true,
      transaction: "pine-debit-1",
      paymentMethod: "RESERVE_PAY",
      amountPaise: "10000",
      currency: "INR",
      idempotencyKey: "idem-1",
      mandateRef: "mandate-7",
    };
    assert.equal(
      checkP3PReceipt(external, {
        amountPaise: "10000",
        currency: "INR",
        paymentMethod: "RESERVE_PAY",
        idempotencyKey: "idem-1",
      }).ok,
      true
    );
    const blob = canonicalize({
      receipt,
      external: { ...external, transaction: receipt.transaction },
    });
    for (const secret of [
      "PINELABS_CLIENT_SECRET",
      "grantToken",
      "P3P-Credential",
    ]) {
      assert.ok(!blob.includes(secret));
    }
  });
});

const SENTINELS = [
  "sk-pinelabs-CANARY-9f2c",
  "grantex-grant-CANARY-51ad",
  "4111111111111111",
  "upi-pin-CANARY-77e0",
  "otp-one-time-CANARY-b3c9",
];

function grantAuth(now: number = NOW) {
  const auth = new Authority({ nowSec: () => now });
  auth.addGrant({
    id: "g-p3p",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/pay" },
    bounds: [
      ...paymentBounds({ amountMax: 50000, currency: "INR" }),
      ...recipientBounds([M]),
    ],
    exp: NOW + 3600,
    maxUses: 1,
  });
  return auth;
}

function p3pIngress() {
  return {
    id: A,
    principal: P,
    source: "local-registration" as const,
    proofRef: "p3p-denial",
  };
}

function p3pOp(overrides: Record<string, unknown> = {}) {
  const parsed = parseP3PChallenge(challenge(overrides));
  return toP3PPaymentDemand(
    parsed,
    { purpose: "weather", resource: RESOURCE, currency: "INR" },
    NOW
  ).operation;
}

describe("p3p denial matrix + secret boundary (prod)", () => {
  it("expired challenges fail closed at mapping time", () => {
    const parsed = parseP3PChallenge(challenge({ expiresAt: NOW - 61 }));
    assert.throws(() =>
      toP3PPaymentDemand(
        parsed,
        { purpose: "weather", resource: RESOURCE, currency: "INR" },
        NOW
      )
    );
    // Inside skew still maps; outside skew never reaches authority.
    const edge = parseP3PChallenge(challenge({ expiresAt: NOW - 60 }));
    assert.ok(
      toP3PPaymentDemand(
        edge,
        { purpose: "weather", resource: RESOURCE, currency: "INR" },
        NOW
      ).operation
    );
    assert.throws(() =>
      toP3PPaymentDemand(
        parseP3PChallenge(challenge()),
        { purpose: "weather", resource: RESOURCE, currency: "INR" },
        -1
      )
    );
  });

  it("amount over grant, expired grant, wrong agent, revoked grant all deny", () => {
    const auth = grantAuth();
    const ingress = p3pIngress();
    assert.equal(auth.evaluate(p3pOp(), ingress).allow, true);
    assert.equal(
      auth.evaluate(p3pOp({ amountPaise: "60000" }), ingress).allow,
      false
    );
    const stale = grantAuth(NOW + 7200);
    assert.equal(stale.evaluate(p3pOp(), ingress).allow, false);
    assert.equal(
      auth.evaluate(p3pOp(), { ...ingress, id: "did:test:attacker" }).allow,
      false
    );
    auth.revoke("g-p3p", NOW);
    assert.equal(auth.evaluate(p3pOp(), ingress).allow, false);
  });

  it("terms mutated after CHECK deny; CHECK output can never execute", async () => {
    const auth = grantAuth();
    const ingress = p3pIngress();
    const op = p3pOp();
    assert.equal(auth.evaluate(op, ingress).allow, true);
    assert.equal(
      auth.evaluate(
        {
          ...op,
          context: { ...(op.context as Record<string, unknown>), amount: 20000 },
        },
        ingress
      ).allow,
      true
    );
    assert.equal(
      auth.evaluate(
        {
          ...op,
          context: { ...(op.context as Record<string, unknown>), amount: 60000 },
        },
        ingress
      ).allow,
      false
    );

    // CHECK output (no chainId, no consumed/proofVerified flags) is rejected
    // by every execute path at runtime, not just by types.
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const merchant = generateEd25519Keypair();
    const keys = new Map([
      [P, principal.publicKeyRaw],
      [A, agent.publicKeyRaw],
      [M, merchant.publicKeyRaw],
    ]);
    const digest = digestForOperation({
      principal: P,
      actor: A,
      action: { name: "/pay" as const },
      resource: { type: "p3p-payment", id: RESOURCE },
      context: {
        amount: 10000,
        currency: "INR",
        recipient: M,
        paymentMethod: "RESERVE_PAY",
      },
      purpose: "weather",
    });
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const cap = caps.issue(
      null,
      {
        iss: P,
        aud: A,
        sub: P,
        cmd: "/pay",
        pol: [],
        purpose: "weather",
        resource: RESOURCE,
        recipient: M,
        amountMax: 50000,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      principal.privateKey
    );
    const demand = {
      cmd: "/pay" as const,
      args: {
        amount: 10000,
        currency: "INR",
        recipient: M,
        paymentMethod: "RESERVE_PAY",
      },
      recipient: M,
      resource: RESOURCE,
      purpose: "weather",
      termsDigest: digest,
    };
    const checked = caps.check([cap], demand);
    assert.equal(checked.ok, true);
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    await assert.rejects(
      () =>
        executeViaProvider(
          fakes.payment,
          {
            capabilityId: "cid-check-misuse",
            termsDigest: digest,
            action: "/pay",
            recipient: M,
            resource: RESOURCE,
            purpose: "weather",
            context: {
              amount: 10000,
              currency: "INR",
              recipient: M,
              paymentMethod: "RESERVE_PAY",
            },
          },
          // A dry-run check result is not a Redemption: no chainId, no
          // consumed/proofVerified flags. The seam must reject it.
          checked as never,
          NOW
        ),
      /redemption|unbound|dry-run|consumed|proof/i
    );
  });

  it("replayed credential (second redeem of a one-time cap) denies", () => {
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const merchant = generateEd25519Keypair();
    const keys = new Map([
      [P, principal.publicKeyRaw],
      [A, agent.publicKeyRaw],
      [M, merchant.publicKeyRaw],
    ]);
    const digest = digestForOperation({
      principal: P,
      actor: A,
      action: { name: "/pay" as const },
      resource: { type: "p3p-payment", id: RESOURCE },
      context: { amount: 10000, currency: "INR", recipient: M },
      purpose: "weather",
    });
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const cap = caps.issue(
      null,
      {
        iss: P,
        aud: A,
        sub: P,
        cmd: "/pay",
        pol: [],
        purpose: "weather",
        resource: RESOURCE,
        recipient: M,
        amountMax: 50000,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      principal.privateKey
    );
    const cidBytes = new Uint8Array(
      Buffer.from(leafCidHex(cap), "hex")
    );
    const proof = {
      key: merchant.publicKeyRaw,
      sig: signBytes(merchant.privateKey, cidBytes),
    };
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 10000, currency: "INR", recipient: M },
      recipient: M,
      resource: RESOURCE,
      purpose: "weather",
      termsDigest: digest,
    };
    const first = caps.redeem([cap], demand, { proof });
    assert.equal(first.ok, true);
    // Same credential replayed: the use is burned, never re-executed.
    const second = caps.redeem([cap], demand, { proof });
    assert.equal(second.ok, false);
  });

  it("tampered challenge amount denies at the grant ceiling", () => {
    const auth = grantAuth();
    const parsed = parseP3PChallenge(challenge());
    const tampered = { ...parsed, amountPaise: "90000" };
    const { operation } = toP3PPaymentDemand(
      tampered,
      { purpose: "weather", resource: RESOURCE, currency: "INR" },
      NOW
    );
    assert.equal(auth.evaluate(operation, p3pIngress()).allow, false);
  });

  it("provider receipt inconsistent with authorized terms fails verification", () => {
    const expected = {
      amountPaise: "10000",
      currency: "INR",
      paymentMethod: "RESERVE_PAY",
      idempotencyKey: "idem-1",
    };
    const base = {
      success: true,
      transaction: "pine-debit-1",
      ...expected,
    };
    assert.equal(checkP3PReceipt(base, expected).ok, true);
    assert.equal(
      checkP3PReceipt({ ...base, amountPaise: "10001" }, expected).ok,
      false
    );
    assert.equal(
      checkP3PReceipt({ ...base, currency: "USD" }, expected).ok,
      false
    );
    assert.equal(
      checkP3PReceipt({ ...base, idempotencyKey: "idem-2" }, expected).ok,
      false
    );
    assert.equal(
      checkP3PReceipt(
        { ...base, success: false, errorReason: "FAILED" },
        expected
      ).ok,
      false
    );
  });

  it("secret canaries never cross the adapter boundary", () => {
    // Host-supplied secrets smuggled into the decoded challenge object must
    // not propagate: unknown fields are ignored, never folded into context.
    const parsed = parseP3PChallenge({
      ...challenge(),
      clientSecret: SENTINELS[0],
      grantToken: SENTINELS[1],
      pan: SENTINELS[2],
      upiPin: SENTINELS[3],
    });
    const { operation, capabilityArgs } = toP3PPaymentDemand(
      parsed,
      { purpose: "weather", resource: RESOURCE, currency: "INR" },
      NOW
    );
    const blob = canonicalize({ operation, capabilityArgs });
    for (const s of SENTINELS) {
      assert.ok(!blob.includes(s), `canary leaked into demand: ${s}`);
    }
    // Failure paths must not echo secrets either.
    try {
      toP3PPaymentDemand(
        parsed,
        { purpose: "weather", resource: "/api/other", currency: "INR" },
        NOW
      );
      assert.fail("resource mismatch must throw");
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      for (const s of SENTINELS) {
        assert.ok(!text.includes(s), `canary leaked into error: ${s}`);
      }
    }
    // The evidence helper answers ok:false (never throws); its fixed
    // reason strings carry no caller data by construction.
    const scoped = grantexScopeAllows(["mpp:payment:initiate"], 10000);
    assert.equal(scoped.ok, false);
    if (!scoped.ok) {
      for (const s of SENTINELS) {
        assert.ok(!scoped.reason.includes(s));
      }
    }
  });
});
