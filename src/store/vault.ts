import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KeyObject } from "node:crypto";
import { Authority } from "../core/authority.js";
import type { VerifiedIdentity } from "../core/authority.js";
import { assembleCapsule } from "../core/persona.js";
import { Disclose } from "../core/disclose.js";
import type { Presentation } from "../core/disclose.js";
import { atomicWrite, checkStoreFreshness, FileAuditLog } from "./files.js";

/**
 * Durable Personal State vault (P0 slice 1).
 *
 * User-owned attribute store with purpose/agent scoping. Authority first,
 * filtering second: every read validates `Authority.evaluate` for
 * `/disclose` before touching records, then enforces owner/purpose/agent/
 * expiry/sensitivity locally. Secrets never leave via `readForPurpose` —
 * `useCredential` is the sole in-host path for `secret` records.
 *
 * Storage mirrors `store/files.ts` optimistic CAS: `personal-state.json`
 * carries a `revision` bumped atomically with the data. A pristine instance
 * (never loaded, never saved) may only create a missing file; stale writers
 * fail closed ("changed under us").
 *
 * Audit is ids/names/revisions only — values never enter audit events,
 * receipts, or logs (ADR-0006). The output types have no value-capable
 * fields beyond the holder-signed disclosures, which exclude `secret`.
 */

export type VaultSensitivity = "general" | "sensitive" | "secret";

export interface VaultRecord {
  readonly id: string;
  /** Principal that owns the record. Must equal the ingress principal on read. */
  readonly owner: string;
  /** Claim key (e.g. "email", "pan"). Disclosed as the claim name. */
  readonly type: string;
  /** Claim value. Never enters audit/receipt/log. */
  readonly value: unknown;
  readonly sensitivity: VaultSensitivity;
  readonly source: string;
  readonly allowedPurposes: readonly string[];
  /** Exact agent ids (no wildcards). */
  readonly allowedAgents: readonly string[];
  /** Null = no expiry; otherwise non-negative epoch int. */
  readonly expiresAt: number | null;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface VaultRecordInput {
  readonly id: string;
  readonly owner: string;
  readonly type: string;
  readonly value: unknown;
  readonly sensitivity: VaultSensitivity;
  readonly source: string;
  readonly allowedPurposes: readonly string[];
  readonly allowedAgents: readonly string[];
  readonly expiresAt?: number | null;
}

export interface VaultSnapshot {
  readonly records: readonly VaultRecord[];
  readonly revision: number;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function checkStringArray(
  v: unknown,
  what: string
): asserts v is readonly string[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw new Error(`vault: ${what} must be a non-empty string array`);
  }
  for (const x of v) {
    if (!isNonEmptyString(x)) {
      throw new Error(`vault: ${what} must be non-empty strings`);
    }
  }
}

function checkExpiresAt(v: unknown): asserts v is number | null {
  if (v === null || v === undefined) return;
  if (!Number.isInteger(v) || (v as number) < 0) {
    throw new Error(
      "vault: expiresAt must be null or a non-negative epoch int"
    );
  }
}

function checkInput(input: VaultRecordInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("vault: record must be an object");
  }
  if (!isNonEmptyString(input.id)) throw new Error("vault: id required");
  if (!isNonEmptyString(input.owner)) throw new Error("vault: owner required");
  if (!isNonEmptyString(input.type)) throw new Error("vault: type required");
  if (
    input.sensitivity !== "general" &&
    input.sensitivity !== "sensitive" &&
    input.sensitivity !== "secret"
  ) {
    throw new Error("vault: sensitivity must be general|sensitive|secret");
  }
  if (!isNonEmptyString(input.source))
    throw new Error("vault: source required");
  checkStringArray(input.allowedPurposes, "allowedPurposes");
  checkStringArray(input.allowedAgents, "allowedAgents");
  checkExpiresAt(input.expiresAt ?? null);
  if (input.value === undefined) throw new Error("vault: value required");
}

function isExpired(rec: VaultRecord, nowSec: number): boolean {
  return rec.expiresAt !== null && nowSec > rec.expiresAt;
}

function auditSafe(detail: string): string {
  return detail;
}

export class VaultStore {
  private readonly records = new Map<string, VaultRecord>();
  private readonly nowSec: () => number;
  private snapshotRevision = 0;
  private knownLineage = false;

  constructor(nowSec: () => number = () => Math.floor(Date.now() / 1000)) {
    this.nowSec = nowSec;
  }

  /** Insert or version-bump a record. Owner is immutable across versions. */
  putRecord(input: VaultRecordInput, at?: number): VaultRecord {
    checkInput(input);
    const now = at ?? this.nowSec();
    if (!Number.isInteger(now) || now < 0) {
      throw new Error("vault: at must be a non-negative epoch int");
    }
    const prev = this.records.get(input.id);
    if (prev !== undefined && prev.owner !== input.owner) {
      throw new Error("vault: owner is immutable (use a new id)");
    }
    const rec: VaultRecord = {
      id: input.id,
      owner: input.owner,
      type: input.type,
      value: input.value,
      sensitivity: input.sensitivity,
      source: input.source,
      allowedPurposes: [...input.allowedPurposes],
      allowedAgents: [...input.allowedAgents],
      expiresAt: input.expiresAt ?? null,
      version: prev === undefined ? 1 : prev.version + 1,
      createdAt: prev === undefined ? now : prev.createdAt,
      updatedAt: now,
    };
    this.records.set(rec.id, rec);
    return {
      ...rec,
      allowedPurposes: [...rec.allowedPurposes],
      allowedAgents: [...rec.allowedAgents],
    };
  }

  getRecord(id: string): VaultRecord | null {
    const r = this.records.get(id);
    if (r === undefined) return null;
    return {
      ...r,
      allowedPurposes: [...r.allowedPurposes],
      allowedAgents: [...r.allowedAgents],
    };
  }

  listRecords(): VaultRecord[] {
    return [...this.records.values()].map((r) => ({
      ...r,
      allowedPurposes: [...r.allowedPurposes],
      allowedAgents: [...r.allowedAgents],
    }));
  }

  snapshot(): VaultSnapshot {
    return { records: this.listRecords(), revision: this.snapshotRevision };
  }

  loadedRevision(): number {
    return this.snapshotRevision;
  }

  adoptRevision(rev: number): void {
    if (!Number.isInteger(rev) || rev < 0)
      throw new Error("vault: bad revision");
    this.snapshotRevision = rev;
    this.knownLineage = true;
  }

  hasKnownLineage(): boolean {
    return this.knownLineage;
  }

  static restore(
    data: unknown,
    opts: { readonly nowSec?: () => number } = {}
  ): VaultStore {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("vault snapshot must be an object");
    }
    const rec = data as Record<string, unknown>;
    if (!Array.isArray(rec["records"]))
      throw new Error("vault snapshot: records must be an array");
    const vault = new VaultStore(opts.nowSec);
    vault.knownLineage = true;
    const rev: unknown = rec["revision"];
    if (rev !== undefined) {
      if (!Number.isInteger(rev) || (rev as number) < 0)
        throw new Error("vault snapshot: bad revision");
      vault.adoptRevision(rev as number);
    }
    for (const entry of rec["records"] as unknown[]) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error("vault snapshot: bad record");
      }
      const r = entry as Record<string, unknown>;
      const input: VaultRecordInput = {
        id: r["id"] as string,
        owner: r["owner"] as string,
        type: r["type"] as string,
        value: r["value"],
        sensitivity: r["sensitivity"] as VaultSensitivity,
        source: r["source"] as string,
        allowedPurposes: r["allowedPurposes"] as readonly string[],
        allowedAgents: r["allowedAgents"] as readonly string[],
        ...(r["expiresAt"] === null || typeof r["expiresAt"] === "number"
          ? { expiresAt: r["expiresAt"] as number | null }
          : {}),
      };
      checkInput(input);
      const version: unknown = r["version"];
      const createdAt: unknown = r["createdAt"];
      const updatedAt: unknown = r["updatedAt"];
      if (!Number.isInteger(version) || (version as number) < 1)
        throw new Error("vault snapshot: bad version");
      if (!Number.isInteger(createdAt) || !Number.isInteger(updatedAt)) {
        throw new Error("vault snapshot: bad timestamps");
      }
      vault.records.set(input.id, {
        ...input,
        allowedPurposes: [...input.allowedPurposes],
        allowedAgents: [...input.allowedAgents],
        expiresAt: input.expiresAt ?? null,
        version: version as number,
        createdAt: createdAt as number,
        updatedAt: updatedAt as number,
      });
    }
    return vault;
  }
}

function parseVaultFile(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`vault store missing: ${path}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`vault store corrupt: ${path}`);
  }
}

function withNextVaultRevision(
  dir: string,
  vault: VaultStore
): { readonly records: readonly VaultRecord[]; readonly revision: number } {
  const path = join(dir, "personal-state.json");
  if (!existsSync(path)) {
    if (vault.loadedRevision() !== 0 || vault.hasKnownLineage()) {
      throw new Error(
        `vault store missing: ${path} (instance at revision ${vault.loadedRevision()} — the store was deleted under us; refusing to resurrect stale state — re-init deliberately)`
      );
    }
    const stamped = { ...vault.snapshot(), revision: 0 };
    vault.adoptRevision(0);
    return stamped;
  }
  const parsed = parseVaultFile(path) as Record<string, unknown>;
  const current: unknown = parsed["revision"];
  const currentRev =
    current === undefined
      ? 0
      : typeof current === "number" && Number.isInteger(current) && current >= 0
        ? current
        : (() => {
            throw new Error(`vault store corrupt: ${path} (bad revision)`);
          })();
  if (currentRev !== vault.loadedRevision()) {
    throw new Error(
      `vault store changed under us (file revision ${currentRev}, loaded ${vault.loadedRevision()}) — reload and retry, never overwrite`
    );
  }
  if (currentRev === 0 && !vault.hasKnownLineage()) {
    throw new Error(
      `vault store exists at ${path} but this instance never loaded it — refusing a fresh overwrite (load first, or init a new dir)`
    );
  }
  const stamped = { ...vault.snapshot(), revision: currentRev + 1 };
  vault.adoptRevision(currentRev + 1);
  return stamped;
}

export function saveVault(dir: string, vault: VaultStore): void {
  atomicWrite(
    join(dir, "personal-state.json"),
    JSON.stringify(withNextVaultRevision(dir, vault))
  );
}

export function loadVault(
  dir: string,
  opts: { readonly nowSec?: () => number } = {}
): VaultStore {
  const vault = VaultStore.restore(
    parseVaultFile(join(dir, "personal-state.json")),
    opts
  );
  checkStoreFreshness(dir, "vault", vault.loadedRevision());
  return vault;
}

/**
 * Durable put: mutate + audit (ids only) + persist via CAS.
 * Audit detail carries id/type/revision — never the value.
 */
export function putRecord(
  dir: string,
  vault: VaultStore,
  input: VaultRecordInput,
  opts: { readonly at?: number; readonly audit?: FileAuditLog } = {}
): VaultRecord {
  const rec = vault.putRecord(input, opts.at);
  if (opts.audit !== undefined) {
    opts.audit.append({
      actor: rec.owner,
      action: "vault.put",
      detail: auditSafe(
        `id=${rec.id} type=${rec.type} sensitivity=${rec.sensitivity} rev=${vault.loadedRevision()}`
      ),
      vaultRev: vault.loadedRevision(),
    });
  }
  saveVault(dir, vault);
  if (opts.audit !== undefined) {
    opts.audit.append({
      actor: rec.owner,
      action: "vault.put.persisted",
      detail: auditSafe(`id=${rec.id} rev=${vault.loadedRevision()}`),
      vaultRev: vault.loadedRevision(),
    });
  }
  return rec;
}

export interface VaultReadRequest {
  readonly ingress: VerifiedIdentity;
  readonly purpose: string;
  readonly requested: readonly string[];
  readonly verifier: string;
  readonly nonce: string;
  readonly nowSec: number;
  readonly authority: Authority;
  /** Host-held holder signing key. holder.id must equal the ingress principal. */
  readonly holder: { readonly id: string; readonly privateKey: KeyObject };
  readonly audit?: FileAuditLog;
}

/**
 * Purpose-scoped read. FIRST evaluates Authority for `/disclose` (fail-closed
 * when no covering grant/approval), then filters owner/purpose/agent/expiry
 * and drops `secret` records entirely. Surviving `requested ∩ allowed` claims
 * are assembled via `assembleCapsule` and presented holder-signed via
 * `Disclose.present` (bearer forbidden: empty/short sigs throw).
 */
export function readForPurpose(
  vault: VaultStore,
  req: VaultReadRequest
): Presentation {
  if (!isNonEmptyString(req.purpose))
    throw new Error("vault: purpose required");
  if (!Array.isArray(req.requested) || req.requested.length === 0) {
    throw new Error("vault: requested must be non-empty");
  }
  for (const c of req.requested) {
    if (!isNonEmptyString(c))
      throw new Error("vault: requested must be non-empty strings");
  }
  if (!isNonEmptyString(req.verifier))
    throw new Error("vault: verifier required");
  if (!isNonEmptyString(req.nonce)) throw new Error("vault: nonce required");
  if (req.holder.id !== req.ingress.principal) {
    throw new Error("vault: holder must equal the ingress principal");
  }
  const operation = {
    action: { name: "/disclose" as const },
    resource: { type: "vault", id: "personal-state" },
    context: { claims: [...req.requested], verifier: req.verifier },
    purpose: req.purpose,
  };
  const decision = req.authority.evaluate(operation, req.ingress, {
    nowSec: req.nowSec,
  });
  if (!decision.allow) {
    throw new Error(`vault: authority denied: ${decision.reason}`);
  }
  const allowed = new Set<string>();
  const attributes: Record<string, unknown> = {};
  for (const rec of vault.listRecords()) {
    if (rec.owner !== req.ingress.principal) continue;
    if (isExpired(rec, req.nowSec)) continue;
    if (!rec.allowedPurposes.includes(req.purpose)) continue;
    if (!rec.allowedAgents.includes(req.ingress.id)) continue;
    if (rec.sensitivity === "secret") continue;
    if (!(req.requested as readonly string[]).includes(rec.type)) continue;
    if (allowed.has(rec.type)) continue;
    allowed.add(rec.type);
    attributes[rec.type] = rec.value;
  }
  if (allowed.size === 0) {
    throw new Error("vault: no records satisfy purpose/agent/expiry policy");
  }
  const names = [...allowed].sort();
  const capsule = assembleCapsule({ attributes }, req.purpose, names);
  const pres = Disclose.present(
    {
      issuer: "vault:personal-state",
      subject: req.ingress.principal,
      claims: { ...capsule.claims },
      cnf: req.holder.id,
    },
    { verifier: req.verifier, nonce: req.nonce, requested: names },
    { recipient: req.verifier, allowed: names },
    { id: req.holder.id, privateKey: req.holder.privateKey },
    req.nowSec
  );
  if (pres.sig.length !== 64)
    throw new Error("vault: bearer presentation forbidden");
  if (req.audit !== undefined) {
    req.audit.append({
      actor: req.ingress.id,
      action: "vault.read",
      detail: auditSafe(
        `purpose=${req.purpose} verifier=${req.verifier} claims=${names.join(",")} rev=${vault.loadedRevision()}`
      ),
      vaultRev: vault.loadedRevision(),
    });
  }
  return pres;
}

export interface SecretInstruction {
  readonly recordId: string;
  readonly type: string;
  readonly purpose: string;
  readonly owner: string;
  /** Secret value, visible to the in-host callback only — never returned. */
  readonly value: unknown;
}

export interface SecretUseResult {
  readonly receipt: string;
  readonly names?: readonly string[];
}

/**
 * Sole in-host path for `secret` records. Validates Authority for `/use`,
 * loads the value in-host, invokes the callback with the sanitized
 * instruction, and returns only the callback's receipt/names — the value
 * never reaches the caller, receipts, logs, or audit.
 */
export async function useCredential(
  vault: VaultStore,
  opts: {
    readonly ingress: VerifiedIdentity;
    readonly recordId: string;
    readonly purpose: string;
    readonly authority: Authority;
    readonly nowSec: number;
    readonly use: (instr: SecretInstruction) => Promise<SecretUseResult>;
    readonly audit?: FileAuditLog;
  }
): Promise<{
  readonly recordId: string;
  readonly type: string;
  readonly purpose: string;
  readonly receipt: string;
  readonly names?: readonly string[];
}> {
  if (!isNonEmptyString(opts.recordId))
    throw new Error("vault: recordId required");
  if (!isNonEmptyString(opts.purpose))
    throw new Error("vault: purpose required");
  const rec = vault.getRecord(opts.recordId);
  if (rec === null) throw new Error("vault: unknown record");
  if (rec.owner !== opts.ingress.principal)
    throw new Error("vault: owner mismatch");
  if (isExpired(rec, opts.nowSec)) throw new Error("vault: record expired");
  if (!rec.allowedPurposes.includes(opts.purpose))
    throw new Error("vault: purpose denied");
  if (!rec.allowedAgents.includes(opts.ingress.id))
    throw new Error("vault: agent denied");
  const operation = {
    action: { name: "/use" as const },
    resource: { type: "vault-record", id: rec.id },
    context: { claim: rec.type },
    purpose: opts.purpose,
  };
  const decision = opts.authority.evaluate(operation, opts.ingress, {
    nowSec: opts.nowSec,
  });
  if (!decision.allow) {
    throw new Error(`vault: authority denied: ${decision.reason}`);
  }
  const instr: SecretInstruction = {
    recordId: rec.id,
    type: rec.type,
    purpose: opts.purpose,
    owner: rec.owner,
    value: rec.value,
  };
  const result = await opts.use(instr);
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("vault: use must resolve a receipt object");
  }
  if (!isNonEmptyString((result as SecretUseResult).receipt)) {
    throw new Error("vault: use must resolve { receipt }");
  }
  const receipt = (result as SecretUseResult).receipt;
  // Fail-closed leak guard for string secrets: the receipt must not echo the value.
  if (
    typeof rec.value === "string" &&
    rec.value.length > 0 &&
    receipt.includes(rec.value)
  ) {
    throw new Error("vault: callback leaked secret into receipt");
  }
  if (opts.audit !== undefined) {
    opts.audit.append({
      actor: opts.ingress.id,
      action: "vault.use",
      detail: auditSafe(
        `id=${rec.id} type=${rec.type} purpose=${opts.purpose} rev=${vault.loadedRevision()}`
      ),
      vaultRev: vault.loadedRevision(),
    });
  }
  const names = (result as SecretUseResult).names;
  return {
    recordId: rec.id,
    type: rec.type,
    purpose: opts.purpose,
    receipt,
    ...(names !== undefined ? { names: [...names] } : {}),
  };
}
