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
import { join } from "node:path";
import { canonicalize, sha256Hex } from "../core/canonical.js";
import type {
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
  sealSnapshotEnvelope,
  sealedDekFingerprint,
} from "./sealed-snapshot.js";

const EVENT_VERSION = 1;
const EVENT_AAD = "ptf-privacy-event/v1";

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
  return openSnapshotEnvelope(
    parsed,
    dek,
    eventOptions(),
    path,
    (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        typeof (value as Record<string, unknown>)["eventId"] !== "string" ||
        typeof (value as Record<string, unknown>)["idempotencyKey"] !== "string" ||
        typeof (value as Record<string, unknown>)["state"] !== "string"
      ) {
        throw new Error("privacy event: bad payload");
      }
      return value as ProcessingEventRecord;
    }
  );
}

function sealRecord(record: ProcessingEventRecord, dek: Uint8Array): string {
  return JSON.stringify(sealSnapshotEnvelope(record, dek, eventOptions()));
}

function isSameFinalize(
  current: ProcessingEventRecord,
  patch: ProcessingEventFinalize
): boolean {
  return (
    current.finalizedAt === patch.finalizedAt &&
    current.evidenceRef === patch.evidenceRef
  );
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
    if (input.attemptRef !== undefined &&
        !/^[A-Za-z0-9_.:-]{1,200}$/.test(input.attemptRef)) {
      throw new Error("privacy event: invalid attempt reference");
    }
    const key = stableKey(input);
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
      throw new Error("privacy event store full — archive safely before creating another record");
    }
    const record: ProcessingEventRecord = {
      ...input,
      resource: { ...input.resource },
      dataCategories: [...input.dataCategories],
      recipients: input.recipients.map((r) => ({ ...r })),
      authorityCitationIds: [...input.authorityCitationIds],
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
        return cloneEvent(openRecord(path, this.dek));
      }
      throw error;
    }
    return cloneEvent(record);
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
      if (current.state === to && isSameFinalize(current, patch)) {
        return cloneEvent(current);
      }
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
      throw new Error("privacy event: finalizedAt must be a non-negative epoch int");
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
    for (const record of this.all()) {
      if (record.idempotencyKey === idempotencyKey) return record;
    }
    return null;
  }

  listBySubject(dataPrincipalRef: string): readonly ProcessingEventRecord[] {
    return this.all().filter((record) => record.dataPrincipalRef === dataPrincipalRef);
  }

  recoverPrepared(nowSec: number = this.nowSec()): readonly ProcessingEventRecord[] {
    const recovered: ProcessingEventRecord[] = [];
    for (const record of this.all()) {
      if (record.state !== "PREPARED") continue;
      recovered.push(
        this.transition(record.eventId, "OUTCOME_UNKNOWN", {
          finalizedAt: nowSec,
        })
      );
    }
    return recovered;
  }

  private all(): ProcessingEventRecord[] {
    const root = join(this.dir, "privacy-events");
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => openRecord(join(root, name), this.dek))
      .map(cloneEvent);
  }
}


/** Verify every durable event by decrypting/validating it. */
export function verifyPrivacyEvents(
  dir: string,
  dek: Uint8Array
): number {
  const root = join(dir, "privacy-events");
  if (!existsSync(root)) return 0;
  let count = 0;
  for (const name of readdirSync(root).filter((n) => n.endsWith(".json"))) {
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
  const root = join(dir, "privacy-events");
  if (!existsSync(root)) return 0;
  let count = 0;
  for (const name of readdirSync(root).filter((n) => n.endsWith(".json")).sort()) {
    const path = join(root, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`privacy event store corrupt: ${path}`);
    }
    const kid = readSealedEnvelopeKid(parsed, eventOptions(), path);
    const opening = Object.values(opts.keys).find(
      (candidate) =>
        candidate instanceof Uint8Array &&
        candidate.length === 32 &&
        sealedDekFingerprint(candidate, {
          kidBytes: 8,
          errorPrefix: "privacy event",
        }) === kid
    );
    if (opening === undefined) {
      throw new Error(`privacy event: no DEK matches envelope kid ${kid}`);
    }
    const record = openRecord(path, opening);
    atomicWrite(path, sealRecord(record, opts.newDek));
    count += 1;
  }
  return count;
}
