import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Authority, generateEd25519Keypair, signBytes } from "../src/index.js";
import { createHostRedemptionChallenge } from "../src/hostkit/index.js";

const NOW = 1_800_000_000;
const P = "owner", A = "email-agent", M = "email-provider";
const ingress = { id: A, principal: P, source: "local-registration" as const, proofRef: "unit-test" };
const operation = {
  action: { name: "/email/send" as const },
  resource: { type: "email-message", id: "msg:1" },
  context: { messageId: "msg:1", recipient: M },
  purpose: "delegated-email",
};

describe("public trusted-host recipient proof", () => {
  it("issues signed, exact-term, one-use generic redemptions", () => {
    const owner = generateEd25519Keypair(), recipient = generateEd25519Keypair();
    const keys = new Map([[P, owner.publicKeyRaw], [M, recipient.publicKeyRaw]]);
    const challenge = createHostRedemptionChallenge({
      operation, ingress, recipient: M,
      principalPrivateKey: owner.privateKey,
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW
    });
    assert.match(challenge.cidHex, /^[a-f0-9]{64}$/);
    const proof = { key: recipient.publicKeyRaw,
      sig: signBytes(recipient.privateKey, Buffer.from(challenge.cidHex, "hex")) };
    const redeemed = challenge.redeem(proof);
    assert.equal(redeemed.ok, true);
    assert.equal(redeemed.consumed, true);
    assert.equal(redeemed.proofVerified, true);
    assert.equal(redeemed.operation.cmd, "/email/send");
    assert.equal(redeemed.operation.resource, "msg:1");
    assert.deepEqual(redeemed.operation.args, operation.context);
    assert.throws(() => challenge.redeem(proof), /uses-exhausted/);
  });
  it("rejects wrong recipient, bad signatures and reserved domains", () => {
    const owner = generateEd25519Keypair(), recipient = generateEd25519Keypair();
    const other = generateEd25519Keypair();
    const keys = new Map([[P, owner.publicKeyRaw], [M, recipient.publicKeyRaw]]);
    const args = { operation, ingress, recipient: M, principalPrivateKey: owner.privateKey,
      resolveKey: (id: string) => keys.get(id) ?? null, nowSec: () => NOW };
    const challenge = createHostRedemptionChallenge(args);
    assert.throws(() => challenge.redeem({
      key: other.publicKeyRaw, sig: signBytes(other.privateKey, Buffer.from(challenge.cidHex, "hex"))
    }), /recipient/);
    assert.throws(() => challenge.redeem({key: recipient.publicKeyRaw, sig: new Uint8Array(64)}), /recipient/);
    assert.throws(() => createHostRedemptionChallenge({
      ...args, operation: { ...operation, action: {name: "/pay"} }
    }), /reserved/);
    assert.throws(() => createHostRedemptionChallenge({
      ...args, recipient: "other"
    }), /recipient/);
  });
});
