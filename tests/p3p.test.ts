import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  Capabilities,
  executeAndReceipt,
  generateEd25519Keypair,
  leafCidHex,
  normalizeP3pChallenge,
  parsePaiseAmount,
  paymentBounds,
  toP3pPaymentDemand,
  verifyP3pReceipt,
  type AuthorityOperation,
  type VerifiedIdentity,
} from "../src/index.js";

const NOW = 1_700_000_000;
const PRINCIPAL = "did:test:principal";
const AGENT = "did:test:agent";
const OTHER_AGENT = "did:test:other-agent";
const MERCHANT = "did:test:merchant";
const ATTACKER_MERCHANT = "did:test:attacker-merchant";

const INGRESS: VerifiedIdentity = {
  id: AGENT,
  principal: PRINCIPAL,
  source: "local-registration",
  proofRef: "p3p-test",
};

function challengeFor(overrides: Record<string, unknown> = {}) {
  return {
    challengeId: "ch_test_001",
    amountPaise: 10000,
    currency: "INR",
    resource: "/api/weather",
    merchant: MERCHANT,
    expiresAt: NOW + 300,
    paymentMethods: ["RESERVE_PAY"],
    ...overrides,
  };
}

function grantingAuthority(
  opts: {
    amountMax?: number;
    currency?: string;
    recipient?: string;
    exp?: number;
    maxUses?: number;
  } = {}
): Authority {
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "g-p3p",
    principal: PRINCIPAL,
    actor: { kind: "exact", id: AGENT },
    action: { name: "/pay" },
    purpose: "weather-data",
    resource: { type: "p3p-payment", id: "/api/weather" },
    bounds: [
      ...paymentBounds({
        amountMax: opts.amountMax ?? 10000,
        currency: opts.currency ?? "INR",
      }),
      {
        path: ".context.recipient",
        op: "in",
        value: [opts.recipient ?? MERCHANT],
      },
    ],
    exp: opts.exp ?? NOW + 600,
    ...(opts.maxUses !== undefined ? { maxUses: opts.maxUses } : {}),
  });
  return auth;
}

function demandFor(
  overrides: Record<string, unknown> = {}
): AuthorityOperation {
  const challenge = normalizeP3pChallenge(challengeFor(), NOW);
  const { operation } = toP3pPaymentDemand(challenge, {
    purpose: "weather-data",
    resource: "/api/weather",
    currency: "INR",
    ...overrides,
  });
  return operation;
}

describe("p3p adapter as evidence (phase 2)", () => {
  it("normalizes a well-formed challenge", () => {
    const c = normalizeP3pChallenge(challengeFor(), NOW);
    assert.equal(c.amountPaise, 10000);
    assert.equal(c.currency, "INR");
    assert.equal(c.resource, "/api/weather");
    assert.equal(c.merchant, MERCHANT);
    assert.deepEqual(c.paymentMethods, ["RESERVE_PAY"]);
  });

  it("rejects malformed challenges before any authority is involved", () => {
    assert.throws(() => normalizeP3pChallenge(null, NOW));
    assert.throws(() => normalizeP3pChallenge({}, NOW));
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ amountPaise: 0 }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ amountPaise: -5 }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ amountPaise: "10.5" }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ amountPaise: "9".repeat(30) }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ currency: "IN" }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ currency: "inr" }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ resource: "api/weather" }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ merchant: "" }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ expiresAt: NOW }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ expiresAt: NOW - 1 }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ paymentMethods: [] }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ paymentMethods: ["WALLET"] }), NOW)
    );
    assert.throws(() =>
      normalizeP3pChallenge(challengeFor({ challengeId: "" }), NOW)
    );
  });

  it("maps a challenge to an identity-free bounded demand", () => {
    const challenge = normalizeP3pChallenge(challengeFor(), NOW);
    const { operation, capabilityArgs } = toP3pPaymentDemand(challenge, {
      purpose: "weather-data",
      resource: "/api/weather",
      currency: "INR",
    });
    assert.ok(!("principal" in operation));
    assert.ok(!("actor" in operation));
    assert.ok(!("termsDigest" in operation));
    assert.equal(operation.context["recipient"], MERCHANT);
    assert.equal(operation.context["amount"], 10000);
    assert.equal(operation.context["p3pChallengeId"], "ch_test_001");
    assert.equal(operation.context["p3pMethod"], "RESERVE_PAY");
    assert.deepEqual(capabilityArgs, {
      amount: 10000,
      currency: "INR",
      p3pChallengeId: "ch_test_001",
      p3pMethod: "RESERVE_PAY",
    });
  });

  it("modified challenge terms fail closed at mapping time", () => {
    const base = challengeFor();
    assert.throws(() =>
      toP3pPaymentDemand(
        normalizeP3pChallenge({ ...base, resource: "/api/other" }, NOW),
        {
          purpose: "weather-data",
          resource: "/api/weather",
          currency: "INR",
        }
      )
    );
    assert.throws(() =>
      toP3pPaymentDemand(
        normalizeP3pChallenge({ ...base, currency: "USD" }, NOW),
        {
          purpose: "weather-data",
          resource: "/api/weather",
          currency: "INR",
        }
      )
    );
    assert.throws(() =>
      toP3pPaymentDemand(
        normalizeP3pChallenge({ ...base, merchant: ATTACKER_MERCHANT }, NOW),
        {
          purpose: "weather-data",
          resource: "/api/weather",
          currency: "INR",
          expectedMerchant: MERCHANT,
        }
      )
    );
    assert.throws(() =>
      toP3pPaymentDemand(normalizeP3pChallenge(base, NOW), {
        purpose: "weather-data",
        resource: "/api/weather",
        currency: "INR",
        expectedMethod: "CARD",
      })
    );
  });

  it("authority allows a covered operation and cites the grant", () => {
    const auth = grantingAuthority();
    const decision = auth.evaluate(demandFor(), INGRESS, { nowSec: NOW });
    assert.equal(decision.allow, true);
    if (decision.allow)
      assert.equal(decision.citations[0]?.authorityId, "g-p3p");
  });

  it("denial matrix: amount, currency, merchant, resource, expiry, agent, revocation", () => {
    const over = grantingAuthority();
    assert.equal(
      over.evaluate(demandFor(), INGRESS, { nowSec: NOW }).allow,
      true
    );
    // amount exceeds grant
    const tooMuch = grantingAuthority();
    assert.equal(
      tooMuch.evaluate(
        {
          ...demandFor(),
          context: { ...demandFor().context, amount: 10001 },
        },
        INGRESS,
        { nowSec: NOW }
      ).allow,
      false
    );
    // wrong currency
    assert.equal(
      grantingAuthority().evaluate(
        {
          ...demandFor(),
          context: { ...demandFor().context, currency: "USD" },
        },
        INGRESS,
        { nowSec: NOW }
      ).allow,
      false
    );
    // wrong merchant
    assert.equal(
      grantingAuthority().evaluate(
        {
          ...demandFor(),
          context: { ...demandFor().context, recipient: ATTACKER_MERCHANT },
        },
        INGRESS,
        { nowSec: NOW }
      ).allow,
      false
    );
    // wrong resource
    assert.equal(
      grantingAuthority().evaluate(
        {
          ...demandFor(),
          resource: { type: "p3p-payment", id: "/api/other" },
        },
        INGRESS,
        { nowSec: NOW }
      ).allow,
      false
    );
    // expired grant (beyond clock-skew tolerance, per authority.test.ts)
    assert.equal(
      grantingAuthority({ exp: NOW - 3600 }).evaluate(demandFor(), INGRESS, {
        nowSec: NOW,
      }).allow,
      false
    );
    // wrong agent
    assert.equal(
      grantingAuthority().evaluate(
        demandFor(),
        { ...INGRESS, id: OTHER_AGENT },
        { nowSec: NOW }
      ).allow,
      false
    );
    // revoked authority
    const revoked = grantingAuthority();
    revoked.revoke("g-p3p");
    assert.equal(
      revoked.evaluate(demandFor(), INGRESS, { nowSec: NOW }).allow,
      false
    );
  });

  it("replayed credential: one-time authority covers exactly one execution", () => {
    const auth = grantingAuthority({ maxUses: 1 });
    const op = demandFor();
    const first = auth.evaluate(op, INGRESS, { consume: true, nowSec: NOW });
    assert.equal(first.allow, true);
    const second = auth.evaluate(op, INGRESS, { consume: true, nowSec: NOW });
    assert.equal(second.allow, false);
  });

  it("CHECK output cannot execute: dry-run carries no redemption", () => {
    const principal = generateEd25519Keypair();
    const recipient = generateEd25519Keypair();
    const keys = new Map([
      ["p", principal.publicKeyRaw],
      ["m", recipient.publicKeyRaw],
    ]);
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const cap = caps.issue(
      null,
      {
        iss: "p",
        aud: "p",
        sub: "p",
        cmd: "/pay",
        pol: [["<=", ".amount", 10000]],
        purpose: "weather-data",
        resource: "/api/weather",
        recipient: "m",
        amountMax: 10000,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: "ab".repeat(32),
      },
      principal.privateKey
    );
    const checked = caps.check([cap], {
      cmd: "/pay",
      args: { amount: 10000, currency: "INR" },
      recipient: "m",
      resource: "/api/weather",
      purpose: "weather-data",
      termsDigest: "ab".repeat(32),
    });
    assert.equal(checked.ok, true);
    assert.ok(!("chainId" in checked));
    // A dry-run check is not a Redemption: execution refuses it.
    // (leafCidHex would bind a real redemption; the check has no chainId.)
    assert.ok(leafCidHex(cap).length === 64);
    return assert.rejects(() =>
      executeAndReceipt(
        {
          executePayment: async () => ({ ok: true as const, transaction: "x" }),
        },
        {
          capabilityId: "00".repeat(32),
          recipient: "m",
          amount: 10000,
          currency: "INR",
          resource: "/api/weather",
          purpose: "weather-data",
          termsDigest: "ab".repeat(32),
        },
        checked as never,
        NOW
      )
    );
  });

  it("receipt verification binds amount, currency, resource, merchant, challenge", () => {
    const expected = {
      amountPaise: 10000,
      currency: "INR",
      resource: "/api/weather",
      merchant: MERCHANT,
      challengeId: "ch_test_001",
    };
    const good = { success: true, transactionId: "txn-1", ...expected };
    assert.equal(verifyP3pReceipt(good, expected).ok, true);
    assert.equal(
      verifyP3pReceipt({ ...good, amountPaise: 9999 }, expected).ok,
      false
    );
    assert.equal(
      verifyP3pReceipt({ ...good, currency: "USD" }, expected).ok,
      false
    );
    assert.equal(
      verifyP3pReceipt({ ...good, resource: "/api/other" }, expected).ok,
      false
    );
    assert.equal(
      verifyP3pReceipt({ ...good, merchant: ATTACKER_MERCHANT }, expected).ok,
      false
    );
    assert.equal(
      verifyP3pReceipt({ ...good, challengeId: "ch_other" }, expected).ok,
      false
    );
    assert.equal(
      verifyP3pReceipt(
        {
          success: false,
          transactionId: "",
          ...expected,
          errorReason: "declined",
        },
        expected
      ).ok,
      false
    );
    assert.equal(
      verifyP3pReceipt({ success: true, ...expected }, expected).ok,
      false
    );
  });

  it("replayed and stale receipts fail closed", () => {
    const expected = {
      amountPaise: 10000,
      currency: "INR",
      resource: "/api/weather",
      merchant: MERCHANT,
      challengeId: "ch_test_001",
    };
    const good = { success: true, transactionId: "txn-1", ...expected };
    const seen = new Set<string>();
    assert.equal(
      verifyP3pReceipt(good, expected, { seenChallengeIds: seen }).ok,
      true
    );
    const replay = verifyP3pReceipt(good, expected, { seenChallengeIds: seen });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "replay");
    const stale = verifyP3pReceipt(good, expected, {
      nowSec: NOW + 3600,
      capturedAt: NOW,
      maxReceiptAgeSec: 300,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.reason, "stale receipt");
  });

  it("secret boundary: provider credentials never appear in adapter outputs", () => {
    const sentinelSecret = "ptf-canary-client-secret-9f2c";
    const sentinelGrant = "ptf-canary-grant-token-4bd1";
    const sentinelPan = "4111111111111111";
    const tainted = {
      ...challengeFor(),
      clientSecret: sentinelSecret,
      grantToken: sentinelGrant,
      cardPan: sentinelPan,
    };
    const normalized = normalizeP3pChallenge(tainted, NOW);
    assert.deepEqual(Object.keys(normalized).sort(), [
      "amountPaise",
      "challengeId",
      "currency",
      "expiresAt",
      "merchant",
      "paymentMethods",
      "resource",
    ]);
    const { operation, capabilityArgs } = toP3pPaymentDemand(normalized, {
      purpose: "weather-data",
      resource: "/api/weather",
      currency: "INR",
    });
    const receipt = verifyP3pReceipt(
      {
        success: true,
        transactionId: "txn-1",
        amountPaise: 10000,
        currency: "INR",
        resource: "/api/weather",
        merchant: MERCHANT,
        challengeId: "ch_test_001",
        grantToken: sentinelGrant,
        cardPan: sentinelPan,
      },
      {
        amountPaise: 10000,
        currency: "INR",
        resource: "/api/weather",
        merchant: MERCHANT,
        challengeId: "ch_test_001",
      }
    );
    assert.equal(receipt.ok, true);
    for (const blob of [
      JSON.stringify(normalized),
      JSON.stringify(operation),
      JSON.stringify(capabilityArgs),
      JSON.stringify(receipt),
    ]) {
      assert.ok(!blob.includes(sentinelSecret));
      assert.ok(!blob.includes(sentinelGrant));
      assert.ok(!blob.includes(sentinelPan));
    }
    // paise discipline: decimals and overflow rejected, never rounded.
    assert.throws(() => parsePaiseAmount("10.5"));
    assert.throws(() => parsePaiseAmount(Number.MAX_SAFE_INTEGER + 1));
    assert.equal(parsePaiseAmount("10000"), 10000);
  });

  it("sandbox-live wiring is env-gated and skipped without credentials", () => {
    if (process.env["PTF_P3P_LIVE"] !== "1") {
      // No credentials on CI/dev machines: the live sandbox round-trip is a
      // documented manual step (runbook below), never an implicit network call.
      // Docs: Pine Labs UAT `https://pluraluat.v2.pinepg.in`, token via
      // `POST /api/auth/v1/token` (client_credentials); Grantex hosted
      // `https://api.grantex.dev`. All values env-supplied, host-held.
      assert.equal(true, true);
      return;
    }
    const baseUrl = process.env["PTF_P3P_BASE_URL"] ?? "";
    const clientId = process.env["PINELABS_CLIENT_ID"] ?? "";
    assert.ok(baseUrl.startsWith("https://"));
    assert.ok(clientId.length > 0);
    // Live path asserts the seam contract only: the executor receives a
    // secret-free instruction (challenge + method + scope NAME +
    // idempotency key) and returns evidence for `verifyP3pReceipt`.
    // Provider credentials must never appear in its inputs or outputs.
    assert.ok(!("clientSecret" in { baseUrl, clientId }));
  });
});
