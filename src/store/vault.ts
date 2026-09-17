import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { Authority } from "../core/authority.js";
import type { VerifiedIdentity } from "../core/authority.js";
import { canonicalize } from "../core/canonical.js";
import { sha256Hex } from "../core/canonical.js";
import { assembleCapsule } from "../core/persona.js";
import { Disclose } from "../core/disclose.js";
import type { Presentation } from "../core/disclose.js";
import { isNonEmptyString } from "../adapters/guards.js";
import { atomicWrite, checkFreshness, FileAuditLog } from "./files.js";

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
    for (const rec of this.listRecords()) {
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

/**
 * At-rest encryption (ADR-0016). `personal-state.json` is an AEAD envelope —
 * AES-256-GCM over the canonical snapshot — never plaintext records.
 *
 * Key custody: the 32-byte vault DEK lives in the existing passphrase-sealed
 * keystore under {@link VAULT_DEK_ALIAS}, so passphrase rotation
 * (`resealKeystore` / `ptf rekey`) re-wraps the DEK without touching vault
 * data, and DEK rotation (`rotateVaultDek` / `ptf vault-rekey`) re-seals
 * vault data without touching the passphrase. Every record field (owner,
 * id, type, revision, sensitivity, value) sits inside the authenticated
 * plaintext; the constant {@link VAULT_AAD} domain-separates the cipher
 * from the keystore blob. Residuals (JS heap erasure, Windows rename,
 * backups holding DEK + ciphertext together) are documented in
 * `docs/audit/limits.md` — the honest boundary for a file-backed operator
 * store; HSM/KMS custody stays a host seam.
 */

export const VAULT_DEK_ALIAS = "ptf/vault-dek";
/**
 * Pending-rotation DEK slot. Rekey stages the new DEK here and persists the
 * keystore BEFORE re-sealing vault data, so every crash state keeps a DEK
 * matching the envelope kid on disk (see `ptf vault-rekey` ordering).
 */
export const VAULT_DEK_NEXT_ALIAS = "ptf/vault-dek-next";
const VAULT_ENVELOPE_VERSION = 2;
const VAULT_AAD = "ptf-vault/v2";
const DEK_BYTES = 32;
const IV_BYTES = 12;
const KID_BYTES = 8;

export interface VaultEnvelopeFile {
  readonly version: 2;
  /** First 8 bytes of sha256(DEK), hex — selects the opening key. */
  readonly kidHex: string;
  readonly ivHex: string;
  readonly ctHex: string;
  readonly tagHex: string;
}

/** Fresh 32-byte vault DEK for keystore custody (hex never logged). */
export function createVaultDek(): Uint8Array {
  return new Uint8Array(randomBytes(DEK_BYTES));
}

/**
 * Ensure the keystore map carries a vault DEK, generating one on first use.
 * Returns a copy — callers persist it with their normal keystore write.
 */
export function ensureVaultDek(keys: Record<string, Uint8Array>): {
  readonly keys: Record<string, Uint8Array>;
  readonly created: boolean;
} {
  const existing = keys[VAULT_DEK_ALIAS];
  if (existing !== undefined) {
    if (!(existing instanceof Uint8Array) || existing.length !== DEK_BYTES) {
      throw new Error("vault: DEK corrupt (expected 32 bytes)");
    }
    return { keys, created: false };
  }
  return {
    keys: { ...keys, [VAULT_DEK_ALIAS]: createVaultDek() },
    created: true,
  };
}

function checkDek(dek: unknown): asserts dek is Uint8Array {
  if (!(dek instanceof Uint8Array) || dek.length !== DEK_BYTES) {
    throw new Error("vault: DEK must be 32 bytes");
  }
}

/** Key id: first 8 bytes of sha256(DEK), hex. Identifies — never secret. */
export function vaultDekFingerprint(dek: Uint8Array): string {
  checkDek(dek);
  return sha256Hex(Buffer.from(dek)).slice(0, KID_BYTES * 2);
}

/**
 * Select the opening DEK from keystore entries. With a kid (read from the
 * envelope), any alias whose fingerprint matches wins — this is what makes
 * rotation crash-safe: mid-rotation the new DEK sits under the next alias
 * and still opens the re-sealed file. Without a kid, the current alias.
 */
export function resolveVaultDek(
  keys: Record<string, Uint8Array>,
  kidHex?: string | null
): Uint8Array {
  if (kidHex !== undefined && kidHex !== null) {
    for (const candidate of Object.values(keys)) {
      if (
        candidate instanceof Uint8Array &&
        candidate.length === DEK_BYTES &&
        vaultDekFingerprint(candidate) === kidHex
      ) {
        return candidate;
      }
    }
    throw new Error(
      `vault: no DEK matches envelope kid ${kidHex} (rotation incomplete — re-run vault-rekey)`
    );
  }
  const current = keys[VAULT_DEK_ALIAS];
  if (current instanceof Uint8Array && current.length === DEK_BYTES) {
    return current;
  }
  throw new Error(
    `no vault DEK under ${VAULT_DEK_ALIAS} (run: vault-put first)`
  );
}

/** Envelope kid for a store dir, or null when no vault file exists. */
export function readVaultKid(dir: string): string | null {
  const path = join(dir, "personal-state.json");
  if (!existsSync(path)) return null;
  const parsed = parseVaultFile(path);
  if (isLegacyPlaintext(parsed)) throw legacyError(path);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { kidHex?: unknown }).kidHex === undefined
  ) {
    throw new Error(`vault store corrupt: ${path} (bad envelope)`);
  }
  const kid: unknown = (parsed as { kidHex?: unknown }).kidHex;
  if (
    typeof kid !== "string" ||
    kid.length !== KID_BYTES * 2 ||
    !/^[0-9a-fA-F]+$/.test(kid)
  ) {
    throw new Error(`vault store corrupt: ${path} (bad envelope)`);
  }
  return kid;
}

function sealSnapshot(
  snap: { readonly records: readonly VaultRecord[]; readonly revision: number },
  dek: Uint8Array
): VaultEnvelopeFile {
  checkDek(dek);
  const plain = canonicalize({
    records: snap.records,
    revision: snap.revision,
  });
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(dek), iv);
  cipher.setAAD(Buffer.from(VAULT_AAD, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    version: VAULT_ENVELOPE_VERSION,
    kidHex: vaultDekFingerprint(dek),
    ivHex: iv.toString("hex"),
    ctHex: ct.toString("hex"),
    tagHex: cipher.getAuthTag().toString("hex"),
  };
}

function openSnapshot(
  parsed: unknown,
  dek: Uint8Array,
  path: string
): { readonly records: readonly VaultRecord[]; readonly revision: number } {
  checkDek(dek);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== VAULT_ENVELOPE_VERSION ||
    typeof (parsed as Record<string, unknown>)["kidHex"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["ivHex"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["ctHex"] !== "string" ||
    typeof (parsed as Record<string, unknown>)["tagHex"] !== "string"
  ) {
    throw new Error(`vault store corrupt: ${path} (bad envelope)`);
  }
  const env = parsed as VaultEnvelopeFile;
  if (
    env.kidHex.length !== KID_BYTES * 2 ||
    !/^[0-9a-fA-F]+$/.test(env.kidHex) ||
    env.ivHex.length !== IV_BYTES * 2 ||
    !/^[0-9a-fA-F]+$/.test(env.ivHex) ||
    env.tagHex.length !== 32 ||
    !/^[0-9a-fA-F]+$/.test(env.tagHex) ||
    env.ctHex.length === 0 ||
    env.ctHex.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(env.ctHex)
  ) {
    throw new Error(`vault store corrupt: ${path} (bad envelope)`);
  }
  let plain: string;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(dek),
      Buffer.from(env.ivHex, "hex")
    );
    decipher.setAAD(Buffer.from(VAULT_AAD, "utf8"));
    decipher.setAuthTag(Buffer.from(env.tagHex, "hex"));
    plain =
      decipher.update(Buffer.from(env.ctHex, "hex"), undefined, "utf8") +
      decipher.final("utf8");
  } catch {
    throw new Error("vault: decryption failed (wrong DEK or tampered file)");
  }
  let snap: unknown;
  try {
    snap = JSON.parse(plain) as unknown;
  } catch {
    throw new Error(`vault store corrupt: ${path} (bad payload)`);
  }
  if (
    typeof snap !== "object" ||
    snap === null ||
    Array.isArray(snap) ||
    !Array.isArray((snap as { records?: unknown }).records)
  ) {
    throw new Error(`vault store corrupt: ${path} (bad payload)`);
  }
  return snap as {
    readonly records: readonly VaultRecord[];
    readonly revision: number;
  };
}

/** Pre-encryption plaintext shape. Loading it is refused — migrate first. */
function isLegacyPlaintext(parsed: unknown): boolean {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Array.isArray((parsed as { records?: unknown }).records) &&
    (parsed as { version?: unknown }).version !== VAULT_ENVELOPE_VERSION
  );
}

function legacyError(path: string): Error {
  return new Error(
    `vault: legacy plaintext store at ${path} — refusing to load; run one-time migration: ptf vault-migrate --dir <store> (then destroy old backups holding plaintext)`
  );
}

function withNextVaultRevision(
  dir: string,
  vault: VaultStore,
  opts: { readonly dek: Uint8Array; readonly sealDek?: Uint8Array }
): VaultEnvelopeFile {
  checkDek(opts.dek);
  const sealDek = opts.sealDek ?? opts.dek;
  checkDek(sealDek);
  const path = join(dir, "personal-state.json");
  if (!existsSync(path)) {
    if (vault.loadedRevision() !== 0 || vault.hasKnownLineage()) {
      throw new Error(
        `vault store missing: ${path} (instance at revision ${vault.loadedRevision()} — the store was deleted under us; refusing to resurrect stale state — re-init deliberately)`
      );
    }
    const stamped = { ...vault.snapshot(), revision: 0 };
    vault.adoptRevision(0);
    return sealSnapshot(stamped, sealDek);
  }
  const parsed = parseVaultFile(path);
  if (isLegacyPlaintext(parsed)) throw legacyError(path);
  const current = openSnapshot(parsed, opts.dek, path);
  const currentRev = current.revision;
  if (!Number.isInteger(currentRev) || currentRev < 0) {
    throw new Error(`vault store corrupt: ${path} (bad revision)`);
  }
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
  return sealSnapshot(stamped, sealDek);
}

export function saveVault(
  dir: string,
  vault: VaultStore,
  opts: { readonly dek: Uint8Array }
): void {
  atomicWrite(
    join(dir, "personal-state.json"),
    JSON.stringify(withNextVaultRevision(dir, vault, opts))
  );
}

export function loadVault(
  dir: string,
  opts: {
    readonly nowSec?: () => number;
    readonly dek?: Uint8Array;
    readonly keys?: Record<string, Uint8Array>;
  } = {}
): VaultStore {
  const path = join(dir, "personal-state.json");
  const parsed = parseVaultFile(path);
  if (isLegacyPlaintext(parsed)) throw legacyError(path);
  let dek: Uint8Array;
  if (opts.keys !== undefined) {
    const kid: unknown = (parsed as { kidHex?: unknown }).kidHex;
    dek = resolveVaultDek(opts.keys, typeof kid === "string" ? kid : null);
  } else if (opts.dek !== undefined) {
    dek = opts.dek;
  } else {
    throw new Error(
      `vault: DEK required — unlock the keystore holding ${VAULT_DEK_ALIAS}`
    );
  }
  const snap = openSnapshot(parsed, dek, path);
  const vault = VaultStore.restore(snap, opts);
  checkFreshness(dir, "vault", vault.loadedRevision());
  return vault;
}

/**
 * One-time migration from the pre-encryption plaintext format. Validates
 * through the same gates as live input, seals under the given DEK, and
 * audits the migration (ids/count/revision only). Refuses already-encrypted
 * stores. Callers must destroy old backups holding plaintext afterwards —
 * migration cannot reach into backup media.
 */
export function migrateVault(
  dir: string,
  opts: {
    readonly dek: Uint8Array;
    readonly nowSec?: () => number;
    readonly audit?: FileAuditLog;
  }
): { readonly records: number; readonly revision: number } {
  checkDek(opts.dek);
  const path = join(dir, "personal-state.json");
  const parsed = parseVaultFile(path);
  if (!isLegacyPlaintext(parsed)) {
    throw new Error("vault: already encrypted, nothing to migrate");
  }
  // Validated through the same gates as live input, then sealed directly:
  // the normal save path refuses to overwrite legacy files (even for
  // migration), so the one-time migration writes the envelope itself at the
  // legacy revision, preserving the CAS lineage.
  const restored = VaultStore.restore(parsed, opts);
  const snap = {
    ...restored.snapshot(),
    revision: restored.loadedRevision(),
  };
  // Refuse to migrate over newer encrypted history (e.g. a concurrent
  // writer sealed ciphertext after this legacy copy was taken).
  checkFreshness(dir, "vault", snap.revision);
  atomicWrite(path, JSON.stringify(sealSnapshot(snap, opts.dek)));
  const vault = VaultStore.restore(snap, opts);
  if (opts.audit !== undefined) {
    opts.audit.append({
      actor: "operator",
      action: "vault.migrated",
      detail: `records=${snap.records.length} rev=${vault.loadedRevision()}`,
      vaultRev: vault.loadedRevision(),
    });
  }
  return { records: snap.records.length, revision: vault.loadedRevision() };
}

/**
 * DEK rotation without re-entering record values: verifies the current DEK
 * against the file, then re-seals the snapshot under the new DEK via CAS.
 * Crash protocol (see `ptf vault-rekey`): the caller must stage `newDek`
 * under {@link VAULT_DEK_NEXT_ALIAS} and persist the keystore BEFORE
 * calling, then promote it to {@link VAULT_DEK_ALIAS} after success. Every
 * crash prefix then keeps a DEK matching the envelope kid — calling this
 * bare (persist-after) bricks on a reseal-then-crash window.
 */
export function rotateVaultDek(
  dir: string,
  vault: VaultStore,
  opts: {
    readonly dek: Uint8Array;
    readonly newDek: Uint8Array;
    readonly audit?: FileAuditLog;
  }
): void {
  checkDek(opts.dek);
  checkDek(opts.newDek);
  atomicWrite(
    join(dir, "personal-state.json"),
    JSON.stringify(
      withNextVaultRevision(dir, vault, { dek: opts.dek, sealDek: opts.newDek })
    )
  );
  if (opts.audit !== undefined) {
    opts.audit.append({
      actor: "operator",
      action: "vault.rekeyed",
      detail: `rev=${vault.loadedRevision()}`,
      vaultRev: vault.loadedRevision(),
    });
  }
}

/**
 * Durable put: mutate + audit (ids only) + persist via CAS.
 * Audit detail carries id/type/revision — never the value.
 */
export function putRecord(
  dir: string,
  vault: VaultStore,
  input: VaultRecordInput,
  opts: {
    readonly at?: number;
    readonly audit?: FileAuditLog;
    readonly dek: Uint8Array;
  }
): VaultRecord {
  const rec = vault.putRecord(input, opts.at);
  if (opts.audit !== undefined) {
    opts.audit.append({
      actor: rec.owner,
      action: "vault.put",
      detail: `id=${rec.id} type=${rec.type} sensitivity=${rec.sensitivity} rev=${vault.loadedRevision()}`,
      vaultRev: vault.loadedRevision(),
    });
  }
  saveVault(dir, vault, { dek: opts.dek });
  if (opts.audit !== undefined) {
    opts.audit.append({
      actor: rec.owner,
      action: "vault.put.persisted",
      detail: `id=${rec.id} rev=${vault.loadedRevision()}`,
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
