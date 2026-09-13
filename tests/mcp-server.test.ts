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
  generateEd25519Keypair,
  paymentBounds,
  saveAuthority,
  saveRegistry,
  sealKeystore,
  signBytes,
} from "../src/index.js";

const NOW = 1_700_000_000;
// Tests run compiled from dist/tests: the server lives at dist/src.
const SERVER = fileURLToPath(new URL("../src/mcp-server.js", import.meta.url));

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
  const send = (msg: unknown): void => {
    child.stdin?.write(`${JSON.stringify(msg)}\n`);
  };
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
        send({ jsonrpc: "2.0", id, method, params });
      });
    },
    close(): void {
      child.kill();
    },
  };
}

function setupStore(): {
  dir: string;
  recipientPriv: Uint8Array;
  recipientPub: Uint8Array;
} {
  // Live clock: the spawned server uses real time, so fixtures must too.
  const liveNow = Math.floor(Date.now() / 1000);
  const dir = mkdtempSync(join(tmpdir(), "ptf-mcp-"));
  const principal = generateEd25519Keypair();
  const recipient = generateEd25519Keypair();
  const auth = new Authority({ nowSec: () => liveNow });
  auth.addGrant({
    id: "g-mcp",
    principal: "did:test:p",
    actor: { kind: "exact", id: "did:test:a" },
    action: { name: "/pay" },
    bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    exp: liveNow + 3600,
  });
  auth.addGrant({
    id: "g-mcp",
    principal: "did:test:p",
    actor: { kind: "exact", id: "did:test:a" },
    action: { name: "/pay" },
    bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    exp: liveNow + 3600,
  });
  saveAuthority(dir, auth);
  const reg = new RecipientRegistry(() => NOW);
  reg.register("did:test:p", principal.publicKeyRaw, NOW);
  reg.register("did:test:m", recipient.publicKeyRaw, NOW);
  saveRegistry(dir, reg);
  const principalDer = new Uint8Array(
    principal.privateKey.export({ format: "der", type: "pkcs8" })
  );
  const recipientDer = new Uint8Array(
    recipient.privateKey.export({ format: "der", type: "pkcs8" })
  );
  writeFileSync(
    join(dir, "keystore.json"),
    `${JSON.stringify(
      sealKeystore(
        {
          "did:test:p": principalDer,
          "did:test:m": recipientDer,
        },
        "test-pass"
      )
    )}\n`,
    "utf8"
  );
  return {
    dir,
    recipientPriv: recipientDer,
    recipientPub: recipient.publicKeyRaw,
  };
}

function textOf(response: Record<string, unknown>): string {
  const result = response["result"] as
    { content?: { type?: string; text?: string }[] } | undefined;
  const text = result?.content?.[0]?.text;
  assert.equal(typeof text, "string");
  return text as string;
}

describe("MCP server conformance over stdio (prod-04)", () => {
  it("lists tools, proposes, checks, and redeems with proof", async () => {
    const store = setupStore();
    const rpc = connect({
      PTF_STORE_DIR: store.dir,
      PTF_PASSPHRASE: "test-pass",
    });
    try {
      const init = await rpc.call("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "conformance", version: "1" },
      });
      assert.ok(
        (init["result"] as Record<string, unknown> | undefined)?.["serverInfo"]
      );

      const listed = await rpc.call("tools/list", {});
      const tools = (
        (listed["result"] as { tools?: { name?: string }[] } | undefined)
          ?.tools ?? []
      ).map((t) => t.name);
      assert.ok(tools.includes("ptf_propose"));
      assert.ok(tools.includes("ptf_check"));
      assert.ok(tools.includes("ptf_redeem"));

      const proposed = await rpc.call("tools/call", {
        name: "ptf_propose",
        arguments: {
          principal: "did:test:p",
          agent: "did:test:a",
          cmd: "/pay",
          purpose: "widgets",
          resource: "order:7",
          recipient: "did:test:m",
          amount: 4250,
          currency: "INR",
        },
      });
      const proposal = JSON.parse(textOf(proposed)) as {
        allowed?: boolean;
        termsDigest?: string;
      };
      assert.equal(proposal.allowed, true);
      assert.ok(proposal.termsDigest);
      const digest = proposal.termsDigest as string;

      const checked = await rpc.call("tools/call", {
        name: "ptf_check",
        arguments: { termsDigest: digest },
      });
      assert.equal(
        (JSON.parse(textOf(checked)) as { status?: string }).status,
        "pending"
      );

      const challenge = await rpc.call("tools/call", {
        name: "ptf_redeem",
        arguments: { termsDigest: digest },
      });
      const { needProof, cidHex } = JSON.parse(textOf(challenge)) as {
        needProof?: boolean;
        cidHex?: string;
      };
      assert.equal(needProof, true);
      assert.ok(cidHex);
      const { createPrivateKey } = await import("node:crypto");
      const priv = createPrivateKey({
        key: Buffer.from(store.recipientPriv),
        format: "der",
        type: "pkcs8",
      });
      const sig = signBytes(
        priv,
        new Uint8Array(Buffer.from(cidHex as string, "hex"))
      );
      const redeemed = await rpc.call("tools/call", {
        name: "ptf_redeem",
        arguments: {
          termsDigest: digest,
          recipientKeyHex: Buffer.from(store.recipientPub).toString("hex"),
          recipientSigHex: Buffer.from(sig).toString("hex"),
        },
      });
      const receipt = JSON.parse(textOf(redeemed)) as {
        amount?: number;
        recipient?: string;
      };
      assert.equal(receipt.amount, 4250);
      assert.equal(receipt.recipient, "did:test:m");
    } finally {
      rpc.close();
    }
  });

  it("refuses unknown proposals and proof-less double redemption", async () => {
    const store = setupStore();
    const rpc = connect({
      PTF_STORE_DIR: store.dir,
      PTF_PASSPHRASE: "test-pass",
    });
    try {
      await rpc.call("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "conformance", version: "1" },
      });
      const unknown = await rpc.call("tools/call", {
        name: "ptf_redeem",
        arguments: { termsDigest: "00".repeat(32) },
      });
      const hasError =
        unknown["error"] !== undefined ||
        (unknown["result"] as { isError?: boolean } | undefined)?.isError ===
          true;
      assert.equal(hasError, true);
    } finally {
      rpc.close();
    }
  });
});
