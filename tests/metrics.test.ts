import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Authority,
  createExecution,
  digestForOperation,
  paymentBounds,
  saveAuthority,
  transitionExecution,
} from "../src/index.js";

// PDP observability slice (G13): unauthenticated GET /metrics beside
// healthz — decision counters by fixed-vocabulary reason plus a read-only
// execution-states/backlog scan. Probes log nothing; counters carry no
// caller content (cardinality + secrecy guard), so canary strings posted
// in evaluations must never surface in the body.

const SERVER = fileURLToPath(
  new URL("../../dist/src/pdp-server.js", import.meta.url)
);

const PRINCIPAL = "did:metrics:owner";
const AGENT = "did:metrics:agent";
const MERCHANT = "did:metrics:merchant";
const NOW = Math.floor(Date.now() / 1000);

const CANARIES = [
  "ptf-canary-pan-4111111111111111",
  "ptf-canary-bearer-9f2c7a",
  "ptf-canary-secret-s3cr3t",
];

function seedAll(dir: string): void {
  const auth = new Authority();
  auth.addGrant({
    id: "g-metrics",
    principal: PRINCIPAL,
    actor: { kind: "exact", id: AGENT },
    action: { name: "/pay" },
    purpose: "metrics drill",
    resource: { type: "invoice", id: "invoice:m-1" },
    bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    exp: NOW + 3600,
  });
  saveAuthority(dir, auth);
  writeFileSync(
    join(dir, "keys.json"),
    JSON.stringify([
      {
        id: "metrics-pep",
        key: "k-0123456789abcdef",
        principal: PRINCIPAL,
        actor: AGENT,
      },
    ]),
    "utf8"
  );
  const base = {
    capabilityId: "cid-metrics-1",
    termsDigest: "ab".repeat(32),
    action: "/pay",
    recipient: MERCHANT,
    resource: "invoice:m-1",
    purpose: "metrics drill",
    context: { amount: 100, currency: "INR" },
  };
  const done = createExecution(dir, { ...base, idempotencyKey: "m-done" }, NOW);
  transitionExecution(dir, done.executionId, "AUTHORIZED", {}, NOW);
  transitionExecution(
    dir,
    done.executionId,
    "SUBMITTING",
    { externalRef: "x-1" },
    NOW
  );
  transitionExecution(
    dir,
    done.executionId,
    "SUCCEEDED",
    { receiptId: "rcpt-1", receiptAt: NOW },
    NOW
  );
  createExecution(
    dir,
    { ...base, capabilityId: "cid-metrics-2", idempotencyKey: "m-open" },
    NOW
  );
  const openRec = createExecution(
    dir,
    { ...base, capabilityId: "cid-metrics-3", idempotencyKey: "m-open3" },
    NOW
  );
  transitionExecution(dir, openRec.executionId, "AUTHORIZED", {}, NOW);
}

function body(
  agent: string,
  amount: number,
  extra?: Record<string, unknown>
): string {
  const op = {
    principal: PRINCIPAL,
    actor: agent,
    action: { name: "/pay" as const },
    resource: { type: "invoice", id: "invoice:m-1" },
    context: { amount, currency: "INR", recipient: MERCHANT, ...(extra ?? {}) },
    purpose: "metrics drill",
  };
  return JSON.stringify({
    subject: {
      type: "user",
      id: op.principal,
      properties: { actor: op.actor },
    },
    action: { name: op.action.name, properties: { purpose: op.purpose } },
    resource: {
      type: op.resource.type,
      id: op.resource.id,
      properties: { recipient: MERCHANT },
    },
    context: { ...op.context, termsDigest: digestForOperation(op) },
  });
}

describe("PDP observability — GET /metrics (G13)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ptf-metrics-"));
  let child: ChildProcess | null = null;
  let stdoutBuf = "";
  let port = 0;

  before(async () => {
    seedAll(dir);
    child = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        PTF_PDP_STORE_DIR: dir,
        PTF_PDP_KEYS_FILE: join(dir, "keys.json"),
        PTF_PDP_PORT: "0",
        PTF_PDP_ALLOW_PLAINTEXT: "1",
        PTF_PDP_REPLICA_ID: "replica-m",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (c: Buffer) => {
      stdoutBuf += c.toString("utf8");
    });
    port = await new Promise<number>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(
        () => reject(new Error(`no listen: ${buf}`)),
        15000
      );
      timer.unref();
      child?.stdout?.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        const m = /PTF_PDP_LISTENING port=(\d+)/.exec(buf);
        if (m?.[1] !== undefined) {
          clearTimeout(timer);
          resolve(Number.parseInt(m[1], 10));
        }
      });
      child?.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`exited early: ${code} ${buf}`));
      });
    });
  });

  after(() => {
    child?.kill();
    child = null;
  });

  async function post(
    text: string
  ): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`http://127.0.0.1:${port}/access/v1/evaluation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer k-0123456789abcdef",
      },
      body: text,
    });
    return { status: res.status, json: (await res.json()) as unknown };
  }

  async function metrics(): Promise<{
    status: number;
    text: string;
    json: unknown;
  }> {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
    return { status: res.status, text, json };
  }

  it("reports decisions, states, and backlog with zero traffic", async () => {
    const m = await metrics();
    assert.equal(m.status, 200);
    assert.deepEqual(m.json, {
      replica: "replica-m",
      decisions: { allow: 0, deny: {} },
      executions: {
        states: { AUTHORIZED: 1, PREPARED: 1, SUCCEEDED: 1 },
        backlog: 2,
      },
    });
  });

  it("probes log nothing and tolerate query strings; wrong method 405", async () => {
    const q = await fetch(`http://127.0.0.1:${port}/metrics?cache=bust`);
    assert.equal(q.status, 200);
    const wrong = await fetch(`http://127.0.0.1:${port}/metrics`, {
      method: "POST",
    });
    assert.equal(wrong.status, 405);
    for (const line of stdoutBuf.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      const v = JSON.parse(t) as Record<string, unknown>;
      assert.ok(!("keyId" in v), "metrics probe must not log decisions");
    }
  });

  it("allow and deny increment exact buckets", async () => {
    const ok = await post(body(AGENT, 100));
    assert.equal(ok.status, 200);
    assert.equal((ok.json as { decision?: boolean }).decision, true);
    const no = await post(body(AGENT, 99999));
    assert.equal(no.status, 200);
    assert.equal((no.json as { decision?: boolean }).decision, false);
    const m = await metrics();
    assert.deepEqual((m.json as { decisions?: unknown }).decisions, {
      allow: 1,
      deny: { "no-authority": 1 },
    });
  });

  it("caller canaries never surface in the metrics body", async () => {
    const tainted = await post(
      body(AGENT, 100, {
        note: CANARIES[0],
        ref: CANARIES[1],
        token: CANARIES[2],
      })
    );
    assert.equal(tainted.status, 200);
    const m = await metrics();
    for (const canary of CANARIES) {
      assert.ok(!m.text.includes(canary), `metrics body leaks ${canary}`);
      assert.ok(!stdoutBuf.includes(canary), `stdout leaks ${canary}`);
    }
    const deny =
      (m.json as { decisions?: { deny?: Record<string, number> } }).decisions
        ?.deny ?? {};
    for (const key of Object.keys(deny)) {
      assert.ok(
        [
          "no-authority",
          "forbidden",
          "expired",
          "uses-exhausted",
          "revoked",
          "terms",
          "other",
        ].includes(key),
        `deny bucket key is fixed vocabulary, got ${key}`
      );
    }
  });
});
