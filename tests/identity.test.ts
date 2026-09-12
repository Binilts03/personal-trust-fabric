import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Capabilities,
  RecipientRegistry,
  generateEd25519Keypair,
  leafCidHex,
  signBytes,
  termsDigestOf,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:p";
const A = "did:test:a";
const MERCHANT = "did:test:merchant-b";

describe("recipient binding registry with rotation (ptf-v02/01)", () => {
  it("registers and resolves; unknown is null; bad input throws", () => {
    const reg = new RecipientRegistry(() => NOW);
    const kp = generateEd25519Keypair();
    reg.register(MERCHANT, kp.publicKeyRaw);
    assert.deepEqual(reg.resolve(MERCHANT), kp.publicKeyRaw);
    assert.equal(reg.resolve("did:test:nobody"), null);
    assert.throws(() => reg.register(MERCHANT, kp.publicKeyRaw));
    assert.throws(() => reg.register("did:test:short", new Uint8Array(16)));
    assert.throws(() => reg.register("", kp.publicKeyRaw));
  });

  it("rotation swaps the live key and keeps history", () => {
    const reg = new RecipientRegistry(() => NOW);
    const oldKp = generateEd25519Keypair();
    const newKp = generateEd25519Keypair();
    reg.register(MERCHANT, oldKp.publicKeyRaw);
    reg.rotate(MERCHANT, newKp.publicKeyRaw);
    assert.deepEqual(reg.resolve(MERCHANT), newKp.publicKeyRaw);
    const history = reg.history(MERCHANT);
    assert.ok(history);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.superseded, true);
    assert.throws(() => reg.rotate("did:test:nobody", newKp.publicKeyRaw));
  });

  it("revocation closes resolution and redemption fails closed", () => {
    const reg = new RecipientRegistry(() => NOW);
    const p = generateEd25519Keypair();
    const a = generateEd25519Keypair();
    const m = generateEd25519Keypair();
    reg.register(MERCHANT, m.publicKeyRaw);
    const keys = new Map([
      [P, p.publicKeyRaw],
      [A, a.publicKeyRaw],
    ]);
    const caps = new Capabilities({
      resolveKey: (id) =>
        id === MERCHANT ? reg.resolve(id) : (keys.get(id) ?? null),
      nowSec: () => NOW,
    });
    const digest = termsDigestOf({ i: "registry-wire" });
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
        recipient: MERCHANT,
        amountMax: 50,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 5,
        termsDigest: digest,
      },
      p.privateKey
    );
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 10, currency: "INR" },
      recipient: MERCHANT,
      termsDigest: digest,
    };
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const proof = {
      key: m.publicKeyRaw,
      sig: signBytes(m.privateKey, cidBytes),
    };
    assert.equal(
      caps.authorize([cap], demand, { consume: true, proof }).ok,
      true
    );

    reg.revoke(MERCHANT);
    assert.equal(reg.resolve(MERCHANT), null);
    assert.equal((reg.history(MERCHANT) ?? []).length, 1);

    const stale = caps.authorize([cap], demand, {
      consume: true,
      proof,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.reason, "recipient");
  });

  it("revoked aliases stay retired: rotation after revocation throws", () => {
    const reg = new RecipientRegistry(() => NOW);
    const oldKp = generateEd25519Keypair();
    const newKp = generateEd25519Keypair();
    reg.register(MERCHANT, oldKp.publicKeyRaw);
    reg.revoke(MERCHANT);
    assert.throws(() => reg.rotate(MERCHANT, newKp.publicKeyRaw));
    assert.equal(reg.resolve(MERCHANT), null);
  });
});
