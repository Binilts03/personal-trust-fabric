import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./files.js";

/**
 * Durable execution journal (Phase 3, ADR-0021).
 *
 * Burn-before-effect prevents double-spending but leaves the outcome unknown
 * when the process crashes after submission. This journal closes that gap
 * with idempotency + reconciliation instead of fake exactly-once:
 *
 * PREPARED → AUTHORIZED → SUBMITTING → SUCCEEDED | FAILED_FINAL
 *                ↑               ↓
 *                └─ no-effect ─ SUBMITTED_UNKNOWN ─ effect → SUCCEEDED
 *                                  │  ├─ failed → FAILED_FINAL
 *                                  │  └─ unknown → quarantined (manual only)
 *                                  └─ manual(+note) → RECONCILED
 *
 * Every record carries a stable `executionId` + `providerIdempotencyKey`:
 * retries after a confirmed no-effect reuse the SAME key, and anything
 * terminal never re-runs. Reconciliation outcomes come from the provider
 * (host query), never from re-guessing locally.
 *
 * Records carry ids/digests/refs only — fixed schema, unknown fields fail
 * closed at load. Free-text `error`/`note` are host-supplied and opaque:
 * keep them secret-free (same host duty as audit `detail`).
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

const KNOWN_KEYS: readonly string[] = [
  "attempts",
  "capabilityId",
  "createdAt",
  "error",
  "executionId",
  "idempotencyKey",
  "note",
  "providerRef",
  "quarantined",
  "state",
  "termsDigest",
  "updatedAt",
];

const VALID_STATES: readonly string[] = [
  "PREPARED",
  "AUTHORIZED",
  "SUBMITTING",
  "SUBMITTED_UNKNOWN",
  "SUCCEEDED",
  "FAILED_FINAL",
  "RECONCILED",
];

export interface ExecutionRecord {
  readonly executionId: string;
  readonly termsDigest: string;
  readonly capabilityId: string;
  readonly idempotencyKey: string;
  readonly state: ExecutionState;
  readonly attempts: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly providerRef?: string;
  readonly error?: string;
  readonly note?: string;
  readonly quarantined?: boolean;
}

export type ReconcileOutcome = "effect" | "no-effect" | "failed" | "unknown" | "manual";

function nonEmpty(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`execution: ${what} must be a non-empty string`);
  }
  return v;
}

function checkRecord(rec: unknown): asserts rec is ExecutionRecord {
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) {
    throw new Error("execution: record corrupt (not an object)");
  }
  const r = rec as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!KNOWN_KEYS.includes(k)) {
      throw new Error(`execution: record corrupt (unknown field ${k})`);
    }
  }
  nonEmpty(r["executionId"], "executionId");
  nonEmpty(r["termsDigest"], "termsDigest");
  nonEmpty(r["capabilityId"], "capabilityId");
  nonEmpty(r["idempotencyKey"], "idempotencyKey");
  if (typeof r["state"] !== "string" || !VALID_STATES.includes(r["state"])) {
    throw new Error("execution: record corrupt (bad state)");
  }
  for (const n of ["attempts", "createdAt", "updatedAt"] as const) {
    const v = r[n];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
      throw new Error(`execution: record corrupt (bad ${n})`);
    }
  }
  for (const s of ["providerRef", "error", "note"] as const) {
    const v = r[s];
    if (v !== undefined && typeof v !== "string") {
      throw new Error(`execution: record corrupt (bad ${s})`);
    }
  }
  if (r["quarantined"] !== undefined && typeof r["quarantined"] !== "boolean") {
    throw new Error("execution: record corrupt (bad quarantined)");
  }
}

const FILE = "executions.json";

/**
 * Single-writer durable journal over `<dir>/executions.json` with the same
 * revision-CAS discipline as authority/registry: a save whose handle is
 * stale fails closed instead of last-write-wins.
 */
export class ExecutionJournal {
  private records = new Map<string, ExecutionRecord>();
  private loadedRev = 0;
  private pristine = true;

  private constructor(private readonly nowSec: () => number) {}

  static load(dir: string, nowSec?: () => number): ExecutionJournal {
    const j = new ExecutionJournal(
      nowSec ?? (() => Math.floor(Date.now() / 1000))
    );
    const path = join(dir, FILE);
    if (!existsSync(path)) return j;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`execution: store corrupt: ${path}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`execution: store corrupt: ${path}`);
    }
    const rev = (parsed as Record<string, unknown>)["revision"];
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) {
      throw new Error(`execution: store corrupt: ${path} (bad revision)`);
    }
    const raw = (parsed as Record<string, unknown>)["records"];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`execution: store corrupt: ${path} (bad records)`);
    }
    for (const [id, rec] of Object.entries(raw as Record<string, unknown>)) {
      checkRecord(rec);
      if ((rec as ExecutionRecord).executionId !== id) {
        throw new Error(`execution: store corrupt: ${path} (id mismatch)`);
      }
      const copy = { ...(rec as ExecutionRecord) };
      if (copy.state === "SUBMITTING") {
        // Crash between persist(SUBMITTING) and the submit call: the effect
        // may or may not have happened. Reload as unknown so reconcile (not
        // retry, not silence) decides. Never auto-advance on load otherwise.
        copy.state = "SUBMITTED_UNKNOWN";
      }
      j.records.set(id, copy);
    }
    j.loadedRev = rev;
    j.pristine = false;
    return j;
  }

  save(dir: string): void {
    const path = join(dir, FILE);
    if (!existsSync(path)) {
      if (!this.pristine || this.loadedRev !== 0) {
        throw new Error(
          `execution: store missing: ${path} — refusing to resurrect stale state`
        );
      }
      atomicWrite(path, JSON.stringify({ revision: 0, records: Object.fromEntries(this.records) }));
      this.pristine = false;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`execution: store corrupt: ${path}`);
    }
    const rev = (parsed as { revision?: unknown })["revision"];
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) {
      throw new Error(`execution: store corrupt: ${path} (bad revision)`);
    }
    if (rev !== this.loadedRev) {
      throw new Error(
        `execution: store changed under us (file revision ${rev}, loaded ${this.loadedRev}) — reload and retry, never overwrite`
      );
    }
    atomicWrite(
      path,
      JSON.stringify({ revision: rev + 1, records: Object.fromEntries(this.records) })
    );
    this.loadedRev = rev + 1;
    this.pristine = false;
  }

  get(executionId: string): ExecutionRecord | undefined {
    const rec = this.records.get(executionId);
    return rec === undefined ? undefined : { ...rec };
  }

  pendingUnknown(): ExecutionRecord[] {
    return [...this.records.values()]
      .filter((r) => r.state === "SUBMITTED_UNKNOWN")
      .map((r) => ({ ...r }));
  }

  /**
   * Drop terminal records (SUCCEEDED / FAILED_FINAL / RECONCILED) last
   * updated more than `olderThanSec` ago. Returns the dropped count.
   * Non-terminal records are never pruned — an unknown outcome stays until
   * reconciled. The audit log remains the permanent history; the journal is
   * live state, so operators prune terminals on a schedule (otherwise the
   * file grows without bound). Unknown-field and bad-arg inputs throw.
   */
  pruneTerminal(nowSec: number, olderThanSec: number): number {
    if (!Number.isSafeInteger(nowSec) || nowSec < 0) {
      throw new Error("execution: nowSec must be a non-negative epoch integer");
    }
    if (!Number.isSafeInteger(olderThanSec) || olderThanSec < 0) {
      throw new Error("execution: olderThanSec must be a non-negative integer");
    }
    let dropped = 0;
    for (const [id, rec] of this.records) {
      if (
        (TERMINAL as readonly string[]).includes(rec.state) &&
        rec.updatedAt <= nowSec &&
        nowSec - rec.updatedAt > olderThanSec
      ) {
        this.records.delete(id);
        dropped += 1;
      }
    }
    return dropped;
  }

  prepare(input: {
    readonly executionId: string;
    readonly termsDigest: string;
    readonly capabilityId: string;
    readonly idempotencyKey: string;
  }): ExecutionRecord {
    const executionId = nonEmpty(input.executionId, "executionId");
    if (this.records.has(executionId)) {
      throw new Error(`execution: ${executionId} already exists — never reuse an executionId`);
    }
    const now = this.nowSec();
    const rec: ExecutionRecord = {
      executionId,
      termsDigest: nonEmpty(input.termsDigest, "termsDigest"),
      capabilityId: nonEmpty(input.capabilityId, "capabilityId"),
      idempotencyKey: nonEmpty(input.idempotencyKey, "idempotencyKey"),
      state: "PREPARED",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(executionId, rec);
    return { ...rec };
  }

  authorize(executionId: string): ExecutionRecord {
    return this.move(executionId, "AUTHORIZED", ["PREPARED"], {});
  }

  beginSubmit(executionId: string): ExecutionRecord {
    const rec = this.require(executionId);
    if (rec.state !== "AUTHORIZED") {
      throw new Error(
        `execution: illegal transition ${rec.state} -> SUBMITTING (authorize first)`
      );
    }
    return this.move(executionId, "SUBMITTING", ["AUTHORIZED"], {
      attempts: rec.attempts + 1,
    });
  }

  /**
   * The submit call threw before a result could be persisted: the effect may
   * or may not have happened. Records the ambiguity (with the provider error
   * text) so restart + reconcile decides — never a blind retry.
   */
  markUnknown(executionId: string, error: string): ExecutionRecord {
    return this.move(
      executionId,
      "SUBMITTED_UNKNOWN",
      ["SUBMITTING"],
      { error: nonEmpty(error, "error") }
    );
  }

  succeed(executionId: string, providerRef: string): ExecutionRecord {
    return this.move(
      executionId,
      "SUCCEEDED",
      ["SUBMITTING", "SUBMITTED_UNKNOWN"],
      { providerRef: nonEmpty(providerRef, "providerRef") }
    );
  }

  failFinal(executionId: string, error: string): ExecutionRecord {
    return this.move(
      executionId,
      "FAILED_FINAL",
      ["SUBMITTING", "SUBMITTED_UNKNOWN"],
      { error: nonEmpty(error, "error") }
    );
  }

  /**
   * Reconcile a SUBMITTED_UNKNOWN record against a provider query performed
   * by the host (never by re-guessing locally):
   * - "effect" (arg = provider ref): the effect happened → SUCCEEDED.
   * - "no-effect" (arg = note): safe to retry → AUTHORIZED, SAME key.
   * - "failed" (arg = error): provider confirms final failure → FAILED_FINAL.
   * - "unknown" (arg = note): cannot establish → stays unknown, quarantined.
   * - "manual" (arg = note): human-resolved quarantine → RECONCILED.
   */
  reconcile(
    executionId: string,
    outcome: ReconcileOutcome,
    refOrNote: string
  ): ExecutionRecord {
    const rec = this.require(executionId);
    if (rec.state !== "SUBMITTED_UNKNOWN") {
      throw new Error(
        `execution: reconcile requires SUBMITTED_UNKNOWN (record is ${rec.state})`
      );
    }
    switch (outcome) {
      case "effect":
        return this.move(executionId, "SUCCEEDED", ["SUBMITTED_UNKNOWN"], {
          providerRef: nonEmpty(refOrNote, "providerRef"),
        });
      case "no-effect":
        return this.move(executionId, "AUTHORIZED", ["SUBMITTED_UNKNOWN"], {
          note: nonEmpty(refOrNote, "note"),
        });
      case "failed":
        return this.move(executionId, "FAILED_FINAL", ["SUBMITTED_UNKNOWN"], {
          error: nonEmpty(refOrNote, "error"),
        });
      case "unknown":
        return this.move(executionId, "SUBMITTED_UNKNOWN", ["SUBMITTED_UNKNOWN"], {
          note: nonEmpty(refOrNote, "note"),
          quarantined: true,
        });
      case "manual":
        return this.move(executionId, "RECONCILED", ["SUBMITTED_UNKNOWN"], {
          note: nonEmpty(refOrNote, "note"),
        });
    }
  }

  private require(executionId: string): ExecutionRecord {
    const rec = this.records.get(executionId);
    if (rec === undefined) {
      throw new Error(`execution: unknown executionId ${executionId}`);
    }
    return rec;
  }

  private move(
    executionId: string,
    to: ExecutionState,
    from: readonly ExecutionState[],
    patch: Partial<ExecutionRecord>
  ): ExecutionRecord {
    const rec = this.require(executionId);
    if (!from.includes(rec.state)) {
      throw new Error(
        `execution: illegal transition ${rec.state} -> ${to}`
      );
    }
    const next: ExecutionRecord = {
      ...rec,
      ...patch,
      state: to,
      updatedAt: this.nowSec(),
    };
    checkRecord(next);
    this.records.set(executionId, next);
    return { ...next };
  }
}

/**
 * Execute one authorized operation exactly once per outcome:
 *
 * 1. Refuses terminal records (history, never re-run) and refuses to submit
 *    while a previous attempt is still SUBMITTED_UNKNOWN (reconcile first —
 *    never blind retry).
 * 2. Persists SUBMITTING (CAS save — a conflict fails BEFORE the external
 *    effect) with the stable idempotency key.
 * 3. Calls `submit(idempotencyKey)`; success persists SUCCEEDED, a throw
 *    persists SUBMITTED_UNKNOWN and rethrows the provider error.
 *
 * The host persists authority consumption BEFORE calling this (burn-before-
 * effect); the journal persists the execution outcome around the call.
 */
export async function runExecution(
  journal: ExecutionJournal,
  save: () => void,
  executionId: string,
  submit: (idempotencyKey: string) => Promise<string>
): Promise<ExecutionRecord> {
  const rec = journal.get(executionId);
  if (rec === undefined) {
    throw new Error(`execution: unknown executionId ${executionId}`);
  }
  if ((TERMINAL as readonly string[]).includes(rec.state)) {
    throw new Error(
      `execution: ${executionId} is terminal (${rec.state}) — reconcile history, never re-run`
    );
  }
  if (rec.state === "SUBMITTED_UNKNOWN") {
    throw new Error(
      rec.quarantined === true
        ? `execution: ${executionId} is quarantined — manual reconciliation required`
        : `execution: ${executionId} outcome unknown — reconcile first, never blind retry`
    );
  }
  if (rec.state !== "AUTHORIZED") {
    throw new Error(
      `execution: ${executionId} is ${rec.state} — reload from disk (a persisted SUBMITTING loads as SUBMITTED_UNKNOWN) and reconcile; never submit from a stale handle`
    );
  }
  journal.beginSubmit(executionId);
  save();
  const key = journal.get(executionId)?.idempotencyKey;
  if (key === undefined || key.length === 0) {
    throw new Error(`execution: ${executionId} lost its idempotency key`);
  }
  try {
    const ref = await submit(key);
    const done = journal.succeed(executionId, ref);
    save();
    return done;
  } catch (err) {
    // The effect may or may not have happened: persist the ambiguity and
    // surface the provider error. Restart + reconcile decides next.
    const errText = err instanceof Error ? err.message : String(err);
    journal.markUnknown(executionId, `submit threw: ${errText}`);
    save();
    throw err;
  }
}
