import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Capabilities,
  checkSettlement,
  generateEd25519Keypair,
  parsePaymentRequired,
  StubFacilitator,
  termsDigestOf,
  toX402PaymentDemand,
} from "../src/index.js";

const NOW = 1_700_000_000;
const PRINCIPAL = "did:test:principal";
const AGENT = "did:test:agent";
const PAYTO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

function headerFor(accepts: unknown) {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url: "https://api.example.com/data" },
      accepts,
    }),
    "utf8"
  ).toString("base64");
}

const ACCEPT = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "10000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: PAYTO,
  maxTimeoutSeconds: 60,
};

describe("x402 v2 adapter as evidence (ptf-v01/04)", () => {
  it("maps a 402 challenge to a bounded payment demand", () => {
    const parsed = parsePaymentRequired(headerFor([ACCEPT]));
    assert.equal(parsed.x402Version, 2);
    assert.equal(parsed.resource.url, "https://api.example.com/data");
    const first = parsed.accepts[0];
    assert.ok(first);
    const { demand, capabilityArgs } = toX402PaymentDemand(first, {
      principal: PRINCIPAL,
      agent: AGENT,
      purpose: "buy data",
      resource: "data:premium",
      currency: "USDC",
      termsDigest: termsDigestOf({
        url: "https://api.example.com/data",
        amount: "10000",
      }),
    });
    assert.equal(demand.recipient, PAYTO);
    assert.equal(demand.amount, 10000);
    assert.deepEqual(capabilityArgs, { amount: 10000, currency: "USDC" });
  });

  it("rejects malformed challenges before any authority is involved", () => {
    assert.throws(() => parsePaymentRequired("!!!not-base64!!!"));
    assert.throws(() => parsePaymentRequired(headerFor([])));
    assert.throws(() =>
      parsePaymentRequired(headerFor([{ ...ACCEPT, amount: "1.5" }]))
    );
    assert.throws(() =>
      parsePaymentRequired(headerFor([{ ...ACCEPT, payTo: "" }]))
    );
    assert.throws(() =>
      parsePaymentRequired(headerFor([{ ...ACCEPT, amount: "9".repeat(30) }]))
    );
  });

  it("a swapped payTo fails at the recipient gate, not in the adapter", () => {
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const merchant = generateEd25519Keypair();
    const keys = new Map([
      ["did:test:principal", principal.publicKeyRaw],
      ["did:test:agent", agent.publicKeyRaw],
      [PAYTO, merchant.publicKeyRaw],
    ]);
    const digest = termsDigestOf({
      url: "https://api.example.com/data",
      amount: "10000",
    });
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const cap = caps.issue(
      null,
      {
        iss: "did:test:principal",
        aud: "did:test:agent",
        sub: "did:test:principal",
        cmd: "/pay",
        pol: [["<=", ".amount", 10000]],
        purpose: "buy data",
        resource: "data:premium",
        recipient: PAYTO,
        amountMax: 10000,
        currency: "USDC",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      principal.privateKey
    );

    const tampered = {
      ...ACCEPT,
      payTo: "0xAttacker0000000000000000000000000000000000",
    };
    const { demand } = toX402PaymentDemand(tampered as never, {
      principal: "did:test:principal",
      agent: "did:test:agent",
      purpose: "buy data",
      resource: "data:premium",
      currency: "USDC",
      termsDigest: digest,
    });
    const result = caps.authorize(
      [cap],
      {
        cmd: "/pay",
        args: { amount: demand.amount, currency: "USDC" },
        recipient: demand.recipient,
        termsDigest: digest,
      },
      { consume: false }
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "recipient");
  });

  it("checks settlement against sender, network, amount, and asset", async () => {
    const facilitator = new StubFacilitator(true, "0xfrom");
    const verified = await facilitator.verify({ x: 1 }, ACCEPT as never);
    assert.equal(verified.isValid, true);
    const settled = await facilitator.settle({ x: 1 }, ACCEPT as never);
    assert.equal(settled.success, true);
    assert.equal(settled.payer, "0xfrom");

    const good = {
      success: true,
      transaction: "0xabc",
      network: "eip155:84532",
      payer: "0xfrom",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    };
    const expected = {
      network: "eip155:84532",
      payer: "0xfrom",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    };
    assert.equal(checkSettlement(good, expected).ok, true);
    assert.equal(
      checkSettlement({ ...good, network: "eip155:1" }, expected).ok,
      false
    );
    assert.equal(
      checkSettlement({ ...good, payer: "0xother" }, expected).ok,
      false
    );
    assert.equal(
      checkSettlement({ ...good, amount: "9999" }, expected).ok,
      false
    );
    assert.equal(
      checkSettlement({ ...good, asset: "0xJunk" }, expected).ok,
      false
    );
    // Amount/asset expectations are opt-in; network + payer always apply.
    assert.equal(
      checkSettlement(
        {
          success: true,
          transaction: "0xabc",
          network: "eip155:84532",
          payer: "0xfrom",
        },
        { network: "eip155:84532", payer: "0xfrom" }
      ).ok,
      true
    );
    const failing = new StubFacilitator(false);
    assert.equal(
      (await failing.settle({ x: 1 }, ACCEPT as never)).success,
      false
    );
  });

  it("preserves description, mimeType, extra, and extensions for citation", () => {
    const raw = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        resource: {
          url: "https://api.example.com/data",
          description: "Premium data",
          mimeType: "application/json",
        },
        accepts: [{ ...ACCEPT, extra: { name: "USDC", version: "2" } }],
        extensions: { info: "x" },
      }),
      "utf8"
    ).toString("base64");
    const parsed = parsePaymentRequired(raw);
    assert.equal(parsed.resource.description, "Premium data");
    assert.equal(parsed.resource.mimeType, "application/json");
    assert.deepEqual(parsed.accepts[0]?.extra, { name: "USDC", version: "2" });
    assert.deepEqual(parsed.extensions, { info: "x" });
  });
});
