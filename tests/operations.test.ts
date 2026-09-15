import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Authority,
  FileAuditLog,
  RecipientRegistry,
  checkpoint,
  loadAuthority,
  loadRegistry,
  paymentBounds,
  saveAuthority,
  saveRegistry,
  verifyConsistency,
} from "../src/index.js";

// Operations pack (ticket 12): PDP health signals, backup/restore drill
// with the ticket-03 freshness check, and install-hygiene contract tests.
// All store access goes through the public seam; the bins run as separate
// processes from dist, exactly as an operator runs them.

const PDP_SERVER = fileURLToPath(
  new URL("../../dist/src/pdp-server.js", import.meta.url)
);
const CLI = fileURLToPath(new URL("../../dist/src/cli.js", import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const PRINCIPAL = "did:op:owner";
const AGENT = "did:op:agent";
const NOW = Math.floor(Date.now() / 1000);

function seedGrant(auth: Authority, id: string): void {
  auth.addGrant({
    id,
    principal: PRINCIPAL,
    actor: { kind: "set", ids: [AGENT] },
    action: { name: "/pay" },
    purpose: "operations drill",
    resource: { type: "invoice", id: "invoice:ops-1" },
    bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    exp: NOW + 3600,
  });
}

function readAuditEntries(dir: string): unknown[] {
  const path = join(dir, "audit.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown);
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

function httpGet(
  targetPort: number,
  path: string,
  method = "GET"
): Promise<{ readonly status: number; readonly json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: "127.0.0.1", port: targetPort, path, method },
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
    req.end();
  });
}

describe("operations pack — PDP health signals (ticket 12)", () => {
  const dir = mkdtempSync(join(tmpdir(), "ptf-ops-health-"));
  const keysFile = join(dir, "keys.json");
  let child: ChildProcess | null = null;
  let stdoutBuf = "";
  let port = 0;

  before(async () => {
    const auth = new Authority();
    seedGrant(auth, "g-health");
    saveAuthority(dir, auth);
    writeFileSync(
      keysFile,
      JSON.stringify([
        {
          id: "ops-pep",
          key: "ops-key-0123456789abcdef",
          principal: PRINCIPAL,
          actor: AGENT,
        },
      ]),
      "utf8"
    );
    child = spawn(process.execPath, [PDP_SERVER], {
      env: {
        ...process.env,
        PTF_PDP_STORE_DIR: dir,
        PTF_PDP_KEYS_FILE: keysFile,
        PTF_PDP_PORT: "0",
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

  it("liveness needs no auth and touches no decisions", async () => {
    const r = await httpGet(port, "/healthz");
    assert.equal(r.status, 200);
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8")
    ) as { readonly version: string };
    assert.deepEqual(r.json, { ok: true, version: pkg.version });
    const queried = await httpGet(port, "/healthz?cache=bust");
    assert.equal(queried.status, 200);
    const wrong = await httpGet(port, "/healthz", "POST");
    assert.equal(wrong.status, 405);
    // Health probes are transport, not decisions: no decision log lines.
    for (const line of stdoutBuf.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      const v = JSON.parse(t) as Record<string, unknown>;
      assert.ok(!("keyId" in v), "health probe must not log decisions");
    }
  });

  it("readiness reflects store loadability, then fails closed", async () => {
    const ready = await httpGet(port, "/readyz");
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.json, { ready: true, replica: "replica-a" });
    writeFileSync(join(dir, "authority.json"), "{not json", "utf8");
    const broken = await httpGet(port, "/readyz");
    assert.equal(broken.status, 503);
    assert.deepEqual(broken.json, { ready: false, replica: "replica-a" });
  });
});

describe("operations pack — backup/restore drill (ticket 12)", () => {
  const live = mkdtempSync(join(tmpdir(), "ptf-ops-live-"));
  const backup = join(tmpdir(), `ptf-ops-backup-${Date.now()}`);
  const restored = join(tmpdir(), `ptf-ops-restored-${Date.now()}`);

  it("stale restores alarm; clean restores verify end to end", () => {
    // Day 0: live store + audited grant, then a full-directory backup.
    const auth = new Authority();
    seedGrant(auth, "g-ops");
    saveAuthority(live, auth);
    const reg = new RecipientRegistry();
    saveRegistry(live, reg);
    const audit = FileAuditLog.open(join(live, "audit.jsonl"));
    audit.append({
      actor: "operator",
      action: "grant",
      authorityId: "g-ops",
      authorityRev: auth.loadedRevision(),
      registryRev: reg.loadedRevision(),
    });
    const backupEntries = readAuditEntries(live);
    const cpBackup = checkpoint(backupEntries, NOW);
    cpSync(live, backup, { recursive: true });

    // Day 1: revoke on live, audited. Checkpoint must extend the backup one.
    const liveAuth = loadAuthority(live);
    liveAuth.revoke("g-ops");
    saveAuthority(live, liveAuth);
    const liveAudit = FileAuditLog.open(join(live, "audit.jsonl"));
    liveAudit.append({
      actor: "operator",
      action: "revoke",
      authorityId: "g-ops",
      authorityRev: liveAuth.loadedRevision(),
      registryRev: loadRegistry(live).loadedRevision(),
    });
    const liveEntries = readAuditEntries(live);
    const cpLive = checkpoint(liveEntries, NOW + 10);
    assert.equal(
      verifyConsistency(cpBackup, cpLive, backupEntries, liveEntries),
      true
    );

    // Stale restore: yesterday's authority.json over today's audit history.
    writeFileSync(
      join(live, "authority.json"),
      readFileSync(join(backup, "authority.json"), "utf8"),
      "utf8"
    );
    assert.throws(() => loadAuthority(live), /predates|rollback/);
    const staleCli = spawnSync(process.execPath, [
      CLI,
      "--dir",
      live,
      "audit",
      "--verify",
    ]);
    assert.notEqual(staleCli.status, 0, "stale store must fail the CLI drill");

    // Clean restore on a fresh host: whole backup directory, then verify.
    cpSync(backup, restored, { recursive: true });
    const back = loadAuthority(restored);
    assert.equal(back.loadedRevision(), 0);
    assert.equal(
      FileAuditLog.open(join(restored, "audit.jsonl")).verifyChain(),
      true
    );
    const restoredEntries = readAuditEntries(restored);
    assert.equal(checkpoint(restoredEntries, NOW).root, cpBackup.root);
    const cli = spawnSync(process.execPath, [
      CLI,
      "--dir",
      restored,
      "audit",
      "--verify",
    ]);
    assert.equal(cli.status, 0, cli.stderr.toString());
    assert.match(cli.stdout.toString(), /valid/);
  });
});

describe("operations pack — install hygiene contract (ticket 12)", () => {
  it("prepare never breaks consumer installs; lint-staged is scoped", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8")
    ) as {
      readonly scripts: Record<string, string>;
      readonly files: readonly string[];
    };
    const prepare: string | undefined = pkg.scripts["prepare"];
    assert.ok(
      typeof prepare === "string" && prepare.includes("husky"),
      "prepare must still install hooks for contributors"
    );
    assert.ok(
      typeof prepare === "string" &&
        (prepare.includes("|| true") || prepare.includes("|| exit 0")),
      "prepare must tolerate a missing husky binary (consumer git installs)"
    );
    for (const f of pkg.files) {
      assert.ok(!f.includes("husky"), `files must not ship hooks: ${f}`);
    }
    const staged = JSON.parse(
      readFileSync(join(ROOT, ".lintstagedrc"), "utf8")
    ) as Record<string, string>;
    assert.ok(!("*" in staged), "lint-staged must not key on bare *");
    assert.ok(Object.keys(staged).length > 0, "lint-staged must keep rules");
  });

  it("Dockerfile pins Node 22 and runs non-root", () => {
    const docker = readFileSync(join(ROOT, "Dockerfile"), "utf8");
    assert.match(docker, /FROM node:22/);
    assert.match(docker, /USER node/);
  });
});
