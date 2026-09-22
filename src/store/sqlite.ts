import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomHex } from "../core/crypto.js";
import { atomicWrite } from "./files.js";
import {
  ExecutionError,
  canTransition,
  listExecutions,
  validateExecutionRecord,
  type ExecutionRecord,
} from "./execution.js";
import type { ExecutionRepository } from "./repositories.js";

/**
 * SQLite WAL backend for the execution journal (ADR-0022, bounded
 * experiment). Same `ExecutionRepository` shape as the file backend; the
 * orchestrator runs unchanged against either. Opt-in per deployment —
 * the file backend stays the default until parity holds in practice.
 *
 * - One database per store dir: `<storeDir>/ptf.sqlite`
 *   (`journal_mode=WAL`, `synchronous=FULL`). WAL + shm files travel with
 *   the db file in backups (one unit, never merge).
 * - Full record JSON in `record_json`; `state` indexed for recovery scans.
 * - Transitions are single conditional UPDATEs
 *   (`WHERE execution_id=? AND state=?`): the SQL statement itself is the
 *   compare-and-swap, stronger than the file read-then-write.
 * - `node:sqlite` is experimental in Node 22 (warning noise, API-drift
 *   risk): mitigated by the parity suite + the retained file backend.
 * - No secrets enter this table: journal payloads are handles-only by
 *   construction (same invariant as the file journal).
 */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
CREATE TABLE IF NOT EXISTS executions (
  execution_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  record_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_executions_state ON executions(state);
CREATE INDEX IF NOT EXISTS idx_executions_key ON executions(idempotency_key);
`;

function dbPath(storeDir: string): string {
  return join(storeDir, "ptf.sqlite");
}

function openDb(storeDir: string): DatabaseSync {
  mkdirSync(storeDir, { recursive: true });
  const db = new DatabaseSync(dbPath(storeDir));
  db.exec(SCHEMA);
  db.exec("PRAGMA busy_timeout = 5000;");
  // Fail closed if WAL did not stick (e.g. read-only FS, unsupported VFS).
  const mode = db.prepare("PRAGMA journal_mode;").get() as
    { journal_mode?: unknown } | undefined;
  if (mode?.journal_mode !== "wal") {
    db.close();
    throw new ExecutionError("journal: sqlite WAL mode unavailable");
  }
  return db;
}

function parseRecord(json: string, what: string): ExecutionRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    throw new ExecutionError(`journal corrupt: ${what}`);
  }
  // Shared shape validation: identical fail-closed behavior to files.
  return validateExecutionRecord(raw, what);
}

function parseRow(row: {
  execution_id: string;
  record_json: string;
}): ExecutionRecord {
  const rec = parseRecord(row.record_json, row.execution_id);
  if (rec.executionId !== row.execution_id) {
    throw new ExecutionError(`journal corrupt: ${row.execution_id}`);
  }
  return rec;
}

function withDb<T>(storeDir: string, fn: (db: DatabaseSync) => T): T {
  const db = openDb(storeDir);
  try {
    return fn(db);
  } catch (err) {
    // Contention surfaces as SQLITE_BUSY despite the timeout: map it to
    // the journal vocabulary; everything else propagates unchanged
    // (corrupt/unknown keep their distinct fail-closed errors).
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: unknown }).code === "SQLITE_BUSY"
    ) {
      throw new ExecutionError("journal: store busy — retry serially");
    }
    throw err;
  } finally {
    try {
      // Checkpoint so -wal/-shm do not linger: the backup unit stays the
      // db file alone. Best-effort; readers never depend on it.
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // Ignore checkpoint failures on close paths.
    }
    db.close();
  }
}

function validateCreateInput(input: {
  readonly executionId?: string;
  readonly idempotencyKey: string;
  readonly capabilityId: string;
  readonly termsDigest: string;
  readonly action: string;
  readonly recipient: string;
  readonly resource: string;
  readonly purpose: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly maxAttempts?: number;
}): { executionId: string; maxAttempts: number } {
  const executionId = input.executionId ?? "";
  if (input.executionId !== undefined && !/^[0-9a-f]{32}$/.test(executionId)) {
    throw new ExecutionError("malformed executionId");
  }
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new ExecutionError("journal: maxAttempts must be a positive integer");
  }
  for (const [k, v] of [
    ["idempotencyKey", input.idempotencyKey],
    ["capabilityId", input.capabilityId],
    ["termsDigest", input.termsDigest],
    ["action", input.action],
    ["recipient", input.recipient],
    ["resource", input.resource],
    ["purpose", input.purpose],
  ] as const) {
    if (typeof v !== "string" || v.length === 0)
      throw new ExecutionError(`journal: ${k} required`);
  }
  if (
    typeof input.context !== "object" ||
    input.context === null ||
    Array.isArray(input.context)
  )
    throw new ExecutionError("journal: context must be an object");
  return { executionId, maxAttempts };
}

export const SqliteExecutions: ExecutionRepository = {
  create(storeDir, input, nowSec = Math.floor(Date.now() / 1000)) {
    const { executionId: explicitId, maxAttempts } = validateCreateInput(input);
    return withDb(storeDir, (db) => {
      const byKey = db
        .prepare("SELECT record_json FROM executions WHERE idempotency_key = ?")
        .get(input.idempotencyKey) as { record_json: string } | undefined;
      if (byKey !== undefined) {
        return parseRecord(byKey.record_json, "idempotency-key");
      }
      const executionId = explicitId !== "" ? explicitId : randomHex(16);
      if (!/^[0-9a-f]{32}$/.test(executionId)) {
        throw new ExecutionError("malformed executionId");
      }
      const record: ExecutionRecord = {
        executionId,
        idempotencyKey: input.idempotencyKey,
        capabilityId: input.capabilityId,
        termsDigest: input.termsDigest,
        action: input.action,
        recipient: input.recipient,
        resource: input.resource,
        purpose: input.purpose,
        context: { ...input.context },
        state: "PREPARED",
        createdAt: nowSec,
        updatedAt: nowSec,
        attempts: 0,
        maxAttempts,
      };
      try {
        db.prepare(
          "INSERT INTO executions (execution_id, idempotency_key, state, record_json, updated_at) VALUES (?, ?, ?, ?, ?)"
        ).run(
          executionId,
          input.idempotencyKey,
          "PREPARED",
          JSON.stringify(record),
          nowSec
        );
      } catch {
        const winner = db
          .prepare(
            "SELECT record_json FROM executions WHERE idempotency_key = ?"
          )
          .get(input.idempotencyKey) as { record_json: string } | undefined;
        if (winner !== undefined) {
          return parseRecord(winner.record_json, "idempotency-key");
        }
        throw new ExecutionError("journal: create failed");
      }
      return record;
    });
  },

  load(storeDir, executionId) {
    if (!/^[0-9a-f]{32}$/.test(executionId)) {
      throw new ExecutionError("malformed executionId");
    }
    return withDb(storeDir, (db) => {
      const row = db
        .prepare(
          "SELECT execution_id, record_json FROM executions WHERE execution_id = ?"
        )
        .get(executionId) as
        { execution_id: string; record_json: string } | undefined;
      if (row === undefined)
        throw new ExecutionError("journal: unknown execution");
      return parseRow(row);
    });
  },

  transition(
    storeDir,
    executionId,
    to,
    patch = {},
    nowSec = Math.floor(Date.now() / 1000)
  ) {
    if (!/^[0-9a-f]{32}$/.test(executionId)) {
      throw new ExecutionError("malformed executionId");
    }
    if (
      patch.lastError !== undefined &&
      (typeof patch.lastError !== "string" || patch.lastError.length > 256)
    ) {
      throw new ExecutionError("journal: lastError exceeds 256 chars");
    }
    return withDb(storeDir, (db) => {
      const row = db
        .prepare(
          "SELECT execution_id, record_json FROM executions WHERE execution_id = ?"
        )
        .get(executionId) as
        { execution_id: string; record_json: string } | undefined;
      if (row === undefined)
        throw new ExecutionError("journal: unknown execution");
      const current = parseRow(row);
      if (!canTransition(current.state, to)) {
        throw new ExecutionError(
          `journal: illegal transition ${current.state} → ${to}`
        );
      }
      const next: ExecutionRecord = {
        ...current,
        state: to,
        updatedAt: nowSec,
        attempts: to === "SUBMITTING" ? current.attempts + 1 : current.attempts,
        ...(patch.externalRef !== undefined
          ? { externalRef: patch.externalRef }
          : {}),
        ...(patch.receiptId !== undefined
          ? { receiptId: patch.receiptId }
          : {}),
        ...(patch.receiptAt !== undefined
          ? { receiptAt: patch.receiptAt }
          : {}),
        ...(patch.lastError !== undefined
          ? { lastError: patch.lastError }
          : {}),
        ...(patch.reconciledAt !== undefined
          ? { reconciledAt: patch.reconciledAt }
          : {}),
      };
      const applied = db
        .prepare(
          "UPDATE executions SET state = ?, record_json = ?, updated_at = ? WHERE execution_id = ? AND state = ?"
        )
        .run(to, JSON.stringify(next), nowSec, executionId, current.state);
      if (Number(applied.changes) !== 1) {
        throw new ExecutionError("journal: concurrent transition lost");
      }
      return next;
    });
  },

  findByIdempotencyKey(storeDir, idempotencyKey) {
    return withDb(storeDir, (db) => {
      const row = db
        .prepare(
          "SELECT execution_id, record_json FROM executions WHERE idempotency_key = ?"
        )
        .get(idempotencyKey) as
        { execution_id: string; record_json: string } | undefined;
      if (row === undefined) return null;
      return parseRow(row);
    });
  },

  list(storeDir) {
    return withDb(storeDir, (db) => {
      const rows = db
        .prepare(
          "SELECT execution_id, record_json FROM executions ORDER BY execution_id"
        )
        .all() as { execution_id: string; record_json: string }[];
      return rows.map(parseRow);
    });
  },

  recoverUnsettled(storeDir, nowSec = Math.floor(Date.now() / 1000)) {
    const repo = SqliteExecutions;
    const out: ExecutionRecord[] = [];
    for (const rec of repo.list(storeDir)) {
      if (rec.state === "SUBMITTING") {
        out.push(
          repo.transition(
            storeDir,
            rec.executionId,
            "SUBMITTED_UNKNOWN",
            {
              lastError: "restart during submission: effect unknown",
            },
            nowSec
          )
        );
      } else if (rec.state === "SUBMITTED_UNKNOWN") {
        out.push(rec);
      }
    }
    return out;
  },

  abort(
    storeDir,
    executionId,
    reason = "cancelled",
    nowSec = Math.floor(Date.now() / 1000)
  ) {
    if (reason !== "cancelled" && reason !== "frozen") {
      throw new ExecutionError("journal: unknown abort reason");
    }
    const current = SqliteExecutions.load(storeDir, executionId);
    if (current.state !== "PREPARED" && current.state !== "AUTHORIZED") {
      throw new ExecutionError(
        `journal: cannot abort ${current.state} execution`
      );
    }
    return SqliteExecutions.transition(
      storeDir,
      executionId,
      "FAILED_FINAL",
      { lastError: `aborted: ${reason}` },
      nowSec
    );
  },
};

/**
 * Migrate file-journal records into SQLite, atomically: one transaction
 * commits the whole copy, so a crash migrates nothing instead of half.
 * Existing rows win on either key conflict (copy, never move): sources
 * are NEVER deleted here — operators remove them only after verifying
 * parity. Returns counts.
 */
export function migrateExecutionsToSqlite(storeDir: string): {
  readonly migrated: number;
  readonly kept: number;
} {
  const records = listExecutions(storeDir);
  if (records.length === 0) {
    // Still ensure the schema exists for a fresh opt-in.
    withDb(storeDir, () => undefined);
    return { migrated: 0, kept: 0 };
  }
  return withDb(storeDir, (db) => {
    let migrated = 0;
    let kept = 0;
    const insert = db.prepare(
      "INSERT OR IGNORE INTO executions (execution_id, idempotency_key, state, record_json, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    db.exec("BEGIN IMMEDIATE;");
    try {
      for (const rec of records) {
        const applied = insert.run(
          rec.executionId,
          rec.idempotencyKey,
          rec.state,
          JSON.stringify(rec),
          rec.updatedAt
        );
        if (Number(applied.changes) === 1) migrated += 1;
        else kept += 1;
      }
      db.exec("COMMIT;");
    } catch (err) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        // Rollback itself failed: surface the original error.
      }
      throw err;
    }
    return { migrated, kept };
  });
}

/**
 * Export SQLite journal rows back to file form under a FRESH target dir.
 * Staged then atomically renamed, so a crash leaves either nothing or a
 * complete unit — re-running never hits a half-written never-merge
 * refusal from its own partial output. Stale staging dirs from crashed
 * runs are cleaned at start. Round-trip path for rollback off SQLite;
 * proves no silent discard either direction.
 */
export function exportExecutionsToFiles(
  storeDir: string,
  targetDir: string
): { readonly exported: number } {
  const finalDir = join(targetDir, "executions");
  mkdirSync(targetDir, { recursive: true });
  // Clean crashed-run staging leftovers (never live data: final renames away).
  for (const name of readdirSync(targetDir)) {
    if (name.startsWith("executions.incomplete-")) {
      const stale = join(targetDir, name);
      for (const f of readdirSync(stale)) {
        unlinkSync(join(stale, f));
      }
      rmdirSync(stale);
    }
  }
  const existing = existsSync(finalDir)
    ? readdirSync(finalDir).filter(
        (n) => n.endsWith(".json") && !n.includes(".tmp-")
      )
    : [];
  if (existing.length > 0) {
    throw new ExecutionError(
      "journal: export target not empty — never merge vintages"
    );
  }
  if (existsSync(finalDir)) rmdirSync(finalDir);
  const staging = join(
    targetDir,
    `executions.incomplete-${process.pid}-${Date.now()}`
  );
  mkdirSync(staging, { recursive: true });
  let exported = 0;
  withDb(storeDir, (db) => {
    const rows = db
      .prepare(
        "SELECT execution_id, record_json FROM executions ORDER BY execution_id"
      )
      .all() as { execution_id: string; record_json: string }[];
    for (const row of rows) {
      const rec = parseRow(row);
      atomicWrite(
        join(staging, `${rec.executionId}.json`),
        JSON.stringify(rec)
      );
      exported += 1;
    }
  });
  renameSync(staging, finalDir);
  return { exported };
}
