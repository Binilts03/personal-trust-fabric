import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  openSync,
  closeSync,
  fsyncSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { canonicalize, sha256Hex } from "../core/canonical.js";
import type {
  PreparedEventResolution,
  PrivacyEventRepository,
  ProcessingEventFinalize,
  ProcessingEventPrepare,
  ProcessingEventRecord,
  ProcessingEventState,
} from "../privacy/model.js";
import { atomicWrite } from "./files.js";
import { assertOpaquePrivacySubjectRef } from "../privacy/model.js";
import {
  openSnapshotEnvelope,
  readSealedEnvelopeKid,
  resolveSealedDek,
  sealSnapshotEnvelope,
  sealedDekFingerprint,
} from "./sealed-snapshot.js";

const EVENT_VERSION = 1;
const EVENT_AAD = "ptf-privacy-event/v1";
/**
 * The attempt index is a CACHE, not evidence: it maps an attempt reference
 * to the event files that cover it, so a lookup does not have to decrypt
 * every event. A missing, stale, or unreadable index is a cache miss - the
 * lookup falls back to the full scan, so the index can never hide an event.
 * It lives beside the store (not inside the event directory) so the backup
 * manifest keeps counting events, not cache files.
 */
const INDEX_FILE = "privacy-event-index.json";

interface AttemptIndex {
  readonly attempts: Readonly<Record<string, readonly string[]>>;
}

function attemptKey(termsDigest: string, attemptRef: string): string {
  return sha256Hex(canonicalize([termsDigest, attemptRef]));
}

function indexPath(dir: string): string {
  return join(dir, INDEX_FILE);
}

function readIndex(dir: string, dek: Uint8Array): AttemptIndex | null {
  const path = indexPath(dir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return openSnapshotEnvelope(parsed, dek, eventOptions(), path, (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        typeof (value as { attempts?: unknown }).attempts !== "object"
      ) {
        throw new Error("privacy event: bad index payload");
      }
      return value as AttemptIndex;
    });
  } catch {
    // A stale index (or one sealed with a rotated key) is a cache miss.
    return null;
  }
}

function writeIndex(dir: string, dek: Uint8Array, index: AttemptIndex): void {
  try {
    atomicWrite(
      indexPath(dir),
      JSON.stringify(sealSnapshotEnvelope(index, dek, eventOptions()))
    );
  } catch {
    // The index is a cache: failing to write it must never fail the
    // evidence write. The next lookup falls back to the full scan.
  }
}

function stableKey(input: ProcessingEventPrepare): string {
  const { preparedAt: _preparedAt, ...stable } = input;
  return sha256Hex(canonicalize(stable));
}

function eventIdFor(key: string): string {
  return `pev-${key.slice(0, 32)}`;
}

function eventFile(dir: string, eventId: string): string {
  if (!/^pev-[0-9a-f]{32}$/.test(eventId)) {
    throw new Error("privacy event: invalid event id");
  }
  return join(dir, "privacy-events", `${eventId}.json`);
}

function cloneEvent(v: ProcessingEventRecord): ProcessingEventRecord {
  return {
    ...v,
    resource: { ...v.resource },
    dataCategories: [...v.dataCategories],
    recipients: v.recipients.map((r) => ({ ...r })),
    authorityCitationIds: [...v.authorityCitationIds],
  };
}

function eventOptions() {
  return {
    version: EVENT_VERSION,
    aad: EVENT_AAD,
    kidBytes: 8,
    errorPrefix: "privacy event",
  } as const;
}

function openRecord(path: string, dek: Uint8Array): ProcessingEventRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`privacy event store corrupt: ${path}`);
  }
  return openSnapshotEnvelope(parsed, dek, eventOptions(), path, (value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as Record<string, unknown>)["eventId"] !== "string" ||
      typeof (value as Record<string, unknown>)["idempotencyKey"] !==
        "string" ||
      typeof (value as Record<string, unknown>)["state"] !== "string"
    ) {
      throw new Error("privacy event: bad payload");
    }
    return value as ProcessingEventRecord;
  });
}

function sealRecord(record: ProcessingEventRecord, dek: Uint8Array): string {
  return JSON.stringify(sealSnapshotEnvelope(record, dek, eventOptions()));
}

export class FilePrivacyEventRepository implements PrivacyEventRepository {
  private readonly dir: string;
  private readonly dek: Uint8Array;
  private readonly nowSec: () => number;
  private readonly maxRecords: number;

  constructor(opts: {
    readonly dir: string;
    readonly dek: Uint8Array;
    readonly nowSec?: () => number;
    readonly maxRecords?: number;
  }) {
    if (
      opts.maxRecords !== undefined &&
      (!Number.isSafeInteger(opts.maxRecords) || opts.maxRecords < 1)
    ) {
      throw new Error("privacy event: maxRecords must be a positive integer");
    }
    this.dir = opts.dir;
    this.dek = opts.dek;
    this.nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
    this.maxRecords = opts.maxRecords ?? 5000;
  }

  prepare(input: ProcessingEventPrepare): ProcessingEventRecord {
    assertOpaquePrivacySubjectRef(input.dataPrincipalRef);
    if (
      input.attemptRef !== undefined &&
      !/^[A-Za-z0-9_.:-]{1,200}$/.test(input.attemptRef)
    ) {
      throw new Error("privacy event: invalid attempt reference");
    }
    // A caller that did not supply a retry reference gets a fresh attempt.
    // Without this, identical terms would collapse distinct effects into one
    // evidence record.
    const attemptRef = input.attemptRef ?? randomUUID();
    const normalized: ProcessingEventPrepare = { ...input, attemptRef };
    const key = stableKey(normalized);
    const eventId = eventIdFor(key);
    const path = eventFile(this.dir, eventId);
    if (existsSync(path)) {
      const existing = openRecord(path, this.dek);
      if (existing.idempotencyKey !== key) {
        throw new Error("privacy event: idempotency collision");
      }
      return cloneEvent(existing);
    }
    if (this.all().length >= this.maxRecords) {
      throw new Error(
        "privacy event store full — archive safely before creating another record"
      );
    }
    const record: ProcessingEventRecord = {
      ...normalized,
      resource: { ...normalized.resource },
      dataCategories: [...normalized.dataCategories],
      recipients: normalized.recipients.map((r) => ({ ...r })),
      authorityCitationIds: [...normalized.authorityCitationIds],
      eventId,
      idempotencyKey: key,
      state: "PREPARED",
    };
    mkdirSync(join(this.dir, "privacy-events"), { recursive: true });
    try {
      // Match the durable proposal creation protocol: exclusive-create,
      // write, fsync file, then best-effort fsync of directory metadata.
      // A plain writeFileSync(..., "wx") is not a durable precommit.
      const fd = openSync(path, "wx", 0o600);
      try {
        writeSync(fd, sealRecord(record, this.dek), null, "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      try {
        const dfd = openSync(join(this.dir, "privacy-events"), "r");
        try {
          fsyncSync(dfd);
        } finally {
          closeSync(dfd);
        }
      } catch {
        // Windows or unusual filesystems do not support syncing folders.
        // Same best-effort residual as the existing proposal-store path.
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "EEXIST"
      ) {
        const existing = openRecord(path, this.dek);
        if (existing.idempotencyKey !== key) {
          throw new Error("privacy event: idempotency collision");
        }
        return cloneEvent(existing);
      }
      throw error;
    }
    this.indexAttempt(normalized.termsDigest, attemptRef, eventId);
    return cloneEvent(record);
  }

  /** Point the attempt cache at this event. Best effort by design. */
  private indexAttempt(
    termsDigest: string,
    attemptRef: string,
    eventId: string
  ): void {
    const key = attemptKey(termsDigest, attemptRef);
    const index = readIndex(this.dir, this.dek) ?? { attempts: {} };
    const ids = index.attempts[key] ?? [];
    if (ids.includes(eventId)) return;
    writeIndex(this.dir, this.dek, {
      attempts: { ...index.attempts, [key]: [...ids, eventId] },
    });
  }

  load(eventId: string): ProcessingEventRecord | null {
    const path = eventFile(this.dir, eventId);
    return existsSync(path) ? cloneEvent(openRecord(path, this.dek)) : null;
  }

  transition(
    eventId: string,
    to: Exclude<ProcessingEventState, "PREPARED">,
    patch: ProcessingEventFinalize
  ): ProcessingEventRecord {
    const path = eventFile(this.dir, eventId);
    if (!existsSync(path)) throw new Error("privacy event: unknown event");
    const current = openRecord(path, this.dek);
    if (current.state !== "PREPARED") {
      // Idempotent retry: the first final evidence wins and is never
      // rewritten. This closes the crash-after-finalize/retry wedge without
      // letting a later call replace a receipt.
      if (current.state === to) return cloneEvent(current);
      // A crash or ambiguous provider result may later be reconciled.
      // FAILED_FINAL and SUCCEEDED are terminal; UNKNOWN may be resolved.
      if (
        current.state !== "OUTCOME_UNKNOWN" ||
        (to !== "SUCCEEDED" && to !== "FAILED_FINAL")
      ) {
        throw new Error("privacy event: terminal transition forbidden");
      }
    }
    if (!Number.isInteger(patch.finalizedAt) || patch.finalizedAt < 0) {
      throw new Error(
        "privacy event: finalizedAt must be a non-negative epoch int"
      );
    }
    const next: ProcessingEventRecord = {
      ...current,
      state: to,
      finalizedAt: patch.finalizedAt,
      ...(patch.evidenceRef !== undefined
        ? { evidenceRef: patch.evidenceRef }
        : {}),
    };
    atomicWrite(path, sealRecord(next, this.dek));
    return cloneEvent(next);
  }

  findByKey(idempotencyKey: string): ProcessingEventRecord | null {
    // The event id is derived from the idempotency key, so the lookup is a
    // single file read instead of a scan that decrypts every event.
    if (!/^[0-9a-f]{64}$/.test(idempotencyKey)) return null;
    const path = eventFile(this.dir, eventIdFor(idempotencyKey));
    if (!existsSync(path)) return null;
    const record = openRecord(path, this.dek);
    return record.idempotencyKey === idempotencyKey ? cloneEvent(record) : null;
  }

  listBySubject(dataPrincipalRef: string): readonly ProcessingEventRecord[] {
    return this.all().filter(
      (record) => record.dataPrincipalRef === dataPrincipalRef
    );
  }

  findByAttempt(
    termsDigest: string,
    attemptRef: string
  ): readonly ProcessingEventRecord[] {
    // The attempt cache turns this into a single event read. A cache miss
    // (no index, a stale index, an index that does not cover the attempt)
    // falls back to the full scan, so the index can never hide an event.
    const key = attemptKey(termsDigest, attemptRef);
    const indexed = readIndex(this.dir, this.dek)?.attempts[key];
    if (indexed !== undefined) {
      const found: ProcessingEventRecord[] = [];
      for (const eventId of indexed) {
        const record = this.load(eventId);
        if (record === null) continue;
        if (
          record.termsDigest !== termsDigest ||
          record.attemptRef !== attemptRef
        ) {
          continue;
        }
        found.push(record);
      }
      if (found.length > 0) return found;
    }
    return this.all().filter(
      (record) =>
        record.termsDigest === termsDigest && record.attemptRef === attemptRef
    );
  }

  recoverPrepared(
    nowSec: number = this.nowSec(),
    resolve?: (event: ProcessingEventRecord) => PreparedEventResolution | null,
    opts: { readonly includeUnknown?: boolean } = {}
  ): readonly ProcessingEventRecord[] {
    const recovered: ProcessingEventRecord[] = [];
    for (const record of this.all()) {
      const eligible =
        record.state === "PREPARED" ||
        (opts.includeUnknown === true && record.state === "OUTCOME_UNKNOWN");
      if (!eligible) continue;
      const proven = resolve?.(record) ?? null;
      if (proven === null && record.state !== "PREPARED") continue;
      recovered.push(
        this.transition(record.eventId, proven?.state ?? "OUTCOME_UNKNOWN", {
          finalizedAt: proven?.finalizedAt ?? nowSec,
          ...(proven?.evidenceRef !== undefined
            ? { evidenceRef: proven.evidenceRef }
            : {}),
        })
      );
    }
    return recovered;
  }

  private all(): ProcessingEventRecord[] {
    const { root, names } = privacyEventFiles(this.dir);
    return names
      .map((name) => openRecord(join(root, name), this.dek))
      .map(cloneEvent);
  }
}

/** Durable event file names for one privacy-event store, sorted. */
function privacyEventFiles(dir: string): {
  readonly root: string;
  readonly names: readonly string[];
} {
  const root = join(dir, "privacy-events");
  if (!existsSync(root)) return { root, names: [] };
  return {
    root,
    names: readdirSync(root)
      .filter((name) => name.endsWith(".json"))
      .sort(),
  };
}

/** Verify every durable event by decrypting/validating it. */
export function verifyPrivacyEvents(dir: string, dek: Uint8Array): number {
  const { root, names } = privacyEventFiles(dir);
  let count = 0;
  for (const name of names) {
    openRecord(join(root, name), dek);
    count += 1;
  }
  return count;
}

/**
 * Crash-safe event DEK rotation helper. Callers stage the new DEK in the
 * keystore before invoking; each file selects its opening key by envelope
 * kid, so rerunning after a partial rotation safely resumes.
 */
export function rotatePrivacyEventsDek(
  dir: string,
  opts: {
    readonly keys: Record<string, Uint8Array>;
    readonly newDek: Uint8Array;
  }
): number {
  const { root, names } = privacyEventFiles(dir);
  let count = 0;
  for (const name of names) {
    const path = join(root, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`privacy event store corrupt: ${path}`);
    }
    const kid = readSealedEnvelopeKid(parsed, eventOptions(), path);
    const opening = resolveSealedDek(opts.keys, {
      alias: "",
      kidHex: kid,
      bytes: 32,
      kidBytes: 8,
      errorPrefix: "privacy event",
      missingHint: "",
    });
    const record = openRecord(path, opening);
    atomicWrite(path, sealRecord(record, opts.newDek));
    count += 1;
  }
  return count;
}
