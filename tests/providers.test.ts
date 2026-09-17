import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  Capabilities,
  FileAuditLog,
  VaultStore,
  digestForOperation,
  executeAndReceipt,
  executeViaProvider,
  executeWithCredential,
  generateEd25519Keypair,
  leafCidHex,
  makeFakeProviders,
  providerAsExecutor,
  signBytes,
  FakeProvider,
  canonicalize,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:principal";
const A = "did:test:agent";
const M = "did:test:merchant";
const SECRET = "PAN-SECRET-4111-never-leaves-host";

function parties() {
  const principal = generateEd25519Keypair();
  const merchant = generateEd25519Keypair();
  const keys = new Map([
    [P, principal.publicKeyRaw],
    [A, generateEd25519Keypair().publicKeyRaw],
    [M, merchant.publicKeyRaw],
  ]);
  return { principal, merchant, keys };
}

function bound(amount = 500) {
  return {
    principal: P,
    actor: A,
    action: { name: "/pay" as const },
    resource: { type: "invoice", id: "invoice:7" },
    context: { amount, currency: "INR", recipient: M },
    purpose: "widgets",
  };
}

describe("protected provider seam (P0 slice 3)", () => {
  it("fake providers per kind record calls with canned externalRef and move nothing", async () => {
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    for (const kind of [
      "payment",
      "travel",
      "retail",
      "email",
      "identity",
    ] as const) {
      const provider = fakes[kind];
      assert.ok(provider instanceof FakeProvider);
      const sub = await provider.submit({
        capabilityId: `cid-${kind}`,
        termsDigest: "ab".repeat(16),
        action: "/pay",
        recipient: M,
        resource: "res:1",
        purpose: "p",
        context: { handle: "h-1" },
      });
      assert.equal(sub.kind, kind);
      assert.ok(sub.externalRef.startsWith(`fake-${kind}-`));
      assert.equal(provider.calls.length, 1);
      assert.equal(
        provider.verify(sub, {
          capabilityId: `cid-${kind}`,
          termsDigest: "ab".repeat(16),
        }).ok,
        true
      );
    }
  });

  it("chainId==capabilityId and termsDigest pin hold end to end", async () => {
    const { principal, merchant, keys } = parties();
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const digest = digestForOperation(bound());
    const cap = caps.issue(
      null,
      {
        iss: P,
        aud: A,
        sub: P,
        cmd: "/pay",
        pol: [["<=", ".amount", 2000]],
        purpose: "widgets",
        resource: "invoice:7",
        recipient: M,
        amountMax: 2000,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      principal.privateKey
    );
    const cid = leafCidHex(cap);
    const cidBytes = new Uint8Array(Buffer.from(cid, "hex"));
    const redeemed = caps.authorize(
      [cap],
      {
        cmd: "/pay",
        args: { amount: 500, currency: "INR" },
        recipient: M,
        termsDigest: digest,
      },
      {
        consume: true,
        proof: {
          key: merchant.publicKeyRaw,
          sig: signBytes(merchant.privateKey, cidBytes),
        },
      }
    );
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("redeem must succeed");
    assert.equal(redeemed.chainId, cid);

    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const receipt = await executeViaProvider(
      fakes.payment,
      {
        capabilityId: cid,
        termsDigest: digest,
        action: "/pay",
        recipient: M,
        resource: "invoice:7",
        purpose: "widgets",
        context: { amount: 500, currency: "INR" },
      },
      redeemed,
      NOW
    );
    assert.equal(receipt.capabilityId, cid);
    assert.equal(receipt.transaction.startsWith("fake-payment-"), true);

    // Wrong chainId fails before any provider effect is trusted.
    await assert.rejects(
      () =>
        executeViaProvider(
          fakes.payment,
          {
            capabilityId: cid,
            termsDigest: digest,
            action: "/pay",
            recipient: M,
            resource: "invoice:7",
            purpose: "widgets",
            context: { amount: 500, currency: "INR" },
          },
          { ok: true, chainId: "deadbeef" },
          NOW
        ),
      /not bound/
    );
  });

  it("verify-fail produces no receipt", async () => {
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const digest = "cd".repeat(16);
    const req = {
      capabilityId: "cid-verify",
      termsDigest: digest,
      action: "/pay" as const,
      recipient: M,
      resource: "res:1",
      purpose: "p",
      context: { amount: 10, currency: "INR" },
    };
    // Tampered submission fails verify directly.
    const sub = await fakes.travel.submit({
      ...req,
      capabilityId: "cid-verify",
      termsDigest: digest,
    });
    assert.equal(
      fakes.travel.verify(
        { ...sub, termsDigest: "00".repeat(32) },
        { capabilityId: "cid-verify", termsDigest: digest }
      ).ok,
      false
    );
    // executeViaProvider with a provider whose verify always fails throws before receipt.
    const evil = new FakeProvider("payment", { nowSec: () => NOW });
    evil.verify = () => ({ ok: false as const, reason: "terms mismatch" });
    await assert.rejects(
      () =>
        executeViaProvider(evil, req, { ok: true, chainId: "cid-verify" }, NOW),
      /terms mismatch/
    );
  });

  it("missing amount/currency fails closed instead of fabricating receipt terms", async () => {
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const digest = "ab".repeat(32);
    const base = {
      capabilityId: "cid-explicit",
      termsDigest: digest,
      action: "/pay" as const,
      recipient: M,
      resource: "res:1",
      purpose: "p",
    };
    const redemption = { ok: true as const, chainId: "cid-explicit" };
    await assert.rejects(
      () =>
        executeViaProvider(
          fakes.payment,
          { ...base, context: {} },
          redemption,
          NOW
        ),
      /context\.amount/
    );
    await assert.rejects(
      () =>
        executeViaProvider(
          fakes.payment,
          { ...base, context: { amount: 0 } },
          redemption,
          NOW
        ),
      /context\.currency/
    );
    // Explicit zero passes — stated, never invented.
    const receipt = await executeViaProvider(
      fakes.payment,
      { ...base, context: { amount: 0, currency: "INR" } },
      redemption,
      NOW
    );
    assert.equal(receipt.amount, 0);
    assert.equal(receipt.currency, "INR");
  });

  it("providerAsExecutor keeps executeAndReceipt call sites untouched and receipts secret-free", async () => {
    const { principal, merchant, keys } = parties();
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const digest = digestForOperation(bound(425));
    const cap = caps.issue(
      null,
      {
        iss: P,
        aud: A,
        sub: P,
        cmd: "/pay",
        pol: [["<=", ".amount", 2000]],
        purpose: "widgets",
        resource: "invoice:7",
        recipient: M,
        amountMax: 2000,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      principal.privateKey
    );
    const cid = leafCidHex(cap);
    const cidBytes = new Uint8Array(Buffer.from(cid, "hex"));
    const redeemed = caps.authorize(
      [cap],
      {
        cmd: "/pay",
        args: { amount: 425, currency: "INR" },
        recipient: M,
        termsDigest: digest,
      },
      {
        consume: true,
        proof: {
          key: merchant.publicKeyRaw,
          sig: signBytes(merchant.privateKey, cidBytes),
        },
      }
    );
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("redeem must succeed");

    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const executor = providerAsExecutor(fakes.payment, {
      capabilityId: cid,
      termsDigest: digest,
    });
    const receipt = await executeAndReceipt(
      executor,
      {
        capabilityId: cid,
        recipient: M,
        amount: 425,
        currency: "INR",
        resource: "invoice:7",
        purpose: "widgets",
      },
      redeemed,
      NOW
    );
    assert.ok(receipt.transaction.startsWith("fake-payment-"));
    assert.equal(fakes.payment.calls.length, 1);

    // Secret in context never reaches the receipt: only amount/currency project.
    const secretReceipt = await executeViaProvider(
      fakes.retail,
      {
        capabilityId: "cid-secret",
        termsDigest: "ef".repeat(16),
        action: "/pay",
        recipient: M,
        resource: "res:1",
        purpose: "p",
        context: { amount: 5, currency: "INR", note: SECRET },
      },
      { ok: true, chainId: "cid-secret" },
      NOW
    );
    const blob = canonicalize(secretReceipt);
    assert.ok(!blob.includes(SECRET));
    assert.deepEqual(Object.keys(secretReceipt).sort(), [
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

  it("executeWithCredential uses a secret without leaking it (handles + refs only)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-orch-"));
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-use",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/use" },
      bounds: [{ path: ".context.claim", op: "==", value: "pan" }],
      exp: NOW + 3600,
    });
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-pan",
      owner: P,
      type: "pan",
      value: SECRET,
      sensitivity: "secret",
      source: "issuer",
      allowedPurposes: ["pay"],
      allowedAgents: [A],
      expiresAt: null,
    });
    const audit = FileAuditLog.open(join(dir, "audit.jsonl"), () => NOW);
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const provider = fakes.payment;
    const redemption = { ok: true as const, chainId: "cid-orchestrator-1" };
    const digest = "ab".repeat(16);
    let seenInHost: unknown;
    const receipt = await executeWithCredential(vault, {
      ingress: {
        id: A,
        principal: P,
        source: "local-registration",
        proofRef: "orchestrator-test",
      },
      recordId: "r-pan",
      purpose: "pay",
      authority: auth,
      nowSec: NOW,
      provider,
      redemption,
      buildRequest: (instr) => {
        seenInHost = instr.value;
        // Handles + refs only: the record id travels, the secret never does.
        return {
          termsDigest: digest,
          action: "/pay",
          recipient: M,
          resource: "invoice:7",
          purpose: "pay",
          context: {
            amount: 500,
            currency: "INR",
            panRef: instr.recordId,
          },
        };
      },
      audit,
      at: NOW,
    });
    assert.equal(seenInHost, SECRET);
    assert.equal(receipt.capabilityId, redemption.chainId);
    assert.equal(receipt.amount, 500);
    assert.equal(receipt.currency, "INR");
    assert.ok(receipt.transaction.startsWith("fake-payment-"));
    assert.equal(provider.calls.length, 1);
    const call = provider.calls[0] as {
      context: Record<string, unknown>;
    };
    assert.equal(call.context["panRef"], "r-pan");
    assert.ok(!canonicalize(call).includes(SECRET));
    assert.ok(!canonicalize(receipt).includes(SECRET));
    const auditBlob = readFileSync(join(dir, "audit.jsonl"), "utf8");
    assert.ok(!auditBlob.includes(SECRET));
    assert.ok(auditBlob.includes("r-pan"));
  });
});
