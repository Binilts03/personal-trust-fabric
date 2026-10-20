# DPDP Slice B — Privacy Model, Profile, and Encrypted Stores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a deterministic jurisdiction-neutral privacy narrowing engine, the versioned India DPDP profile, encrypted privacy configuration, and crash-conservative encrypted Processing Event storage.

**Architecture:** Pure privacy model/engine code lives under `src/privacy/`; encrypted mutable configuration lives in `src/store/privacy.ts`; per-attempt processing evidence lives independently in `src/store/privacy-events.ts`. Authority remains untouched.

**Tech Stack:** TypeScript, existing canonical/crypto helpers, extracted sealed-snapshot module, node:test/fast-check, file CAS/atomic writes.

**Spec:** `docs/superpowers/specs/2026-10-18-dpdp-privacy-enforcement-design.md`

## Global Constraints

- Privacy engine has no side effects and never mutates Authority.
- Subject refs are opaque/non-identifying; direct identifiers are rejected at host/config boundaries where detectable and never emitted.
- Profile output says allow/deny/control references, never compliant/legal.
- No agent I/O in this slice.
- Processing events are independent encrypted records, not part of `privacy-state.json`.
- Consent is evidence, never a StandingGrant.

## Review Focus

1. Missing/unknown basis defaults to deny.
2. Explicit wildcard subject scope is required; missing selector is not wildcard.
3. Consent withdrawal/expiry must fail without mutating authority state.
4. Event transition/replay races must be idempotent and fail closed.
5. Tampered/wrong-key privacy files/events must never be treated as absent/fresh.

---

### Task B1: Define canonical privacy model and deterministic engine

**Files:**

- Create: `src/privacy/model.ts`
- Create: `src/privacy/engine.ts`
- Modify: `src/index.ts`
- Create: `tests/privacy-engine.test.ts`

**Interfaces:**

- Produces:

```ts
export type PrivacyRecipientRole =
  "data-processor" | "data-fiduciary" | "third-party" | "other";

export type PrivacySubjectSelector =
  | { readonly kind: "exact"; readonly ref: string }
  | { readonly kind: "set"; readonly refs: readonly string[] }
  | { readonly kind: "any" };

export interface ProcessingRecipient {
  readonly id: string;
  readonly role: PrivacyRecipientRole;
}

export interface NoticeEvidence {
  readonly id: string;
  readonly controllerId: string;
  readonly dataPrincipalRef: string;
  readonly purpose: string;
  readonly dataCategories: readonly string[];
  readonly noticeRef: string;
  readonly noticeHash: string;
  readonly presentedAt: number;
  readonly assertedBy: string;
  readonly language?: string;
  readonly version?: string;
}

export interface ConsentEvidence {
  readonly id: string;
  readonly noticeId: string;
  readonly controllerId: string;
  readonly dataPrincipalRef: string;
  readonly purpose: string;
  readonly dataCategories: readonly string[];
  readonly givenAt: number;
  readonly method: string;
  readonly proofRef: string;
  readonly assertedBy: string;
  readonly withdrawnAt?: number;
  readonly withdrawalProofRef?: string;
  readonly withdrawnBy?: string;
}

export type ProcessingBasisEvidence =
  | {
      readonly kind: "consent";
      readonly id: string;
      readonly controllerId: string;
      readonly dataPrincipalRef: string;
      readonly purpose: string;
      readonly dataCategories: readonly string[];
      readonly consentId: string;
      readonly assertedBy: string;
      readonly nbf?: number;
      readonly exp?: number;
      readonly active: boolean;
    }
  | {
      readonly kind: "certain-legitimate-use";
      readonly id: string;
      readonly controllerId: string;
      readonly purpose: string;
      readonly dataCategories: readonly string[];
      readonly provisionRef: string;
      readonly evidenceRef: string;
      readonly assertedBy: string;
      readonly nbf?: number;
      readonly exp?: number;
      readonly active: boolean;
    };

export interface RetentionHold {
  readonly id: string;
  readonly dataPrincipalRef: string;
  readonly recordIds: readonly string[];
  readonly dataCategories: readonly string[];
  readonly reasonRef: string;
  readonly assertedBy: string;
  readonly effectiveAt: number;
  readonly retainUntil: number | null;
  readonly releasedAt?: number;
  readonly releasedBy?: string;
}

export interface ProcessingActivity {
  readonly id: string;
  readonly profileId: string;
  readonly authorityPrincipal: string;
  readonly controllerId: string;
  readonly subjects: PrivacySubjectSelector;
  readonly action: `/${string}`;
  readonly resourceType: string;
  readonly purpose: string;
  readonly dataCategories: readonly string[];
  readonly recipients: readonly ProcessingRecipient[];
  readonly basisId: string;
  readonly allowedTransferDestinations?: readonly string[];
  readonly nbf?: number;
  readonly exp?: number;
  readonly active: boolean;
}

export interface TrustedProcessingContext {
  readonly authorityPrincipal: string;
  readonly actor: string;
  readonly dataPrincipalRef: string;
  readonly controllerId: string;
  readonly action: `/${string}`;
  readonly resource: { readonly type: string; readonly id: string };
  readonly purpose: string;
  readonly dataCategories: readonly string[];
  readonly recipients: readonly ProcessingRecipient[];
  readonly subjectAssurance?: {
    readonly classification: "adult" | "child" | "guardian-assisted";
    readonly proofRef: string;
    readonly assertedBy: string;
  };
  readonly transferDestination?: string;
}

export const PRIVACY_DENY_REASONS = [
  "no-processing-activity",
  "activity-inactive",
  "principal-mismatch",
  "controller-mismatch",
  "purpose-mismatch",
  "action-mismatch",
  "resource-mismatch",
  "basis-missing",
  "basis-inactive",
  "basis-invalid",
  "data-category-forbidden",
  "recipient-forbidden",
  "guardian-evidence-required",
  "transfer-forbidden",
  "retention-restricted",
  "other",
] as const;
export type PrivacyDenyReason = (typeof PRIVACY_DENY_REASONS)[number];

export type PrivacyProfileDecision =
  | { readonly ok: true; readonly controlRefs: readonly string[] }
  | { readonly ok: false; readonly reason: PrivacyDenyReason };

export interface PrivacyProfile {
  readonly id: string;
  readonly revision: string;
  validate(input: {
    readonly activity: ProcessingActivity;
    readonly basis: ProcessingBasisEvidence;
    readonly notices: readonly NoticeEvidence[];
    readonly consents: readonly ConsentEvidence[];
    readonly context: TrustedProcessingContext;
    readonly nowSec: number;
  }): PrivacyProfileDecision;
}

export type PrivacyDecision =
  | {
      readonly allow: true;
      readonly activityId: string;
      readonly basisId: string;
      readonly profileId: string;
      readonly profileRevision: string;
      readonly controlRefs: readonly string[];
    }
  | { readonly allow: false; readonly reason: PrivacyDenyReason };

export interface PrivacySnapshot {
  readonly notices: readonly NoticeEvidence[];
  readonly consents: readonly ConsentEvidence[];
  readonly bases: readonly ProcessingBasisEvidence[];
  readonly activities: readonly ProcessingActivity[];
  readonly holds: readonly RetentionHold[];
  readonly revision: number;
}

export type ProcessingEventState =
  "PREPARED" | "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN";

export interface ProcessingEventPrepare {
  readonly profileId: string;
  readonly profileRevision: string;
  readonly dataPrincipalRef: string;
  readonly authorityPrincipal: string;
  readonly actor: string;
  readonly controllerId: string;
  readonly activityId: string;
  readonly basisId: string;
  readonly purpose: string;
  readonly action: `/${string}`;
  readonly resource: { readonly type: string; readonly id: string };
  readonly dataCategories: readonly string[];
  readonly recipients: readonly ProcessingRecipient[];
  readonly termsDigest: string;
  readonly authorityCitationIds: readonly string[];
  readonly preparedAt: number;
}

export interface ProcessingEventFinalize {
  readonly finalizedAt: number;
  readonly evidenceRef?: string;
}

export interface ProcessingEventRecord extends ProcessingEventPrepare {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly state: ProcessingEventState;
  readonly finalizedAt?: number;
  readonly evidenceRef?: string;
}

export interface PrivacyEventRepository {
  prepare(input: ProcessingEventPrepare): ProcessingEventRecord;
  load(eventId: string): ProcessingEventRecord | null;
  transition(
    eventId: string,
    to: Exclude<ProcessingEventState, "PREPARED">,
    patch: ProcessingEventFinalize
  ): ProcessingEventRecord;
  findByKey(idempotencyKey: string): ProcessingEventRecord | null;
  listBySubject(dataPrincipalRef: string): readonly ProcessingEventRecord[];
  recoverPrepared(nowSec: number): readonly ProcessingEventRecord[];
}

export function evaluateProcessing(input: {
  readonly activities: readonly ProcessingActivity[];
  readonly bases: readonly ProcessingBasisEvidence[];
  readonly notices: readonly NoticeEvidence[];
  readonly consents: readonly ConsentEvidence[];
  readonly holds: readonly RetentionHold[];
  readonly context: TrustedProcessingContext;
  readonly profile: PrivacyProfile;
  readonly nowSec: number;
}): PrivacyDecision;
```

- [ ] **Step 1: Write failing table/property tests**

Cover default deny, exact action/resource-type/purpose, controller and authority-principal mismatch, exact/set/explicit-any subject selectors, data-category subset, recipient id+role subset, inactive/expired activity, missing/inactive basis.

Run:

```sh
npm run build && node --test dist/tests/privacy-engine.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 2: Implement model validation**

Use closed deny codes from the spec. Reject empty arrays/ids, duplicate ids, invalid epoch fields, and missing subject selector. Do not accept free-form deny text from inputs.

- [ ] **Step 3: Implement deterministic engine**

Exact-match v1 semantics; no prefix purpose matching; no inference.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/privacy/model.ts src/privacy/engine.ts src/index.ts tests/privacy-engine.test.ts
git commit -m "feat: add privacy narrowing engine"
```

---

### Task B2: Implement versioned DPDP profile

**Files:**

- Create: `src/privacy/dpdp.ts`
- Modify: `src/privacy/model.ts`
- Modify: `src/index.ts`
- Create: `tests/privacy-dpdp.test.ts`

**Interfaces:**

- Produces:

```ts
export const DPDP_PROFILE_ID = "IN-DPDP-2025" as const;
export const DPDP_PROFILE_REVISION = "2025-r1" as const;
export const dpdpProfile: PrivacyProfile;
```

- [ ] **Step 1: Write failing profile tests**

Consent tests:

- notice required and matches controller/subject/purpose/data categories;
- consent captures affirmative timestamp/method/proof reference;
- withdrawn consent denies;
- activity cannot widen consent categories;
- child/guardian-assisted classifications require guardian verification evidence when consent is basis.

Legitimate-use tests:

- non-empty `provisionRef`, `evidenceRef`, `assertedBy` required;
- no AI-generated/free text is treated as sufficient by itself; only configured record passes shape validation;
- transfer destination is checked only against configured transfer constraint and never against an invented country list.

- [ ] **Step 2: Implement profile validation**

Profile validates configured evidence shape/state only. No string such as `legal`, `lawful`, or `compliant` appears in allow results.

- [ ] **Step 3: Run focused tests**

```sh
npm run build && node --test dist/tests/privacy-dpdp.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add src/privacy/dpdp.ts src/privacy/model.ts src/index.ts tests/privacy-dpdp.test.ts
git commit -m "feat: add India DPDP privacy profile"
```

---

### Task B3: Implement encrypted privacy configuration store and key lifecycle

**Files:**

- Create: `src/store/privacy.ts`
- Modify: `src/store/keystore.ts` only if a generic internal DEK helper is needed; do not change public custody semantics.
- Modify: `src/index.ts`
- Create: `tests/privacy-store.test.ts`

**Interfaces:**

- Produces:

```ts
export const PRIVACY_DEK_ALIAS = "ptf/privacy-dek";
export const PRIVACY_DEK_NEXT_ALIAS = "ptf/privacy-dek-next";

export class PrivacyStore {
  addNotice(input: NoticeEvidence): NoticeEvidence;
  addConsent(input: ConsentEvidence): ConsentEvidence;
  addBasis(input: ProcessingBasisEvidence): ProcessingBasisEvidence;
  withdrawConsent(consentId: string, input: { at: number; proofRef: string; assertedBy: string }): ConsentEvidence;
  addActivity(input: ProcessingActivity): ProcessingActivity;
  addHold(input: RetentionHold): RetentionHold;
  releaseHold(id: string, input: { at: number; assertedBy: string }): RetentionHold;
  snapshot(): PrivacySnapshot;
  loadedRevision(): number;
  adoptRevision(rev: number): void;
  static restore(data: unknown, opts?: { nowSec?: () => number }): PrivacyStore;
}

savePrivacyStore(dir, store, { dek }): void
loadPrivacyStore(dir, { dek? , keys?, nowSec? }): PrivacyStore
rotatePrivacyDek(dir, store, { dek, newDek, audit? }): void
readPrivacyKid(dir): string | null
resolvePrivacyDek(keys, kidHex?): Uint8Array
```

- [ ] **Step 1: Write failing store tests**

Pin unique/global ids, consent withdrawal immutability/history fields, revision CAS, encrypted-at-rest sentinel absence, wrong-key/tamper failure, staged rekey recovery and malformed snapshot refusal.

- [ ] **Step 2: Implement store model and CAS persistence using `sealed-snapshot.ts`**

Do not copy AES-GCM code.

- [ ] **Step 3: Add privacy freshness binding to audit infrastructure if needed**

Extend freshness metadata generically rather than hard-coding ad hoc checks in unrelated code. If `FileAuditLog` snapshot shape needs an additive `privacyRev`, update serializers/backward compatibility and tests.

- [ ] **Step 4: Run focused/full tests**

```sh
npm run build && node --test dist/tests/privacy-store.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/store/privacy.ts src/store/keystore.ts src/index.ts tests/privacy-store.test.ts src/store/files.ts
git commit -m "feat: persist encrypted privacy configuration"
```

---

### Task B4: Implement encrypted Processing Event repository

**Files:**

- Create: `src/store/privacy-events.ts`
- Modify: `src/index.ts`
- Create: `tests/privacy-events.test.ts`

**Interfaces:**

- Produces:

```ts
export class FilePrivacyEventRepository implements PrivacyEventRepository {
  constructor(opts: {
    readonly dir: string;
    readonly dek: Uint8Array;
    readonly nowSec?: () => number;
  });
  prepare(input: ProcessingEventPrepare): ProcessingEventRecord;
  load(eventId: string): ProcessingEventRecord | null;
  transition(
    eventId: string,
    to: Exclude<ProcessingEventState, "PREPARED">,
    patch: ProcessingEventFinalize
  ): ProcessingEventRecord;
  findByKey(idempotencyKey: string): ProcessingEventRecord | null;
  listBySubject(dataPrincipalRef: string): readonly ProcessingEventRecord[];
  recoverPrepared(nowSec: number): readonly ProcessingEventRecord[];
}
```

File backend uses deterministic hashed filenames/idempotency keys derived from canonical metadata including termsDigest/activity/basis/opaque subject ref, never direct personal values.

- [ ] **Step 1: Write failing state-machine/replay tests**

Assertions:

- same prepare key returns same record;
- same terminal transition is idempotent only when identical;
- conflicting terminal transition throws;
- PREPARED can transition only to allowed states;
- recovery of leftover PREPARED produces/marks OUTCOME_UNKNOWN;
- tampered/wrong-key event fails closed;
- sentinel personal value/direct identifier is rejected/absent from serialized ciphertext metadata/error text.

- [ ] **Step 2: Implement repository using one encrypted file per event**

Reuse sealed envelope helper. Do not reuse/clone provider ExecutionJournal state machine; this repository records privacy evidence only.

- [ ] **Step 3: Add bounded growth and safe prune/export hooks**

The first implementation may expose `listTerminalCandidates`/operator error text rather than automatic GC. Never auto-prune events under active configured retention.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/store/privacy-events.ts src/index.ts tests/privacy-events.test.ts
git commit -m "feat: add durable privacy processing events"
```

---

### Task B5: Extend backup/restore coherently

**Files:**

- Modify: `src/store/backup.ts`
- Modify: `tests/backup.test.ts`
- Modify: `docs/audit/limits.md`

**Interfaces:**

- Consumes: privacy config store and event repository.
- Produces: additive `privacyEvents` count in BackupSummary if useful; restore verifies privacy state/event decryptability whenever privacy artifacts exist.

- [ ] **Step 1: Write failing backup tests**

Seed privacy-state + one event; assert backup includes `privacy-state.json` and `privacy-events/`, no sentinel plaintext, clean restore decrypts, missing privacy key fails, tampered event fails restore verification.

- [ ] **Step 2: Update backup/restore file set and validation**

Treat privacy artifacts as part of one unit. Do not make old backups without privacy files fail.

- [ ] **Step 3: Run focused/full verification**

```sh
npm run build && node --test dist/tests/backup.test.js dist/tests/privacy-store.test.js dist/tests/privacy-events.test.js
npm test
npm run eval
bash scripts/harness.sh
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add src/store/backup.ts tests/backup.test.ts docs/audit/limits.md
git commit -m "feat: include privacy state in backup unit"
```
