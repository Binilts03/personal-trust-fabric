import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomHex } from "../core/crypto.js";
import { atomicWrite } from "./files.js";

/**
 * Durable execution journal (ADR-0021, roadmap G3).
 *
 * Crash semantics before this journal: authority consumption persisted
 * BEFORE the external effect, so a crash between persist and execute burned
 * a use with the outcome unknown and no recovery path. The journal records
 * the outcome lifecycle around the effect: every effectful run gets an
 * `executionId` plus a deterministic provider idempotency key, transitions
 * persist before the provider call, and restart recovery reconciles
 * unknown outcomes via provider query instead of blind retry.
 *
 * One JSON file per execution: `executions/<executionId>.json`. Create uses
 * O_EXCL; transitions rewrite via `atomicWrite` (tmp+0600+fsync+rename).
 * Corrupt records throw (fail-closed); no TTL/GC — execution history is
 * audit-supporting and must survive (growth: one small file per effectful
 * op; archive with backups). Single-writer topology unchanged.
 *
 * Exactly-once is NOT claimed: safety comes from idempotency keys +
 * query-first reconcile, never from retry alone.
 */

export type ExecutionState =
  | "PREPARED"
  | "AUTHORIZED"
  | "SUBMITTING"
  | "SUBMITTED_UNKNOWN"
  | "SUCCEEDED"
  | "FAILED_FINAL"
  | "RECONCILED";

const TERMINAL: readonly ExecutionState[] = [
  "SUCCEEDED",
  "FAILED_FINAL",
  "RECONCILED",
];

/** Strict transition map: anything unlisted throws fail-closed. */
const TRANSITIONS: Readonly<Record<ExecutionState, readonly ExecutionState[]>> =
  {
    PREPARED: ["AUTHORIZED", "FAILED_FINAL"],
    AUTHORIZED: ["SUBMITTING", "FAILED_FINAL"],
    SUBMITTING: ["SUCCEEDED", "FAILED_FINAL", "SUBMITTED_UNKNOWN"],
    SUBMITTED_UNKNOWN: ["SUCCEEDED", "SUBMITTING", "RECONCILED"],
    SUCCEEDED: [],
    FAILED_FINAL: [],
    RECONCILED: [],
  };

export interface ExecutionRecord {
  readonly executionId: string;
  /** Stable per authorized terms: retries reuse it, replays find it. */
  readonly idempotencyKey: string;
  readonly capabilityId: string;
  readonly termsDigest: string;
  readonly action: string;
  readonly recipient: string;
  readonly resource: string;
  readonly purpose: string;
  /** Handles-only effect terms snapshot (canonicalizable, secret-free). */
  readonly context: Readonly<Record<string, unknown>>;
  readonly state: ExecutionState;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly attempts: number;
  /** Retry budget fixed at create; resume cannot re-arm it. */
  readonly maxAttempts: number;
  readonly externalRef?: string;
  readonly receiptId?: string;
  readonly receiptAt?: number;
  /** Fixed-vocabulary failure/reconcile note — never raw provider detail. */
  readonly lastError?: string;
  readonly reconciledAt?: number;
}

export class ExecutionError extends Error {
  constructor(reason: string) {
    super(`execution: ${reason}`);
  }
}

/** Journal write that must surface the execution id to the caller. */
export class AmbiguousExecutionError extends ExecutionError {
  readonly executionId: string;
  constructor(executionId: string, reason: string) {
    super(reason);
    this.executionId = executionId;
  }
}

function dirOf(storeDir: string): string {
  return join(storeDir, "executions");
}

function pathOf(storeDir: string, executionId: string): string {
  if (!/^[0-9a-f]{32}$/.test(executionId))
    throw new ExecutionError("malformed executionId");
  return join(dirOf(storeDir), `${executionId}.json`);
}

/**
 * Deterministic provider idempotency key for one authorized terms set.
 * Full digests, no truncation: same (termsDigest, capabilityId) → same key
 * across retries and replays; different terms → different key.
 */
export function deriveIdempotencyKey(
  termsDigest: string,
  capabilityId: string
): string {
  if (!/^[0-9a-f]{16,128}$/.test(termsDigest))
    throw new ExecutionError("malformed termsDigest");
  if (!/^[0-9a-f]{16,128}$/.test(capabilityId))
    throw new ExecutionError("malformed capabilityId");
  return `ptf-${termsDigest}-${capabilityId}`;
}

/** External refs are provider-controlled evidence: bounded, non-empty. */
export function assertExternalRef(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 256) {
    throw new ExecutionError("journal: malformed external ref");
  }
  return raw;
}

function readRecord(path: string): ExecutionRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8") as string) as unknown;
  } catch {
    throw new ExecutionError(`journal corrupt: ${path}`);
  }
  return validateExecutionRecord(raw, path);
}

/**
 * Shape validation shared by every backend (file + SQLite): corrupt or
 * illegal-state payloads throw identically, so tamper fails closed the
 * same way everywhere. Backends must validate through this, never a
 * subset.
 */
export function validateExecutionRecord(
  raw: unknown,
  what: string
): ExecutionRecord {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    !/^[0-9a-f]{32}$/.test(
      (raw as Record<string, unknown>)["executionId"] as string
    ) ||
    typeof (raw as Record<string, unknown>)["idempotencyKey"] !== "string" ||
    typeof (raw as Record<string, unknown>)["capabilityId"] !== "string" ||
    typeof (raw as Record<string, unknown>)["termsDigest"] !== "string" ||
    typeof (raw as Record<string, unknown>)["action"] !== "string" ||
    typeof (raw as Record<string, unknown>)["recipient"] !== "string" ||
    typeof (raw as Record<string, unknown>)["resource"] !== "string" ||
    typeof (raw as Record<string, unknown>)["purpose"] !== "string" ||
    typeof (raw as Record<string, unknown>)["context"] !== "object" ||
    (raw as Record<string, unknown>)["context"] === null ||
    !TRANSITIONS[(raw as Record<string, unknown>)["state"] as ExecutionState] ||
    typeof (raw as Record<string, unknown>)["createdAt"] !== "number" ||
    typeof (raw as Record<string, unknown>)["updatedAt"] !== "number" ||
    typeof (raw as Record<string, unknown>)["attempts"] !== "number" ||
    typeof (raw as Record<string, unknown>)["maxAttempts"] !== "number"
  ) {
    throw new ExecutionError(`journal corrupt: ${what}`);
  }
  return raw as ExecutionRecord;
}

/**
 * Create a PREPARED record. Idempotent on the idempotency key: a live
 * record with the same key is returned instead of a duplicate (same key
 * implies same authorized terms — the key derives from them). O_EXCL on
 * the execution id still guards the file race; the loser re-reads the
 * winner by key. An explicitly reused executionId with different terms
 * throws (caller bug). Residual: two processes racing past the key lookup
 * can still create two ids for one key — single-writer topology covers
 * that window (same backstop as proposals, ADR-0017).
 */
export function createExecution(
  storeDir: string,
  input: {
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
  },
  nowSec: number = Math.floor(Date.now() / 1000)
): ExecutionRecord {
  const executionId = input.executionId ?? randomHex(16);
  if (!/^[0-9a-f]{32}$/.test(executionId))
    throw new ExecutionError("malformed executionId");
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
  mkdirSync(dirOf(storeDir), { recursive: true });
  const byKey = findByIdempotencyKey(storeDir, input.idempotencyKey);
  if (byKey !== null) return byKey;
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
  const path = pathOf(storeDir, executionId);
  const content = JSON.stringify(record);
  try {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeSync(fd, content, null, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Lost the file race: re-read the winner by key instead of duplicating.
    const winner = findByIdempotencyKey(storeDir, input.idempotencyKey);
    if (winner !== null) return winner;
    throw new ExecutionError("journal: create failed");
  }
  return record;
}

/** Load a record by id. Missing reads as unknown; corrupt reads throw. */
export function loadExecution(
  storeDir: string,
  executionId: string
): ExecutionRecord {
  const path = pathOf(storeDir, executionId);
  if (!existsSync(path)) throw new ExecutionError("journal: unknown execution");
  return readRecord(path);
}

/**
 * Guarded transition: the (from → to) pair must be listed in TRANSITIONS.
 * SUBMITTING increments attempts (one durable count per provider attempt).
 * Terminal records are immutable — any transition out throws.
 */
export function transitionExecution(
  storeDir: string,
  executionId: string,
  to: ExecutionState,
  patch: {
    readonly externalRef?: string;
    readonly receiptId?: string;
    readonly receiptAt?: number;
    readonly lastError?: string;
    readonly reconciledAt?: number;
  } = {},
  nowSec: number = Math.floor(Date.now() / 1000)
): ExecutionRecord {
  const path = pathOf(storeDir, executionId);
  const current = readRecord(path);
  if (!(TRANSITIONS[current.state] as readonly ExecutionState[]).includes(to)) {
    throw new ExecutionError(
      `journal: illegal transition ${current.state} → ${to}`
    );
  }
  if (
    patch.lastError !== undefined &&
    (typeof patch.lastError !== "string" || patch.lastError.length > 256)
  ) {
    throw new ExecutionError("journal: lastError exceeds 256 chars");
  }
  const next: ExecutionRecord = {
    ...current,
    state: to,
    updatedAt: nowSec,
    attempts: to === "SUBMITTING" ? current.attempts + 1 : current.attempts,
    ...(patch.externalRef !== undefined
      ? { externalRef: patch.externalRef }
      : {}),
    ...(patch.receiptId !== undefined ? { receiptId: patch.receiptId } : {}),
    ...(patch.receiptAt !== undefined ? { receiptAt: patch.receiptAt } : {}),
    ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
    ...(patch.reconciledAt !== undefined
      ? { reconciledAt: patch.reconciledAt }
      : {}),
  };
  atomicWrite(path, JSON.stringify(next));
  return next;
}

/**
 * Find a record by idempotency key (O(n) scan; indexed backends come with
 * Phase 4). Corrupt files throw — same as listExecutions: tamper must
 * never silently hide a live record from dedupe and fork a second effect.
 */
export function findByIdempotencyKey(
  storeDir: string,
  idempotencyKey: string
): ExecutionRecord | null {
  let names: string[];
  try {
    names = readdirSync(dirOf(storeDir));
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith(".json") || name.includes(".tmp-")) continue;
    const rec = readRecord(join(dirOf(storeDir), name));
    if (rec.idempotencyKey === idempotencyKey) return rec;
  }
  return null;
}

/** All records (corrupt files throw — inspection duty, never silent skip at this layer). */
export function listExecutions(storeDir: string): ExecutionRecord[] {
  let names: string[];
  try {
    names = readdirSync(dirOf(storeDir));
  } catch {
    return [];
  }
  const out: ExecutionRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.includes(".tmp-")) continue;
    out.push(readRecord(join(dirOf(storeDir), name)));
  }
  return out;
}

/**
 * Restart recovery: leftover SUBMITTING records are crash evidence — the
 * provider was called (or was about to be) with no persisted result, so
 * the effect is unknown. Mark each SUBMITTED_UNKNOWN and return them for
 * query-first reconciliation. Never retries here.
 */
export function recoverUnsettled(
  storeDir: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): ExecutionRecord[] {
  const out: ExecutionRecord[] = [];
  for (const rec of listExecutions(storeDir)) {
    if (rec.state === "SUBMITTING") {
      out.push(
        transitionExecution(
          storeDir,
          rec.executionId,
          "SUBMITTED_UNKNOWN",
          { lastError: "restart during submission: effect unknown" },
          nowSec
        )
      );
    } else if (rec.state === "SUBMITTED_UNKNOWN") {
      out.push(rec);
    }
  }
  return out;
}

/** True for SUCCEEDED / FAILED_FINAL / RECONCILED. */
export function isTerminal(record: ExecutionRecord): boolean {
  return (TERMINAL as readonly ExecutionState[]).includes(record.state);
}

/** Whether a (from → to) transition is legal. Backends enforce the same map. */
export function canTransition(
  from: ExecutionState,
  to: ExecutionState
): boolean {
  return (TRANSITIONS[from] as readonly ExecutionState[]).includes(to);
}

/**
 * Explicit host abort (freeze/cancel path): PREPARED or AUTHORIZED records
 * that must never submit transition to FAILED_FINAL. Never touches live or
 * terminal records — aborting those throws. Reason is fixed-vocabulary.
 */
export function abortExecution(
  storeDir: string,
  executionId: string,
  reason: "cancelled" | "frozen" = "cancelled",
  nowSec: number = Math.floor(Date.now() / 1000)
): ExecutionRecord {
  if (reason !== "cancelled" && reason !== "frozen") {
    throw new ExecutionError("journal: unknown abort reason");
  }
  const current = loadExecution(storeDir, executionId);
  if (current.state !== "PREPARED" && current.state !== "AUTHORIZED") {
    throw new ExecutionError(
      `journal: cannot abort ${current.state} execution`
    );
  }
  return transitionExecution(
    storeDir,
    executionId,
    "FAILED_FINAL",
    { lastError: `aborted: ${reason}` },
    nowSec
  );
}
