import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
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
import {
  openSnapshotEnvelope,
  sealSnapshotEnvelope,
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

  constructor(opts: {
    readonly dir: string;
    readonly dek: Uint8Array;
    readonly nowSec?: () => number;
  }) {
    this.dir = opts.dir;
    this.dek = opts.dek;
    this.nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
  }

  prepare(input: ProcessingEventPrepare): ProcessingEventRecord {
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
      writeFileSync(path, sealRecord(record, this.dek), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
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
      throw new Error("privacy event: terminal transition forbidden");
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
