import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Authority,
  RecipientRegistry,
  VaultStore,
  VAULT_DEK_ALIAS,
  claimsSubset,
  createVaultDek,
  generateEd25519Keypair,
  saveAuthority,
  saveRegistry,
  saveVault,
  sealKeystore,
} from "../src/index.js";
const SERVER = fileURLToPath(new URL("../src/mcp-server.js", import.meta.url));
const P = "did:test:owner";
const A = "did:test:agent";
const V = "did:test:verifier";
const NONCE = "n-0123456789abcdef";
const RES_A = "credential:issuer-1";
const RES_B = "credential:issuer-2";
interface RpcClient {
  call(method: string, params?: unknown): Promise<Record<string, unknown>>;
  close(): void;
}
function connect(env: Record<string, string>): RpcClient {
  const child: ChildProcess = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buffer = "";
  const waiters = new Map<number, (msg: Record<string, unknown>) => void>();
  let nextId = 1;
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length === 0) continue;
      const msg = JSON.parse(line) as Record<string, unknown>;
      if (typeof msg["id"] === "number") {
        waiters.get(msg["id"])?.(msg);
        waiters.delete(msg["id"] as number);
      }
    }
  });
  return {
    call(
      method: string,
      params: unknown = {}
    ): Promise<Record<string, unknown>> {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(id);
          reject(new Error(`rpc timeout: ${method}`));
        }, 15000);
        waiters.set(id, (msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
        child.stdin?.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`
        );
      });
    },
    close(): void {
      try {
        child.kill("SIGKILL");
      } catch {
        child.kill();
      }
    },
  };
}
function textOf(response: Record<string, unknown>): string {
  const result = response["result"] as
    { content?: { type?: string; text?: string }[] } | undefined;
  const text = result?.content?.[0]?.text;
  assert.equal(typeof text, "string");
  return text as string;
}
function failed(response: Record<string, unknown>): boolean {
  return (
    response["error"] !== undefined ||
    (response["result"] as { isError?: boolean } | undefined)?.isError === true
  );
}
function seedStore(): string {
  const liveNow = Math.floor(Date.now() / 1000);
  const dir = mkdtempSync(join(tmpdir(), "ptf-nonce-"));
  const auth = new Authority({ nowSec: () => liveNow });
  auth.addGrant({
    id: "g-disclose",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/disclose" },
    bounds: claimsSubset(["email"]),
    exp: liveNow + 3600,
  });
  saveAuthority(dir, auth);
  saveRegistry(dir, new RecipientRegistry(() => liveNow));
  const kp = generateEd25519Keypair();
  const dek = createVaultDek();
  const vault = new VaultStore(() => liveNow);
  vault.putRecord({
    id: "r-email",
    owner: P,
    type: "email",
    value: "owner@example.com",
    sensitivity: "general",
    source: "user",
    allowedPurposes: ["support"],
    allowedAgents: [A],
    expiresAt: null,
  });
  saveVault(dir, vault, { dek });
  const pkcs8 = new Uint8Array(
    kp.privateKey.export({ format: "der", type: "pkcs8" })
  );
  writeFileSync(
    join(dir, "keystore.json"),
    JSON.stringify(
      sealKeystore({ [VAULT_DEK_ALIAS]: dek, [P]: pkcs8 }, "test-pass")
    )
  );
  return dir;
}
function launch(dir: string): RpcClient {
  return connect({
    PTF_STORE_DIR: dir,
    PTF_PASSPHRASE: "test-pass",
    PTF_MCP_PRINCIPAL: P,
    PTF_MCP_ACTOR: A,
  });
}
async function init(rpc: RpcClient): Promise<void> {
  await rpc.call("initialize", {
    protocolVersion: "2026-07-28",
    capabilities: {},
    clientInfo: { name: "nonce-restart", version: "1" },
  });
}
async function request(rpc: RpcClient, resource: string): Promise<string> {
  const res = await rpc.call("tools/call", {
    name: "ptf_request_data",
    arguments: { purpose: "support", resource, verifier: V, claims: ["email"] },
  });
  const body = JSON.parse(textOf(res)) as {
    allowed?: boolean;
    termsDigest?: string;
  };
  assert.equal(body.allowed, true);
  assert.ok(body.termsDigest);
  return body.termsDigest as string;
}
async function present(
  rpc: RpcClient,
  digest: string,
  nonce: string
): Promise<Record<string, unknown>> {
  return rpc.call("tools/call", {
    name: "ptf_present_data",
    arguments: { termsDigest: digest, nonce },
  });
}
describe("MCP nonce restart: replay hole", () => {
  it("control: same-process nonce reuse across fresh digests denies as replay", async () => {
    const rpc = launch(seedStore());
    try {
      await init(rpc);
      const digestA = await request(rpc, RES_A);
      assert.equal(
        (
          JSON.parse(textOf(await present(rpc, digestA, NONCE))) as {
            presented?: boolean;
          }
        ).presented,
        true
      );
      const digestB = await request(rpc, RES_B);
      assert.notEqual(digestB, digestA);
      const retry = await present(rpc, digestB, NONCE);
      assert.equal(failed(retry), true, "nonce reuse in-process must deny");
      assert.match(textOf(retry), /replay/);
    } finally {
      rpc.close();
    }
  });
  it("red: nonce reuse across SIGKILL restart must deny as replay", async () => {
    const dir = seedStore();
    const rpc = launch(dir);
    try {
      await init(rpc);
      const digestA = await request(rpc, RES_A);
      assert.equal(
        (
          JSON.parse(textOf(await present(rpc, digestA, NONCE))) as {
            presented?: boolean;
          }
        ).presented,
        true
      );
    } finally {
      rpc.close();
    }
    await new Promise((r) => setTimeout(r, 500));
    const rpc2 = launch(dir);
    try {
      await init(rpc2);
      const digestB = await request(rpc2, RES_B);
      const retry = await present(rpc2, digestB, NONCE);
      assert.equal(failed(retry), true, "nonce reuse across restart must deny");
      assert.match(textOf(retry), /replay/);
    } finally {
      rpc2.close();
    }
  });
});
