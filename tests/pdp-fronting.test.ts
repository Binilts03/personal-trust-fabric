import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Authority,
  digestForOperation,
  paymentBounds,
  saveAuthority,
} from "../src/index.js";

// Ticket 10 front door: per-key scopes, hot-reload rotation, replica
// visibility, decision-log redaction. Separate processes from dist,
// exactly as an operator runs them.

const SERVER = fileURLToPath(
  new URL("../../dist/src/pdp-server.js", import.meta.url)
);

const PRINCIPAL = "did:op:owner";
const AGENT = "did:op:agent";
const MERCHANT = "did:op:shop";
const NOW = Math.floor(Date.now() / 1000);
const KEY_A = "front-key-aaaaaaaaaaaaaaaa";
const KEY_B = "front-key-bbbbbbbbbbbbbbbb";
const SENTINEL = "SENTINEL-4111111111111111-x7q9";

function seed(dir: string): void {
  const auth = new Authority();
  auth.addGrant({
    id: "g-front",
    principal: PRINCIPAL,
    actor: { kind: "set", ids: [AGENT] },
    action: { name: "/pay" },
    purpose: "fronting drill",
    resource: { type: "invoice", id: "invoice:front-1" },
    bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    exp: NOW + 3600,
  });
  saveAuthority(dir, auth);
}

function body(extraContext: Record<string, unknown> = {}): string {
  const op = {
    principal: PRINCIPAL,
    actor: AGENT,
    action: { name: "/pay" as const },
    resource: { type: "invoice", id: "invoice:front-1" },
    context: {
      amount: 100,
      currency: "INR",
      recipient: MERCHANT,
      ...extraContext,
    },
    purpose: "fronting drill",
  };
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
        const raw: string | undefined = m[1];
        if (raw === undefined) return;
        clearTimeout(timer);
        resolve(Number.parseInt(raw, 10));
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`pdp server exited early: ${code} ${buf}`));
    });
  });
}

function waitForExit(proc: ChildProcess, timeoutMs = 8000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("pdp server did not exit in time"));
    }, timeoutMs);
    timer.unref();
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? -1);
    });
  });
}

function post(
  targetPort: number,
  path: string,
  key?: string,
  payload?: string
): Promise<{ readonly status: number; readonly json: unknown }> {
  return new Promise((resolve, reject) => {
    const data =
      payload !== undefined ? Buffer.from(payload, "utf8") : undefined;
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key !== undefined ? { authorization: `Bearer ${key}` } : {}),
          ...(data !== undefined ? { "content-length": data.length } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          chunks.push(c);
        });
        res.on("end", () => {
          let json: unknown = null;
          try {
            json = JSON.parse(
              Buffer.concat(chunks).toString("utf8")
            ) as unknown;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on("error", reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

function decisionLines(buf: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of buf.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        out.push(v as Record<string, unknown>);
      }
    } catch {
      // LISTENING line etc.
    }
  }
  return out;
}

describe("ticket 10 — scopes, rotation, replicas, redaction", () => {
  const dir = mkdtempSync(join(tmpdir(), "ptf-front-"));
  const keysFile = join(dir, "keys.json");
  let child: ChildProcess | null = null;
  let stdoutBuf = "";
  let port = 0;

  const writeKeys = (keys: unknown): void => {
    writeFileSync(keysFile, JSON.stringify(keys), "utf8");
  };

  before(async () => {
    seed(dir);
    writeKeys([
      { id: "pep-a", key: KEY_A, principal: PRINCIPAL, actor: AGENT },
      {
        id: "pep-parked",
        key: "front-key-parked-00000000",
        principal: PRINCIPAL,
        actor: AGENT,
        scopes: [],
      },
    ]);
    child =
      child ??
      spawn(process.execPath, [SERVER], {
        env: {
          ...process.env,
          PTF_PDP_STORE_DIR: dir,
          PTF_PDP_KEYS_FILE: keysFile,
          PTF_PDP_PORT: "0",
          PTF_PDP_RPM: "1000",
          PTF_PDP_ALLOW_PLAINTEXT: "1",
          PTF_PDP_REPLICA_ID: "replica-a",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
    child.stdout?.on("data", (c: Buffer) => {
      stdoutBuf += c.toString("utf8");
    });
    port = await waitForListening(child);
  });

  after(() => {
    child?.kill();
    child = null;
  });

  it("parked keys authenticate but are forbidden; legacy keys evaluate", async () => {
    const parked = await post(
      port,
      "/access/v1/evaluation",
      "front-key-parked-00000000",
      body()
    );
    assert.equal(parked.status, 403);
    const legacy = await post(port, "/access/v1/evaluation", KEY_A, body());
    assert.equal(legacy.status, 200);
  });

  it("rotation is hot: new key 200s, removed key 401s, zero restarts", async () => {
    const before = await post(port, "/access/v1/evaluation", KEY_A, body());
    assert.equal(before.status, 200);
    writeKeys([
      { id: "pep-a", key: KEY_A, principal: PRINCIPAL, actor: AGENT },
      { id: "pep-b", key: KEY_B, principal: PRINCIPAL, actor: AGENT },
    ]);
    const rotated = await post(port, "/access/v1/evaluation", KEY_B, body());
    assert.equal(rotated.status, 200);
    writeKeys([
      { id: "pep-b", key: KEY_B, principal: PRINCIPAL, actor: AGENT },
    ]);
    const oldGone = await post(port, "/access/v1/evaluation", KEY_A, body());
    assert.equal(oldGone.status, 401);
    const newStays = await post(port, "/access/v1/evaluation", KEY_B, body());
    assert.equal(newStays.status, 200);
  });

  it("malformed rewrite keeps serving with last-good keys (no process exit)", async () => {
    // Baseline: pep-b serves before the bad rewrite.
    const baseline = await post(port, "/access/v1/evaluation", KEY_B, body());
    assert.equal(baseline.status, 200);
    // Malformed rewrite: invalid JSON must not kill the process — the next
    // request still serves with last-good keys (src/pdp-server.ts: keysLive
    // retains on loadKeysThrowing failure instead of process.exit(2)).
    writeFileSync(keysFile, "{not json", "utf8");
    const kept = await post(port, "/access/v1/evaluation", KEY_B, body());
    assert.equal(kept.status, 200);
    const keptAgain = await post(port, "/access/v1/evaluation", KEY_B, body());
    assert.equal(keptAgain.status, 200);
    assert.equal(child?.killed, false);
    assert.equal(child?.exitCode, null);
    // Recovery: a good rewrite resumes rotation without a restart.
    writeKeys([
      { id: "pep-b", key: KEY_B, principal: PRINCIPAL, actor: AGENT },
    ]);
    const recovered = await post(port, "/access/v1/evaluation", KEY_B, body());
    assert.equal(recovered.status, 200);
    // The broken file still fails the NEXT deploy (startup stays fail-closed).
    const dirBad = mkdtempSync(join(tmpdir(), "ptf-front-malformed-"));
    seed(dirBad);
    const keysBad = join(dirBad, "keys.json");
    writeFileSync(keysBad, "{not json", "utf8");
    const bad = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        PTF_PDP_STORE_DIR: dirBad,
        PTF_PDP_KEYS_FILE: keysBad,
        PTF_PDP_PORT: "0",
        PTF_PDP_ALLOW_PLAINTEXT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(await waitForExit(bad), 2);
  });

  it("decision logs carry the replica id and never bodies, keys, or secrets", async () => {
    const r = await post(
      port,
      "/access/v1/evaluation",
      KEY_B,
      body({ note: SENTINEL })
    );
    assert.equal(r.status, 200);
    const logs = decisionLines(stdoutBuf).filter((l) => l["keyId"] === "pep-b");
    assert.ok(logs.length >= 1, "a decision must have been logged");
    for (const l of logs) {
      assert.equal(l["replica"], "replica-a");
    }
    assert.ok(!stdoutBuf.includes(SENTINEL), "secret context leaked to logs");
    assert.ok(!stdoutBuf.includes(KEY_B), "bearer key leaked to logs");
    assert.ok(!stdoutBuf.includes("invoice:front-1"), "body echoed to logs");
  });

  it("two replicas report distinct ids (duplicate deployments are visible)", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "ptf-front-2-"));
    seed(dir2);
    const keys2 = join(dir2, "keys.json");
    writeFileSync(
      keys2,
      JSON.stringify([
        { id: "pep-a", key: KEY_A, principal: PRINCIPAL, actor: AGENT },
      ]),
      "utf8"
    );
    const second = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        PTF_PDP_STORE_DIR: dir2,
        PTF_PDP_KEYS_FILE: keys2,
        PTF_PDP_PORT: "0",
        PTF_PDP_ALLOW_PLAINTEXT: "1",
        PTF_PDP_REPLICA_ID: "replica-b",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const port2 = await waitForListening(second);
      const ready = await new Promise<{ status: number; json: unknown }>(
        (resolve, reject) => {
          const req = httpRequest(
            {
              hostname: "127.0.0.1",
              port: port2,
              path: "/readyz",
              method: "GET",
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (c: Buffer) => {
                chunks.push(c);
              });
              res.on("end", () => {
                resolve({
                  status: res.statusCode ?? 0,
                  json: JSON.parse(
                    Buffer.concat(chunks).toString("utf8")
                  ) as unknown,
                });
              });
            }
          );
          req.on("error", reject);
          req.end();
        }
      );
      assert.equal(ready.status, 200);
      assert.deepEqual(ready.json, { ready: true, replica: "replica-b" });
    } finally {
      second.kill();
    }
  });

  it("unknown scopes fail startup, fail-closed", async () => {
    const dirBad = mkdtempSync(join(tmpdir(), "ptf-front-bad-"));
    seed(dirBad);
    const keysBad = join(dirBad, "keys.json");
    writeFileSync(
      keysBad,
      JSON.stringify([
        {
          id: "pep-x",
          key: "front-key-xxxxxxxxxxxxxxxx",
          principal: PRINCIPAL,
          actor: AGENT,
          scopes: ["mind-reading"],
        },
      ]),
      "utf8"
    );
    const bad = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        PTF_PDP_STORE_DIR: dirBad,
        PTF_PDP_KEYS_FILE: keysBad,
        PTF_PDP_PORT: "0",
        PTF_PDP_ALLOW_PLAINTEXT: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(await waitForExit(bad), 2);
  });
});
