import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  Disclose,
  RecipientRegistry,
  VaultStore,
  claimsSubset,
  createVaultDek,
  generateEd25519Keypair,
  paymentBounds,
  saveAuthority,
  saveRegistry,
  saveVault,
  sealKeystore,
  VAULT_DEK_ALIAS,
} from "../src/index.js";
import { createPtfServer } from "../src/mcp-server.js";

const NOW = 1_700_000_000;
const P = "did:test:owner";
const A = "did:test:agent";
const V = "did:test:verifier";
const M = "did:test:merchant";
const EMAIL = "owner@example.com";
const SECRET = "PAN-SECRET-4111-never-leaves-host";
const PASS = "test-pass";
const NONCE = "n-0123456789abcdef";

function setup(): {
  dir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any;
  principalKp: ReturnType<typeof generateEd25519Keypair>;
} {
  const dir = mkdtempSync(join(tmpdir(), "ptf-present-"));
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "g-disclose",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/disclose" },
    bounds: claimsSubset(["email"]),
    exp: NOW + 3600,
  });
  auth.addGrant({
    id: "g-pay",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/pay" },
    bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
    exp: NOW + 3600,
  });
  saveAuthority(dir, auth);
  const reg = new RecipientRegistry(() => NOW);
  saveRegistry(dir, reg);
  const principalKp = generateEd25519Keypair();
  const dek = createVaultDek();
  const vault = new VaultStore(() => NOW);
  vault.putRecord({
    id: "r-email",
    owner: P,
    type: "email",
    value: EMAIL,
    sensitivity: "general",
    source: "user",
    allowedPurposes: ["support"],
    allowedAgents: [A],
    expiresAt: null,
  });
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
  saveVault(dir, vault, { dek });
  const pkcs8 = new Uint8Array(
    principalKp.privateKey.export({ format: "der", type: "pkcs8" })
  );
  const sealed = sealKeystore({ [VAULT_DEK_ALIAS]: dek, [P]: pkcs8 }, PASS);
  writeFileSync(join(dir, "keystore.json"), JSON.stringify(sealed));
  const server = createPtfServer({
    dir,
    env: { PTF_PASSPHRASE: PASS },
    principal: P,
    actor: A,
    now: () => NOW,
  });
  return { dir, server, principalKp };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(
  server: any,
  name: string,
  args: unknown
): Promise<unknown> {
  const tool = server._registeredTools[name];
  assert.ok(tool, `tool ${name} registered`);
  const res = await tool.handler(args);
  const text = (res.content[0] as { text: string }).text;
  return JSON.parse(text) as unknown;
}

describe("agent data-delivery loop (ptf_present_data)", () => {
  it("presents a /disclose proposal holder-signed, secret absent", async () => {
    const { server, principalKp } = setup();
    const req = (await callTool(server, "ptf_request_data", {
      purpose: "support",
      resource: "credential:issuer-1",
      verifier: V,
      claims: ["email"],
    })) as { allowed?: boolean; termsDigest?: string };
    assert.equal(req.allowed, true);
    assert.ok(typeof req.termsDigest === "string");
    const digest = req.termsDigest as string;

    const out = (await callTool(server, "ptf_present_data", {
      termsDigest: digest,
      nonce: NONCE,
    })) as {
      presented?: boolean;
      termsDigest?: string;
      disclosed?: string[];
      presentation?: {
        issuer?: string;
        subject?: string;
        holder?: string;
        verifier?: string;
        nonce?: string;
        iat?: number;
        disclosures?: { name?: string; value?: unknown }[];
        sigHex?: string;
      };
    };
    assert.equal(out.presented, true);
    assert.equal(out.termsDigest, digest);
    assert.deepEqual(out.disclosed, ["email"]);
    assert.ok(out.presentation);
    assert.equal(out.presentation?.verifier, V);
    assert.equal(out.presentation?.nonce, NONCE);
    assert.equal(out.presentation?.holder, P);
    assert.deepEqual(
      (out.presentation?.disclosures ?? []).map((d) => d.name),
      ["email"]
    );
    assert.equal((out.presentation?.disclosures ?? [])[0]?.value, EMAIL);
    assert.ok(
      !JSON.stringify(out).includes(SECRET),
      "secret must never enter the presentation"
    );

    // Reconstruct the sig and verify as the verifier would.
    const sigHex = out.presentation?.sigHex as string;
    assert.ok(typeof sigHex === "string" && sigHex.length === 128);
    const pres = {
      issuer: out.presentation?.issuer as string,
      subject: out.presentation?.subject as string,
      holder: out.presentation?.holder as string,
      verifier: out.presentation?.verifier as string,
      nonce: out.presentation?.nonce as string,
      iat: out.presentation?.iat as number,
      disclosures: (out.presentation as unknown as { disclosures: [] })
        .disclosures as never,
      sig: new Uint8Array(Buffer.from(sigHex, "hex")),
    };
    // Rebuild with the exact Disclosure shape for verify.
    const full = {
      ...pres,
      disclosures: (out.presentation?.disclosures ?? []) as unknown as {
        name: string;
        value: unknown;
        salt: string;
        digest: string;
      }[],
    };
    const verified = Disclose.verify(full, {
      holderKey: principalKp.publicKeyRaw,
      expectedAud: V,
      nowSec: NOW,
    });
    assert.equal(verified.ok, true);
    if (verified.ok) assert.deepEqual([...verified.disclosed], ["email"]);
  });

  it("wrong-verifier verify fails (audience)", async () => {
    const { server, principalKp } = setup();
    const req = (await callTool(server, "ptf_request_data", {
      purpose: "support",
      resource: "credential:issuer-1",
      verifier: V,
      claims: ["email"],
    })) as { termsDigest?: string };
    const out = (await callTool(server, "ptf_present_data", {
      termsDigest: req.termsDigest as string,
      nonce: "n-abcdef0123456789",
    })) as {
      presentation?: {
        issuer: string;
        subject: string;
        holder: string;
        verifier: string;
        nonce: string;
        iat: number;
        disclosures: {
          name: string;
          value: unknown;
          salt: string;
          digest: string;
        }[];
        sigHex: string;
      };
    };
    const p = out.presentation as NonNullable<typeof out.presentation>;
    const pres = {
      issuer: p.issuer,
      subject: p.subject,
      holder: p.holder,
      verifier: p.verifier,
      nonce: p.nonce,
      iat: p.iat,
      disclosures: p.disclosures,
      sig: new Uint8Array(Buffer.from(p.sigHex, "hex")),
    };
    const bad = Disclose.verify(pres, {
      holderKey: principalKp.publicKeyRaw,
      expectedAud: "did:test:someone-else",
      nowSec: NOW,
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.reason, "audience");
  });

  it("abuse: short nonce rejected", async () => {
    const { server } = setup();
    const req = (await callTool(server, "ptf_request_data", {
      purpose: "support",
      resource: "credential:issuer-1",
      verifier: V,
      claims: ["email"],
    })) as { termsDigest?: string };
    await assert.rejects(
      () =>
        callTool(server, "ptf_present_data", {
          termsDigest: req.termsDigest as string,
          nonce: "short",
        }),
      /nonce/
    );
  });

  it("abuse: unknown digest rejected", async () => {
    const { server } = setup();
    await assert.rejects(
      () =>
        callTool(server, "ptf_present_data", {
          termsDigest: "00".repeat(32),
          nonce: NONCE,
        }),
      /unknown proposal/
    );
  });

  it("abuse: double-present refused (no nonce reuse)", async () => {
    const { server } = setup();
    const req = (await callTool(server, "ptf_request_data", {
      purpose: "support",
      resource: "credential:issuer-1",
      verifier: V,
      claims: ["email"],
    })) as { termsDigest?: string };
    const digest = req.termsDigest as string;
    const first = (await callTool(server, "ptf_present_data", {
      termsDigest: digest,
      nonce: NONCE,
    })) as { presented?: boolean };
    assert.equal(first.presented, true);
    await assert.rejects(
      () =>
        callTool(server, "ptf_present_data", {
          termsDigest: digest,
          nonce: "n-fresh-nonce-0123456",
        }),
      /already presented\/denied/
    );
  });

  it("abuse: /pay proposal refused by present", async () => {
    const { server } = setup();
    const pay = (await callTool(server, "ptf_request_action", {
      cmd: "/pay",
      purpose: "widgets",
      resource: "order:7",
      context: { amount: 100, currency: "INR", recipient: M },
    })) as { allowed?: boolean; termsDigest?: string };
    assert.equal(pay.allowed, true);
    await assert.rejects(
      () =>
        callTool(server, "ptf_present_data", {
          termsDigest: pay.termsDigest as string,
          nonce: NONCE,
        }),
      /present supports \/disclose proposals only; pay via ptf_redeem/
    );
  });
});
