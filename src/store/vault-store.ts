import type { KeyObject } from "node:crypto";
import { Authority } from "../core/authority.js";
import type { VerifiedIdentity } from "../core/authority.js";
import { canonicalize } from "../core/canonical.js";
import { assembleCapsule } from "../core/persona.js";
import { Disclose } from "../core/disclose.js";
import type { Presentation } from "../core/disclose.js";
import { isNonEmptyString } from "../adapters/guards.js";
import { FileAuditLog } from "./files.js";

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
  /** Opaque privacy subject binding; required for privacy-mode erasure. */
  readonly dataPrincipalRef?: string;
  /**
   * Optional resource address (e.g. `{type:"credential", id:"credential:issuer-1"}`).
   * When set, the record is selected ONLY for reads whose operation
   * resource matches exactly — the resource then determines data selection,
   * not just authorization. Records without one match any resource
   * (back-compat for owner-scoped personal data).
   */
  readonly resource?: { readonly type: string; readonly id: string };
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
  readonly dataPrincipalRef?: string;
  readonly resource?: { readonly type: string; readonly id: string };
  readonly allowedPurposes: readonly string[];
  readonly allowedAgents: readonly string[];
  readonly expiresAt?: number | null;
}

export interface VaultRecordMetadata {
  readonly id: string;
  readonly owner: string;
  readonly type: string;
  readonly sensitivity: VaultSensitivity;
  readonly source: string;
  readonly dataPrincipalRef?: string;
  readonly resource?: { readonly type: string; readonly id: string };
  readonly allowedPurposes: readonly string[];
  readonly allowedAgents: readonly string[];
  readonly expiresAt: number | null;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface VaultErasureReceipt {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly erasedAt: number;
}

export interface VaultSnapshot {
  readonly records: readonly VaultRecord[];
  readonly revision: number;
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

/** Shared sensitivity validator (also used by the CLI so both reject alike). */
export function parseSensitivity(v: unknown): VaultSensitivity {
  if (v !== "general" && v !== "sensitive" && v !== "secret") {
    throw new Error("vault: sensitivity must be general|sensitive|secret");
  }
  return v;
}

function checkInput(input: VaultRecordInput): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("vault: record must be an object");
  }
  if (!isNonEmptyString(input.id)) throw new Error("vault: id required");
  if (!isNonEmptyString(input.owner)) throw new Error("vault: owner required");
  if (!isNonEmptyString(input.type)) throw new Error("vault: type required");
  parseSensitivity(input.sensitivity);
  if (!isNonEmptyString(input.source))
    throw new Error("vault: source required");
  if (
    input.dataPrincipalRef !== undefined &&
    (typeof input.dataPrincipalRef !== "string" ||
      !/^subject:[A-Za-z][A-Za-z0-9_-]{5,127}$/.test(input.dataPrincipalRef))
  ) {
    throw new Error(
      "vault: dataPrincipalRef must be an opaque subject reference"
    );
  }
  if (input.resource !== undefined) {
    if (
      typeof input.resource !== "object" ||
      input.resource === null ||
      Array.isArray(input.resource) ||
      !isNonEmptyString((input.resource as { type?: unknown }).type) ||
      !isNonEmptyString((input.resource as { id?: unknown }).id)
    ) {
      throw new Error("vault: resource must be { type, id } non-empty strings");
    }
  }
  checkStringArray(input.allowedPurposes, "allowedPurposes");
  checkStringArray(input.allowedAgents, "allowedAgents");
  checkExpiresAt(input.expiresAt ?? null);
  if (input.value === undefined) throw new Error("vault: value required");
}

function isExpired(rec: VaultRecord, nowSec: number): boolean {
  return rec.expiresAt !== null && nowSec > rec.expiresAt;
}

/** Canonical rendering for leak comparison; null when unrenderable. */
function tryCanonical(v: unknown): string | null {
  try {
    return canonicalize(v);
  } catch {
    return null;
  }
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
    if (
      prev?.dataPrincipalRef !== undefined &&
      prev.dataPrincipalRef !== input.dataPrincipalRef
    ) {
      throw new Error("vault: dataPrincipalRef is immutable (use a new id)");
    }
    const rec: VaultRecord = {
      id: input.id,
      owner: input.owner,
      type: input.type,
      value: input.value,
      sensitivity: input.sensitivity,
      source: input.source,
      ...(input.dataPrincipalRef !== undefined
        ? { dataPrincipalRef: input.dataPrincipalRef }
        : {}),
      ...(input.resource !== undefined
        ? {
            resource: {
              type: input.resource.type,
              id: input.resource.id,
            },
          }
        : {}),
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

  /**
   * Purpose-scoped disclosure (evaluate-first). The ONLY read path besides
   * {@link VaultStore.useSecret}: validates `Authority.evaluate(/disclose)`
   * before touching records, drops `secret` records entirely, and returns a
   * holder-signed presentation over `requested ∩ allowed` claim names.
   */
  disclose(req: VaultReadRequest): Presentation {
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
      resource: { type: req.resource.type, id: req.resource.id },
      context: { claims: [...req.requested], verifier: req.verifier },
      purpose: req.purpose,
    };
    // Actual disclosure consumes uses (ADR-0018): a one-time approval
    // covers exactly one presentation. Hosts MUST persist authority state
    // after success (same burn-before-deliver order as execution).
    const decision = req.authority.evaluate(operation, req.ingress, {
      consume: true,
      nowSec: req.nowSec,
    });
    if (!decision.allow) {
      throw new Error(`vault: authority denied: ${decision.reason}`);
    }
    // Same-type ambiguity fails closed: two live records answering one
    // claim (e.g. two emails) must never resolve by insertion order.
    // Update a record by re-putting its id (version bump), or remove the
    // stale one — the vault will not guess which identity value is yours.
    const byType = new Map<string, VaultRecord[]>();
    for (const rec of this.listRecords()) {
      if (rec.owner !== req.ingress.principal) continue;
      if (isExpired(rec, req.nowSec)) continue;
      if (!rec.allowedPurposes.includes(req.purpose)) continue;
      if (!rec.allowedAgents.includes(req.ingress.id)) continue;
      if (rec.sensitivity === "secret") continue;
      if (!(req.requested as readonly string[]).includes(rec.type)) continue;
      // Resource-addressable records are selected ONLY by their resource:
      // the requested resource determines data selection, not just
      // authorization. Unaddressed records match any resource (back-compat).
      if (
        rec.resource !== undefined &&
        (rec.resource.type !== req.resource.type ||
          rec.resource.id !== req.resource.id)
      ) {
        continue;
      }
      const group = byType.get(rec.type) ?? [];
      group.push(rec);
      byType.set(rec.type, group);
    }
    if (byType.size === 0) {
      throw new Error("vault: no records satisfy purpose/agent/expiry policy");
    }
    const attributes: Record<string, unknown> = {};
    for (const [type, group] of byType) {
      const ids = new Set(group.map((r) => r.id));
      if (ids.size > 1) {
        throw new Error(
          `vault: ambiguous claim ${type} (${ids.size} records) — re-put under one id or remove the stale record`
        );
      }
      attributes[type] = (group[0] as VaultRecord).value;
    }
    const names = [...byType.keys()].sort();
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
        detail: `purpose=${req.purpose} verifier=${req.verifier} claims=${names.join(",")} rev=${this.loadedRevision()}`,
        vaultRev: this.loadedRevision(),
      });
    }
    return pres;
  }

  /**
   * Sole in-host path for `secret` records. Validates Authority for `/use`,
   * hands the value to the in-host callback only, and returns the callback's
   * receipt — the value never reaches the caller, receipts, logs, or audit.
   * Selection is by exact record id (stronger than resource filtering); the
   * `/use` authority operation binds the same id.
   */
  async useSecret(opts: SecretUseOptions): Promise<{
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
    const rec = this.getRecord(opts.recordId);
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
    // Actual secret use consumes uses (ADR-0018): a one-time approval
    // covers exactly one use. Hosts MUST persist authority state via the
    // onConsumed hook (burn-before-effect) — persisting after success is
    // already too late for effectful uses; see executeProtectedAction.
    const decision = opts.authority.evaluate(operation, opts.ingress, {
      consume: true,
      nowSec: opts.nowSec,
    });
    if (!decision.allow) {
      throw new Error(`vault: authority denied: ${decision.reason}`);
    }
    // Burn-before-effect: persist consumption before the secret moves.
    await opts.onConsumed?.(opts.authority);
    const instr: SecretInstruction = {
      recordId: rec.id,
      type: rec.type,
      purpose: opts.purpose,
      owner: rec.owner,
      value: rec.value,
    };
    const result = await opts.use(instr);
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result)
    ) {
      throw new Error("vault: use must resolve a receipt object");
    }
    if (!isNonEmptyString((result as SecretUseResult).receipt)) {
      throw new Error("vault: use must resolve { receipt }");
    }
    const receipt = (result as SecretUseResult).receipt;
    // Fail-closed leak guard: the receipt must not echo the secret value.
    // Strings compare verbatim; other values compare in canonical form when
    // distinctive (>= 16 chars). Short scalars (numbers, flags) cannot be
    // told apart from legitimate receipt fields and stay uncovered —
    // keep them out of string-typed receipt fields (see limits.md vault row).
    const rendered =
      typeof rec.value === "string" ? rec.value : tryCanonical(rec.value);
    const distinctive =
      rendered !== null &&
      (typeof rec.value === "string"
        ? rendered.length > 0
        : rendered.length >= 16);
    if (distinctive && receipt.includes(rendered as string)) {
      throw new Error("vault: callback leaked secret into receipt");
    }
    if (opts.audit !== undefined) {
      opts.audit.append({
        actor: opts.ingress.id,
        action: "vault.use",
        detail: `id=${rec.id} type=${rec.type} purpose=${opts.purpose} rev=${this.loadedRevision()}`,
        vaultRev: this.loadedRevision(),
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

  /** Host-safe metadata projection; never includes record values. */
  listMetadata(owner?: string): VaultRecordMetadata[] {
    const out: VaultRecordMetadata[] = [];
    for (const rec of this.records.values()) {
      if (owner !== undefined && rec.owner !== owner) continue;
      out.push({
        id: rec.id,
        owner: rec.owner,
        type: rec.type,
        sensitivity: rec.sensitivity,
        source: rec.source,
        ...(rec.dataPrincipalRef !== undefined
          ? { dataPrincipalRef: rec.dataPrincipalRef }
          : {}),
        ...(rec.resource !== undefined
          ? { resource: { type: rec.resource.type, id: rec.resource.id } }
          : {}),
        allowedPurposes: [...rec.allowedPurposes],
        allowedAgents: [...rec.allowedAgents],
        expiresAt: rec.expiresAt,
        version: rec.version,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Exact-record lifecycle erasure. No wildcard/bulk semantics. */
  eraseRecord(
    input: { readonly id: string; readonly owner: string },
    at?: number
  ): VaultErasureReceipt {
    if (!isNonEmptyString(input.id)) throw new Error("vault: id required");
    if (!isNonEmptyString(input.owner))
      throw new Error("vault: owner required");
    const now = at ?? this.nowSec();
    if (!Number.isInteger(now) || now < 0) {
      throw new Error("vault: at must be a non-negative epoch int");
    }
    const rec = this.records.get(input.id);
    if (rec === undefined) throw new Error("vault: unknown record");
    if (rec.owner !== input.owner) throw new Error("vault: owner mismatch");
    this.records.delete(rec.id);
    return {
      id: rec.id,
      type: rec.type,
      version: rec.version,
      erasedAt: now,
    };
  }

  /**
   * @internal Host-only raw access. The embedding host already possesses the
   * vault file, so this cannot be a security boundary — but it must never
   * become an agent-facing read path. Agents reach records only through
   * {@link VaultStore.disclose} (evaluate-first) and
   * {@link VaultStore.useSecret} (receipt-only), enforced at the MCP/CLI
   * seam. Private so library consumers cannot depend on it by accident.
   */
  private getRecord(id: string): VaultRecord | null {
    const r = this.records.get(id);
    if (r === undefined) return null;
    return {
      ...r,
      allowedPurposes: [...r.allowedPurposes],
      allowedAgents: [...r.allowedAgents],
    };
  }

  /** @internal See {@link VaultStore.getRecord}. */
  private listRecords(): VaultRecord[] {
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
        ...(typeof r["dataPrincipalRef"] === "string"
          ? { dataPrincipalRef: r["dataPrincipalRef"] }
          : {}),
        allowedPurposes: r["allowedPurposes"] as readonly string[],
        allowedAgents: r["allowedAgents"] as readonly string[],
        ...(r["expiresAt"] === null || typeof r["expiresAt"] === "number"
          ? { expiresAt: r["expiresAt"] as number | null }
          : {}),
        ...(r["resource"] !== undefined
          ? {
              resource: {
                type: (r["resource"] as { type?: unknown }).type as string,
                id: (r["resource"] as { id?: unknown }).id as string,
              },
            }
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

export interface VaultReadRequest {
  readonly ingress: VerifiedIdentity;
  readonly purpose: string;
  readonly requested: readonly string[];
  readonly verifier: string;
  readonly nonce: string;
  readonly nowSec: number;
  readonly authority: Authority;
  /**
   * Resource coordinates of the PROPOSED operation. Callers must pass the
   * exact resource the demand was proposed under (ADR-0018: the vault
   * evaluates the identical canonical operation, never a rewritten one).
   */
  readonly resource: { readonly type: string; readonly id: string };
  /** Host-held holder signing key. holder.id must equal the ingress principal. */
  readonly holder: { readonly id: string; readonly privateKey: KeyObject };
  readonly audit?: FileAuditLog;
}

/**
 * Purpose-scoped read (module entry; delegates to {@link VaultStore.disclose},
 * the only read path besides {@link VaultStore.useSecret}).
 */
export function readForPurpose(
  vault: VaultStore,
  req: VaultReadRequest
): Presentation {
  return vault.disclose(req);
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

export interface SecretUseOptions {
  readonly ingress: VerifiedIdentity;
  readonly recordId: string;
  readonly purpose: string;
  readonly authority: Authority;
  readonly nowSec: number;
  readonly use: (instr: SecretInstruction) => Promise<SecretUseResult>;
  readonly audit?: FileAuditLog;
  /**
   * Burn-before-effect hook (ADR-0018): runs after authority is consumed
   * but BEFORE the secret reaches the callback. Hosts persist authority
   * state here, so a crash between consumption and the external effect
   * burns a use instead of resurrecting it. Without this hook, callers
   * must persist before invoking — persisting after success is too late.
   */
  readonly onConsumed?: (authority: Authority) => void | Promise<void>;
}

/**
 * Sole in-host path for `secret` records (module entry; delegates to
 * {@link VaultStore.useSecret}). Returns only the callback's receipt/names.
 */
export async function useCredential(
  vault: VaultStore,
  opts: SecretUseOptions
): Promise<{
  readonly recordId: string;
  readonly type: string;
  readonly purpose: string;
  readonly receipt: string;
  readonly names?: readonly string[];
}> {
  return vault.useSecret(opts);
}
