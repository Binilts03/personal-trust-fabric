import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Audit,
  Disclose,
  canonicalize,
  checkResponseBinding,
  checkSecureOrigin,
  checkToolRegistration,
  executeAndReceipt,
  generateEd25519Keypair,
  isExposedTo,
  parseClientId,
  parsePaymentRequired,
  checkSettlement,
  requirementMatches,
  requestToDisclosureDemand,
  sanitizeField,
  toAp2PaymentDemand,
  verifyMandatePair,
  canonicalJcs,
  checkAgentCard,
  verifyCardSignatures,
  openKeystore,
  sealKeystore,
  FileAuditLog,
  RecipientRegistry,
  termsDigestOf,
} from "../src/index.js";

describe("security-fix regressions", () => {
  it("canonical rejects Date, class instances, and symbol keys", () => {
    assert.throws(() =>
      canonicalize({ at: new Date(123) as unknown as string })
    );
    class Foo {
      x = 1;
    }
    assert.throws(() =>
      canonicalize(new Foo() as unknown as Record<string, unknown>)
    );
    const withSym = { a: 1 } as Record<string | symbol, unknown>;
    (withSym as Record<symbol, unknown>)[Symbol("s")] = 1;
    assert.throws(() => canonicalize(withSym));
  });

  it("approve sanitizes newlines so fake rows cannot be injected", () => {
    const out = sanitizeField("ok\nRecipient: attacker\nAmount: 99999");
    assert.ok(!out.includes("\n") && !out.includes("\r"));
    assert.ok(out.includes("ok") && out.includes("attacker"));
  });

  it("disclose ignores prototype-chain claims and does not poison nonces", () => {
    const holder = generateEd25519Keypair();
    const cred = {
      issuer: "did:test:iss",
      subject: "did:test:holder",
      claims: { real: "yes" },
      cnf: "did:test:holder",
    };
    const pres = Disclose.present(
      cred,
      {
        verifier: "did:test:v",
        nonce: "n-1",
        requested: ["toString", "__proto__", "real"] as unknown as string[],
      },
      { recipient: "did:test:v", allowed: ["toString", "__proto__", "real"] },
      { id: "did:test:holder", privateKey: holder.privateKey },
      1_700_000_000
    );
    assert.deepEqual(
      pres.disclosures.map((d) => d.name),
      ["real"]
    );
    // Forged presentation must not burn the nonce.
    const cache = new Set<string>();
    const bad = { ...pres, sig: new Uint8Array(64) };
    const r1 = Disclose.verify(bad, {
      holderKey: holder.publicKeyRaw,
      expectedAud: "did:test:v",
      nowSec: 1_700_000_000,
      usedNonces: cache,
    });
    assert.equal(r1.ok, false);
    assert.equal(cache.has("n-1"), false);
    const r2 = Disclose.verify(pres, {
      holderKey: holder.publicKeyRaw,
      expectedAud: "did:test:v",
      nowSec: 1_700_000_000,
      usedNonces: cache,
    });
    assert.equal(r2.ok, true);
  });

  it("audit ingest rejects forgeries and enforces seq continuity", () => {
    const a = new Audit(() => 1_700_000_000);
    a.append({ actor: "a", action: "x" });
    const lines = a.toJSONL().trim().split("\n");
    const tampered = JSON.parse(lines[0] as string) as Record<string, unknown>;
    tampered["action"] = "refund";
    const f = new Audit(() => 1_700_000_000);
    assert.throws(() => f.ingest(JSON.stringify(tampered)), /hash mismatch/);
    const g = new Audit(() => 1_700_000_000);
    const e0 = JSON.parse(lines[0] as string) as Record<string, unknown>;
    (e0 as Record<string, unknown>)["seq"] = 5;
    assert.throws(() => g.ingest(JSON.stringify(e0)), /seq gap/);
  });

  it("execute binds redemption chainId to the instruction", async () => {
    const { FakePaymentExecutor } = await import("../src/index.js");
    const ex = new FakePaymentExecutor();
    await assert.rejects(() =>
      executeAndReceipt(
        ex,
        {
          capabilityId: "cid-A",
          recipient: "r",
          amount: 1,
          currency: "INR",
          resource: "x",
          purpose: "p",
        },
        { ok: true, chainId: "cid-B" } as never,
        1_700_000_000
      )
    );
  });

  it("registry rejects same-key rotation", () => {
    const reg = new RecipientRegistry(() => 1_700_000_000);
    const k = new Uint8Array(32).fill(1);
    reg.register("shop", k);
    assert.throws(() => reg.rotate("shop", k), /already bound/);
  });

  it("x402 rejects bad timeout/scheme/network and binds requirements", () => {
    const good = {
      scheme: "exact",
      network: "eip155:84532",
      amount: "100",
      asset: "0xabc",
      payTo: "0xpay",
      maxTimeoutSeconds: 60,
    };
    const hdr = (accepts: unknown) =>
      Buffer.from(
        JSON.stringify({
          x402Version: 2,
          resource: { url: "https://api.example.com/data" },
          accepts,
        }),
        "utf8"
      ).toString("base64");
    assert.throws(() =>
      parsePaymentRequired(hdr([{ ...good, maxTimeoutSeconds: Infinity }]))
    );
    assert.throws(() =>
      parsePaymentRequired(hdr([{ ...good, scheme: "evil" }]))
    );
    assert.throws(() =>
      parsePaymentRequired(hdr([{ ...good, network: "mainnet" }]))
    );
    assert.throws(() => parsePaymentRequired("!!!not-base64!!!"));
    assert.equal(
      requirementMatches(good as never, {
        asset: "0xabc",
        network: "eip155:84532",
      }),
      true
    );
    assert.equal(
      requirementMatches(good as never, {
        asset: "0xjunk",
        network: "eip155:84532",
      }),
      false
    );
    assert.equal(
      checkSettlement(
        { success: true, transaction: "", network: "n", payer: "p" } as never,
        {
          network: "n",
          payer: "p",
        }
      ).ok,
      false
    );
    assert.equal(
      checkSettlement(
        { success: true, transaction: 123, network: "n", payer: "p" } as never,
        {
          network: "n",
          payer: "p",
        }
      ).ok,
      false
    );
  });

  it("ap2 binds termsDigest to transactionId", () => {
    const v = {
      payeeId: "did:test:payee",
      payeeName: "Shop",
      amountMinor: 10,
      currency: "INR",
      agentKey: { kty: "EC", crv: "P-256", x: "x", y: "y" },
      transactionId: "ab".repeat(32),
      mode: "direct",
    } as never;
    assert.throws(() =>
      toAp2PaymentDemand(v, {
        principal: "p",
        agent: "a",
        purpose: "x",
        resource: "r",
        termsDigest: "00".repeat(32),
      })
    );
    const { demand } = toAp2PaymentDemand(v, {
      principal: "p",
      agent: "a",
      purpose: "x",
      resource: "r",
    });
    assert.equal(demand.termsDigest, "ab".repeat(32));
  });

  it("webmcp rejects bad names, userinfo origins, and keeps same-origin with grants", () => {
    assert.throws(() =>
      checkToolRegistration({
        name: 123 as unknown as string,
        description: "d",
        origin: "https://app.example.com",
      })
    );
    assert.throws(() =>
      checkSecureOrigin("https://user:pass@app.example.com/")
    );
    assert.throws(() => checkSecureOrigin("https://10.0.0.5/"));
    assert.equal(
      isExposedTo(
        {
          origin: "https://app.example.com",
          exposedTo: ["https://b.example.com"],
        },
        "https://app.example.com"
      ),
      true
    );
  });

  it("a2a rejects jku, malformed sigs, and empty modes without crashing", () => {
    assert.throws(() => canonicalJcs("lone-\ud800-surrogate"));
    assert.throws(() =>
      verifyCardSignatures(
        { signatures: [null] } as unknown as Record<string, unknown> & {
          readonly signatures?: readonly never[];
        },
        () => null
      )
    );
    assert.throws(() =>
      checkAgentCard({
        name: "n",
        description: "d",
        version: "1",
        supportedInterfaces: [
          {
            url: "https://a.example.com/",
            protocolBinding: "x",
            protocolVersion: "1",
          },
        ],
        provider: { organization: "o" },
        defaultInputModes: [""],
        defaultOutputModes: ["text"],
        skills: [{ id: "s", name: "n", description: "d" }],
      })
    );
  });

  it("oid4vp enforces nonce length, vp_token shape, scope type, and hash equality", () => {
    const pinned = { allowed: ["redirect_uri"] as const };
    assert.throws(() =>
      requestToDisclosureDemand(
        {
          response_type: "vp_token",
          client_id: "redirect_uri:https://v.example.com/cb",
          response_mode: "fragment",
          nonce: "x",
          scope: "openid",
        },
        pinned
      )
    );
    assert.throws(() =>
      requestToDisclosureDemand(
        {
          response_type: "vp_token",
          client_id: "redirect_uri:https://v.example.com/cb",
          response_mode: "weird",
          nonce: "0123456789abcdef",
          scope: "openid",
        },
        pinned
      )
    );
    assert.throws(() =>
      requestToDisclosureDemand(
        {
          response_type: "vp_token",
          client_id: "redirect_uri:https://v.example.com/cb",
          response_mode: "fragment",
          nonce: "0123456789abcdef",
          scope: 123,
        },
        pinned
      )
    );
    assert.throws(() =>
      checkResponseBinding(
        { nonce: "n", aud: "a" },
        {
          expectedNonce: "n",
          expectedAud: "a",
          transactionDataRequested: false,
          holderBindingPresent: true,
          kbRequired: false,
        }
      )
    );
    assert.throws(() =>
      checkResponseBinding(
        { vp_token: "t", nonce: "n", aud: "a", transaction_data_hashes: ["x"] },
        {
          expectedNonce: "n",
          expectedAud: "a",
          transactionDataRequested: true,
          holderBindingPresent: true,
          kbRequired: false,
          expectedTransactionData: ["y"],
        }
      )
    );
    assert.throws(() => parseClientId("redirect_uri:!!!", pinned));
  });

  it("keystore pins KDF and validates hex", () => {
    const sealed = sealKeystore({ a: new Uint8Array([1, 2, 3]) }, "pass-123");
    assert.equal(sealed.kdf.N, 16384);
    const evil = JSON.parse(JSON.stringify(sealed)) as typeof sealed & {
      kdf: { N: number };
    };
    (evil.kdf as { N: number }).N = 1024;
    assert.throws(() => openKeystore(evil, "pass-123"), /KDF/);
    const badHex = JSON.parse(JSON.stringify(sealed)) as typeof sealed;
    (badHex as unknown as Record<string, unknown>)["ivHex"] = "zz";
    assert.throws(() => openKeystore(badHex, "pass-123"), /corrupt/);
  });

  it("file audit refuses to open a broken chain", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "ptf-audit-"));
    const p = join(dir, "audit.jsonl");
    const a = new Audit(() => 1_700_000_000);
    a.append({ actor: "a", action: "x" });
    writeFileSync(p, a.toJSONL(), "utf8");
    // Corrupt the hash: open must fail closed.
    const lines = a.toJSONL().trim().split("\n");
    const bad = JSON.parse(lines[0] as string) as Record<string, unknown>;
    bad["action"] = "refund";
    writeFileSync(p, `${JSON.stringify(bad)}\n`, "utf8");
    assert.throws(() => FileAuditLog.open(p, () => 1_700_000_000), /corrupt/);
  });

  it("terms digests separate currency/recipient variants", () => {
    const a = termsDigestOf({
      principal: "p",
      agent: "a",
      cmd: "/pay",
      purpose: "x",
      resource: "r",
      recipient: "m1",
      amount: 100,
      currency: "INR",
    });
    const b = termsDigestOf({
      principal: "p",
      agent: "a",
      cmd: "/pay",
      purpose: "x",
      resource: "r",
      recipient: "m2",
      amount: 100,
      currency: "INR",
    });
    assert.notEqual(a, b);
  });
});
