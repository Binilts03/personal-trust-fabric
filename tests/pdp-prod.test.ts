import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
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

// Production PDP bin (ticket 13): separate-process, real TLS HTTP like
// tests/pdp-http.test.ts. Covers allow/deny-shape, 401, malformed 400,
// 429 burst, revoke-without-restart, and the plaintext refusal gate.
// TLS: prefer an openssl CA flow generated to tmp at test time (client runs
// with `ca` + rejectUnauthorized:true); when openssl is absent from PATH we
// fall back to the committed TEST-ONLY self-signed pair under
// tests/fixtures/ with `rejectUnauthorized:false` — documented test-only,
// never production (see tests/fixtures/README.md).
const PRINCIPAL = "did:test:traveler";
const AGENT_A = "did:test:agent-a";
const ATTACKER = "did:attacker:anything";
const MERCHANT = "did:test:airline";
const API_KEY = "test-key-0123456789abcdef";
const KEY_ID = "pep-a";
const ATTACKER_KEY = "test-key-attacker-0123456789ab";
const ATTACKER_KEY_ID = "pep-attacker";

const SERVER = fileURLToPath(
  new URL("../../dist/src/pdp-server.js", import.meta.url)
);
const FIXTURE_KEY = fileURLToPath(
  new URL("../../tests/fixtures/test-only-insecure-key.pem", import.meta.url)
);
const FIXTURE_CERT = fileURLToPath(
  new URL("../../tests/fixtures/test-only-insecure-cert.pem", import.meta.url)
);

const NOW = Math.floor(Date.now() / 1000);
const dir = mkdtempSync(join(tmpdir(), "ptf-pdp-prod-"));
const dirRl = mkdtempSync(join(tmpdir(), "ptf-pdp-prod-rl-"));
const dirPlain = mkdtempSync(join(tmpdir(), "ptf-pdp-prod-plain-"));
const tmpTls = mkdtempSync(join(tmpdir(), "ptf-pdp-prod-tls-"));
const keysFile = join(tmpTls, "keys.json");

function seedStore(target: string): void {
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
  saveAuthority(target, auth);
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

interface TlsPair {
  readonly keyPath: string;
  readonly certPath: string;
  readonly caPath?: string;
}

function tryOpensslCaPair(tmp: string): TlsPair | null {
  try {
    const caKey = join(tmp, "ca-key.pem");
    const caCert = join(tmp, "ca-cert.pem");
    const srvKey = join(tmp, "srv-key.pem");
    const srvCsr = join(tmp, "srv.csr");
    const srvCert = join(tmp, "srv-cert.pem");
    const steps = [
      ["genrsa", "-out", caKey, "2048"],
      [
        "req",
        "-x509",
        "-new",
        "-nodes",
        "-key",
        caKey,
        "-sha256",
        "-days",
        "2",
        "-out",
        caCert,
        "-subj",
        "/CN=ptf-test-ca",
      ],
      ["genrsa", "-out", srvKey, "2048"],
      ["req", "-new", "-key", srvKey, "-out", srvCsr, "-subj", "/CN=127.0.0.1"],
      [
        "x509",
        "-req",
        "-in",
        srvCsr,
        "-CA",
        caCert,
        "-CAkey",
        caKey,
        "-CAcreateserial",
        "-out",
        srvCert,
        "-days",
        "2",
        "-sha256",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
      ],
    ] as const;
    for (const args of steps) {
      const r = spawnSync("openssl", [...args], { stdio: "ignore" });
      if (r.status !== 0) return null;
    }
    if (
      !existsSync(caKey) ||
      !existsSync(caCert) ||
      !existsSync(srvKey) ||
      !existsSync(srvCert)
    ) {
      return null;
    }
    return { keyPath: srvKey, certPath: srvCert, caPath: caCert };
  } catch {
    return null;
  }
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

function spawnPdp(env: Record<string, string | undefined>): ChildProcess {
  return spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

let tls: TlsPair = { keyPath: FIXTURE_KEY, certPath: FIXTURE_CERT };
let child: ChildProcess | null = null;
let port = 0;
let stdoutBuf = "";

function tlsPost(
  targetPort: number,
  path: string,
  init: {
    readonly method?: string;
    readonly body?: string;
    readonly key?: string;
  }
): Promise<{
  readonly status: number;
  readonly json: unknown;
  readonly headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const payload =
      init.body !== undefined ? Buffer.from(init.body, "utf8") : undefined;
    const headers: Record<string, string | number> = {
      "content-type": "application/json",
    };
    if (init.key !== undefined) headers["authorization"] = `Bearer ${init.key}`;
    if (payload !== undefined) headers["content-length"] = payload.length;
    // TEST-ONLY transport trust: with a real CA (openssl flow) we verify
    // against it; with the committed self-signed fixture there is no chain,
    // so verification is disabled here and ONLY here (never production).
    const opts: RequestOptions = {
      hostname: "127.0.0.1",
      port: targetPort,
      path,
      method: init.method ?? "POST",
      headers,
      ...(tls.caPath !== undefined
        ? { ca: readFileSync(tls.caPath), rejectUnauthorized: true }
        : { rejectUnauthorized: false }),
    };
    const req = httpsRequest(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => {
        chunks.push(c);
      });
      res.on("end", () => {
        let json: unknown = null;
        try {
          json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, json, headers: res.headers });
      });
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function httpPost(
  targetPort: number,
  path: string,
  init: {
    readonly method?: string;
    readonly body?: string;
    readonly key?: string;
  }
): Promise<{ readonly status: number; readonly json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload =
      init.body !== undefined ? Buffer.from(init.body, "utf8") : undefined;
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: targetPort,
        path,
        method: init.method ?? "POST",
        headers: {
          "content-type": "application/json",
          ...(init.key !== undefined
            ? { authorization: `Bearer ${init.key}` }
            : {}),
          ...(payload !== undefined
            ? { "content-length": payload.length }
            : {}),
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
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function decisionLogs(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of stdoutBuf.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        out.push(v as Record<string, unknown>);
      }
    } catch {
      // Non-JSON stdout (e.g. the LISTENING line) is ignored.
    }
  }
  return out;
}

async function waitForLog(
  pred: (l: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 2000;
  for (;;) {
    for (const l of decisionLogs()) {
      if (pred(l)) return l;
    }
    if (Date.now() > deadline)
      throw new Error("decision log line never arrived");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("production PDP bin over TLS (ticket 13)", () => {
  before(async () => {
    seedStore(dir);
    seedStore(dirRl);
    seedStore(dirPlain);
    writeFileSync(
      keysFile,
      JSON.stringify([
        { id: KEY_ID, key: API_KEY, principal: PRINCIPAL, actor: AGENT_A },
        {
          id: ATTACKER_KEY_ID,
          key: ATTACKER_KEY,
          principal: PRINCIPAL,
          actor: ATTACKER,
        },
      ]),
      "utf8"
    );
    tls = tryOpensslCaPair(tmpTls) ?? {
      keyPath: FIXTURE_KEY,
      certPath: FIXTURE_CERT,
    };
    assert.ok(existsSync(tls.keyPath));
    assert.ok(existsSync(tls.certPath));
    child =
      child ??
      spawnPdp({
        PTF_PDP_STORE_DIR: dir,
        PTF_PDP_KEYS_FILE: keysFile,
        PTF_PDP_TLS_KEY: tls.keyPath,
        PTF_PDP_TLS_CERT: tls.certPath,
        PTF_PDP_PORT: "0",
        PTF_PDP_RPM: "1000",
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

  it("allows a covered demand over TLS with citations", async () => {
    const { status, json } = await tlsPost(port, "/access/v1/evaluation", {
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
    const log = await waitForLog(
      (l) => l["keyId"] === KEY_ID && l["decision"] === true
    );
    assert.equal(typeof log["at"], "string");
    assert.ok(!JSON.stringify(log).includes(API_KEY));
  });

  it("denies as 200 + decision:false, never smuggled into an error", async () => {
    // Attacker authenticates as itself (own key → own ingress) and is
    // denied by policy — identity comes from the key, never the body.
    const { status, json } = await tlsPost(port, "/access/v1/evaluation", {
      body: evaluationBody(ATTACKER, 12000),
      key: ATTACKER_KEY,
    });
    assert.equal(status, 200);
    assert.equal((json as { readonly decision: boolean }).decision, false);
  });

  it("spoofed hints fail closed with 400, never evaluated", async () => {
    // Same trusted key but a body claiming the attacker's actor string:
    // the hint disagrees with the verified ingress → 400, no decision.
    const { status } = await tlsPost(port, "/access/v1/evaluation", {
      body: evaluationBody(ATTACKER, 12000),
      key: API_KEY,
    });
    assert.equal(status, 400);
  });

  it("rejects bad or missing PEP credentials with 401", async () => {
    const bad = await tlsPost(port, "/access/v1/evaluation", {
      body: evaluationBody(AGENT_A, 12000),
      key: "wrong-key-00000000000000000000",
    });
    assert.equal(bad.status, 401);
    const missing = await tlsPost(port, "/access/v1/evaluation", {
      body: evaluationBody(AGENT_A, 12000),
    });
    assert.equal(missing.status, 401);
  });

  it("fails malformed bodies, methods, and paths closed without a decision", async () => {
    const garbage = await tlsPost(port, "/access/v1/evaluation", {
      body: "{not json",
      key: API_KEY,
    });
    assert.equal(garbage.status, 400);
    const get = await tlsPost(port, "/access/v1/evaluation", {
      method: "GET",
      key: API_KEY,
    });
    assert.equal(get.status, 405);
    const elsewhere = await tlsPost(port, "/access/v1/evaluations", {
      body: evaluationBody(AGENT_A, 12000),
      key: API_KEY,
    });
    assert.equal(elsewhere.status, 404);
  });

  it("rate-limits a burst over RPM with 429 + Retry-After", async () => {
    const rl = spawnPdp({
      PTF_PDP_STORE_DIR: dirRl,
      PTF_PDP_KEYS_FILE: keysFile,
      PTF_PDP_TLS_KEY: tls.keyPath,
      PTF_PDP_TLS_CERT: tls.certPath,
      PTF_PDP_PORT: "0",
      PTF_PDP_RPM: "2",
    });
    try {
      const rlPort = await waitForListening(rl);
      const first = await tlsPost(rlPort, "/access/v1/evaluation", {
        body: evaluationBody(AGENT_A, 12000),
        key: API_KEY,
      });
      assert.equal(first.status, 200);
      const second = await tlsPost(rlPort, "/access/v1/evaluation", {
        body: evaluationBody(AGENT_A, 12000),
        key: API_KEY,
      });
      assert.equal(second.status, 200);
      const third = await tlsPost(rlPort, "/access/v1/evaluation", {
        body: evaluationBody(AGENT_A, 12000),
        key: API_KEY,
      });
      assert.equal(third.status, 429);
      const retry = third.headers["retry-after"];
      const retryStr = Array.isArray(retry) ? retry[0] : retry;
      assert.ok(retryStr !== undefined && Number.parseInt(retryStr, 10) >= 1);
    } finally {
      rl.kill();
    }
  });

  it("refuses to start plaintext without the flag (exit non-zero)", async () => {
    const proc = spawnPdp({
      PTF_PDP_STORE_DIR: dirPlain,
      PTF_PDP_KEYS_FILE: keysFile,
      PTF_PDP_PORT: "0",
    });
    try {
      const code = await waitForExit(proc);
      assert.notEqual(code, 0);
    } finally {
      proc.kill();
    }
  });

  it("serves plaintext only with PTF_PDP_ALLOW_PLAINTEXT=1", async () => {
    const proc = spawnPdp({
      PTF_PDP_STORE_DIR: dirPlain,
      PTF_PDP_KEYS_FILE: keysFile,
      PTF_PDP_PORT: "0",
      PTF_PDP_ALLOW_PLAINTEXT: "1",
    });
    try {
      const plainPort = await waitForListening(proc);
      const { status, json } = await httpPost(
        plainPort,
        "/access/v1/evaluation",
        {
          body: evaluationBody(AGENT_A, 12000),
          key: API_KEY,
        }
      );
      assert.equal(status, 200);
      assert.equal((json as { readonly decision: boolean }).decision, true);
    } finally {
      proc.kill();
    }
  });

  it("a central revoke lands in fresh TLS evaluations without restart", async () => {
    const beforeRevoke = await tlsPost(port, "/access/v1/evaluation", {
      body: evaluationBody(AGENT_A, 12000),
      key: API_KEY,
    });
    assert.equal(
      (beforeRevoke.json as { readonly decision: boolean }).decision,
      true
    );
    const handle = loadAuthority(dir);
    handle.revoke("travel-domestic-economy");
    saveAuthority(dir, handle);
    const afterRevoke = await tlsPost(port, "/access/v1/evaluation", {
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
    // Revoke denies both: the formerly-valid ingress and the attacker,
    // which was denied before and stays denied after.
    const attackerAfter = await tlsPost(port, "/access/v1/evaluation", {
      body: evaluationBody(ATTACKER, 12000),
      key: ATTACKER_KEY,
    });
    assert.equal(attackerAfter.status, 200);
    assert.equal(
      (attackerAfter.json as { readonly decision: boolean }).decision,
      false
    );
  });
});
