import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  Authority,
  digestForOperation,
  loadAuthority,
  paymentBounds,
  saveAuthority,
} from "../src/index.js";

// Loopback proof for ticket 12: the reference PDP speaks real AuthZEN 1.0
// wire shapes over HTTP in a SEPARATE process. Allow, deny-shape, 401,
// malformed-body and post-revoke behavior are all exercised across the
// transport boundary — not against an in-process call.
const PRINCIPAL = "did:test:traveler";
const AGENT_A = "did:test:agent-a";
const ATTACKER = "did:attacker:anything";
const MERCHANT = "did:test:airline";
const API_KEY = "test-key-0123456789abcdef";

const SERVER = fileURLToPath(
  new URL("../../examples/pdp-server.mjs", import.meta.url)
);

const NOW = Math.floor(Date.now() / 1000);
const dir = mkdtempSync(join(tmpdir(), "ptf-pdp-http-"));

function seedStore(): void {
  const auth = new Authority();
  auth.addGrant({
    id: "travel-domestic-economy",
    principal: PRINCIPAL,
    actor: { kind: "set", ids: [AGENT_A, "did:test:agent-b"] },
    action: { name: "/pay" },
    purpose: "book domestic economy flight",
    resource: { type: "flight", id: "flight:domestic:economy" },
    bounds: paymentBounds({ amountMax: 15000, currency: "INR" }),
    exp: NOW + 3600,
  });
  saveAuthority(dir, auth);
}

function operation(agent: string, amount: number) {
  return {
    principal: PRINCIPAL,
    actor: agent,
    action: { name: "/pay" as const },
    resource: { type: "flight", id: "flight:domestic:economy" },
    context: { amount, currency: "INR", recipient: MERCHANT },
    purpose: "book domestic economy flight",
  };
}

function evaluationBody(agent: string, amount: number): string {
  const op = operation(agent, amount);
  return JSON.stringify({
    subject: {
      type: "user",
      id: op.principal,
      properties: { actor: op.actor },
    },
    action: {
      name: op.action.name,
      properties: { purpose: op.purpose },
    },
    resource: {
      type: op.resource.type,
      id: op.resource.id,
      properties: { recipient: MERCHANT },
    },
    context: { ...op.context, termsDigest: digestForOperation(op) },
  });
}

let child: ChildProcess | null = null;
let port = 0;

function waitForListening(proc: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      reject(new Error(`pdp server did not start: ${buf}`));
    }, 15000);
    timer.unref();
    proc.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const m = /PTF_PDP_LISTENING port=(\d+)/.exec(buf);
      if (m !== null) {
        clearTimeout(timer);
        resolve(Number.parseInt(m[1] as string, 10));
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`pdp server exited early: ${code} ${buf}`));
    });
  });
}

async function post(
  path: string,
  init: {
    readonly method?: string;
    readonly body?: string;
    readonly key?: string;
  }
): Promise<{ readonly status: number; readonly json: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.key !== undefined) headers["authorization"] = `Bearer ${init.key}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: init.method ?? "POST",
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  return { status: res.status, json: (await res.json()) as unknown };
}

describe("reference HTTP PDP over loopback (ticket 12)", () => {
  before(async () => {
    seedStore();
    child =
      child ??
      spawn(process.execPath, [SERVER, dir, "0"], {
        env: {
          ...process.env,
          PTF_PDP_API_KEY: API_KEY,
          PTF_PDP_PRINCIPAL: PRINCIPAL,
          PTF_PDP_ACTOR: AGENT_A,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    port = await waitForListening(child);
  });

  after(() => {
    child?.kill();
    child = null;
  });

  it("allows a covered demand across HTTP with citations", async () => {
    const { status, json } = await post("/access/v1/evaluation", {
      body: evaluationBody(AGENT_A, 12000),
      key: API_KEY,
    });
    assert.equal(status, 200);
    const body = json as {
      readonly decision: boolean;
      readonly context: { readonly citations: readonly unknown[] };
    };
    assert.equal(body.decision, true);
    assert.equal(body.context.citations.length, 1);
  });

  it("denies as 200 + decision:false, never smuggled into an error", async () => {
    // Over-ceiling amount under the verified identity: policy denies
    // with a decision, not a transport error.
    const { status, json } = await post("/access/v1/evaluation", {
      body: evaluationBody(AGENT_A, 999999),
      key: API_KEY,
    });
    assert.equal(status, 200);
    assert.equal((json as { readonly decision: boolean }).decision, false);
  });

  it("spoofed subject hints fail closed with 400, never evaluated", async () => {
    // Same trusted key but a body claiming another actor: the hint
    // disagrees with the key-mapped ingress → 400, no decision.
    const { status } = await post("/access/v1/evaluation", {
      body: evaluationBody(ATTACKER, 12000),
      key: API_KEY,
    });
    assert.equal(status, 400);
  });

  it("rejects bad or missing PEP credentials with 401", async () => {
    const bad = await post("/access/v1/evaluation", {
      body: evaluationBody(AGENT_A, 12000),
      key: "wrong-key-00000000000000000000",
    });
    assert.equal(bad.status, 401);
    const missing = await post("/access/v1/evaluation", {
      body: evaluationBody(AGENT_A, 12000),
    });
    assert.equal(missing.status, 401);
  });

  it("fails malformed bodies and methods closed without a decision", async () => {
    const garbage = await post("/access/v1/evaluation", {
      body: "{not json",
      key: API_KEY,
    });
    assert.equal(garbage.status, 400);
    const get = await post("/access/v1/evaluation", {
      method: "GET",
      key: API_KEY,
    });
    assert.equal(get.status, 405);
    const elsewhere = await post("/access/v1/evaluations", {
      body: evaluationBody(AGENT_A, 12000),
      key: API_KEY,
    });
    assert.equal(elsewhere.status, 404);
  });

  it("a central revoke lands in fresh HTTP evaluations without restart", async () => {
    const before = await post("/access/v1/evaluation", {
      body: evaluationBody(AGENT_A, 12000),
      key: API_KEY,
    });
    assert.equal(
      (before.json as { readonly decision: boolean }).decision,
      true
    );
    const handle = loadAuthority(dir);
    handle.revoke("travel-domestic-economy");
    saveAuthority(dir, handle);
    const afterRevoke = await post("/access/v1/evaluation", {
      body: evaluationBody(AGENT_A, 12000),
      key: API_KEY,
    });
    assert.equal(afterRevoke.status, 200);
    const body = afterRevoke.json as {
      readonly decision: boolean;
      readonly context: { readonly reason: string };
    };
    assert.equal(body.decision, false);
    assert.equal(body.context.reason, "revoked");
  });
});
