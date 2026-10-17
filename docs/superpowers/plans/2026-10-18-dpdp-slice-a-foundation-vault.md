# DPDP Slice A — Foundation and Vault Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor vault encryption/persistence into focused modules without behavior drift, add exact-record erasure, and land the DPDP architecture vocabulary/ADR before privacy semantics are introduced.

**Architecture:** Keep `src/store/vault.ts` as a compatibility facade. Move the vault class/record behavior into `vault-store.ts`, persistence/key lifecycle into `vault-persistence.ts`, and reusable AES-GCM envelope/CAS primitives into `sealed-snapshot.ts`; no privacy logic exists yet.

**Tech Stack:** TypeScript, Node 22 `node:crypto`/`node:fs`, existing `atomicWrite`, FileAuditLog, node:test.

**Spec:** `docs/superpowers/specs/2026-10-18-dpdp-privacy-enforcement-design.md`

## Global Constraints

- Preserve every existing `./vault` named export and behavior.
- No new runtime dependency.
- No DPDP logic in core.
- Exact-record erasure is host/operator-only and never agent-facing in this slice.
- Erasure receipts/audit carry no raw value.
- Refactor first; behavior changes are limited to the explicitly tested erasure seam.
- Run the full legacy gate before and after structural refactors.

## Review Focus

1. Legacy encrypted vault files created before the refactor must still load identically.
2. Wrong DEK/tampered envelope errors must remain fail-closed and semantically equivalent.
3. A stale VaultStore handle must still fail CAS rather than overwrite.
4. Exact erasure must remove only one requested id and preserve other versions/records.
5. Deleted value sentinels must not appear in erasure receipt/audit output.

---

### Task A1: Freeze baseline, vocabulary, and architecture decision

**Files:**
- Modify: `CONTEXT.md`
- Create: `docs/adr/0024-privacy-enforcement-narrows-authority.md`
- Modify: `CHANGELOG.md`
- Test/verify: existing repository gate

**Interfaces:**
- Consumes: approved DPDP design spec.
- Produces: canonical domain terms and the architectural rule that later code must obey.

- [ ] **Step 1: Capture frozen-base verification**

Run from an isolated implementation worktree before code changes:

```sh
git rev-parse HEAD
npm ci
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
npm pack --dry-run
```

Expected: HEAD is the approved implementation base (design/plan commits carried from `7b52d61...`); every command passes. Save output outside tracked source or in PR evidence, not as generated repo noise.

- [ ] **Step 2: Write the ADR and glossary changes**

ADR must state exactly:
- Personal State ≠ Authority State ≠ Processing Basis Evidence.
- PTF Principal ≠ Privacy Data Principal Reference.
- privacy decisions only narrow;
- legal sufficiency remains external evidence;
- privacy profiles never enter `src/core/`;
- privacy mode is explicit/backward-compatible;
- agent-facing requests cannot choose legal-basis/subject/controller fields.

`CONTEXT.md` adds pure domain definitions only: Privacy Data Principal Reference, Processing Basis Evidence, Notice Evidence, Consent Evidence, Processing Activity, Processing Recipient, Privacy Decision, Processing Event, Retention Hold, Privacy Profile.

- [ ] **Step 3: Verify docs/brand/build invariants**

Run:
```sh
npm run check:brand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add CONTEXT.md docs/adr/0024-privacy-enforcement-narrows-authority.md CHANGELOG.md
git commit -m "docs: define privacy enforcement boundary"
```

---

### Task A2: Extract reusable sealed snapshot primitives without behavior change

**Files:**
- Create: `src/store/sealed-snapshot.ts`
- Create: `src/store/vault-persistence.ts`
- Modify: `src/store/vault.ts`
- Test: `tests/vault.test.ts`
- Test: `tests/backup.test.ts`

**Interfaces:**
- Consumes: `atomicWrite`, `checkFreshness`, canonical JSON, existing vault snapshot shape.
- Produces:
  - `sealSnapshotEnvelope<T>(payload: T, dek: Uint8Array, opts: SealedSnapshotOptions): SealedEnvelope`
  - `openSnapshotEnvelope<T>(parsed: unknown, dek: Uint8Array, opts: SealedSnapshotOpenOptions<T>): T`
  - `dekFingerprint(dek: Uint8Array, kidBytes?: number): string`
  - vault-specific wrappers preserving `saveVault`, `loadVault`, `migrateVault`, `rotateVaultDek`, `resolveVaultDek`, `readVaultKid`, `vaultDekFingerprint`.

- [ ] **Step 1: Add regression tests that pin the old persisted format**

In `tests/vault.test.ts`, add tests that:
- save a vault and assert envelope fields/version/AAD-compatible round-trip;
- tamper ct/tag and assert load fails;
- open with wrong DEK and assert failure;
- simulate stale revision and assert save refuses;
- confirm `readVaultKid` and `resolveVaultDek` still work during staged rotation.

Run:
```sh
npm run build && node --test dist/tests/vault.test.js
```
Expected: PASS on frozen behavior before extraction.

- [ ] **Step 2: Implement `sealed-snapshot.ts`**

Exact options:
```ts
export interface SealedSnapshotOptions {
  readonly version: number;
  readonly aad: string;
  readonly kidBytes?: number;
  readonly errorPrefix: string;
}
export interface SealedEnvelope {
  readonly version: number;
  readonly kidHex: string;
  readonly ivHex: string;
  readonly ctHex: string;
  readonly tagHex: string;
}
```

`openSnapshotEnvelope` receives a validator callback that owns domain-shape validation; this helper owns only envelope validation, AES-256-GCM, canonical payload serialization, and key fingerprinting.

- [ ] **Step 3: Move vault file/envelope/key-rotation mechanics to `vault-persistence.ts`**

Keep vault-specific constants/error wording and legacy-plaintext migration semantics there. `sealed-snapshot.ts` must not know `personal-state.json`, vault aliases, or VaultRecord.

- [ ] **Step 4: Make `vault.ts` re-export persistence functions while keeping existing names**

Do not update callers yet beyond imports needed internally.

- [ ] **Step 5: Run focused and full tests**

```sh
npm run typecheck
npm run build && node --test dist/tests/vault.test.js dist/tests/backup.test.js
npm test
```

Expected: all PASS; no behavior delta.

- [ ] **Step 6: Commit**

```sh
git add src/store/sealed-snapshot.ts src/store/vault-persistence.ts src/store/vault.ts tests/vault.test.ts tests/backup.test.ts
git commit -m "refactor: extract sealed snapshot persistence"
```

---

### Task A3: Move VaultStore behavior out of the facade

**Files:**
- Create: `src/store/vault-store.ts`
- Modify: `src/store/vault.ts`
- Modify: `src/api.ts`
- Modify: `src/index.ts`
- Test: `tests/vault.test.ts`
- Test: `tests/hygiene.test.ts`

**Interfaces:**
- Consumes: extracted persistence module.
- Produces: existing `VaultStore`, VaultRecord types, `parseSensitivity`, `readForPurpose`, `useCredential` from the same public import paths.

- [ ] **Step 1: Write/retain facade compatibility tests**

In `tests/hygiene.test.ts`, assert package exports still expose `./vault`. In `tests/vault.test.ts`, keep imports through `../src/index.js`; do not deep-import new internals.

- [ ] **Step 2: Move record validation, `VaultStore`, disclosure/use methods and types into `vault-store.ts`**

Do not change method semantics. Private raw get/list remain private.

- [ ] **Step 3: Reduce `vault.ts` to a compatibility facade**

It may re-export from `vault-store.ts` and `vault-persistence.ts` and keep only thin durable wrappers that need both. Target: materially below the frozen-base 1,048 lines.

- [ ] **Step 4: Run compatibility gate**

```sh
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/store/vault.ts src/store/vault-store.ts src/store/vault-persistence.ts src/api.ts src/index.ts tests/vault.test.ts tests/hygiene.test.ts
git commit -m "refactor: decompose vault store"
```

---

### Task A4: Add exact-record erasure and safe metadata view

**Files:**
- Modify: `src/store/vault-store.ts`
- Modify: `src/store/vault.ts`
- Modify: `src/api.ts`
- Test: `tests/vault.test.ts`

**Interfaces:**
- Produces:
```ts
export interface VaultRecordMetadata {
  readonly id: string;
  readonly owner: string;
  readonly type: string;
  readonly sensitivity: VaultSensitivity;
  readonly source: string;
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

VaultStore.listMetadata(owner?: string): readonly VaultRecordMetadata[]
VaultStore.eraseRecord(input: { readonly id: string; readonly owner: string }, at?: number): VaultErasureReceipt
eraseRecord(dir: string, vault: VaultStore, input: { id: string; owner: string }, opts: { at?: number; audit?: FileAuditLog; dek: Uint8Array }): VaultErasureReceipt
```

- [ ] **Step 1: Write failing erasure tests**

Assertions:
- unknown id throws;
- wrong owner throws;
- erase A leaves B unchanged;
- second erase of A throws;
- receipt contains id/type/version/timestamp only;
- sentinel value is absent from receipt and audit JSON;
- after durable save/reload the erased record is absent;
- stale writer cannot resurrect erased state.

Run focused test; Expected: FAIL because erasure APIs do not exist.

- [ ] **Step 2: Implement in-memory exact erasure and metadata projection**

Never return `value` from metadata.

- [ ] **Step 3: Implement durable erasure wrapper**

Order: in-memory mutation → CAS save → append secret-free `vault.erase` audit. If save fails, no audit success is appended.

- [ ] **Step 4: Run focused/full verification**

```sh
npm run build && node --test dist/tests/vault.test.js
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/store/vault-store.ts src/store/vault.ts src/api.ts tests/vault.test.ts
git commit -m "feat: add exact vault erasure"
```

---

### Task A5: Slice-A structural gate

**Files:** no intended product changes unless review finds a defect.

- [ ] **Step 1: Measure affected file sizes and inspect diff**

Confirm `src/store/vault.ts` is materially smaller and no replacement file crosses 1,000 lines.

- [ ] **Step 2: Run complete repository gate**

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
npm pack --dry-run
```

Expected: PASS.

- [ ] **Step 3: Review against frozen base**

Check that Slice A introduced no privacy engine behavior and no public break other than additive erasure/metadata APIs.

- [ ] **Step 4: Commit any review-only corrections separately**

Use `fix: preserve vault behavior after decomposition` only if evidence requires a correction.
