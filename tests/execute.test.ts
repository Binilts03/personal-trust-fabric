import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { KeyObject } from "node:crypto";
import {
  Audit,
  Authority,
  Capabilities,
  FakePaymentExecutor,
  canonicalize,
  digestForOperation,
  executeAndReceipt,
  generateEd25519Keypair,
  leafCidHex,
  paymentBounds,
  signBytes,
  termsDigestOf,
} from "../src/index.js";

const NOW = 1_700_000_000;
const PRINCIPAL = "did:test:principal";
const AGENT = "did:test:agent";
const MERCHANT = "did:test:merchant";
const ATTACKER = "did:test:attacker";
const PAN_SENTINEL = "4111-SECRET-PAN-never-leaves-host";

function parties() {
  const principal = generateEd25519Keypair();
  const agent = generateEd25519Keypair();
  const merchant = generateEd25519Keypair();
  const attacker = generateEd25519Keypair();
  const keys = new Map([
    [PRINCIPAL, principal.publicKeyRaw],
    [AGENT, agent.publicKeyRaw],
    [MERCHANT, merchant.publicKeyRaw],
    [ATTACKER, attacker.publicKeyRaw],
  ]);
  return { principal, agent, merchant, attacker, keys };
}

function issueCap(caps: Capabilities, priv: KeyObject, digest: string) {
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
      exp: NOW + 300,
      maxUses: 1,
      termsDigest: digest,
    },
    priv
  );
}

describe("protected payment execution with receipts and secretness audit (ptf-v01/02)", () => {
  it("runs propose → approve → redeem-with-proof → receipt → chained audit", async () => {
    const { principal, merchant, keys } = parties();
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g1",
      principal: PRINCIPAL,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 600,
    });
    const operation = {
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "invoice:inv_8472" },
      context: { amount: 1790, currency: "INR", recipient: MERCHANT },
      purpose: "pay invoice",
    };

    const decision = auth.evaluate(
      operation,
      {
        id: AGENT,
        principal: PRINCIPAL,
        source: "local-registration",
        proofRef: "execute-test",
      },
      { consume: true }
    );
    assert.equal(decision.allow, true);

    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const bound = { ...operation, principal: PRINCIPAL, actor: AGENT };
    const cap = issueCap(caps, principal.privateKey, digestForOperation(bound));
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 1790, currency: "INR" },
      recipient: MERCHANT,
      termsDigest: digestForOperation(bound),
    };
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const proof = {
      key: merchant.publicKeyRaw,
      sig: signBytes(merchant.privateKey, cidBytes),
    };
    const redeemed = caps.authorize([cap], demand, { consume: true, proof });
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("redeem must succeed in this fixture");

    const executor = new FakePaymentExecutor();
    const receipt = await executeAndReceipt(
      executor,
      {
        capabilityId: leafCidHex(cap),
        recipient: MERCHANT,
        amount: 1790,
        currency: "INR",
        resource: "invoice:inv_8472",
        purpose: "pay invoice",
      },
      redeemed,
      NOW
    );
    assert.equal(receipt.amount, 1790);
    assert.equal(receipt.recipient, MERCHANT);
    assert.equal(executor.calls.length, 1);
    const audit = new Audit(() => NOW);
    audit.append({
      actor: AGENT,
      action: "redeem",
      authorityId: "g1",
      capabilityId: receipt.capabilityId,
    });
    audit.append({
      actor: "executor",
      action: "execute",
      capabilityId: receipt.capabilityId,
      detail: receipt.transaction,
    });
    assert.equal(audit.verifyChain(), true);

    const blob = canonicalize(receipt) + audit.toJSONL();
    assert.ok(!blob.includes(PAN_SENTINEL));
  });

  it("denies replay and wrong-recipient redemption before any execution", async () => {
    const { principal, merchant, attacker, keys } = parties();
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const digest = termsDigestOf({ invoice: "inv_9", amount: 10 });
    const cap = issueCap(caps, principal.privateKey, digest);
    const demand = {
      cmd: "/pay" as const,
      args: { amount: 10, currency: "INR" },
      recipient: MERCHANT,
      termsDigest: digest,
    };
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const proof = {
      key: merchant.publicKeyRaw,
      sig: signBytes(merchant.privateKey, cidBytes),
    };

    assert.equal(
      caps.authorize([cap], demand, { consume: true, proof }).ok,
      true
    );
    const replay = caps.authorize([cap], demand, { consume: true, proof });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "uses-exhausted");

    const badProof = {
      key: attacker.publicKeyRaw,
      sig: signBytes(attacker.privateKey, cidBytes),
    };
    const wrongRecipient = caps.authorize(
      [cap],
      { ...demand, recipient: ATTACKER },
      { consume: true, proof: badProof }
    );
    assert.equal(wrongRecipient.ok, false);
    if (!wrongRecipient.ok) assert.equal(wrongRecipient.reason, "recipient");
  });

  it("detects audit-chain tampering", () => {
    const audit = new Audit(() => NOW);
    audit.append({ actor: AGENT, action: "redeem", capabilityId: "cid-1" });
    audit.append({
      actor: "executor",
      action: "execute",
      capabilityId: "cid-1",
    });
    assert.equal(audit.verifyChain(), true);
    const lines = audit.toJSONL().trim().split("\n");
    const tampered = JSON.parse(lines[0] as string) as Record<string, unknown>;
    tampered["action"] = "refund";
    lines[0] = JSON.stringify(tampered);
    const forged = new Audit(() => NOW);
    // Fail-closed ingest: forged entries are rejected at load, not merely
    // flagged by verifyChain.
    assert.throws(() => {
      for (const line of lines) forged.ingest(line);
    }, /hash mismatch|prevHash|seq/);
    assert.equal(forged.verifyChain(), true);
    assert.equal(forged.toJSONL(), "");
  });

  it("chains audit entries with HMAC when keyed, and rejects key confusion", () => {
    const key = new Uint8Array(32).fill(7);
    const audit = new Audit(() => NOW, { hmacKey: key });
    audit.append({ actor: AGENT, action: "redeem", capabilityId: "cid-1" });
    audit.append({
      actor: "executor",
      action: "execute",
      capabilityId: "cid-1",
    });
    assert.equal(audit.verifyChain(), true);
    assert.ok(!audit.toJSONL().includes(Buffer.from(key).toString("hex")));

    const wrongKey = new Audit(() => NOW, {
      hmacKey: new Uint8Array(32).fill(8),
    });
    assert.throws(() => {
      for (const line of audit.toJSONL().trim().split("\n"))
        wrongKey.ingest(line);
    }, /hash mismatch/);

    const unkeyed = new Audit(() => NOW);
    assert.throws(() => {
      for (const line of audit.toJSONL().trim().split("\n"))
        unkeyed.ingest(line);
    }, /hash mismatch/);

    assert.throws(() => new Audit(() => NOW, { hmacKey: new Uint8Array(8) }));
  });

  it("refuses execution without a successful redemption result", async () => {
    const executor = new FakePaymentExecutor();
    const instruction = {
      capabilityId: "cid-x",
      recipient: MERCHANT,
      amount: 10,
      currency: "INR",
      resource: "r",
      purpose: "p",
    };
    await assert.rejects(() =>
      executeAndReceipt(executor, instruction, { ok: false } as never, NOW)
    );
    assert.equal(executor.calls.length, 0);
  });

  it("instructions and receipts carry a fixed field set with no room for secrets", async () => {
    const executor = new FakePaymentExecutor();
    const instruction = {
      capabilityId: "cid-x",
      recipient: MERCHANT,
      amount: 10,
      currency: "INR",
      resource: "r",
      purpose: "p",
    };
    assert.deepEqual(Object.keys(instruction).sort(), [
      "amount",
      "capabilityId",
      "currency",
      "purpose",
      "recipient",
      "resource",
    ]);
    const receipt = await executeAndReceipt(
      executor,
      instruction,
      { ok: true, chainId: "cid-x" },
      NOW
    );
    assert.deepEqual(Object.keys(receipt).sort(), [
      "amount",
      "at",
      "capabilityId",
      "currency",
      "purpose",
      "receiptId",
      "recipient",
      "resource",
      "transaction",
    ]);
  });
});
