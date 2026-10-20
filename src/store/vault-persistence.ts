import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  atomicWrite,
  checkFreshness,
  FileAuditLog,
  nextStoreRevision,
  parseStoreFile,
} from "./files.js";
import {
  assertSealedDek,
  openSnapshotEnvelope,
  readSealedEnvelopeKid,
  resolveSealedDek,
  sealSnapshotEnvelope,
  sealedDekFingerprint,
} from "./sealed-snapshot.js";
import {
  VaultStore,
  type VaultRecord,
  type VaultRecordInput,
  type VaultErasureReceipt,
} from "./vault-store.js";

function parseVaultFile(path: string): unknown {
  return parseStoreFile(path, "vault");
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
  assertSealedDek(dek, "vault");
}

/** Key id: first 8 bytes of sha256(DEK), hex. Identifies — never secret. */
export function vaultDekFingerprint(dek: Uint8Array): string {
  return sealedDekFingerprint(dek, {
    kidBytes: KID_BYTES,
    errorPrefix: "vault",
  });
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
  return resolveSealedDek(keys, {
    alias: VAULT_DEK_ALIAS,
    ...(kidHex !== undefined ? { kidHex } : {}),
    bytes: DEK_BYTES,
    kidBytes: KID_BYTES,
    errorPrefix: "vault",
    missingHint: " (run: vault-put first)",
  });
}

/** Envelope kid for a store dir, or null when no vault file exists. */
export function readVaultKid(dir: string): string | null {
  const path = join(dir, "personal-state.json");
  if (!existsSync(path)) return null;
  const parsed = parseVaultFile(path);
  if (isLegacyPlaintext(parsed)) throw legacyError(path);
  return readSealedEnvelopeKid(
    parsed,
    {
      version: VAULT_ENVELOPE_VERSION,
      aad: VAULT_AAD,
      kidBytes: KID_BYTES,
      errorPrefix: "vault",
    },
    path
  );
}

function sealSnapshot(
  snap: { readonly records: readonly VaultRecord[]; readonly revision: number },
  dek: Uint8Array
): VaultEnvelopeFile {
  return sealSnapshotEnvelope(
    { records: snap.records, revision: snap.revision },
    dek,
    {
      version: VAULT_ENVELOPE_VERSION,
      aad: VAULT_AAD,
      kidBytes: KID_BYTES,
      errorPrefix: "vault",
    }
  ) as VaultEnvelopeFile;
}

function openSnapshot(
  parsed: unknown,
  dek: Uint8Array,
  path: string
): { readonly records: readonly VaultRecord[]; readonly revision: number } {
  return openSnapshotEnvelope(
    parsed,
    dek,
    {
      version: VAULT_ENVELOPE_VERSION,
      aad: VAULT_AAD,
      kidBytes: KID_BYTES,
      errorPrefix: "vault",
    },
    path,
    (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        !Array.isArray((value as { records?: unknown }).records)
      ) {
        throw new Error("vault: bad snapshot payload");
      }
      return value as {
        readonly records: readonly VaultRecord[];
        readonly revision: number;
      };
    }
  );
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
  let fileRevision: unknown;
  if (existsSync(path)) {
    const parsed = parseVaultFile(path);
    if (isLegacyPlaintext(parsed)) throw legacyError(path);
    fileRevision = openSnapshot(parsed, opts.dek, path).revision;
  }
  const next = nextStoreRevision({
    what: "vault",
    path,
    fileRevision,
    loadedRevision: vault.loadedRevision(),
    hasKnownLineage: vault.hasKnownLineage(),
  });
  const stamped = { ...vault.snapshot(), revision: next };
  vault.adoptRevision(next);
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

/**
 * Durable exact-record erasure: mutate in memory, persist through revision
 * CAS, then append a value-free audit event. A failed save never records a
 * successful erasure.
 */
export function eraseRecord(
  dir: string,
  vault: VaultStore,
  input: { readonly id: string; readonly owner: string },
  opts: {
    readonly at?: number;
    readonly audit?: FileAuditLog;
    readonly dek: Uint8Array;
  }
): VaultErasureReceipt {
  const receipt = vault.eraseRecord(input, opts.at);
  saveVault(dir, vault, { dek: opts.dek });
  if (opts.audit !== undefined) {
    opts.audit.append({
      actor: input.owner,
      action: "vault.erase",
      detail: `id=${receipt.id} type=${receipt.type} version=${receipt.version} rev=${vault.loadedRevision()}`,
      vaultRev: vault.loadedRevision(),
    });
  }
  return receipt;
}
