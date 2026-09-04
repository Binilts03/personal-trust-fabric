# PTF v1 Conformance, Portability, Recovery, and Release Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the PTF v1 product contract with an executable versioned conformance suite, locked authorization regression corpus, privacy-safe portability/import, multi-device revocation and non-broadening recovery, final Trusted Surface export/recovery journeys, audit verification/witnessing, supply-chain/security CI, external protocol evidence, and release gates that prevent unsupported conformance/security claims.

**Architecture:** `ptf-conformance` is a black-box/public-seam harness over PTF deployments, not a second authority engine. Portable state and recovery live in `ptf-runtime`/`ptf-postgres` because they mutate canonical state; conformance only verifies them. CI composes Python, JavaScript, database, protocol, leak-canary, migration, dependency, SBOM, secret-scan, and release-copy gates. The reference release claims only profiles actually executed and recorded.

**Tech Stack:** Existing PTF Python/Node stack; pytest/Hypothesis; PostgreSQL 18; `pip-audit==2.10.1`; npm audit; Gitleaks GitHub Action v3; Syft `1.51.0` for CycloneDX/SPDX SBOM generation; GitHub Actions using Node 24-compatible actions; OpenID Foundation OpenID4VP 1.0 + HAIP conformance programme for external wallet evidence when run; existing x402/AP2 pinned reference implementations.

**Spec:** `docs/spec/PTF-V1-PROPOSED.md`, exact approved blob recorded by `docs/spec/PTF-V1-APPROVAL.md`. Primary sections: 5–6, 12–14, 17–31; this plan closes all remaining foundational acceptance gates.

## Global Constraints

- Execute only after Plan 04. Product-surface Task 7 may integrate with accepted Plan 05 UI once its backend state operations exist.
- `ptf-conformance` must drive public/runtime/API seams and protocol test fixtures; it must not call private authorization helpers to manufacture expected outcomes.
- A PTF deployment may claim conformance only as `PTF v1 / <profile-id> / suite <suite-version>` with an attached passing evidence artifact.
- Mandatory oracle identifiers are stable test IDs; renaming/removing one requires spec/ADR review.
- A change from `DENY` or `APPROVAL_REQUIRED` to `AUTHORIZE` in the locked regression corpus fails release unless an explicit human-approved spec/policy change explains and updates the corpus.
- Portable State Package never exports raw protected-resource values or non-exportable key/credential material.
- Imported trust/binding labels are never trusted solely because they were trusted on the source deployment; revalidation is required.
- Recovery must not increase plaintext visibility, usable-key invokers, operator domains, or authorization scope beyond the pre-loss state without new deliberate Principal approval at required assurance.
- Revocation must propagate to the authoritative runtime before a consequential commit can succeed; stale replicas fail closed according to profile.
- Security-sensitive state conflicts fail closed; there is no generic last-write-wins merge across Personal State, grants, trust, reservations, and protected resources.
- AI0 remains baseline; AI1 is an optional reference profile with an external privacy-safe witness. Do not relabel AI0 as externally immutable.
- External conformance/certification results are recorded exactly; passing local tests does not become an OpenID Foundation certification claim.
- Release workflows must not upload protected test canaries, private keys, raw credentials, payment artifacts, or real user data as CI artifacts.
- Every task uses red-green-refactor and ends with a reviewable commit.

---

## File map

```text
packages/ptf-conformance/
├── pyproject.toml
├── src/ptf_conformance/
│   ├── __init__.py
│   ├── profile.py
│   ├── oracle.py
│   ├── runner.py
│   ├── evidence.py
│   ├── cli.py
│   └── oracles/
│       ├── authority.py
│       ├── identity.py
│       ├── planning.py
│       ├── execution.py
│       ├── leakage.py
│       ├── memory.py
│       └── portability.py
└── tests/
    ├── test_profile.py
    ├── test_runner.py
    └── test_evidence.py
packages/ptf-runtime/src/ptf_runtime/
├── portability.py
├── recovery.py
└── sync.py
packages/ptf-postgres/
├── migrations/0003_portability_recovery.sql
└── src/ptf_postgres/
    ├── portability_repository.py
    └── recovery_repository.py
packages/ptf-api/src/ptf_api/routes/principal.py      # export/import/recovery additions
apps/trusted-surface/src/pages/
├── Portability.tsx
└── Recovery.tsx
tests/conformance/
├── fixtures/
│   ├── authorization-regression-v1.json
│   └── profile-foundation-v1.json
├── test_foundation_profile.py
├── test_x402_profile.py
├── test_ap2_profile.py
├── test_openid4vp_profile.py
└── test_migrations.py
tests/integration/
├── test_portability_roundtrip.py
├── test_import_trust_revalidation.py
├── test_multi_device_revocation.py
├── test_recovery_tcb.py
└── test_ai1_witness.py
docs/conformance/
├── README.md
├── profiles/PTF-V1-FOUNDATION-1.md
└── external/openid4vp.md
docs/threat-model/PTF-v1.md
docs/operations/
├── incident-revocation.md
├── recovery.md
├── migrations.md
└── release.md
.github/workflows/
├── ci.yml
├── security.yml
└── release-evidence.yml
.gitleaks.toml
```

---

### Task 1: Bootstrap a versioned black-box conformance package and evidence format

**Files:**
- Create: `packages/ptf-conformance/pyproject.toml`
- Create: `packages/ptf-conformance/src/ptf_conformance/profile.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/oracle.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/evidence.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/runner.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/cli.py`
- Create: `packages/ptf-conformance/tests/test_profile.py`
- Create: `packages/ptf-conformance/tests/test_runner.py`
- Create: `packages/ptf-conformance/tests/test_evidence.py`

**Interfaces:**
- Produces:
```python
class ConformanceProfile(FrozenModel):
    profile_id: str
    suite_version: str
    required_oracle_ids: tuple[str, ...]
    required_protocol_profiles: tuple[str, ...]

class OracleResult(FrozenModel):
    oracle_id: str
    status: Literal["PASS", "FAIL", "SKIP"]
    evidence_digest: str
    explanation: str

class ConformanceEvidence(FrozenModel):
    profile_id: str
    suite_version: str
    implementation_version: str
    source_commit: str
    executed_at: datetime
    results: tuple[OracleResult, ...]
    overall_status: Literal["PASS", "FAIL"]
```

- [ ] **Step 1: Write profile completeness tests**

Create `tests/conformance/fixtures/profile-foundation-v1.json` requiring all mandatory oracle IDs listed in Task 2. Assert runner refuses duplicate/missing IDs and refuses overall PASS when any required oracle is FAIL/SKIP.

- [ ] **Step 2: Run red**

```bash
uv run pytest packages/ptf-conformance/tests -q
```
Expected: import failure.

- [ ] **Step 3: Create package metadata**

`packages/ptf-conformance/pyproject.toml` depends on `ptf-core`, `ptf-runtime`, `httpx>=0.28,<0.29` and exposes console script:
```toml
[project.scripts]
ptf-conformance = "ptf_conformance.cli:main"
```

- [ ] **Step 4: Implement deterministic evidence serialization**

Evidence digest uses the same canonical-security serialization discipline as core. `explanation` is structured deterministic text from the oracle, not model-generated rationale. Runner writes JSON and refuses to overwrite an existing evidence path unless `--replace-failed` is explicitly supplied and prior evidence is FAIL.

- [ ] **Step 5: Run**

```bash
uv lock
uv sync --all-packages --all-groups
uv run pytest packages/ptf-conformance/tests -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-conformance tests/conformance/fixtures/profile-foundation-v1.json uv.lock
git commit -m "feat(conformance): add versioned PTF profile runner"
```

---

### Task 2: Implement every mandatory foundational conformance oracle and locked authorization corpus

**Files:**
- Create: `packages/ptf-conformance/src/ptf_conformance/oracles/authority.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/oracles/identity.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/oracles/planning.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/oracles/execution.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/oracles/leakage.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/oracles/memory.py`
- Create: `packages/ptf-conformance/src/ptf_conformance/oracles/portability.py`
- Create: `tests/conformance/fixtures/authorization-regression-v1.json`
- Create: `tests/conformance/test_foundation_profile.py`
- Create: `docs/conformance/profiles/PTF-V1-FOUNDATION-1.md`

**Interfaces:**
- Produces stable oracle IDs exactly matching the approved specification.

- [ ] **Step 1: Register the exact mandatory oracle set**

The profile must contain these exact IDs:
```text
AUTH-PERSONAL-STATE-NO-BROADEN
AUTH-NO-GRANT-UNION
AUTH-EXCEPTION-NO-GRANT-MUTATION
AUTH-PLAN-MUTATION-REAPPROVAL
AUTH-REVOCATION-RECHECK
AUTH-DELEGATION-ATTENUATION
COORD-AGGREGATE-RACE
ID-RECIPIENT-SUBSTITUTION
ID-ENDPOINT-PAYMENT-SUBSTITUTION
ID-STALE-BINDING
TRUST-MISSING-RELATION
DISCLOSURE-ESCALATION
PLAN-SEMANTIC-LOSS
PLAN-DOWNGRADE-POLICY
EXEC-REPLAY
EXEC-INDETERMINATE-NO-BLIND-RETRY
RESOURCE-REF-NOT-AUTHORITY
LEAK-AGENT-SURFACES
LEAK-LOG-RECEIPT-ERROR-TELEMETRY
MEMORY-SOURCE-LAUNDERING
MIGRATION-NO-SILENT-BROADENING
PORTABILITY-IMPORT-NO-TRUST-ESCALATION
RECOVERY-TCB-NO-BROADENING
```

- [ ] **Step 2: Build the locked authorization regression corpus**

`authorization-regression-v1.json` contains deterministic setup/request/expected decision tuples for deny, approval-required, and authorize cases across payment, credential presentation, generic signing/auth action, and non-consequential Safe View. Each case identifies policy/grant/trust state by fixture IDs, not arbitrary executable code.

- [ ] **Step 3: Implement metamorphic no-broadening oracle**

For every corpus case, mutate only Personal State/preferences/model-derived strategy fields and rerun through public `ActionRuntime.request_action`. Fail if a decision moves `DENY -> APPROVAL_REQUIRED/AUTHORIZE` or `APPROVAL_REQUIRED -> AUTHORIZE` solely from that mutation.

- [ ] **Step 4: Implement remaining authority/identity/planning/execution oracles through public seams**

Each oracle uses the same test harness setup and validates the exact attack described by its ID. No oracle calls `constraint_contains`, private repository SQL, or internal resolver functions directly to produce PASS; those may be unit-tested elsewhere but conformance observes public runtime/API behavior.

- [ ] **Step 5: Implement leakage scanning with controlled canaries**

Scan Agent HTTP bodies, SDK results, structured logs, PTF receipts, audit export, exception strings, browser storage captures, and recorded controlled telemetry. Fail on any registered canary or protected-field signature. State explicitly that this does not claim access to undocumented model-provider internals.

- [ ] **Step 6: Run the foundation profile**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run ptf-conformance run --profile tests/conformance/fixtures/profile-foundation-v1.json --output artifacts/conformance/foundation.json
python - <<'PY'
import json
r=json.load(open('artifacts/conformance/foundation.json'))
assert r['overall_status'] == 'PASS'
PY
```
Expected: PASS after all required implementation pieces from later tasks are available; during incremental execution, oracle-specific tests are run and the full profile remains a final gate rather than being mislabeled complete.

- [ ] **Step 7: Commit**

```bash
git add packages/ptf-conformance/src/ptf_conformance/oracles tests/conformance/fixtures/authorization-regression-v1.json tests/conformance/test_foundation_profile.py docs/conformance/profiles/PTF-V1-FOUNDATION-1.md
git commit -m "feat(conformance): codify mandatory PTF v1 oracles"
```

---

### Task 3: Add protocol-specific conformance packs without changing canonical authority

**Files:**
- Create: `tests/conformance/test_x402_profile.py`
- Create: `tests/conformance/test_ap2_profile.py`
- Create: `tests/conformance/test_openid4vp_profile.py`
- Create: `docs/conformance/README.md`

**Interfaces:**
- Produces protocol evidence layered on the foundational profile; does not create new authority semantics.

- [ ] **Step 1: Build x402 conformance pack**

Run requirement->ActionRequest, recipient/payment-endpoint substitution, amount/network/asset mutation, wallet-key leak, settlement/replay, and indeterminate no-blind-retry cases against the Plan 02 public flow.

- [ ] **Step 2: Build AP2 conformance pack**

Run open mandate requires Standing Grant, child attenuation, merchant/audience/nonce substitution, selective disclosure, signing-key leak, closed-mandate receipt binding, and AP2-valid-but-PTF-denied cases.

- [ ] **Step 3: Build OpenID4VP conformance pack**

Run verifier binding, DCQL escalation, credential freshness/status, nonce replay, raw credential/VP leak, and protocol-valid-but-PTF-denied cases.

- [ ] **Step 4: Assert core decision invariance across protocol validation success**

For each protocol, create a cryptographically/protocol-valid external artifact for a PTF-denied request and assert final PTF execution remains denied. This is the direct proof that external protocols are adapters/evidence, not authority.

- [ ] **Step 5: Run**

```bash
uv run pytest tests/conformance/test_x402_profile.py tests/conformance/test_ap2_profile.py tests/conformance/test_openid4vp_profile.py -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/conformance/test_x402_profile.py tests/conformance/test_ap2_profile.py tests/conformance/test_openid4vp_profile.py docs/conformance/README.md
git commit -m "test(conformance): add protocol-specific PTF profiles"
```

---

### Task 4: Implement versioned Portable State Package export/import with trust revalidation

**Files:**
- Create: `packages/ptf-runtime/src/ptf_runtime/portability.py`
- Create: `packages/ptf-postgres/migrations/0003_portability_recovery.sql`
- Create: `packages/ptf-postgres/src/ptf_postgres/portability_repository.py`
- Create: `tests/integration/test_portability_roundtrip.py`
- Create: `tests/integration/test_import_trust_revalidation.py`

**Interfaces:**
- Produces:
```python
class PortableStatePackageV1(FrozenModel):
    schema_version: Literal["PTF-PORTABLE-STATE-1"]
    exported_at: datetime
    source_deployment_id: str
    principal_id: str
    personal_state: tuple[PortablePersonalStateItem, ...]
    hard_policies: tuple[PortablePolicy, ...]
    standing_grants: tuple[PortableGrant, ...]
    trust_metadata: tuple[PortableTrustMetadata, ...]
    protected_resource_refs: tuple[PortableResourceMetadata, ...]
    receipt_summaries: tuple[PortableReceiptSummary, ...]
    package_digest: str

class ImportResult(FrozenModel):
    imported_ids: tuple[str, ...]
    requires_revalidation: tuple[str, ...]
    requires_reenrollment: tuple[str, ...]
    conflicts: tuple[str, ...]
```

- [ ] **Step 1: Write export leak tests**

Seed protected payment key, credential, secret, and use-only resource canaries. Export package and assert none are present. Resource entries contain metadata/reference/profile/status only.

- [ ] **Step 2: Implement deterministic export**

Export supported Personal State with provenance, policies/grants with immutable versions, trust metadata as untrusted/revalidation-needed external metadata, protected resource refs/status, and selected safe receipt summaries. Sign/digest package for corruption detection; do not treat signature as source deployment trust on import.

- [ ] **Step 3: Write import trust-escalation tests**

Import a package whose source marks Merchant X trusted and Agent Y authorized. Destination must not create active TrustRelation/IdentityBinding merely from imported labels. Existing active Standing Grants that depend on unavailable/unvalidated destination bindings remain suspended/unusable until revalidated.

- [ ] **Step 4: Implement conflict rules by state class**

Personal State uses provenance/supersession semantics. Security Configuration conflicts fail closed and require explicit Principal/admin resolution. Usage/Reservation Ledger is not blindly merged across deployments. Protected resources marked non-exportable return `requires_reenrollment`.

- [ ] **Step 5: Run**

```bash
uv run pytest tests/integration/test_portability_roundtrip.py tests/integration/test_import_trust_revalidation.py -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-runtime/src/ptf_runtime/portability.py packages/ptf-postgres/migrations/0003_portability_recovery.sql packages/ptf-postgres/src/ptf_postgres/portability_repository.py tests/integration/test_portability_roundtrip.py tests/integration/test_import_trust_revalidation.py
git commit -m "feat(portability): export and import PTF state safely"
```

---

### Task 5: Implement multi-device enrollment/revocation and non-broadening recovery

**Files:**
- Create: `packages/ptf-runtime/src/ptf_runtime/recovery.py`
- Create: `packages/ptf-runtime/src/ptf_runtime/sync.py`
- Create: `packages/ptf-postgres/src/ptf_postgres/recovery_repository.py`
- Create: `tests/integration/test_multi_device_revocation.py`
- Create: `tests/integration/test_recovery_tcb.py`
- Create: `docs/operations/recovery.md`
- Create: `docs/operations/incident-revocation.md`

**Interfaces:**
- Produces `DeviceEnrollment`, `DeviceStatus`, `RecoveryPlan`, `RecoveryEvidence`, `RecoveryResult`.

- [ ] **Step 1: Write device revocation tests**

Enroll two Principal devices with independent authenticated bindings. Revoke device A and increment Trust Registry epoch. Requests signed by A must fail immediately at authoritative runtime/revalidation; device B remains valid. A stale cached trust snapshot cannot commit consequential action.

- [ ] **Step 2: Define recovery-plan constraints**

`RecoveryPlan` explicitly records pre-loss custody/TCB profile, recovery parties, resources requiring re-enrollment, allowed state restoration classes, required Principal assurance, and any unavoidable downgrade. Recovery execution is denied if the proposed post-recovery Assurance Manifest broadens plaintext observers/usable-key invokers without separate deliberate approval.

- [ ] **Step 3: Test non-exportable resource recovery**

A non-exportable WebAuthn/private-key/credential resource must be marked `requires_reenrollment` or use its provider’s documented recovery mechanism. PTF cannot recover it by exporting/copying the secret.

- [ ] **Step 4: Implement class-specific sync**

`sync.py` may synchronize safe Personal State/security metadata between devices but must not create a universal state merge. Reservations/usage remain authoritative server-coordinated under CP2; trust mutations increment epoch; protected resources follow custody-specific semantics.

- [ ] **Step 5: Run**

```bash
uv run pytest tests/integration/test_multi_device_revocation.py tests/integration/test_recovery_tcb.py -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-runtime/src/ptf_runtime/recovery.py packages/ptf-runtime/src/ptf_runtime/sync.py packages/ptf-postgres/src/ptf_postgres/recovery_repository.py tests/integration/test_multi_device_revocation.py tests/integration/test_recovery_tcb.py docs/operations/recovery.md docs/operations/incident-revocation.md
git commit -m "feat(recovery): preserve authority and TCB across device loss"
```

---

### Task 6: Add optional AI1 privacy-safe external witness profile

**Files:**
- Extend: `packages/ptf-runtime/src/ptf_runtime/audit.py`
- Create: `tests/integration/test_ai1_witness.py`
- Create: `docs/operations/audit-integrity.md`

**Interfaces:**
- Produces optional:
```python
class AuditWitness(Protocol):
    def witness_checkpoint(self, checkpoint_digest: str, sequence: int, created_at: datetime) -> WitnessReceipt: ...
```
- Witness receives only checkpoint digest/sequence/timestamp, not raw AuditEvent bodies.

- [ ] **Step 1: Write privacy test**

A fake external witness records every call. Assert it never receives recipient names, protected fields, transaction details, Personal State, protocol artifacts, or canaries—only the checkpoint commitment tuple.

- [ ] **Step 2: Write external-rewrite detection test**

After witnessing checkpoint N, rewrite local history and recompute a local AI0 chain/checkpoint with compromised local test key. `verify_history` under AI1 must fail against the externally retained witness receipt.

- [ ] **Step 3: Implement optional witness composition**

AI0 works without witness. AI1 calls `AuditWitness` after local checkpoint creation and stores only its safe receipt. Network failure to required AI1 witness makes checkpoint status `UNWITNESSED` and prevents claiming AI1 for that interval; it does not silently fall back while labeling AI1.

- [ ] **Step 4: Run**

```bash
uv run pytest tests/integration/test_ai1_witness.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ptf-runtime/src/ptf_runtime/audit.py tests/integration/test_ai1_witness.py docs/operations/audit-integrity.md
git commit -m "feat(audit): add privacy-safe AI1 witnessing"
```

---

### Task 7: Complete Trusted Surface portability and recovery journeys

**Files:**
- Extend: `packages/ptf-api/src/ptf_api/routes/principal.py`
- Create: `apps/trusted-surface/src/pages/Portability.tsx`
- Create: `apps/trusted-surface/src/pages/Recovery.tsx`
- Create: `tests/e2e/trusted-surface-portability.spec.ts`
- Create: `tests/e2e/trusted-surface-recovery.spec.ts`

**Interfaces:**
- Adds Principal routes:
```text
POST /v1/principal/portability/export
POST /v1/principal/portability/import/inspect
POST /v1/principal/portability/import/commit
POST /v1/principal/recovery/plan
POST /v1/principal/recovery/execute
```
- These routes remain absent from Agent OpenAPI/SDK.

- [ ] **Step 1: Test export UI truthfulness**

Before export, UI displays exactly which classes are included/excluded and identifies resources that will require re-enrollment. Downloaded package must pass server digest/schema validation and leak scan.

- [ ] **Step 2: Implement two-phase import**

`inspect` returns conflicts/revalidation/re-enrollment requirements without mutating security state. `commit` requires authenticated Principal authorization and cannot activate imported TrustRelations/bindings automatically.

- [ ] **Step 3: Implement recovery review UX**

Render pre/post Assurance Manifest differences, required assurance, affected devices/resources, recovery parties, and downgrades. Recovery cannot proceed if it broadens TCB without a separate explicit authorization path defined by policy.

- [ ] **Step 4: Run**

```bash
npx playwright test tests/e2e/trusted-surface-portability.spec.ts tests/e2e/trusted-surface-recovery.spec.ts
uv run pytest packages/ptf-api/tests -q
```
Expected: PASS.

- [ ] **Step 5: Re-generate Agent OpenAPI and prove no leakage**

```bash
uv run python -m ptf_api.openapi --surface agent --output artifacts/openapi/agent.json
npx openapi-typescript@7.13.0 artifacts/openapi/agent.json -o sdk/typescript/src/generated/agent-api.d.ts
npm --workspace sdk/typescript test
```
Expected: Agent SDK public surface remains unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-api apps/trusted-surface/src/pages tests/e2e artifacts/openapi/agent.json sdk/typescript/src/generated/agent-api.d.ts
git commit -m "feat(product): add safe portability and recovery controls"
```

---

### Task 8: Build migration/self-improvement release gates and the full threat model

**Files:**
- Create: `tests/conformance/test_migrations.py`
- Create: `docs/threat-model/PTF-v1.md`
- Create: `docs/operations/migrations.md`

**Interfaces:**
- Produces release-blocking evidence for schema/code migrations and planner/learning changes.

- [ ] **Step 1: Implement `MIGRATION-NO-SILENT-BROADENING`**

Take a database snapshot + locked authorization corpus before migration, apply migrations/current release code, replay corpus, and fail any `DENY/APPROVAL_REQUIRED -> AUTHORIZE` transition not accompanied by an explicit fixture metadata field referencing a human-approved spec/policy change ID.

- [ ] **Step 2: Add strategy/self-improvement regression gate**

A fixture mode changes ranking/planner/preference strategy while holding authority state constant. Re-run the same corpus and fail silent broadening. This test is required whenever files under Personal State learning/planning-strategy paths change.

- [ ] **Step 3: Write the threat model from actual implemented boundaries**

`docs/threat-model/PTF-v1.md` must enumerate assets, principals/Agents/recipients/providers/operators, control/confidential planes, per-custody-profile TCB, attack surfaces, prompt injection, malicious Agent, recipient substitution, replay, confused deputy, malicious frontend, database/operator compromise, executor compromise, audit compromise, memory poisoning, sync/recovery attacks, supply-chain compromise, legitimate recipient retention, and residual risks. Each mitigation links to an executable oracle/test or explicitly says residual/unmitigated.

- [ ] **Step 4: Run migration regression**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest tests/conformance/test_migrations.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/conformance/test_migrations.py docs/threat-model/PTF-v1.md docs/operations/migrations.md
git commit -m "test(security): block migration and learning authority broadening"
```

---

### Task 9: Add CI, dependency audit, secret scan, SBOM, and safe release evidence

**Files:**
- Modify: root Python dev dependencies to include `pip-audit==2.10.1`
- Create: `.gitleaks.toml`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/security.yml`
- Create: `.github/workflows/release-evidence.yml`
- Create: `docs/operations/release.md`

**Interfaces:**
- Produces deterministic CI/release evidence; no production secrets required.

- [ ] **Step 1: Add local security commands**

Required release commands:
```bash
uv run pip-audit
npm audit --audit-level=high
syft dir:. -o cyclonedx-json=artifacts/sbom.cdx.json
gitleaks detect --source . --redact --no-banner
```
Pin Syft CLI `1.51.0` and Gitleaks CLI/action major/version in release tooling; do not use floating `latest` in release workflow.

- [ ] **Step 2: Create CI workflow**

`ci.yml` runs on pull request/push and includes PostgreSQL 18 service, Python 3.14.7 setup, Node 24.20.0 setup, uv/npm install, Python tests, Ruff, Pyright, JS typecheck/unit/build, Playwright critical E2E, and foundational conformance profile. Cache only dependency caches; do not cache runtime database/artifact secrets.

- [ ] **Step 3: Create security workflow**

`security.yml` runs `pypa/gh-action-pip-audit@v1.1.0` or exact audited action commit, `npm audit`, `gitleaks/gitleaks-action@v3` pinned to a reviewed commit for release branches, and SBOM generation with Syft 1.51.0. Fail high/critical dependency vulnerabilities unless an explicit time-bounded reviewed exception file names advisory, rationale, owner, and expiry.

- [ ] **Step 4: Create safe release-evidence workflow**

Produce only:
```text
source commit
lockfile digests
SBOM
conformance evidence JSON
unit/integration summaries
threat-model version
protocol reference versions
```
Artifact packaging scans files for registered PTF canaries/private-key markers before upload and fails if found.

- [ ] **Step 5: Run local equivalents**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest -q
uv run ruff check .
uv run pyright
npm ci
npm run typecheck
npm run test:js
npm run build:js
uv run pip-audit
npm audit --audit-level=high
```
Expected: all exit 0, subject only to documented dependency-service availability for vulnerability feeds.

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml uv.lock .gitleaks.toml .github/workflows docs/operations/release.md
git commit -m "ci: add PTF conformance and supply-chain gates"
```

---

### Task 10: Record external interoperability evidence and enforce truthful release claims

**Files:**
- Create: `docs/conformance/external/openid4vp.md`
- Extend: `docs/conformance/README.md`
- Create: `tests/acceptance/test_release_claims.py`
- Create: `artifacts/release-evidence/manifest.json` at release time only

**Interfaces:**
- Produces the final v1 release decision/evidence manifest.

- [ ] **Step 1: Run the current official OpenID Foundation OpenID4VP conformance programme for the reference wallet profile**

Use the OpenID Foundation conformance service’s current **OpenID4VP 1.0 + HAIP 1.0 Wallet** test plan, selecting the `dc+sd-jwt` variant matching the reference implementation. Record in `docs/conformance/external/openid4vp.md`:
```text
execution date
OIDF test-plan/profile name
PTF source commit
reference deployment version
credential format/variant
result PASS/FAIL
OIDF result/run identifier or exported report digest
known skipped/non-applicable tests
```
If the run is not performed or does not pass, release docs must say `OIDF external conformance: not demonstrated` or `failed`; local Plan 04 tests do not substitute for this result. Do not claim formal certification unless the separate OIDF self-certification process is actually completed and published.

- [ ] **Step 2: Record x402/AP2 reference interoperability evidence**

Run pinned x402 official SDK end-to-end fixture and AP2 upstream mandate/receipt fixture suites used by Plans 02–03. Record source versions/commits, exact PTF test IDs, and result digests. This is compatibility evidence, not third-party certification.

- [ ] **Step 3: Add release-copy guard tests**

`tests/acceptance/test_release_claims.py` scans README/docs/release metadata and fails if phrases such as `PTF conformant`, `OpenID certified`, `zero-knowledge`, `non-custodial`, `agent cannot access`, `operator cannot access`, or `cryptographically private` appear without an adjacent declared profile/evidence/TCB qualifier allowed by a reviewed claim registry.

- [ ] **Step 4: Build final release manifest**

`artifacts/release-evidence/manifest.json` contains:
```json
{
  "spec_blob": "32fc9bb6119142e10b854b09a95544c4ec25d1cc",
  "profile": "PTF-V1-FOUNDATION-1",
  "suite_version": "1",
  "source_commit": "<release commit>",
  "conformance_evidence_digest": "<sha256>",
  "sbom_digest": "<sha256>",
  "threat_model_digest": "<sha256>",
  "protocol_profiles": {
    "x402": "2.22.0",
    "ap2": "e1ea56db72a6385bce3e5c1112b3a56ce60acb43",
    "openid4vp": "1.0 Final"
  }
}
```
The release command fills only the two `<...>` values from deterministic command output; no human-entered security result is accepted without linked evidence.

- [ ] **Step 5: Run the complete v1 release gate**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest -q
uv run ruff check .
uv run pyright
npm ci
npm run typecheck
npm run test:js
npm run build:js
npx playwright test
uv run pip-audit
npm audit --audit-level=high
gitleaks detect --source . --redact --no-banner
syft dir:. -o cyclonedx-json=artifacts/sbom.cdx.json
uv run ptf-conformance run --profile tests/conformance/fixtures/profile-foundation-v1.json --output artifacts/conformance/foundation.json
```
Expected: all applicable gates pass; external OIDF result is reported separately and truthfully.

- [ ] **Step 6: Independent security/release review**

Reviewer checks all 28 foundational acceptance gates in the approved spec against executable evidence, verifies no protocol/demo became the product boundary, validates TCB/Assurance Manifest claims, confirms import/recovery do not broaden trust/TCB, and validates release-copy qualifiers.

- [ ] **Step 7: Commit release-gate code/docs (not transient release artifacts unless repository policy says to version them)**

```bash
git add docs/conformance tests/acceptance/test_release_claims.py
git commit -m "test(release): enforce truthful PTF v1 conformance claims"
```

---

## Plan 06 completion gate

PTF v1 implementation is eligible for release review only when all of the following are evidenced:

1. every mandatory oracle ID executes in the versioned foundational profile;
2. the locked authorization regression corpus shows no unexplained authority broadening;
3. x402/AP2/OpenID4VP protocol packs pass against public PTF seams;
4. Portable State export contains no protected raw resource and import does not auto-trust source bindings;
5. non-exportable resources require re-enrollment/provider recovery rather than secret copying;
6. multi-device revocation blocks the revoked device before consequential commit;
7. recovery does not broaden TCB/plaintext/usable-key authority without separate deliberate approval;
8. AI0 verification works and AI1, if claimed, has actual external witness evidence;
9. Trusted Surface implements export/import inspection/commit and recovery review without exposing them to Agent SDK;
10. migration/strategy changes replay the locked authorization corpus;
11. full threat model maps implemented mitigations to executable tests and states residual risks;
12. dependency audit, secret scan, SBOM, CI, Python/JS/E2E/conformance suites pass;
13. external OpenID4VP conformance status is represented exactly, with no certification claim unless actually certified;
14. release copy cannot make unqualified privacy/custody/conformance claims;
15. all 28 foundational acceptance gates in the approved specification have concrete evidence;
16. the mandatory pre-rewrite legacy tag/history preservation gate remains satisfied in repository history.

Only after this gate and an independent final review may the implementation be described as the PTF v1 reference implementation for its declared conformance profile.