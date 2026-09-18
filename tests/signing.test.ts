import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Capabilities,
  canonicalize,
  generateEd25519Keypair,
  leafCidHex,
  sha256Hex,
  signAndReceipt,
  signBytes,
} from "../src/index.js";
import { FakeSigningExecutor } from "./fakes.js";

const NOW = 1_700_000_000;
const P = "did:test:principal";
const A = "did:test:agent";
const R = "did:test:recipient";
const BYTES = "ab".repeat(32);
const PURPOSE = "sign-order";
const RESOURCE = "order:1";
const DIGEST = "cd".repeat(32);

const bytesDigestOf = (hex: string): string =>
  sha256Hex(canonicalize(hex.toLowerCase()));

function setup() {
  const principal = generateEd25519Keypair();
  const recipient = generateEd25519Keypair();
  const keys = new Map([
    [P, principal.publicKeyRaw],
    [R, recipient.publicKeyRaw],
  ]);
  const caps = new Capabilities({
    resolveKey: (id) => keys.get(id) ?? null,
    nowSec: () => NOW,
  });
  return { principal, recipient, caps };
}

function issue(
  caps: Capabilities,
  priv: ReturnType<typeof generateEd25519Keypair>["privateKey"]
) {
  return caps.issue(
    null,
    {
      iss: P,
      aud: A,
      sub: P,
      cmd: "/sign",
      pol: [],
      purpose: PURPOSE,
      resource: RESOURCE,
      recipient: R,
      exp: NOW + 300,
      maxUses: 1,
      termsDigest: DIGEST,
    },
    priv
  );
}

function demand(bytesDigest: string) {
  return {
    cmd: "/sign" as const,
    args: { bytesDigest },
    recipient: R,
    resource: RESOURCE,
    purpose: PURPOSE,
    termsDigest: DIGEST,
  };
}

function proofFor(
  cap: ReturnType<Capabilities["issue"]>,
  recipient: ReturnType<typeof generateEd25519Keypair>
) {
  const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
  return {
    key: recipient.publicKeyRaw,
    sig: signBytes(recipient.privateKey, cidBytes),
  };
}

function instruction() {
  return {
    capabilityId: "",
    recipient: R,
    bytesHex: BYTES,
    purpose: PURPOSE,
    resource: RESOURCE,
    termsDigest: DIGEST,
  };
}

describe("SigningExecutor parity (v04/04)", () => {
  it("signs with a bound redemption and receipt without key material", async () => {
    const { principal, recipient, caps } = setup();
    const cap = issue(caps, principal.privateKey);
    const redeemed = caps.authorize([cap], demand(bytesDigestOf(BYTES)), {
      consume: true,
      proof: proofFor(cap, recipient),
    });
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("redeem must succeed in this fixture");
    const ex = new FakeSigningExecutor();
    const receipt = await signAndReceipt(
      ex,
      { ...instruction(), capabilityId: redeemed.chainId },
      redeemed,
      NOW
    );
    assert.equal(receipt.capabilityId, redeemed.chainId);
    assert.equal(receipt.termsDigest, DIGEST);
    assert.ok(receipt.signature.length > 0);
    assert.ok(!JSON.stringify(receipt).includes("private"));
    assert.equal(ex.calls.length, 1);
  });

  it("rejects mismatched chainId and malformed bytes", async () => {
    const { principal, recipient, caps } = setup();
    const cap = issue(caps, principal.privateKey);
    const redeemed = caps.authorize([cap], demand(bytesDigestOf(BYTES)), {
      consume: false,
      proof: proofFor(cap, recipient),
    });
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("dry-run must succeed in this fixture");
    const ex = new FakeSigningExecutor();
    await assert.rejects(() =>
      signAndReceipt(
        ex,
        { ...instruction(), capabilityId: "other" },
        redeemed,
        NOW
      )
    );
    await assert.rejects(() =>
      signAndReceipt(
        ex,
        { ...instruction(), capabilityId: redeemed.chainId, bytesHex: "zz" },
        redeemed,
        NOW
      )
    );
  });

  it("rejects any mutation between authorization and signing", async () => {
    const { principal, recipient, caps } = setup();
    const cap = issue(caps, principal.privateKey);
    const good = demand(bytesDigestOf(BYTES));
    const authorize = () => {
      const r = caps.authorize([cap], good, { consume: false });
      assert.equal(r.ok, true);
      if (!r.ok) throw new Error("dry-run must succeed in this fixture");
      return r;
    };
    const ex = new FakeSigningExecutor();
    const base = { ...instruction(), capabilityId: "cid-x" };
    // Manufactured redemptions (no bound operation) fail first.
    await assert.rejects(
      () =>
        signAndReceipt(ex, base, { ok: true, chainId: "cid-x" } as never, NOW),
      /unbound redemption/
    );
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["bytes", { bytesHex: "cd".repeat(32) }, /bytes differ/],
      ["recipient", { recipient: "did:test:other" }, /recipient differs/],
      ["resource", { resource: "order:evil" }, /resource differs/],
      ["purpose", { purpose: "evil" }, /purpose differs/],
      [
        "termsDigest",
        { termsDigest: "00".repeat(32) },
        /terms digest mismatch/,
      ],
      ["capabilityId", { capabilityId: "cid-other" }, /not bound/],
    ];
    for (const [label, patch, re] of cases) {
      await assert.rejects(
        () =>
          signAndReceipt(
            ex,
            { ...base, capabilityId: authorize().chainId, ...patch },
            authorize(),
            NOW
          ),
        re,
        label
      );
    }
    assert.equal(ex.calls.length, 0);
  });
});
