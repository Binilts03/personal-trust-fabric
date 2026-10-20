# DPDP Slice C — Runtime Enforcement, Evidence, and Rights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose the privacy engine with existing PTF authority, vault, protected-use and execution-journal seams so privacy mode denies independently, is live-rechecked, records crash-conservative evidence, and supports PTF-observed rights/erasure workflows.

**Architecture:** `PrivacyRuntime` owns the ordering and privacy evidence lifecycle but delegates actual authority consumption, disclosure, secret use and provider effects to existing PTF modules. It never reimplements Authority or ExecutionJournal.

**Tech Stack:** Existing Authority/Vault/provider/journal APIs plus Slice-B privacy modules.

**Spec:** `docs/superpowers/specs/2026-10-18-dpdp-privacy-enforcement-design.md`

## Global Constraints

- Non-consuming Authority preflight must occur before privacy-state lookup on agent-facing paths.
- Operator-only dry-run may expose structured privacy deny reason; agent-facing path returns coarse `privacy-denied`.
- Re-evaluate privacy state immediately before actual data processing.
- PREPARE event before processing; finalize after result.
- Existing Authority consumption ordering is unchanged.
- No raw personal value enters runtime event arguments.

## Review Focus

1. Authority denial must short-circuit before privacy store access.
2. Consent withdrawal between preflight and effect must stop processing.
3. Crash after PREPARED must remain visible as unknown.
4. Provider journal success/replay must not create duplicate privacy events.
5. Rights summary must not treat OUTCOME_UNKNOWN as “never processed”.

---

### Task C1: Implement PrivacyRuntime gate ordering and oracle resistance

**Files:**

- Create: `src/privacy/runtime.ts`
- Modify: `src/index.ts`
- Create: `tests/privacy-runtime.test.ts`

**Interfaces:**

- Produces:

```ts
export interface PrivacyRuntimeDeps {
  readonly loadPrivacy: () => PrivacySnapshot;
  readonly events: PrivacyEventRepository;
  readonly profile: PrivacyProfile;
  readonly nowSec?: () => number;
}

export interface PrivacyGateRequest {
  readonly authority: Authority;
  readonly ingress: VerifiedIdentity;
  readonly operation: AuthorityOperation;
  readonly processing: TrustedProcessingContext;
}

export type PrivacyGateResult =
  | {
      readonly allow: true;
      readonly privacy: Extract<PrivacyDecision, { allow: true }>;
      readonly termsDigest: string;
      readonly authorityCitationIds: readonly string[];
    }
  | {
      readonly allow: false;
      readonly publicReason: "authority-denied" | "privacy-denied";
      readonly operatorReason?: PrivacyDenyReason;
    };

export class PrivacyRuntime {
  constructor(deps: PrivacyRuntimeDeps);
  preflight(
    req: PrivacyGateRequest,
    opts?: { operatorDetail?: boolean }
  ): PrivacyGateResult;
  recheck(
    allow: Extract<PrivacyGateResult, { allow: true }>,
    req: PrivacyGateRequest
  ): Extract<PrivacyGateResult, { allow: true }>;
  prepareEvent(
    allow: Extract<PrivacyGateResult, { allow: true }>,
    req: PrivacyGateRequest
  ): ProcessingEventRecord;
  finalizeEvent(
    eventId: string,
    outcome: ProcessingEventFinalize
  ): ProcessingEventRecord;
}
```

- [ ] **Step 1: Write failing oracle tests**

Use an instrumented fake PrivacyStore/profile counter:

- no authority => privacy store/profile not read/called;
- no authority + different hypothetical privacy states => same public reason;
- authority yes + privacy no => `privacy-denied`, operatorDetail gets closed reason only;
- privacy yes cannot turn Authority deny into allow.

- [ ] **Step 2: Implement non-consuming authority preflight**

Use current `Authority.evaluate(operation, ingress, { consume: false })`; derive terms digest from the same canonical bound operation/ingress. Do not add a core helper unless existing public functions cannot express this without unsafe duplication; if a helper is unavoidable, it must remain domain-neutral and get an ADR amendment/test.

- [ ] **Step 3: Implement live recheck**

`PrivacyRuntime` calls `loadPrivacy()` again during recheck so a consent withdrawal, activity deactivation, or hold change committed after preflight is visible before processing. The loader returns the immutable `PrivacySnapshot` contract; the runtime never depends on the file-backed `PrivacyStore`. It compares activity/basis identifiers and the exact trusted processing context; any withdrawal/deactivation denies.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/privacy/runtime.ts src/index.ts tests/privacy-runtime.test.ts
git commit -m "feat: add privacy runtime gate"
```

---

### Task C2: Add privacy-wrapped vault disclosure and protected secret use

**Files:**

- Create: `src/privacy/vault.ts`
- Modify: `src/index.ts`
- Modify: `tests/privacy-runtime.test.ts`
- Create: `tests/privacy-vault.test.ts`

**Interfaces:**

- Produces:

```ts
export async function discloseWithPrivacy(opts: {
  readonly runtime: PrivacyRuntime;
  readonly gate: PrivacyGateRequest;
  readonly vault: VaultStore;
  readonly disclosure: VaultReadRequest;
  readonly onAuthorityConsumed: (authority: Authority) => void | Promise<void>;
}): Promise<Presentation>;

export async function useCredentialWithPrivacy(opts: {
  readonly runtime: PrivacyRuntime;
  readonly gate: PrivacyGateRequest;
  readonly vault: VaultStore;
  readonly secret: SecretUseOptions;
}): Promise<Awaited<ReturnType<typeof useCredential>>>;
```

- [ ] **Step 1: Write failing integration tests**

Disclosure:

- authority only + missing basis denies before vault returns values;
- privacy only + authority deny denies;
- valid both discloses only configured claims;
- add one claim beyond activity/basis scope => deny;
- withdraw consent after preflight but before call => deny;
- event PREPARED before `VaultStore.disclose`; success => SUCCEEDED;
- injected throw between PREPARED and completion => recover as OUTCOME_UNKNOWN.

Secret use:

- same gate behaviors;
- secret sentinel never appears in event/audit/result.

- [ ] **Step 2: Implement wrappers by composing existing vault APIs**

No copy of disclosure selection, secret leak guards, or Authority consumption logic. After `VaultStore.disclose` consumes authority in memory, call `onAuthorityConsumed` before returning/delivering the presentation; a callback failure prevents delivery. For secret use, preserve the existing `SecretUseOptions.onConsumed` burn-before-effect hook.

- [ ] **Step 3: Run focused tests**

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add src/privacy/vault.ts src/index.ts tests/privacy-runtime.test.ts tests/privacy-vault.test.ts
git commit -m "feat: enforce privacy on vault processing"
```

---

### Task C3: Add privacy evidence around protected provider execution

**Files:**

- Create: `src/privacy/providers.ts`
- Modify: `src/index.ts`
- Create: `tests/privacy-providers.test.ts`

**Interfaces:**

- Produces:

```ts
export async function executeProtectedActionWithPrivacy(opts: {
  readonly runtime: PrivacyRuntime;
  readonly gate: PrivacyGateRequest;
  readonly execute: () => Promise<ExecutionReceipt>;
  readonly executionLookup?: (
    termsDigest: string
  ) => Promise<ExecutionReceipt | null>;
}): Promise<ExecutionReceipt>;
```

Implementation must call the existing provider/execution orchestration supplied by the host; it is not a replacement for `executeProtectedAction` or `executeWithJournal`.

- [ ] **Step 1: Write failing tests**

- PREPARED event is durable before provided execute callback runs;
- success finalizes one event;
- same exact successful journal replay returns same event, no duplicate;
- callback throws ambiguously => event OUTCOME_UNKNOWN;
- existing execution journal proves success on resume => finalize existing event SUCCEEDED;
- privacy recheck fails before callback => callback not invoked.

- [ ] **Step 2: Implement thin orchestration**

Keep provider-specific fields out. Link `executionId`/receipt ref as evidence only.

- [ ] **Step 3: Run focused tests**

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add src/privacy/providers.ts src/index.ts tests/privacy-providers.test.ts
git commit -m "feat: bind privacy evidence to protected execution"
```

---

### Task C4: Implement processing summary, retention checks, and erasure plan

**Files:**

- Create: `src/privacy/rights.ts`
- Modify: `src/privacy/runtime.ts`
- Create: `tests/privacy-rights.test.ts`

**Interfaces:**

- Produces:

```ts
export interface ProcessingSummary {
  readonly dataPrincipalRef: string;
  readonly categories: readonly string[];
  readonly purposes: readonly string[];
  readonly recipients: readonly ProcessingRecipient[];
  readonly basisIds: readonly string[];
  readonly events: readonly {
    readonly eventId: string;
    readonly state: ProcessingEventState;
    readonly at: number;
  }[];
}

export interface ErasurePlanItem {
  readonly record: VaultRecordMetadata;
  readonly status: "eligible" | "held";
  readonly holdIds: readonly string[];
}

export function summarizeProcessing(
  events: readonly ProcessingEventRecord[],
  dataPrincipalRef: string
): ProcessingSummary;
export function planErasure(input: {
  records: readonly VaultRecordMetadata[];
  holds: readonly RetentionHold[];
  dataPrincipalRef: string;
  nowSec: number;
}): readonly ErasurePlanItem[];
```

- [ ] **Step 1: Write failing rights tests**

- summary includes SUCCEEDED and OUTCOME_UNKNOWN;
- summary excludes unrelated subject refs;
- no raw record values available by type;
- active hold marks exact id/category held;
- expired/released hold does not block;
- hold never makes privacy preflight allow.

- [ ] **Step 2: Implement pure summary/planner**

No filesystem, no legal inference.

- [ ] **Step 3: Add runtime/operator helper for executing selected eligible erasures**

It must call Slice-A `eraseRecord` exact-id API one item at a time and return secret-free receipts. No bulk wildcard delete.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/privacy/rights.ts src/privacy/runtime.ts tests/privacy-rights.test.ts
git commit -m "feat: add privacy rights evidence and erasure planning"
```

---

### Task C5: Adversarial/property regression gate

**Files:**

- Modify: `tests/privacy-engine.test.ts`
- Modify: `tests/privacy-runtime.test.ts`
- Modify: `tests/privacy-vault.test.ts`
- Modify: `tests/privacy-providers.test.ts`

- [ ] **Step 1: Add fast-check subset/property tests**

Randomize requested category sets/recipient sets and prove adding a category/recipient outside configured sets cannot turn deny into allow.

- [ ] **Step 2: Add stale-state/race regressions**

Pin withdraw-after-preflight, activity deactivation, stale store handle, repeated event finalization and crash recovery.

- [ ] **Step 3: Run slice/full gate**

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add tests/privacy-*.test.ts
git commit -m "test: harden privacy enforcement against races"
```
