import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

/**
 * Durable proposals/challenges via file CAS (v04/02, ADR-0008).
 * One JSON file per digest: `proposals/<digest>.json`. Create uses O_EXCL so
 * double-propose races fail instead of lost-updating. Transitions
 * pending→executed|denied rewrite via write→fsync(file)→rename→fsync(dir)
 * per Borrill arXiv:2603.01384 (rename is atomic namespace, not persistence).
 * TTL GC + stale-tmp cleanup run on open. Single-writer ceiling remains: this
 * fixes restart loss and redeem races for one server, not multi-writer
 * clustering (SQLite deferred with criteria in ADR-0008).
 */

export type ChallengeState = "pending" | "executed" | "denied";

export interface ChallengeRecord {
  readonly digest: string;
  readonly demand: unknown;
  readonly state: ChallengeState;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly ttlSec: number;
  readonly receipt?: unknown;
}

function dirOf(storeDir: string): string {
  return join(storeDir, "proposals");
}

function pathOf(storeDir: string, digest: string): string {
  if (!/^[0-9a-f]{16,128}$/.test(digest))
    throw new Error("challenges: malformed digest");
  return join(dirOf(storeDir), `${digest}.json`);
}

function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Windows/odd FS: best effort only.
  }
}

function durableWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, content, null, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}

/** Remove crashed-write leftovers and expired records. Never throws on missing dir. */
export function gcChallenges(
  storeDir: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): { readonly purged: number; readonly tmpCleaned: number } {
  const dir = dirOf(storeDir);
  let purged = 0;
  let tmpCleaned = 0;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { purged, tmpCleaned };
  }
  for (const name of names) {
    const full = join(dir, name);
    if (name.includes(".tmp-")) {
      try {
        unlinkSync(full);
        tmpCleaned += 1;
      } catch {
        // Best effort.
      }
      continue;
    }
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(full, "utf8") as string) as {
        updatedAt?: unknown;
        ttlSec?: unknown;
      };
      if (
        typeof raw.updatedAt === "number" &&
        typeof raw.ttlSec === "number" &&
        nowSec > raw.updatedAt + raw.ttlSec
      ) {
        unlinkSync(full);
        purged += 1;
      }
    } catch {
      // Corrupt proposal files fail closed at load; GC leaves them for inspection.
    }
  }
  return { purged, tmpCleaned };
}

function readRecord(path: string): ChallengeRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8") as string) as unknown;
  } catch {
    throw new Error(`challenges: store corrupt: ${path}`);
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r["digest"] !== "string" ||
    (r["state"] !== "pending" &&
      r["state"] !== "executed" &&
      r["state"] !== "denied") ||
    typeof r["createdAt"] !== "number" ||
    typeof r["updatedAt"] !== "number" ||
    typeof r["ttlSec"] !== "number"
  ) {
    throw new Error(`challenges: store corrupt: ${path}`);
  }
  return raw as ChallengeRecord;
}

/** Create a pending proposal. O_EXCL: an existing live record is left untouched and returned. */
export function createProposal(
  storeDir: string,
  digest: string,
  demand: unknown,
  ttlSec: number,
  nowSec: number = Math.floor(Date.now() / 1000)
): ChallengeRecord {
  if (!Number.isInteger(ttlSec) || ttlSec <= 0)
    throw new Error("challenges: ttlSec must be a positive integer");
  mkdirSync(dirOf(storeDir), { recursive: true });
  gcChallenges(storeDir, nowSec);
  const path = pathOf(storeDir, digest);
  if (existsSync(path)) {
    const existing = readRecord(path);
    if (nowSec <= existing.updatedAt + existing.ttlSec) return existing;
  }
  const record: ChallengeRecord = {
    digest,
    demand,
    state: "pending",
    createdAt: nowSec,
    updatedAt: nowSec,
    ttlSec,
  };
  const content = JSON.stringify(record);
  try {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeSync(fd, content, null, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    fsyncDir(dirname(path));
  } catch (err) {
    // Lost the O_EXCL race: re-read the winner instead of overwriting.
    if (existsSync(path)) return readRecord(path);
    throw err;
  }
  return record;
}

/** Load a live record; expired records read as expired (caller proposes again). */
export function loadProposal(
  storeDir: string,
  digest: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): ChallengeRecord {
  const record = readRecord(pathOf(storeDir, digest));
  if (nowSec > record.updatedAt + record.ttlSec)
    throw new Error("challenges: proposal expired: propose again");
  return record;
}

/** CAS transition pending→terminal. Non-pending records throw; concurrent winner wins. */
export function transitionProposal(
  storeDir: string,
  digest: string,
  to: "executed" | "denied",
  receipt: unknown,
  nowSec: number = Math.floor(Date.now() / 1000)
): ChallengeRecord {
  const path = pathOf(storeDir, digest);
  const current = readRecord(path);
  if (nowSec > current.updatedAt + current.ttlSec)
    throw new Error("challenges: proposal expired: propose again");
  if (current.state !== "pending")
    throw new Error(`challenges: already ${current.state}`);
  const next: ChallengeRecord = {
    ...current,
    state: to,
    updatedAt: nowSec,
    ...(to === "executed" ? { receipt } : {}),
  };
  durableWriteFile(path, JSON.stringify(next));
  return next;
}
