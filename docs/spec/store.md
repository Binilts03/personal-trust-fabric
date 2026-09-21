# Store, Vault, and Audit

## 1. Vault (Personal State)

### 1.1 Record Model

A vault record contains:

| Field | Type | Constraint |
|-------|------|------------|
| `owner` | string | Principal identity. |
| `id` | string | Record identifier. |
| `type` | string | Record type. |
| `revision` | number | CAS revision. |
| `sensitivity` | string | Sensitivity level. |
| `values` | Record<string, unknown> | Record data. |
| `secret` | string | Optional secret value (receipt-only return). |

### 1.2 Access Control

- `readForPurpose` evaluates `Authority.evaluate(/disclose)` first, then owner/purpose/agent/expiry filtering
- `secret` records MUST be dropped from regular reads
- `useCredential` is the sole path for `secret` — receipt-only return
- Raw record access is host-only by construction
- Reads and uses CONSUME authority (one-time approvals cover exactly one presentation/use)

### 1.3 Encryption at Rest

- `personal-state.json` MUST be an AES-256-GCM envelope over the canonical snapshot
- The DEK MUST live in the passphrase-sealed keystore
- Passphrase rotation re-wraps the DEK without touching vault data
- DEK rotation re-seals vault data without touching the passphrase
- Legacy plaintext files MUST be refused at load and save
- Wrong DEK or tamper fails closed (`decryption failed`)
- Malformed envelopes fail closed (`bad envelope`)

### 1.4 Freshness Binding

- Every vault file carries a `revision` bumped atomically with data
- Loads MUST fail closed when the file predates audit history
- `audit --verify` loads the vault when present to check freshness
- Full-directory rollback to consistently-old files is undetectable without external anchoring

## 2. Audit

### 2.1 Hash Chain

The audit log MUST be append-only with hash chaining:

- Each entry contains `seq`, `prevHash`, `hash`
- `GENESIS` is the sentinel for the first entry's `prevHash`
- Hash is SHA-256 (unkeyed) or HMAC-SHA-256 (keyed)
- Sequentiality MUST be enforced: gaps or duplicates deny

### 2.2 Audit Events

Audit entries record:

- `at` — timestamp
- `actor` — the actor performing the action
- `action` — the action name
- `authorityId` — the authority consumed (if any)
- `capabilityId` — the capability used (if any)
- `detail` — human-readable detail (MUST NOT contain secrets)
- Revision stamps for authority, registry, vault

### 2.3 Tamper Detection

- Unkeyed: tamper-detection (hash chain break detectable)
- Keyed (HMAC): tamper-evidence (attacker cannot forge without key)
- `audit --verify` checks chain integrity without requiring the passphrase

## 3. Store Integrity

### 3.1 Revision CAS

Every durable file carries a `revision` bumped atomically with data. A stale handle's save MUST fail closed.

### 3.2 Freshness Binding

- `authority.json`, `registry.json`, `personal-state.json` all carry revision stamps
- Loads fail closed when files predate recorded audit history
- `audit --verify` loads the vault when present to check freshness

### 3.3 Backup/Restore

- Backups are whole-directory copies (never merge across backups)
- Every backup carries `anchor.json` (Merkle root + count over audit log)
- Restore recomputes and refuses mismatch
- Restored stores reload under revision-CAS freshness
- `anchor.json` proves backup consistency, not external freshness

## 4. Cryptography

### 4.1 Keys

- Signing: Ed25519 (64-byte signatures)
- Key derivation: scrypt (file keystore)
- Encryption: AES-256-GCM (vault at rest)
- Hashing: SHA-256 (digests, audit chain)

### 4.2 Nonce Requirements

- Capability nonce: minimum 16 characters
- Disclosure nonce: minimum 16 characters (verifier-provided)
- Presentation nonce: minimum 16 characters

### 4.3 Clock Skew

A `CLOCK_SKEW_SEC` tolerance applies to all time-based checks (nbf, exp, freshness).
