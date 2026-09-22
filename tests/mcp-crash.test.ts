import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Authority,
  RecipientRegistry,
  generateEd25519Keypair,
  loadAuthority,
  paymentBounds,
  saveAuthority,
  saveRegistry,
  sealKeystore,
  signBytes,
} from "../src/index.js";
import { createPrivateKey } from "node:crypto";

const SERVER = fileURLToPath(new URL("../src/mcp-server.js", import.meta.url));
const P = "did:test:owner";
const A = "did:test:agent";
const M = "did:test:m";

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
      child.kill();
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

function seedStore(maxUses: number): {
  dir: string;
  recipient: ReturnType<typeof generateEd25519Keypair>;
} {
  const liveNow = Math.floor(Date.now() / 1000);
  const dir = mkdtempSync(join(tmpdir(), "ptf-crash-"));
  const principal = generateEd25519Keypair();
  const recipient = generateEd25519Keypair();
  const auth = new Authority({ nowSec: () => liveNow });
  auth.addGrant({
    id: "g-reusable",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/pay" },
    bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    exp: liveNow + 3600,
    maxUses,
  });
  saveAuthority(dir, auth);
  const reg = new RecipientRegistry(() => liveNow);
  reg.register(P, principal.publicKeyRaw, liveNow);
  reg.register(M, recipient.publicKeyRaw, liveNow);
  saveRegistry(dir, reg);
  writeFileSync(
    join(dir, "keystore.json"),
    `${JSON.stringify(
      sealKeystore(
        {
          [P]: new Uint8Array(
            principal.privateKey.export({ format: "der", type: "pkcs8" })
          ),
          [M]: new Uint8Array(
            recipient.privateKey.export({ format: "der", type: "pkcs8" })
          ),
        },
        "test-pass"
      )
    )}\n`,
    "utf8"
  );
  return { dir, recipient };
}

async function propose(
  rpc: RpcClient
): Promise<{ digest: string; allowed: boolean }> {
  const res = await rpc.call("tools/call", {
    name: "ptf_propose",
    arguments: {
      cmd: "/pay",
      purpose: "widgets",
      resource: "order:9",
      recipient: M,
      amount: 4250,
      currency: "INR",
    },
  });
  const body = JSON.parse(textOf(res)) as {
    allowed?: boolean;
    termsDigest?: string;
  };
  assert.equal(body.allowed, true);
  assert.ok(body.termsDigest);
  return { digest: body.termsDigest as string, allowed: true };
}

async function redeemOnce(
  rpc: RpcClient,
  digest: string,
  recipient: ReturnType<typeof generateEd25519Keypair>
): Promise<string> {
  const ch = await rpc.call("tools/call", {
    name: "ptf_redeem",
    arguments: { termsDigest: digest },
  });
  const { cidHex } = JSON.parse(textOf(ch)) as { cidHex?: string };
  assert.ok(cidHex);
  const priv = createPrivateKey({
    key: Buffer.from(
      recipient.privateKey.export({ format: "der", type: "pkcs8" })
    ),
    format: "der",
    type: "pkcs8",
  });
  const sig = signBytes(priv, new Uint8Array(Buffer.from(cidHex, "hex")));
  const done = await rpc.call("tools/call", {
    name: "ptf_redeem",
    arguments: {
      termsDigest: digest,
      recipientKeyHex: Buffer.from(recipient.publicKeyRaw).toString("hex"),
      recipientSigHex: Buffer.from(sig).toString("hex"),
    },
  });
  assert.equal(failed(done), false);
  return (JSON.parse(textOf(done)) as { transaction: string }).transaction;
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
    clientInfo: { name: "crash-matrix", version: "1" },
  });
}

describe("MCP crash matrix: effects reconcile, never resubmit (PR-A)", () => {
  it("crash after provider effect, before proposal transition, reconciles", async () => {
    const { dir, recipient } = seedStore(2);
    const rpc = launch(dir);
    try {
      await init(rpc);
      const { digest } = await propose(rpc);
      const tx1 = await redeemOnce(rpc, digest, recipient);
      // Crash simulation: provider effect happened, proposal file never
      // transitioned to executed (still pending on restart).
      const proposalPath = join(dir, "proposals", `${digest}.json`);
      const stored = JSON.parse(readFileSync(proposalPath, "utf8")) as {
        state: string;
      };
      assert.equal(stored.state, "executed");
      stored.state = "pending";
      writeFileSync(proposalPath, JSON.stringify(stored));
      // Restart remints a fresh challenge; reusable authority covers it.
      const tx2 = await redeemOnce(rpc, digest, recipient);
      // Must reconcile to the SAME effect, never submit a second one.
      assert.equal(tx2, tx1);
      // Secret-freedom across every new surface: the recipient private
      // key (real keystore material) must appear in no journal record,
      // proposal, receipt, or audit line.
      const privHex = Buffer.from(
        recipient.privateKey.export({ format: "der", type: "pkcs8" })
      ).toString("hex");
      const blobs: string[] = [
        readFileSync(proposalPath, "utf8"),
        readFileSync(join(dir, "audit.jsonl"), "utf8"),
      ];
      for (const name of readdirSync(join(dir, "executions"))) {
        if (name.endsWith(".json")) {
          blobs.push(readFileSync(join(dir, "executions", name), "utf8"));
        }
      }
      for (const blob of blobs) {
        assert.ok(!blob.includes(privHex));
      }
    } finally {
      rpc.close();
    }
  });

  it("SIGKILL restart preserves pending proposals with no duplicate effect", async () => {
    const { dir, recipient } = seedStore(2);
    const rpc = launch(dir);
    let digest = "";
    try {
      await init(rpc);
      digest = (await propose(rpc)).digest;
      // Kill -9 mid-flight: stdio transport dies with the process.
      rpc.close();
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      rpc.close();
    }
    // Fresh process over the same store: proposal still pending, no
    // receipt exists anywhere, and the flow completes exactly once.
    const rpc2 = launch(dir);
    try {
      await init(rpc2);
      const status = await rpc2.call("tools/call", {
        name: "ptf_check",
        arguments: { termsDigest: digest },
      });
      assert.equal(
        (JSON.parse(textOf(status)) as { status?: string }).status,
        "pending"
      );
      const tx1 = await redeemOnce(rpc2, digest, recipient);
      assert.ok(tx1.startsWith("fake-tx-"));
      // Executed re-redeem returns the stored receipt directly (fast path:
      // no new challenge, no resubmit) — same transaction.
      const again = await rpc2.call("tools/call", {
        name: "ptf_redeem",
        arguments: { termsDigest: digest },
      });
      const tx2 = (JSON.parse(textOf(again)) as { transaction: string })
        .transaction;
      assert.equal(tx2, tx1);
    } finally {
      rpc2.close();
    }
  });

  it("revoked authority denies remint instead of returning a journaled receipt", async () => {
    const { dir, recipient } = seedStore(5);
    const rpc = launch(dir);
    try {
      await init(rpc);
      const { digest } = await propose(rpc);
      const tx1 = await redeemOnce(rpc, digest, recipient);
      assert.ok(tx1.startsWith("fake-tx-"));
      // Operator revokes the grant out-of-band (uses remain, but the
      // authority is gone). A reminted proposal for the same terms must
      // deny — never resurrect via the journal.
      const auth = loadAuthority(dir, {
        nowSec: () => Math.floor(Date.now() / 1000),
      });
      auth.revoke("g-reusable");
      saveAuthority(dir, auth);
      const res = await rpc.call("tools/call", {
        name: "ptf_propose",
        arguments: {
          cmd: "/pay",
          purpose: "widgets",
          resource: "order:9",
          recipient: M,
          amount: 4250,
          currency: "INR",
        },
      });
      const body = JSON.parse(textOf(res)) as {
        allowed?: boolean;
        reason?: string;
      };
      assert.equal(body.allowed, false);
      assert.equal(body.reason, "revoked");
    } finally {
      rpc.close();
    }
  });

  it("unknown journal outcome over stdio fails closed as reconcile-required", async () => {
    const { dir, recipient } = seedStore(3);
    const rpc = launch(dir);
    try {
      await init(rpc);
      const { digest } = await propose(rpc);
      await redeemOnce(rpc, digest, recipient);
      // Force genuine unknown state: rewind BOTH the proposal (pending,
      // as a crash before transition leaves it) and the journal record
      // (SUBMITTED_UNKNOWN without receipt fields, as a crash during
      // submission leaves it).
      const proposalPath = join(dir, "proposals", `${digest}.json`);
      const stored = JSON.parse(readFileSync(proposalPath, "utf8")) as {
        state: string;
      };
      stored.state = "pending";
      writeFileSync(proposalPath, JSON.stringify(stored));
      const names = readdirSync(join(dir, "executions")).filter((n) =>
        n.endsWith(".json")
      );
      assert.equal(names.length, 1);
      const execPath = join(dir, "executions", names[0] as string);
      const rec = JSON.parse(readFileSync(execPath, "utf8")) as {
        state: string;
      };
      assert.equal(rec.state, "SUCCEEDED");
      rec.state = "SUBMITTED_UNKNOWN";
      delete (rec as Record<string, unknown>)["externalRef"];
      delete (rec as Record<string, unknown>)["receiptId"];
      delete (rec as Record<string, unknown>)["receiptAt"];
      writeFileSync(execPath, JSON.stringify(rec));
      // The stdio surface has no provider query: the reminted redemption
      // must refuse to guess rather than blind-retry, naming reconcile,
      // and the record stays unknown.
      const ch = await rpc.call("tools/call", {
        name: "ptf_redeem",
        arguments: { termsDigest: digest },
      });
      assert.equal(failed(ch), false);
      const { cidHex } = JSON.parse(textOf(ch)) as { cidHex?: string };
      assert.ok(cidHex);
      const priv = createPrivateKey({
        key: Buffer.from(
          recipient.privateKey.export({ format: "der", type: "pkcs8" })
        ),
        format: "der",
        type: "pkcs8",
      });
      const sig = signBytes(priv, new Uint8Array(Buffer.from(cidHex, "hex")));
      const done = await rpc.call("tools/call", {
        name: "ptf_redeem",
        arguments: {
          termsDigest: digest,
          recipientKeyHex: Buffer.from(recipient.publicKeyRaw).toString("hex"),
          recipientSigHex: Buffer.from(sig).toString("hex"),
        },
      });
      assert.equal(failed(done), true);
      assert.ok(textOf(done).includes("reconcile"));
      const reread = JSON.parse(readFileSync(execPath, "utf8")) as {
        state: string;
      };
      assert.equal(reread.state, "SUBMITTED_UNKNOWN");
    } finally {
      rpc.close();
    }
  });
});
