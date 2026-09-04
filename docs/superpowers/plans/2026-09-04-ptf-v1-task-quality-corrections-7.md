# PTF v1 Task-Quality Corrections 7 — Plan 06 Conformance, Portability, Recovery, and Release

Status: **BINDING PLANNING CORRECTIONS; APPROVED SPEC UNCHANGED**

This document resolves the second-pass C10 and sequencing findings for Plan 06. Read after the readiness addendum, task-review protocol, and task-quality corrections 1–6, and before the original Plan 06 subsystem plan.

---

## Plan 06 correction summary

This correction makes four structural repairs:

1. splits the original premature `0003_portability_recovery.sql` into portability and recovery/device migrations owned by their actual tasks;
2. gives device enrollment/revocation a real backend before Principal routes/UI exist;
3. gives the three deferred foundational oracles exact owners/files and prevents a false early foundational PASS;
4. gives CI/release tasks exact verification/configuration surfaces and a concrete release-claim registry rather than later-chosen placeholders.

---

## 06/T1 — conformance package/evidence runner

No additional correction is required. The task already contains exact files, concrete public models, profile completeness assertions, red command, minimal runner/evidence behavior, green command, and commit boundary. It inherits the task-review protocol.

---

## 06/T2 — register every oracle, implement dependency-ready oracles only

Task-quality corrections 1 supersedes the original title and green claim.

Task 2 registers every mandatory foundational oracle ID, but these three remain explicitly pending until their owner task implements them:

```text
PORTABILITY-IMPORT-NO-TRUST-ESCALATION -> 06/T4
RECOVERY-TCB-NO-BROADENING             -> 06/T5
MIGRATION-NO-SILENT-BROADENING         -> 06/T8
```

A required pending oracle is never represented as `PASS`; the foundation runner must return overall `FAIL`/non-pass while any required oracle is pending.

The `ConformanceTarget` and `Oracle` public harness seams, red command, locked authorization corpus, and dependency-ready oracle tests are defined by task-quality corrections 1.

Task 2 MUST NOT create `artifacts/conformance/foundation.json` with `overall_status == "PASS"`.

---

## 06/T3 — protocol-specific conformance packs

Task-quality corrections 1 supplies the missing red command and establishes this as a test-only task over accepted Plan 02–04 public seams. No new canonical authority or generic protocol adapter interface is introduced.

No additional correction is required.

---

# 06/T4 — Portable State only; recovery persistence moves to T5

## Exact file correction

Replace:

```text
packages/ptf-postgres/migrations/0003_portability_recovery.sql
```

with:

```text
packages/ptf-postgres/migrations/0003_portability.sql
```

Task 4 exact files are:

```text
packages/ptf-runtime/src/ptf_runtime/portability.py
packages/ptf-postgres/migrations/0003_portability.sql
packages/ptf-postgres/src/ptf_postgres/portability_repository.py
packages/ptf-conformance/src/ptf_conformance/oracles/portability.py
packages/ptf-conformance/tests/test_portability_oracle.py
tests/integration/test_portability_roundtrip.py
tests/integration/test_import_trust_revalidation.py
```

## Public runtime seam

The original `PortableStatePackageV1` and `ImportResult` shapes remain binding. Add:

```python
class PortabilityService:
    def export_state(
        self,
        *,
        principal: AuthenticatedActor,
        now: datetime,
    ) -> PortableStatePackageV1: ...

    def inspect_import(
        self,
        *,
        principal: AuthenticatedActor,
        package: PortableStatePackageV1,
        now: datetime,
    ) -> ImportResult: ...

    def commit_import(
        self,
        *,
        principal: AuthenticatedActor,
        package: PortableStatePackageV1,
        inspected_digest: str,
        now: datetime,
    ) -> ImportResult: ...
```

`commit_import` rejects a package whose digest differs from the inspected package. Imported IdentityBinding/EndpointBinding/TrustRelation data remains inactive or explicitly `requires_revalidation`; an imported display name, source trust label, package signature, or source deployment status cannot create destination trust.

Usage/reservation ledger state is not blindly imported as available capacity.

## Red test/command

Write the original export leak, round-trip, and trust-escalation fixtures plus the portability oracle before implementation, then run:

```bash
PTF_TEST_DATABASE_URL="$PTF_TEST_DATABASE_URL" \
  uv run pytest \
    tests/integration/test_portability_roundtrip.py \
    tests/integration/test_import_trust_revalidation.py \
    packages/ptf-conformance/tests/test_portability_oracle.py -q
```

Expected: non-zero because the portability runtime/repository/oracle does not yet exist.

## Owned foundational oracle

Task 4 replaces the pending implementation for:

```text
PORTABILITY-IMPORT-NO-TRUST-ESCALATION
```

The oracle must exercise public portability + runtime seams and fail if imported trust/binding metadata can authorize or commit a consequential action before destination-side revalidation.

Green is the same pytest command and must exit 0.

## Commit

```bash
git add \
  packages/ptf-runtime/src/ptf_runtime/portability.py \
  packages/ptf-postgres/migrations/0003_portability.sql \
  packages/ptf-postgres/src/ptf_postgres/portability_repository.py \
  packages/ptf-conformance/src/ptf_conformance/oracles/portability.py \
  packages/ptf-conformance/tests/test_portability_oracle.py \
  tests/integration/test_portability_roundtrip.py \
  tests/integration/test_import_trust_revalidation.py
git commit -m "feat(portability): export and import PTF state safely"
```

---

# 06/T5 — real device backend plus non-broadening recovery

## Exact files

```text
packages/ptf-runtime/src/ptf_runtime/devices.py
packages/ptf-runtime/src/ptf_runtime/recovery.py
packages/ptf-runtime/src/ptf_runtime/sync.py
packages/ptf-postgres/migrations/0004_recovery_devices.sql
packages/ptf-postgres/src/ptf_postgres/device_repository.py
packages/ptf-postgres/src/ptf_postgres/recovery_repository.py
packages/ptf-conformance/src/ptf_conformance/oracles/recovery.py
packages/ptf-conformance/tests/test_recovery_oracle.py
tests/integration/test_multi_device_revocation.py
tests/integration/test_recovery_tcb.py
docs/operations/recovery.md
docs/operations/incident-revocation.md
```

## Device values

```python
class DeviceStatus(StrEnum):
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"

class DeviceEnrollment(FrozenModel):
    device_id: str
    principal_id: str
    identity_binding_id: str
    key_id: str
    assurance_profile: str
    enrolled_at: datetime
    status: DeviceStatus
    version: int

class DeviceEnrollmentChallenge(FrozenModel):
    challenge_id: str
    principal_id: str
    expected_binding_type: str
    required_assurance: str
    expires_at: datetime
```

These are security metadata only. No private key, authenticator secret, raw credential payload, arbitrary `trusted` boolean, or display label acts as enrollment evidence.

## Device module interface

```python
class DeviceService:
    def begin_enrollment(
        self,
        *,
        principal: AuthenticatedActor,
        required_assurance: str,
        now: datetime,
    ) -> DeviceEnrollmentChallenge: ...

    def complete_enrollment(
        self,
        *,
        principal: AuthenticatedActor,
        challenge_id: str,
        verified_binding: IdentityBinding,
        now: datetime,
    ) -> DeviceEnrollment: ...

    def list_devices(
        self,
        *,
        principal: AuthenticatedActor,
    ) -> tuple[DeviceEnrollment, ...]: ...

    def revoke_device(
        self,
        *,
        principal: AuthenticatedActor,
        device_id: str,
        expected_version: int,
        now: datetime,
    ) -> DeviceEnrollment: ...
```

`complete_enrollment` consumes only a binding that has already passed the configured reference enrollment ceremony and matches Principal + challenge. In the reference Trusted Surface, Task 7 uses server-verified WebAuthn registration to produce that binding; the core device module is not coupled to browser/WebAuthn transport.

`revoke_device` deactivates the device's usable authentication binding and increments the authoritative Trust Registry epoch in the same security mutation boundary. Authentication/revalidation through the revoked binding fails immediately at the authoritative runtime.

## Recovery module interface

The original `RecoveryPlan`, `RecoveryEvidence`, and `RecoveryResult` remain the recovery value types. Recovery plan generation/execution must explicitly compare pre-loss and proposed post-recovery Assurance Manifests. An increase in plaintext observers, usable-key invokers, operator/administrative domains, or authority scope requires a separate deliberate Principal authorization at the required assurance; it cannot be hidden inside recovery.

Non-exportable protected resources return `requires_reenrollment` or use their declared provider recovery path rather than copying secrets.

## Red test/command

Write the original two-device revocation/stale-snapshot/non-exportable-resource/TCB-broadening fixtures plus the recovery oracle, then run:

```bash
PTF_TEST_DATABASE_URL="$PTF_TEST_DATABASE_URL" \
  uv run pytest \
    tests/integration/test_multi_device_revocation.py \
    tests/integration/test_recovery_tcb.py \
    packages/ptf-conformance/tests/test_recovery_oracle.py -q
```

Expected: non-zero because device/recovery persistence and the oracle do not exist.

## Owned foundational oracle

Task 5 replaces the pending implementation for:

```text
RECOVERY-TCB-NO-BROADENING
```

The oracle exercises public/runtime recovery seams and fails any unapproved expansion of protected-plaintext observers, key invokers, administrative/operator domains, or authorization scope.

Green is the same pytest command and must exit 0.

## Commit

```bash
git add \
  packages/ptf-runtime/src/ptf_runtime/devices.py \
  packages/ptf-runtime/src/ptf_runtime/recovery.py \
  packages/ptf-runtime/src/ptf_runtime/sync.py \
  packages/ptf-postgres/migrations/0004_recovery_devices.sql \
  packages/ptf-postgres/src/ptf_postgres/device_repository.py \
  packages/ptf-postgres/src/ptf_postgres/recovery_repository.py \
  packages/ptf-conformance/src/ptf_conformance/oracles/recovery.py \
  packages/ptf-conformance/tests/test_recovery_oracle.py \
  tests/integration/test_multi_device_revocation.py \
  tests/integration/test_recovery_tcb.py \
  docs/operations/recovery.md \
  docs/operations/incident-revocation.md
git commit -m "feat(recovery): add revocable devices and non-broadening recovery"
```

---

## 06/T6 — AI1 witness red state and shape

Before extending audit composition, write the privacy and externally-witnessed rewrite tests, then run:

```bash
uv run pytest tests/integration/test_ai1_witness.py -q
```

Expected: non-zero because `AuditWitness`/AI1 composition is absent.

The original interface remains:

```python
class AuditWitness(Protocol):
    def witness_checkpoint(
        self,
        checkpoint_digest: str,
        sequence: int,
        created_at: datetime,
    ) -> WitnessReceipt: ...
```

`WitnessReceipt` contains only witness identity/reference, checkpoint digest, sequence, witnessed timestamp, and safe verification metadata. It contains no AuditEvent body or protected/user content.

AI0 remains usable without a witness; a profile that declares AI1 fails closed for an unwitnessed interval instead of silently relabelling AI0 as AI1.

Green is the same pytest command.

---

# 06/T7 — final Trusted Surface includes devices after T5 backend

## Exact files

```text
packages/ptf-api/src/ptf_api/routes/principal.py
packages/ptf-api/tests/test_principal_product_routes.py
apps/trusted-surface/src/pages/Portability.tsx
apps/trusted-surface/src/pages/Recovery.tsx
apps/trusted-surface/src/pages/Devices.tsx
tests/e2e/trusted-surface-portability.spec.ts
tests/e2e/trusted-surface-recovery.spec.ts
tests/e2e/trusted-surface-devices.spec.ts
artifacts/openapi/agent.json
sdk/typescript/src/generated/agent-api.d.ts
```

## Principal routes

Portability/recovery:

```text
POST /v1/principal/portability/export
POST /v1/principal/portability/import/inspect
POST /v1/principal/portability/import/commit
POST /v1/principal/recovery/plan
POST /v1/principal/recovery/execute
```

Devices, exactly as Contract C8 requires:

```text
GET  /v1/principal/devices
POST /v1/principal/devices/enroll
POST /v1/principal/devices/{device_id}/revoke
```

`POST /devices/enroll` uses a discriminated request body so the route can support the two phases without adding a hidden route:

```python
class BeginDeviceEnrollmentRequest(FrozenModel):
    phase: Literal["BEGIN"]
    required_assurance: str

class CompleteDeviceEnrollmentRequest(FrozenModel):
    phase: Literal["COMPLETE"]
    challenge_id: str
    webauthn_registration_response: dict[str, object]
```

`BEGIN` requires an already authenticated Principal and returns server-generated WebAuthn registration options bound to the `DeviceEnrollmentChallenge`. `COMPLETE` verifies the registration response server-side, creates/validates the new key IdentityBinding, then calls `DeviceService.complete_enrollment`. An arbitrary public key or display label cannot enroll a device.

## Required device E2E assertions

```text
existing Principal authentication is required to administer enrollment
new device is ACTIVE only after a verified registration ceremony
unverified key/display label cannot enroll
revocation is version checked and increments authoritative trust epoch
revoked device cannot authenticate or consequentially commit after revocation
another active device remains usable
Agent OpenAPI/SDK contains no device, portability, or recovery method
```

## Red command

Before adding Task 7 routes/pages, write all three E2E files and Principal route tests, then run:

```bash
uv run pytest packages/ptf-api/tests/test_principal_product_routes.py -q
npx playwright test \
  tests/e2e/trusted-surface-portability.spec.ts \
  tests/e2e/trusted-surface-recovery.spec.ts \
  tests/e2e/trusted-surface-devices.spec.ts
```

Expected: at least one command is non-zero because the Task 7 routes/pages are absent.

Green is the same pair of commands with both exiting 0, followed by the original Agent OpenAPI regeneration + Agent SDK test proving the five-method Agent surface is unchanged.

## Commit

```bash
git add \
  packages/ptf-api/src/ptf_api/routes/principal.py \
  packages/ptf-api/tests/test_principal_product_routes.py \
  apps/trusted-surface/src/pages/Portability.tsx \
  apps/trusted-surface/src/pages/Recovery.tsx \
  apps/trusted-surface/src/pages/Devices.tsx \
  tests/e2e/trusted-surface-portability.spec.ts \
  tests/e2e/trusted-surface-recovery.spec.ts \
  tests/e2e/trusted-surface-devices.spec.ts \
  artifacts/openapi/agent.json \
  sdk/typescript/src/generated/agent-api.d.ts
git commit -m "feat(product): add safe portability recovery and device controls"
```

---

# 06/T8 — migration/self-improvement oracle gets a real conformance implementation

## Exact files

```text
packages/ptf-conformance/src/ptf_conformance/oracles/migration.py
packages/ptf-conformance/tests/test_migration_oracle.py
tests/conformance/test_migrations.py
docs/threat-model/PTF-v1.md
docs/operations/migrations.md
```

## Oracle interface

Use the existing `Oracle`/`ConformanceTarget` seam. `MigrationNoSilentBroadeningOracle.oracle_id` is exactly:

```text
MIGRATION-NO-SILENT-BROADENING
```

Its fixture contains pre-migration state snapshot reference, locked authorization corpus version, migration set/version, post-migration target, and an optional reviewed change authorization ID.

A transition:

```text
DENY -> APPROVAL_REQUIRED
DENY -> AUTHORIZE
APPROVAL_REQUIRED -> AUTHORIZE
```

fails unless the fixture explicitly names a human-approved spec/policy change record authorizing that exact semantic change. A strategy/model/ranking change receives no exception merely because schema did not change.

## Red command

Write `test_migration_oracle.py` and `test_migrations.py` before oracle implementation, then run:

```bash
PTF_TEST_DATABASE_URL="$PTF_TEST_DATABASE_URL" \
  uv run pytest \
    packages/ptf-conformance/tests/test_migration_oracle.py \
    tests/conformance/test_migrations.py -q
```

Expected: non-zero because the migration oracle is absent.

## Owned foundational oracle

Task 8 replaces the pending implementation for `MIGRATION-NO-SILENT-BROADENING`. After T8 green, there must be no pending mandatory foundational oracle from T2.

Green is the same pytest command.

The threat model remains evidence-linked: each implemented mitigation names a concrete oracle/test; unsupported/residual properties are stated rather than inferred.

## Commit

```bash
git add \
  packages/ptf-conformance/src/ptf_conformance/oracles/migration.py \
  packages/ptf-conformance/tests/test_migration_oracle.py \
  tests/conformance/test_migrations.py \
  docs/threat-model/PTF-v1.md \
  docs/operations/migrations.md
git commit -m "test(security): block migration and learning authority broadening"
```

---

# 06/T9 — CI/supply-chain configuration is verification/configuration work

Task 9 is not a new domain-behavior task. Mark:

```text
verification_only: true
```

## Exact files

```text
pyproject.toml
uv.lock
.gitleaks.toml
.github/workflows/ci.yml
.github/workflows/security.yml
.github/workflows/release-evidence.yml
docs/operations/release.md
tests/acceptance/test_ci_configuration.py
```

## Frozen GitHub Action pins reviewed September 4, 2026

Use exact commit SHAs, not floating major tags:

```text
actions/checkout            fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09  # v5
actions/setup-python        ece7cb06caefa5fff74198d8649806c4678c61a1  # v6
actions/setup-node          a0853c24544627f65ddf259abe73b1d18a591444  # v5
pypa/gh-action-pip-audit    1220774d901786e6f652ae159f7b6bc8fea6d266  # v1.1.0
gitleaks/gitleaks-action    e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e  # v3
actions/upload-artifact     ea165f8d65b6e75b540449e92b4886f43607fa02  # v4
```

Syft remains exactly `1.51.0`; its upstream tag resolves to annotated tag object `57260929138ad516dd4999a5cc43b4a295d2461f`. Installation may use the reviewed release mechanism documented in `docs/operations/release.md`, but the executed binary must report exactly `syft 1.51.0` before SBOM generation.

No workflow `uses:` entry may use a mutable tag or branch.

## Configuration acceptance test

`tests/acceptance/test_ci_configuration.py` reads the three workflow files as text and asserts:

```text
all external action uses: values contain a full 40-hex commit SHA
only the frozen action repository+SHA pairs above are accepted
Python setup requests 3.14.7
Node setup requests 24.20.0
PostgreSQL service is 18
foundational conformance command is present
release evidence upload is preceded by canary/private-key-marker scan
high/critical dependency exception path requires advisory+rationale+owner+expiry
no workflow uploads database dumps, raw protocol artifacts, test credentials, or unrestricted workspace archives
```

Precondition before configuration files are created:

```bash
test ! -f .github/workflows/ci.yml && \
test ! -f .github/workflows/security.yml && \
test ! -f .github/workflows/release-evidence.yml
```

Green evidence:

```bash
uv run pytest tests/acceptance/test_ci_configuration.py -q
PTF_TEST_DATABASE_URL="$PTF_TEST_DATABASE_URL" uv run pytest -q
uv run ruff check .
uv run pyright
npm ci
npm run typecheck
npm run test:js
npm run build:js
uv run pip-audit
npm audit --audit-level=high
gitleaks detect --source . --redact --no-banner
syft version | grep '1.51.0'
```

A vulnerability-feed/network outage is recorded as a failed/unavailable release gate; it is not converted to success.

## Commit

```bash
git add \
  pyproject.toml uv.lock .gitleaks.toml \
  .github/workflows/ci.yml \
  .github/workflows/security.yml \
  .github/workflows/release-evidence.yml \
  docs/operations/release.md \
  tests/acceptance/test_ci_configuration.py
git commit -m "ci: add PTF conformance and supply-chain gates"
```

---

# 06/T10 — external evidence + truthful release claims with concrete claim registry

## Exact files

```text
docs/conformance/external/openid4vp.md
docs/conformance/README.md
docs/conformance/claim-registry.json
tests/acceptance/test_release_claims.py
artifacts/release-evidence/manifest.json    # release-time only; not required in source commit
```

## Claim registry

`docs/conformance/claim-registry.json` is versioned review data. Initial structure:

```json
{
  "registry_version": "1",
  "claims": {
    "PTF conformant": {
      "requires_profile": true,
      "requires_evidence_digest": true
    },
    "OpenID certified": {
      "requires_oidf_certification_record": true
    },
    "zero-knowledge": {
      "allowed": false
    },
    "non-custodial": {
      "requires_assurance_profile_qualifier": true
    },
    "agent cannot access": {
      "requires_surface_and_tcb_qualifier": true
    },
    "operator cannot access": {
      "requires_assurance_profile_qualifier": true
    },
    "cryptographically private": {
      "allowed": false
    }
  }
}
```

The claim test loads this registry. No undocumented phrase whitelist exists in test code.

## Red test/command

Before creating the registry/release docs, create `tests/acceptance/test_release_claims.py` so that it fails when the registry is missing or a controlled unqualified fixture contains one of the guarded claims. Run:

```bash
uv run pytest tests/acceptance/test_release_claims.py -q
```

Expected: non-zero before `claim-registry.json` exists.

Then implement the registry-backed scan and make all repository release copy conform to the registry.

Green:

```bash
uv run pytest tests/acceptance/test_release_claims.py -q
```

## External interoperability evidence

OpenID4VP external evidence records exactly one status:

```text
PASS
FAIL
NOT_RUN
```

If the official OpenID Foundation run is not performed, `docs/conformance/external/openid4vp.md` states `OIDF external conformance: not demonstrated`. Local tests never rewrite this to PASS.

A formal certification claim is allowed only if the separate OIDF certification/self-certification process has actually produced the required published record and that record is referenced by the claim registry/evidence.

x402/AP2 upstream compatibility runs record pinned source versions/commits and result digests and are labelled compatibility evidence, not certification.

## Release manifest semantics

The original manifest shape remains binding, but release generation additionally verifies:

```text
spec_blob equals approved blob
profile/suite identifiers match the generated ConformanceEvidence
source_commit equals release HEAD
conformance evidence overall_status is PASS
no mandatory oracle is pending/skip/fail
SBOM/threat-model/evidence digests are recomputed, not typed by a human
protocol profile strings equal the frozen reference profiles
```

Transient release artifacts are not committed unless repository release policy explicitly requires versioning them.

## Final release verification

The original complete Python/JS/E2E/security/SBOM/foundational-conformance command set remains binding, plus:

```bash
uv run pytest tests/acceptance/test_ci_configuration.py tests/acceptance/test_release_claims.py -q
```

Task 10 inherits the two-stage reviewer gate; its release review also explicitly rechecks all 28 foundational acceptance gates against executable evidence.

## Commit

```bash
git add \
  docs/conformance/external/openid4vp.md \
  docs/conformance/README.md \
  docs/conformance/claim-registry.json \
  tests/acceptance/test_release_claims.py
git commit -m "test(release): enforce truthful PTF v1 conformance claims"
```

---

## Plan 06 second-pass disposition

After applying this document and earlier corrections:

- Task 4 owns portability persistence/oracle only;
- Task 5 owns device/recovery persistence and recovery oracle;
- Task 7 exposes real device controls only after T5 exists;
- Task 8 closes the final pending mandatory foundational oracle;
- Task 9 contains no floating GitHub Action pin;
- Task 10 has a defined claim registry and permits truthful `NOT_RUN` external evidence without inventing certification.

All ten Plan 06 tasks now have an explicit C10 execution or verification path. Final PASS status is assigned only by the regenerated task-quality matrix and fresh cross-plan verification.