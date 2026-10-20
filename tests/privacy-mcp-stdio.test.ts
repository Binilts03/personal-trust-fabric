import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Authority,
  VaultStore,
  RecipientRegistry,
  createVaultDek,
  generateEd25519Keypair,
  saveAuthority,
  saveRegistry,
  saveVault,
  sealKeystore,
  claimsSubset,
  paymentBounds,
  signBytes,
  openKeystore,
  VAULT_DEK_ALIAS,
} from "../src/index.js";
import {
  PrivacyStore,
  createPrivacyDek,
  savePrivacyStore,
  PRIVACY_DEK_ALIAS,
} from "../src/store/privacy.js";
import { FilePrivacyEventRepository } from "../src/store/privacy-events.js";

const SERVER = fileURLToPath(new URL("../src/mcp-server.js", import.meta.url));
const P = "did:test:p";
const A = "did:test:a";

function setup(active: boolean): {
  dir: string;
  configPath: string;
  recipientDer: Uint8Array;
  recipientPub: Uint8Array;
} {
  const at = Math.floor(Date.now() / 1000);
  const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-mcp-"));
  const principal = generateEd25519Keypair();
  const recipient = generateEd25519Keypair();
  const auth = new Authority({ nowSec: () => at });
  auth.addGrant({
    id: "grant-privacy",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/disclose" },
    resource: { type: "credential", id: "personal-state" },
    purpose: "support",
    bounds: claimsSubset(["email"]),
    exp: at + 300,
  });
  auth.addGrant({
    id: "grant-payment",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/pay" },
    resource: { type: "ptf-resource", id: "invoice:1" },
    purpose: "support",
    bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    exp: at + 300,
  });
  saveAuthority(dir, auth);
  const registry = new RecipientRegistry(() => at);
  registry.register(P, principal.publicKeyRaw, at);
  registry.register("seller:1", recipient.publicKeyRaw, at);
  saveRegistry(dir, registry);

  const vaultDek = createVaultDek();
  const vault = new VaultStore(() => at);
  vault.putRecord({
    id: "r-email",
    owner: P,
    type: "email",
    value: "protected-person@example.com",
    sensitivity: "general",
    source: "user",
    allowedPurposes: ["support"],
    allowedAgents: [A],
    expiresAt: null,
  });
  saveVault(dir, vault, { dek: vaultDek });

  const privacyDek = createPrivacyDek();
  const privacy = new PrivacyStore(() => at);
  privacy.addBasis({
    kind: "certain-legitimate-use",
    id: "basis-support",
    controllerId: "acme",
    purpose: "support",
    dataCategories: ["email", "payment"],
    provisionRef: "operator-asserted:s7",
    evidenceRef: "operator-evidence:1",
    assertedBy: "privacy-office",
    active,
  });
  privacy.addActivity({
    id: "act-support",
    profileId: "IN-DPDP-2025",
    authorityPrincipal: P,
    controllerId: "acme",
    subjects: { kind: "exact", ref: "subject:opaque-1" },
    action: "/disclose",
    resourceType: "credential",
    purpose: "support",
    dataCategories: ["email"],
    recipients: [{ id: "verifier", role: "third-party" }],
    basisId: "basis-support",
    active: true,
  });
  privacy.addActivity({
    id: "act-payment",
    profileId: "IN-DPDP-2025",
    authorityPrincipal: P,
    controllerId: "acme",
    subjects: { kind: "exact", ref: "subject:opaque-1" },
    action: "/pay",
    resourceType: "ptf-resource",
    purpose: "support",
    dataCategories: ["payment"],
    recipients: [{ id: "seller:1", role: "third-party" }],
    basisId: "basis-support",
    active: true,
  });
  savePrivacyStore(dir, privacy, { dek: privacyDek });

  const principalSeed = new Uint8Array(
    principal.privateKey.export({ format: "der", type: "pkcs8" })
  );
  writeFileSync(
    join(dir, "keystore.json"),
    JSON.stringify(
      sealKeystore(
        {
          [P]: principalSeed,
          [VAULT_DEK_ALIAS]: vaultDek,
          [PRIVACY_DEK_ALIAS]: privacyDek,
        },
        "privacy-test-pass"
      )
    )
  );
  const configPath = join(dir, "privacy-config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      dataPrincipalRef: "subject:opaque-1",
      controllerId: "acme",
      recipientRoles: { verifier: "third-party", "seller:1": "third-party" },
      actionCategories: { "/pay": ["payment"] },
    })
  );
  const recipientDer = new Uint8Array(
    recipient.privateKey.export({ format: "der", type: "pkcs8" })
  );
  return {
    dir,
    configPath,
    recipientDer,
    recipientPub: recipient.publicKeyRaw,
  };
}

async function withRpc<T>(
  env: Record<string, string>,
  test: (
    call: (name: string, args: Record<string, unknown>) => Promise<any>
  ) => Promise<T>
): Promise<T> {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const waits = new Map<number, (value: any) => void>();
  let id = 0;
  let stderr = "";
  child.stderr?.on("data", (buf: Buffer) => {
    stderr += buf.toString();
  });
  child.stdout?.on("data", (buf: Buffer) => {
    buffer += buf.toString();
    let nl = -1;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const done = waits.get(response.id);
      if (done) {
        waits.delete(response.id);
        done(response);
      }
    }
  });
  const rpc = (method: string, params: unknown): Promise<any> => {
    const key = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waits.delete(key);
        reject(
          new Error("MCP timeout: " + method + " " + stderr.slice(0, 1200))
        );
      }, 12000);
      waits.set(key, (x) => {
        clearTimeout(timer);
        resolve(x);
      });
      child.stdin?.write(
        JSON.stringify({ jsonrpc: "2.0", id: key, method, params }) + "\n"
      );
    });
  };
  try {
    const init = await rpc("initialize", {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "privacy-test", version: "1" },
    });
    assert.ok(init.result?.serverInfo);
    return await test((name, args) =>
      rpc("tools/call", { name, arguments: args })
    );
  } finally {
    child.kill();
  }
}

function resultData(response: any): any {
  const text = response.result?.content?.[0]?.text;
  if (typeof text !== "string")
    throw new Error("No MCP text: " + JSON.stringify(response));
  return JSON.parse(text);
}

describe("opt-in privacy disclosure over stdio", () => {
  it("denies a valid authority when its privacy basis is inactive", async () => {
    const { dir, configPath } = setup(false);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const out = resultData(
          await call("ptf_request_data", {
            purpose: "support",
            resource: "personal-state",
            verifier: "verifier",
            claims: ["email"],
          })
        );
        assert.equal(out.allowed, false);
        assert.equal(out.reason, "privacy denied");
      }
    );
  });

  it("permits authorised+privacy-approved disclosure and records an encrypted event", async () => {
    const { dir, configPath } = setup(true);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const out = resultData(
          await call("ptf_request_data", {
            purpose: "support",
            resource: "personal-state",
            verifier: "verifier",
            claims: ["email"],
          })
        );
        assert.equal(out.allowed, true);
        const presented = resultData(
          await call("ptf_present_data", {
            termsDigest: out.termsDigest,
            nonce: "dW5pcXVlLXByaXZhY3ktbm9uY2UrLw==",
          })
        );
        assert.equal(presented.presented, true);
        assert.equal(presented.disclosed[0], "email");
        assert.match(presented.notice, /consumes one authority use/);
        assert.doesNotMatch(presented.notice, /no uses consumed/);
      }
    );
    assert.equal(readdirSync(join(dir, "privacy-events")).length, 1);
  });

  it("gates the actual MCP payment redemption and journal with privacy evidence", async () => {
    const { dir, configPath, recipientDer, recipientPub } = setup(true);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        assert.equal(proposal.allowed, true);
        const challenge = resultData(
          await call("ptf_redeem", {
            termsDigest: proposal.termsDigest,
          })
        );
        assert.equal(challenge.needProof, true);
        const { createPrivateKey } = await import("node:crypto");
        const privateKey = createPrivateKey({
          key: Buffer.from(recipientDer),
          format: "der",
          type: "pkcs8",
        });
        const signature = signBytes(
          privateKey,
          new Uint8Array(Buffer.from(challenge.cidHex, "hex"))
        );
        const paid = resultData(
          await call("ptf_redeem", {
            termsDigest: proposal.termsDigest,
            recipientKeyHex: Buffer.from(recipientPub).toString("hex"),
            recipientSigHex: Buffer.from(signature).toString("hex"),
          })
        );
        assert.equal(paid.amount, 100);
        assert.ok(paid.receiptId);
      }
    );
    const eventRepo = new FilePrivacyEventRepository({
      dir,
      dek: openKeystore(
        JSON.parse(readFileSync(join(dir, "keystore.json"), "utf8")),
        "privacy-test-pass"
      )[PRIVACY_DEK_ALIAS] as Uint8Array,
    });
    const records = eventRepo.listBySubject("subject:opaque-1");
    assert.ok(
      records.some(
        (record) => record.action === "/pay" && record.state === "SUCCEEDED"
      )
    );
  });

  it("denies payment in privacy mode when its operator category mapping is absent", async () => {
    const { dir, configPath } = setup(true);
    writeFileSync(
      configPath,
      JSON.stringify({
        dataPrincipalRef: "subject:opaque-1",
        controllerId: "acme",
        recipientRoles: { "seller:1": "third-party" },
      })
    );
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const result = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        assert.equal(result.allowed, false);
        assert.equal(result.reason, "privacy denied");
      }
    );
  });

  it("denies ptf_request_action in privacy mode and never leaks store detail on corruption", async () => {
    const { dir, configPath } = setup(true);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const action = await call("ptf_request_action", {
          cmd: "/send",
          resource: "message:1",
        });
        assert.match(
          JSON.stringify(action.error ?? action.result),
          /not supported|privacy mode/
        );
        const out = resultData(
          await call("ptf_request_data", {
            purpose: "support",
            resource: "personal-state",
            verifier: "verifier",
            claims: ["email"],
          })
        );
        assert.equal(out.allowed, true);
        writeFileSync(join(dir, "privacy-state.json"), "corrupt");
        const failed = await call("ptf_present_data", {
          termsDigest: out.termsDigest,
          nonce: "unique-privacy-nonce-02",
        });
        const text = JSON.stringify(failed);
        assert.match(text, /privacy denied/);
        assert.doesNotMatch(
          text,
          /privacy-state|keystore|DEK|kid|[A-Za-z]:[\\/]/i
        );
      }
    );
  });

  it("preserves legacy disabled mode without requiring a privacy basis", async () => {
    const { dir } = setup(false);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
      },
      async (call) => {
        const out = resultData(
          await call("ptf_request_data", {
            purpose: "support",
            resource: "personal-state",
            verifier: "verifier",
            claims: ["email"],
          })
        );
        assert.equal(out.allowed, true);
      }
    );
  });
});
