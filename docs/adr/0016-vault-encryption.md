# ADR-0016: Vault encryption at rest (DEK in keystore)

**Date**: 2026-09-17
**Status**: accepted
**Deciders**: PTF maintainer + independent review (P0 finding: vault stored
plaintext JSON)

## Context

The Personal State vault (`src/store/vault.ts`) persisted record values —
including `secret` records — as plaintext JSON in `personal-state.json`.
Receipt-only APIs do not compensate for plaintext durable storage: any
reader of the store directory, backup, snapshot, or container layer could
read vault contents (independent review, 2026-09-17).

## Decision

`personal-state.json` is an AES-256-GCM envelope (v2) over the canonical
snapshot — ciphertext only at rest:

- The 32-byte vault DEK lives in the existing passphrase-sealed keystore
  under `ptf/vault-dek` (`createVaultDek` / `ensureVaultDek`). Passphrase
  rotation (`resealKeystore` / `ptf rekey`) re-wraps the DEK without
  touching vault data; DEK rotation (`rotateVaultDek` / `ptf vault-rekey`)
  re-seals vault data without touching the passphrase.
- Every record field (owner, id, type, revision, sensitivity, value) sits
  inside the authenticated plaintext, plus a constant `ptf-vault/v2`
  domain separator. The envelope carries a `kidHex` (first 8 bytes of
  sha256(DEK)) so loads resolve the opening key; rotation stages the new
  DEK under `ptf/vault-dek-next`, re-seals, then promotes — every crash
  prefix keeps a matching DEK on disk, so no rotation state bricks the
  vault (re-run `vault-rekey` to complete). Wrong DEK, tamper, or
  corruption fails closed.
- Legacy plaintext files are refused at load AND save. One-time `ptf
vault-migrate` seals them under the DEK; operators must destroy old
  plaintext backups by hand (migration cannot reach backup media).
- Revision CAS + `vaultRev` audit freshness binding are unchanged (ADR-0015
  mechanics, now over ciphertext).
- Core stays zero-dep (`node:crypto` only); the envelope lives in
  `store/`, never `core/`.

## Consequences

- `vault-put` / `vault-migrate` load-or-create the keystore;
  `vault-read` / `vault-rekey` / `audit --verify` (when a vault file
  exists) need the passphrase. The old "audit needs no passphrase" claim
  now carries that exception.
- Whole-directory backups hold ciphertext AND the DEK together — backup
  media must be protected and rotated on exposure. DEK/media separation
  needs the `KeyProvider` host seam (HSM/KMS), which stays host duty.
- Short-scalar secrets (PINs) remain indistinguishable from legitimate
  receipt fields; the leak guard covers verbatim strings and distinctive
  canonical forms only (documented in `docs/audit/limits.md`).
