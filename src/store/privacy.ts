import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type {
  ConsentEvidence,
  NoticeEvidence,
  PrivacySnapshot,
  ProcessingActivity,
  ProcessingBasisEvidence,
  RetentionHold,
} from "../privacy/model.js";
import { assertOpaquePrivacySubjectRef } from "../privacy/model.js";
import { atomicWrite, checkFreshness } from "./files.js";
import {
  assertSealedDek,
  openSnapshotEnvelope,
  readSealedEnvelopeKid,
  sealSnapshotEnvelope,
  sealedDekFingerprint,
} from "./sealed-snapshot.js";

export const PRIVACY_DEK_ALIAS = "ptf/privacy-dek";
export const PRIVACY_DEK_NEXT_ALIAS = "ptf/privacy-dek-next";

const PRIVACY_FILE = "privacy-state.json";
const PRIVACY_ENVELOPE_VERSION = 1;
const PRIVACY_AAD = "ptf-privacy-state/v1";
const DEK_BYTES = 32;
const KID_BYTES = 8;

function required(value: unknown, what: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`privacy: ${what} required`);
  }
}

function strings(value: unknown, what: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`privacy: ${what} must be a non-empty string array`);
  }
  for (const item of value) required(item, what);
}

function stringArray(value: unknown, what: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`privacy: ${what} must be a string array`);
  }
  for (const item of value) required(item, what);
}

function booleanValue(value: unknown, what: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`privacy: ${what} must be a boolean`);
  }
}

function epoch(value: number | undefined, what: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`privacy: ${what} must be a non-negative epoch int`);
  }
}

function requiredEpoch(value: number | undefined, what: string): void {
  if (value === undefined) throw new Error(`privacy: ${what} required`);
  epoch(value, what);
}

function oneOf(value: unknown, allowed: readonly string[], what: string): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`privacy: ${what} must be one of: ${allowed.join(", ")}`);
  }
}

function cloneNotice(v: NoticeEvidence): NoticeEvidence {
  return { ...v, dataCategories: [...v.dataCategories] };
}
function cloneConsent(v: ConsentEvidence): ConsentEvidence {
  return { ...v, dataCategories: [...v.dataCategories] };
}
function cloneBasis(v: ProcessingBasisEvidence): ProcessingBasisEvidence {
  return { ...v, dataCategories: [...v.dataCategories] };
}
function cloneActivity(v: ProcessingActivity): ProcessingActivity {
  return {
    ...v,
    subjects:
      v.subjects.kind === "set"
        ? { kind: "set", refs: [...v.subjects.refs] }
        : { ...v.subjects },
    dataCategories: [...v.dataCategories],
    recipients: v.recipients.map((r) => ({ ...r })),
    ...(v.allowedTransferDestinations !== undefined
      ? { allowedTransferDestinations: [...v.allowedTransferDestinations] }
      : {}),
  };
}
function cloneHold(v: RetentionHold): RetentionHold {
  return {
    ...v,
    recordIds: [...v.recordIds],
    dataCategories: [...v.dataCategories],
  };
}

function validateNotice(v: NoticeEvidence): void {
  required(v.id, "notice id");
  required(v.controllerId, "notice controllerId");
  assertOpaquePrivacySubjectRef(v.dataPrincipalRef);
  required(v.purpose, "notice purpose");
  strings(v.dataCategories, "notice dataCategories");
  required(v.noticeRef, "notice noticeRef");
  required(v.noticeHash, "notice noticeHash");
  required(v.assertedBy, "notice assertedBy");
  requiredEpoch(v.presentedAt, "notice presentedAt");
  if (v.language !== undefined) required(v.language, "notice language");
  if (v.version !== undefined) required(v.version, "notice version");
}
function validateConsent(v: ConsentEvidence): void {
  required(v.id, "consent id");
  required(v.noticeId, "consent noticeId");
  required(v.controllerId, "consent controllerId");
  assertOpaquePrivacySubjectRef(v.dataPrincipalRef);
  required(v.purpose, "consent purpose");
  strings(v.dataCategories, "consent dataCategories");
  required(v.method, "consent method");
  required(v.proofRef, "consent proofRef");
  required(v.assertedBy, "consent assertedBy");
  requiredEpoch(v.givenAt, "consent givenAt");
  epoch(v.withdrawnAt, "consent withdrawnAt");
  if (v.withdrawnAt !== undefined) {
    required(v.withdrawalProofRef, "consent withdrawalProofRef");
    required(v.withdrawnBy, "consent withdrawnBy");
  } else if (
    v.withdrawalProofRef !== undefined ||
    v.withdrawnBy !== undefined
  ) {
    throw new Error("privacy: consent withdrawal fields require withdrawnAt");
  }
}
function validateBasis(v: ProcessingBasisEvidence): void {
  required(v.id, "basis id");
  required(v.controllerId, "basis controllerId");
  required(v.purpose, "basis purpose");
  strings(v.dataCategories, "basis dataCategories");
  required(v.assertedBy, "basis assertedBy");
  booleanValue(v.active, "basis active");
  oneOf(v.kind, ["consent", "certain-legitimate-use"], "basis kind");
  epoch(v.nbf, "basis nbf");
  epoch(v.exp, "basis exp");
  if (v.kind === "consent") {
    assertOpaquePrivacySubjectRef(v.dataPrincipalRef);
    required(v.consentId, "basis consentId");
  } else {
    if ("dataPrincipalRef" in v && v.dataPrincipalRef !== undefined) {
      throw new Error(
        "privacy: legitimate-use basis must not carry dataPrincipalRef"
      );
    }
    required(v.provisionRef, "basis provisionRef");
    required(v.evidenceRef, "basis evidenceRef");
  }
}
function validateActivity(v: ProcessingActivity): void {
  required(v.id, "activity id");
  required(v.profileId, "activity profileId");
  required(v.authorityPrincipal, "activity authorityPrincipal");
  required(v.controllerId, "activity controllerId");
  required(v.action, "activity action");
  if (!v.action.startsWith("/"))
    throw new Error("privacy: activity action must start with /");
  required(v.resourceType, "activity resourceType");
  required(v.purpose, "activity purpose");
  strings(v.dataCategories, "activity dataCategories");
  required(v.basisId, "activity basisId");
  booleanValue(v.active, "activity active");
  epoch(v.nbf, "activity nbf");
  epoch(v.exp, "activity exp");
  if (typeof v.subjects !== "object" || v.subjects === null) {
    throw new Error("privacy: activity subjects required");
  }
  if (v.subjects.kind === "exact")
    assertOpaquePrivacySubjectRef(v.subjects.ref);
  else if (v.subjects.kind === "set") {
    strings(v.subjects.refs, "activity subject refs");
    for (const ref of v.subjects.refs) assertOpaquePrivacySubjectRef(ref);
  } else if (v.subjects.kind !== "any") {
    throw new Error(
      "privacy: activity subjects.kind must be exact, set, or any"
    );
  }
  if (!Array.isArray(v.recipients)) {
    throw new Error("privacy: activity recipients must be an array");
  }
  for (const r of v.recipients) {
    required(r.id, "activity recipient id");
    oneOf(
      r.role,
      ["data-processor", "data-fiduciary", "third-party", "other"],
      "activity recipient role"
    );
  }
  if (v.allowedTransferDestinations !== undefined) {
    stringArray(
      v.allowedTransferDestinations,
      "activity allowedTransferDestinations"
    );
  }
}
function validateHold(v: RetentionHold): void {
  required(v.id, "hold id");
  assertOpaquePrivacySubjectRef(v.dataPrincipalRef);
  if (!Array.isArray(v.recordIds)) {
    throw new Error("privacy: hold recordIds must be an array");
  }
  if (!Array.isArray(v.dataCategories)) {
    throw new Error("privacy: hold dataCategories must be an array");
  }
  if (v.recordIds.length === 0 && v.dataCategories.length === 0) {
    throw new Error("privacy: hold requires recordIds or dataCategories");
  }
  stringArray(v.recordIds, "hold record id");
  stringArray(v.dataCategories, "hold data category");
  required(v.reasonRef, "hold reasonRef");
  required(v.assertedBy, "hold assertedBy");
  requiredEpoch(v.effectiveAt, "hold effectiveAt");
  if (v.retainUntil !== null)
    requiredEpoch(v.retainUntil ?? undefined, "hold retainUntil");
  epoch(v.releasedAt, "hold releasedAt");
  if (v.releasedAt !== undefined) required(v.releasedBy, "hold releasedBy");
  else if (v.releasedBy !== undefined) {
    throw new Error("privacy: hold releasedBy requires releasedAt");
  }
}

export class PrivacyStore {
  private readonly notices = new Map<string, NoticeEvidence>();
  private readonly consents = new Map<string, ConsentEvidence>();
  private readonly bases = new Map<string, ProcessingBasisEvidence>();
  private readonly activities = new Map<string, ProcessingActivity>();
  private readonly holds = new Map<string, RetentionHold>();
  private snapshotRevision = 0;
  private knownLineage = false;
  private readonly nowSec: () => number;

  constructor(nowSec: () => number = () => Math.floor(Date.now() / 1000)) {
    this.nowSec = nowSec;
  }

  private assertUnused(id: string): void {
    if (
      this.notices.has(id) ||
      this.consents.has(id) ||
      this.bases.has(id) ||
      this.activities.has(id) ||
      this.holds.has(id)
    ) {
      throw new Error(`privacy: id already exists: ${id}`);
    }
  }

  addNotice(input: NoticeEvidence): NoticeEvidence {
    validateNotice(input);
    this.assertUnused(input.id);
    const value = cloneNotice(input);
    this.notices.set(value.id, value);
    return cloneNotice(value);
  }

  addConsent(input: ConsentEvidence): ConsentEvidence {
    validateConsent(input);
    this.assertUnused(input.id);
    const value = cloneConsent(input);
    this.consents.set(value.id, value);
    return cloneConsent(value);
  }

  addBasis(input: ProcessingBasisEvidence): ProcessingBasisEvidence {
    validateBasis(input);
    this.assertUnused(input.id);
    const value = cloneBasis(input);
    this.bases.set(value.id, value);
    return cloneBasis(value);
  }

  addActivity(input: ProcessingActivity): ProcessingActivity {
    validateActivity(input);
    this.assertUnused(input.id);
    const value = cloneActivity(input);
    this.activities.set(value.id, value);
    return cloneActivity(value);
  }

  addHold(input: RetentionHold): RetentionHold {
    validateHold(input);
    this.assertUnused(input.id);
    const value = cloneHold(input);
    this.holds.set(value.id, value);
    return cloneHold(value);
  }

  withdrawConsent(
    consentId: string,
    input: {
      readonly at: number;
      readonly proofRef: string;
      readonly assertedBy: string;
    }
  ): ConsentEvidence {
    required(consentId, "consent id");
    epoch(input.at, "withdrawal at");
    required(input.proofRef, "withdrawal proofRef");
    required(input.assertedBy, "withdrawal assertedBy");
    const existing = this.consents.get(consentId);
    if (existing === undefined) throw new Error("privacy: unknown consent");
    if (existing.withdrawnAt !== undefined)
      throw new Error("privacy: consent already withdrawn");
    const value: ConsentEvidence = {
      ...existing,
      dataCategories: [...existing.dataCategories],
      withdrawnAt: input.at,
      withdrawalProofRef: input.proofRef,
      withdrawnBy: input.assertedBy,
    };
    this.consents.set(consentId, value);
    return cloneConsent(value);
  }

  releaseHold(
    id: string,
    input: { readonly at: number; readonly assertedBy: string }
  ): RetentionHold {
    required(id, "hold id");
    epoch(input.at, "hold releasedAt");
    required(input.assertedBy, "hold releasedBy");
    const existing = this.holds.get(id);
    if (existing === undefined) throw new Error("privacy: unknown hold");
    if (existing.releasedAt !== undefined)
      throw new Error("privacy: hold already released");
    const value: RetentionHold = {
      ...existing,
      recordIds: [...existing.recordIds],
      dataCategories: [...existing.dataCategories],
      releasedAt: input.at,
      releasedBy: input.assertedBy,
    };
    this.holds.set(id, value);
    return cloneHold(value);
  }

  snapshot(): PrivacySnapshot {
    return {
      notices: [...this.notices.values()].map(cloneNotice),
      consents: [...this.consents.values()].map(cloneConsent),
      bases: [...this.bases.values()].map(cloneBasis),
      activities: [...this.activities.values()].map(cloneActivity),
      holds: [...this.holds.values()].map(cloneHold),
      revision: this.snapshotRevision,
    };
  }

  loadedRevision(): number {
    return this.snapshotRevision;
  }
  hasKnownLineage(): boolean {
    return this.knownLineage;
  }
  adoptRevision(rev: number): void {
    if (!Number.isInteger(rev) || rev < 0)
      throw new Error("privacy: bad revision");
    this.snapshotRevision = rev;
    this.knownLineage = true;
  }

  static restore(
    data: unknown,
    opts: { readonly nowSec?: () => number } = {}
  ): PrivacyStore {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("privacy snapshot must be an object");
    }
    const rec = data as Record<string, unknown>;
    for (const key of [
      "notices",
      "consents",
      "bases",
      "activities",
      "holds",
    ] as const) {
      if (!Array.isArray(rec[key]))
        throw new Error(`privacy snapshot: ${key} must be an array`);
    }
    const store = new PrivacyStore(opts.nowSec);
    store.knownLineage = true;
    const revision = rec["revision"];
    if (!Number.isInteger(revision) || (revision as number) < 0) {
      throw new Error("privacy snapshot: bad revision");
    }
    store.adoptRevision(revision as number);
    for (const item of rec["notices"] as NoticeEvidence[])
      store.addNotice(item);
    for (const item of rec["consents"] as ConsentEvidence[])
      store.addConsent(item);
    for (const item of rec["bases"] as ProcessingBasisEvidence[])
      store.addBasis(item);
    for (const item of rec["activities"] as ProcessingActivity[])
      store.addActivity(item);
    for (const item of rec["holds"] as RetentionHold[]) store.addHold(item);
    return store;
  }
}

export function createPrivacyDek(): Uint8Array {
  return new Uint8Array(randomBytes(DEK_BYTES));
}

export function ensurePrivacyDek(keys: Record<string, Uint8Array>): Uint8Array {
  const existing = keys[PRIVACY_DEK_ALIAS];
  if (existing !== undefined) {
    assertSealedDek(existing, "privacy");
    return existing;
  }
  const dek = createPrivacyDek();
  keys[PRIVACY_DEK_ALIAS] = dek;
  return dek;
}

export function privacyDekFingerprint(dek: Uint8Array): string {
  return sealedDekFingerprint(dek, {
    kidBytes: KID_BYTES,
    errorPrefix: "privacy",
  });
}

export function resolvePrivacyDek(
  keys: Record<string, Uint8Array>,
  kidHex?: string | null
): Uint8Array {
  if (kidHex !== undefined && kidHex !== null) {
    for (const candidate of Object.values(keys)) {
      if (
        candidate instanceof Uint8Array &&
        candidate.length === DEK_BYTES &&
        privacyDekFingerprint(candidate) === kidHex
      )
        return candidate;
    }
    throw new Error(`privacy: no DEK matches envelope kid ${kidHex}`);
  }
  const current = keys[PRIVACY_DEK_ALIAS];
  if (current instanceof Uint8Array && current.length === DEK_BYTES)
    return current;
  throw new Error(`privacy: no DEK under ${PRIVACY_DEK_ALIAS}`);
}

function parsePrivacyFile(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`privacy store missing: ${path}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`privacy store corrupt: ${path}`);
  }
}

export function readPrivacyKid(dir: string): string | null {
  const path = join(dir, PRIVACY_FILE);
  if (!existsSync(path)) return null;
  return readSealedEnvelopeKid(
    parsePrivacyFile(path),
    {
      version: PRIVACY_ENVELOPE_VERSION,
      aad: PRIVACY_AAD,
      kidBytes: KID_BYTES,
      errorPrefix: "privacy",
    },
    path
  );
}

function openPrivacySnapshot(
  parsed: unknown,
  dek: Uint8Array,
  path: string
): PrivacySnapshot {
  return openSnapshotEnvelope(
    parsed,
    dek,
    {
      version: PRIVACY_ENVELOPE_VERSION,
      aad: PRIVACY_AAD,
      kidBytes: KID_BYTES,
      errorPrefix: "privacy",
    },
    path,
    (value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("privacy: bad snapshot payload");
      }
      return value as PrivacySnapshot;
    }
  );
}

function withNextPrivacyRevision(
  dir: string,
  store: PrivacyStore,
  dek: Uint8Array,
  sealDek: Uint8Array = dek
) {
  assertSealedDek(dek, "privacy");
  assertSealedDek(sealDek, "privacy");
  const path = join(dir, PRIVACY_FILE);
  let stamped: PrivacySnapshot;
  if (!existsSync(path)) {
    if (store.loadedRevision() !== 0 || store.hasKnownLineage()) {
      throw new Error(
        `privacy store missing: ${path} (refusing stale resurrection)`
      );
    }
    stamped = { ...store.snapshot(), revision: 0 };
    store.adoptRevision(0);
  } else {
    const current = openPrivacySnapshot(parsePrivacyFile(path), dek, path);
    if (!Number.isInteger(current.revision) || current.revision < 0) {
      throw new Error(`privacy store corrupt: ${path} (bad revision)`);
    }
    if (current.revision !== store.loadedRevision()) {
      throw new Error(
        `privacy store changed under us (file revision ${current.revision}, loaded ${store.loadedRevision()}) — reload and retry, never overwrite`
      );
    }
    if (current.revision === 0 && !store.hasKnownLineage()) {
      throw new Error(
        `privacy store exists at ${path} but this instance never loaded it`
      );
    }
    stamped = { ...store.snapshot(), revision: current.revision + 1 };
    store.adoptRevision(current.revision + 1);
  }
  return sealSnapshotEnvelope(stamped, sealDek, {
    version: PRIVACY_ENVELOPE_VERSION,
    aad: PRIVACY_AAD,
    kidBytes: KID_BYTES,
    errorPrefix: "privacy",
  });
}

export function savePrivacyStore(
  dir: string,
  store: PrivacyStore,
  opts: { readonly dek: Uint8Array }
): void {
  atomicWrite(
    join(dir, PRIVACY_FILE),
    JSON.stringify(withNextPrivacyRevision(dir, store, opts.dek))
  );
}

export function loadPrivacyStore(
  dir: string,
  opts: {
    readonly dek?: Uint8Array;
    readonly keys?: Record<string, Uint8Array>;
    readonly nowSec?: () => number;
  }
): PrivacyStore {
  const path = join(dir, PRIVACY_FILE);
  const parsed = parsePrivacyFile(path);
  const kid =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)["kidHex"]
      : null;
  const dek =
    opts.keys !== undefined
      ? resolvePrivacyDek(opts.keys, typeof kid === "string" ? kid : null)
      : opts.dek;
  if (dek === undefined) throw new Error("privacy: DEK required");
  const store = PrivacyStore.restore(openPrivacySnapshot(parsed, dek, path), {
    ...(opts.nowSec !== undefined ? { nowSec: opts.nowSec } : {}),
  });
  checkFreshness(dir, "privacy", store.loadedRevision());
  return store;
}

export function rotatePrivacyDek(
  dir: string,
  store: PrivacyStore,
  opts: { readonly dek: Uint8Array; readonly newDek: Uint8Array }
): void {
  atomicWrite(
    join(dir, PRIVACY_FILE),
    JSON.stringify(withNextPrivacyRevision(dir, store, opts.dek, opts.newDek))
  );
}
