import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentRegistry,
  Authority,
  agentChallengeMessage,
  generateEd25519Keypair,
  issueAgentChallenge,
  loadAgents,
  paymentBounds,
  saveAgents,
  saveAuthority,
  saveRegistry,
  signBytes,
  verifyAgentChallengeSignature,
  RecipientRegistry,
} from "../src/index.js";
import { run, type CliIo } from "../src/cli.js";

const NOW = 1_700_000_000;
const P = "did:test:owner";
const AGENT_A = "did:test:agent-a";
const AGENT_B = "did:test:agent-b";
const SERVER = fileURLToPath(new URL("../src/mcp-server.js", import.meta.url));

function keyHex(): { hex: string; privDer: Uint8Array } {
  const kp = generateEd25519Keypair();
  return {
    hex: Buffer.from(kp.publicKeyRaw).toString("hex"),
    privDer: new Uint8Array(
      kp.privateKey.export({ format: "der", type: "pkcs8" })
    ),
  };
}

function privOf(der: Uint8Array): KeyObject {
  return createPrivateKey({
    key: Buffer.from(der),
    format: "der",
    type: "pkcs8",
  });
}

describe("agent challenge/response (core, ADR-0023)", () => {
  it("issues, signs, and verifies; rejects expiry, wrong keys, and tampering", () => {
    const challenger = generateEd25519Keypair();
    const other = generateEd25519Keypair();
    const ch = issueAgentChallenge(NOW);
    assert.ok(ch.challengeId.length > 0);
    assert.equal(ch.expiresAt, NOW + 120);
    const msg = agentChallengeMessage(ch, AGENT_A);
    const sig = signBytes(challenger.privateKey, msg);
    assert.equal(
      verifyAgentChallengeSignature({
        challenge: ch,
        agentId: AGENT_A,
        publicKeyRaw: challenger.publicKeyRaw,
        sigHex: Buffer.from(sig).toString("hex"),
        nowSec: NOW,
      }),
      true
    );
    // Expired, wrong key, tampered nonce, wrong claimant, malformed sig:
    // all fail closed.
    assert.equal(
      verifyAgentChallengeSignature({
        challenge: ch,
        agentId: AGENT_A,
        publicKeyRaw: challenger.publicKeyRaw,
        sigHex: Buffer.from(sig).toString("hex"),
        nowSec: NOW + 121,
      }),
      false
    );
    assert.equal(
      verifyAgentChallengeSignature({
        challenge: ch,
        agentId: AGENT_A,
        publicKeyRaw: other.publicKeyRaw,
        sigHex: Buffer.from(sig).toString("hex"),
        nowSec: NOW,
      }),
      false
    );
    assert.equal(
      verifyAgentChallengeSignature({
        challenge: { ...ch, nonceHex: "00".repeat(16) },
        agentId: AGENT_A,
        publicKeyRaw: challenger.publicKeyRaw,
        sigHex: Buffer.from(sig).toString("hex"),
        nowSec: NOW,
      }),
      false
    );
    assert.equal(
      verifyAgentChallengeSignature({
        challenge: ch,
        agentId: AGENT_B,
        publicKeyRaw: challenger.publicKeyRaw,
        sigHex: Buffer.from(sig).toString("hex"),
        nowSec: NOW,
      }),
      false
    );
    assert.equal(
      verifyAgentChallengeSignature({
        challenge: ch,
        agentId: AGENT_A,
        publicKeyRaw: challenger.publicKeyRaw,
        sigHex: "zz",
        nowSec: NOW,
      }),
      false
    );
    assert.throws(() => issueAgentChallenge(NaN));
  });
});

describe("agent registry store (ADR-0023)", () => {
  function tmpDir() {
    return mkdtempSync(join(tmpdir(), "ptf-agents-"));
  }

  it("registers keyed and keyless agents; duplicates and bad input throw", () => {
    const dir = tmpDir();
    const reg = new AgentRegistry(() => NOW);
    const { hex } = keyHex();
    reg.register(AGENT_A, hex, NOW);
    reg.register(AGENT_B, undefined, NOW);
    assert.equal(reg.isActive(AGENT_A), true);
    assert.equal(reg.isActive("did:test:ghost"), false);
    assert.ok(reg.publicKeyRaw(AGENT_A)?.length === 32);
    assert.equal(reg.publicKeyRaw(AGENT_B), null);
    assert.throws(() => reg.register(AGENT_A, hex, NOW));
    assert.throws(() => reg.register("", hex, NOW));
    assert.throws(() => reg.register("x", "zz", NOW));
    saveAgents(dir, reg);
    const reloaded = loadAgents(dir);
    assert.equal(reloaded.isActive(AGENT_A), true);
    assert.equal(reloaded.isActive(AGENT_B), true);
    assert.equal(reloaded.loadedRevision(), 0);
  });

  it("rotation swaps keys; removal retires permanently; CAS guards saves", () => {
    const dir = tmpDir();
    const reg = new AgentRegistry(() => NOW);
    const k1 = keyHex();
    const k2 = keyHex();
    reg.register(AGENT_A, k1.hex, NOW);
    saveAgents(dir, reg);
    reg.rotate(AGENT_A, k2.hex);
    assert.equal(
      Buffer.from(reg.publicKeyRaw(AGENT_A) ?? []).toString("hex"),
      k2.hex
    );
    assert.throws(() => reg.rotate(AGENT_A, k2.hex));
    saveAgents(dir, reg);
    reg.remove(AGENT_A, NOW);
    assert.equal(reg.isActive(AGENT_A), false);
    assert.equal(reg.publicKeyRaw(AGENT_A), null);
    assert.throws(() => reg.rotate(AGENT_A, k1.hex));
    assert.throws(() => reg.register(AGENT_A, k1.hex, NOW));
    saveAgents(dir, reg);
    // Stale handle fails closed instead of overwriting.
    const stale = loadAgents(dir);
    reg.register(AGENT_B, undefined, NOW);
    saveAgents(dir, reg);
    assert.throws(() => {
      stale.register("did:test:late", undefined, NOW);
      saveAgents(dir, stale);
    });
    // Corrupt file fails closed; missing file reads empty.
    const { writeFileSync } = process.getBuiltinModule(
      "node:fs"
    ) as typeof import("node:fs");
    writeFileSync(join(dir, "agents.json"), "{oops");
    assert.throws(() => loadAgents(dir), /corrupt/);
    assert.equal(loadAgents(tmpDir()).ids().length, 0);
  });
});

describe("operator CLI agent commands (ADR-0023)", () => {
  function setupStore(): { dir: string; io: CliIo; lines: string[] } {
    const dir = mkdtempSync(join(tmpdir(), "ptf-agent-cli-"));
    const lines: string[] = [];
    const io: CliIo = {
      readLine: () => "",
      print: (l: string) => {
        lines.push(l);
      },
      now: () => NOW,
    };
    return { dir, io, lines };
  }

  it("register, list, rotate, and remove round-trip with audit", async () => {
    const { dir, io, lines } = setupStore();
    const auth = new Authority({ nowSec: () => NOW });
    saveAuthority(dir, auth);
    saveRegistry(dir, new RecipientRegistry(() => NOW));
    const env: Record<string, string | undefined> = {};
    const { hex } = keyHex();
    const hex2 = keyHex().hex;
    assert.equal(
      await run(
        ["--dir", dir, "agent", "--register", AGENT_A, "--key", hex],
        io,
        env
      ),
      0
    );
    assert.equal(
      await run(["--dir", dir, "agent", "--register", AGENT_B], io, env),
      0
    );
    assert.equal(await run(["--dir", dir, "agent", "--list"], io, env), 0);
    assert.ok(lines.join("\n").includes(`${AGENT_A} active keyed`));
    assert.ok(lines.join("\n").includes(`${AGENT_B} active keyless`));
    assert.equal(
      await run(
        ["--dir", dir, "agent", "--rotate", AGENT_A, "--key", hex2],
        io,
        env
      ),
      0
    );
    assert.equal(loadAgents(dir).publicKeyRaw(AGENT_A) !== null, true);
    assert.equal(
      await run(["--dir", dir, "agent", "--remove", AGENT_A], io, env),
      0
    );
    assert.equal(loadAgents(dir).isActive(AGENT_A), false);
    // Duplicates and unknown removals fail closed.
    await assert.rejects(
      run(["--dir", dir, "agent", "--register", AGENT_A], io, env)
    );
    await assert.rejects(
      run(["--dir", dir, "agent", "--remove", "did:test:ghost"], io, env)
    );
  });
});

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

function seedRegistryStore(): {
  dir: string;
  keyA: { hex: string; privDer: Uint8Array };
  keyB: { hex: string; privDer: Uint8Array };
} {
  const liveNow = Math.floor(Date.now() / 1000);
  const dir = mkdtempSync(join(tmpdir(), "ptf-agent-mcp-"));
  const auth = new Authority({ nowSec: () => liveNow });
  auth.addGrant({
    id: "g-team",
    principal: P,
    actor: { kind: "set", ids: [AGENT_A, AGENT_B] },
    action: { name: "/pay" },
    bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    exp: liveNow + 3600,
  });
  saveAuthority(dir, auth);
  saveRegistry(dir, new RecipientRegistry(() => liveNow));
  const keyA = keyHex();
  const keyB = keyHex();
  const agents = new AgentRegistry(() => liveNow);
  agents.register(AGENT_A, keyA.hex, liveNow);
  agents.register(AGENT_B, keyB.hex, liveNow);
  saveAgents(dir, agents);
  return { dir, keyA, keyB };
}

async function authenticate(
  rpc: RpcClient,
  agentId: string,
  priv: Uint8Array
): Promise<void> {
  const got = await rpc.call("tools/call", {
    name: "ptf_authenticate",
    arguments: {},
  });
  assert.equal(failed(got), false);
  const { challengeId, nonceHex, expiresAt } = JSON.parse(textOf(got)) as {
    challengeId: string;
    nonceHex: string;
    expiresAt: number;
  };
  const done = await rpc.call("tools/call", {
    name: "ptf_authenticate",
    arguments: {
      agentId,
      challengeId,
      sigHex: Buffer.from(
        signBytes(
          privOf(priv),
          agentChallengeMessage({ challengeId, nonceHex, expiresAt }, agentId)
        )
      ).toString("hex"),
    },
  });
  assert.equal(failed(done), false);
  assert.equal(
    (JSON.parse(textOf(done)) as { authenticated?: boolean }).authenticated,
    true
  );
}

async function propose(
  rpc: RpcClient,
  recipient = "did:test:m"
): Promise<{ allowed?: boolean; reason?: string }> {
  const res = await rpc.call("tools/call", {
    name: "ptf_propose",
    arguments: {
      cmd: "/pay",
      purpose: "widgets",
      resource: "order:7",
      recipient,
      amount: 4250,
      currency: "INR",
    },
  });
  if (failed(res)) return { allowed: false, reason: "rpc-error" };
  return JSON.parse(textOf(res)) as { allowed?: boolean; reason?: string };
}

describe("MCP multi-agent ingress over stdio (phase 5)", () => {
  it("unauthenticated sessions fail closed; challenge/response binds the agent", async () => {
    const store = seedRegistryStore();
    const rpc = connect({
      PTF_STORE_DIR: store.dir,
      PTF_MCP_PRINCIPAL: P,
    });
    try {
      await rpc.call("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "agent-auth", version: "1" },
      });
      const denied = await propose(rpc);
      assert.equal(denied.allowed, false);
      await authenticate(rpc, AGENT_A, store.keyA.privDer);
      const allowed = await propose(rpc);
      assert.equal(allowed.allowed, true);
      const listed = await rpc.call("tools/call", {
        name: "ptf_list_capabilities",
        arguments: {},
      });
      const caps = JSON.parse(textOf(listed)) as { capabilities?: unknown[] };
      assert.equal(caps.capabilities?.length, 1);
    } finally {
      rpc.close();
    }
  });

  it("wrong keys, unknown agents, and replayed challenges fail closed", async () => {
    const store = seedRegistryStore();
    const rpc = connect({
      PTF_STORE_DIR: store.dir,
      PTF_MCP_PRINCIPAL: P,
    });
    try {
      await rpc.call("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "agent-auth", version: "1" },
      });
      // Unknown agent.
      const got = await rpc.call("tools/call", {
        name: "ptf_authenticate",
        arguments: {},
      });
      const { challengeId, nonceHex, expiresAt } = JSON.parse(textOf(got)) as {
        challengeId: string;
        nonceHex: string;
        expiresAt: number;
      };
      const ghost = await rpc.call("tools/call", {
        name: "ptf_authenticate",
        arguments: {
          agentId: "did:test:ghost",
          challengeId,
          sigHex: Buffer.from(
            signBytes(
              privOf(store.keyA.privDer),
              agentChallengeMessage(
                { challengeId, nonceHex, expiresAt },
                "did:test:ghost"
              )
            )
          ).toString("hex"),
        },
      });
      assert.equal(failed(ghost), true);
      // Wrong key for a real agent.
      const got2 = await rpc.call("tools/call", {
        name: "ptf_authenticate",
        arguments: {},
      });
      const c2 = JSON.parse(textOf(got2)) as {
        challengeId: string;
        nonceHex: string;
        expiresAt: number;
      };
      const wrongKey = await rpc.call("tools/call", {
        name: "ptf_authenticate",
        arguments: {
          agentId: AGENT_A,
          challengeId: c2.challengeId,
          sigHex: Buffer.from(
            signBytes(
              privOf(store.keyB.privDer),
              agentChallengeMessage(c2, AGENT_A)
            )
          ).toString("hex"),
        },
      });
      assert.equal(failed(wrongKey), true);
      // Replay the consumed challenge (single-use).
      const replay = await rpc.call("tools/call", {
        name: "ptf_authenticate",
        arguments: {
          agentId: AGENT_A,
          challengeId: c2.challengeId,
          sigHex: Buffer.from(
            signBytes(
              privOf(store.keyA.privDer),
              agentChallengeMessage(c2, AGENT_A)
            )
          ).toString("hex"),
        },
      });
      assert.equal(failed(replay), true);
      // Still unauthenticated.
      assert.equal((await propose(rpc)).allowed, false);
    } finally {
      rpc.close();
    }
  });

  it("removal takes effect immediately; Agent B inherits the same grant", async () => {
    const store = seedRegistryStore();
    const rpc = connect({
      PTF_STORE_DIR: store.dir,
      PTF_MCP_PRINCIPAL: P,
    });
    try {
      await rpc.call("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "agent-auth", version: "1" },
      });
      // Agent A works.
      await authenticate(rpc, AGENT_A, store.keyA.privDer);
      assert.equal((await propose(rpc)).allowed, true);
      // Operator removes A (direct registry edit = CLI remove path).
      const agents = loadAgents(store.dir);
      agents.remove(AGENT_A, Math.floor(Date.now() / 1000));
      saveAgents(store.dir, agents);
      // A's session is dead on the next call; re-auth as A fails too.
      assert.equal((await propose(rpc)).allowed, false);
      const got = await rpc.call("tools/call", {
        name: "ptf_authenticate",
        arguments: {},
      });
      const c = JSON.parse(textOf(got)) as {
        challengeId: string;
        nonceHex: string;
        expiresAt: number;
      };
      const reauth = await rpc.call("tools/call", {
        name: "ptf_authenticate",
        arguments: {
          agentId: AGENT_A,
          challengeId: c.challengeId,
          sigHex: Buffer.from(
            signBytes(
              privOf(store.keyA.privDer),
              agentChallengeMessage(c, AGENT_A)
            )
          ).toString("hex"),
        },
      });
      assert.equal(failed(reauth), true);
      // Agent B authenticates: the SAME user-owned grant covers B.
      // Authority was never copied anywhere — the grant file is untouched.
      await authenticate(rpc, AGENT_B, store.keyB.privDer);
      assert.equal((await propose(rpc)).allowed, true);
    } finally {
      rpc.close();
    }
  });

  it("launcher-asserted env identity must be registered; fixed mode is unchanged", async () => {
    const store = seedRegistryStore();
    // Registered env actor works with no ptf_authenticate call.
    const rpc = connect({
      PTF_STORE_DIR: store.dir,
      PTF_MCP_PRINCIPAL: P,
      PTF_MCP_ACTOR: AGENT_A,
    });
    try {
      await rpc.call("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "agent-auth", version: "1" },
      });
      assert.equal((await propose(rpc)).allowed, true);
    } finally {
      rpc.close();
    }
    // Unregistered env actor fails closed.
    const rpc2 = connect({
      PTF_STORE_DIR: store.dir,
      PTF_MCP_PRINCIPAL: P,
      PTF_MCP_ACTOR: "did:test:ghost",
    });
    try {
      await rpc2.call("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "agent-auth", version: "1" },
      });
      assert.equal((await propose(rpc2)).allowed, false);
    } finally {
      rpc2.close();
    }
  });

  it("cross-agent redemption and tampered proposals fail closed at redeem", async () => {
    const store = seedRegistryStore();
    const rpc = connect({
      PTF_STORE_DIR: store.dir,
      PTF_MCP_PRINCIPAL: P,
    });
    try {
      await rpc.call("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "agent-auth", version: "1" },
      });
      await authenticate(rpc, AGENT_A, store.keyA.privDer);
      const res = await rpc.call("tools/call", {
        name: "ptf_propose",
        arguments: {
          cmd: "/pay",
          purpose: "widgets",
          resource: "order:7",
          recipient: "did:test:m",
          amount: 4250,
          currency: "INR",
        },
      });
      const digest = (JSON.parse(textOf(res)) as { termsDigest: string })
        .termsDigest;
      // Agent B takes over the session: A's proposal is not redeemable.
      await authenticate(rpc, AGENT_B, store.keyB.privDer);
      const cross = await rpc.call("tools/call", {
        name: "ptf_redeem",
        arguments: { termsDigest: digest },
      });
      assert.equal(failed(cross), true);
      // Back to A: tamper the proposal file, redeem refuses the mutation.
      await authenticate(rpc, AGENT_A, store.keyA.privDer);
      const { readFileSync, writeFileSync } = await import("node:fs");
      const path = join(store.dir, "proposals", `${digest}.json`);
      const stored = JSON.parse(readFileSync(path, "utf8")) as {
        demand: { context: Record<string, unknown> };
      };
      stored.demand.context["amount"] = 1;
      writeFileSync(path, JSON.stringify(stored));
      const tampered = await rpc.call("tools/call", {
        name: "ptf_redeem",
        arguments: { termsDigest: digest },
      });
      assert.equal(failed(tampered), true);
    } finally {
      rpc.close();
    }
  });

  it("key rotation invalidates the live session", async () => {
    const store = seedRegistryStore();
    const rpc = connect({
      PTF_STORE_DIR: store.dir,
      PTF_MCP_PRINCIPAL: P,
    });
    try {
      await rpc.call("initialize", {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "agent-auth", version: "1" },
      });
      await authenticate(rpc, AGENT_A, store.keyA.privDer);
      assert.equal((await propose(rpc)).allowed, true);
      // Operator rotates A's key: the session bound to the old key dies.
      const agents = loadAgents(store.dir);
      agents.rotate(AGENT_A, keyHex().hex);
      saveAgents(store.dir, agents);
      assert.equal((await propose(rpc)).allowed, false);
    } finally {
      rpc.close();
    }
  });
});
