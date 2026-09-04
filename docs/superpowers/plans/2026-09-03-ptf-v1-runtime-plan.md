# PTF v1 Runtime and Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the durable PTF authority runtime on top of Plan 00, including authenticated actors, deployment-authoritative trust state, CP2 aggregate authority, exact approval binding, execution revalidation/reconciliation, privacy-safe audit, and narrow Agent/Principal HTTP seams.

**Architecture:** `ptf-runtime` is a deep orchestration module over pure `ptf-core` semantics. `ptf-postgres` owns durable state and transactional coordination; `ptf-api` exposes separate trust-level surfaces and never becomes an authority engine. This plan intentionally does not define a generic `ProtocolAdapter` interface: x402 and AP2 will integrate concretely in Plans 02 and 03, then a common seam may be extracted only after both exist.

**Tech Stack:** Python 3.14.7; uv; Pydantic 2.x; PostgreSQL 18.x; psycopg 3.3.x; FastAPI 0.141.x; cryptography 50.x; pytest; Hypothesis; Ruff; Pyright.

**Spec:** `docs/spec/PTF-V1-PROPOSED.md`, exact approved blob recorded by `docs/spec/PTF-V1-APPROVAL.md`. Primary sections: 7–14, 17–18, 20, 22, 24, 28.

## Global Constraints

- Execute only after Plan 00 passes and the roadmap preservation/tag preflight is complete.
- Preserve Plan 00 public names: `ActionRequest`, `HardPolicy`, `StandingGrant`, `TrustSnapshot`, `AuthorizationDecision`, `ExecutionPlan`, `PTFReceipt`, `ExecutionOutcome`, `plan_fingerprint`, `validate_execution_plan`.
- PostgreSQL is authoritative for CP2 and Trust Registry state in this reference profile; security decisions do not use stale replicas in Plan 01.
- The Trust Registry epoch increases monotonically on each security-relevant binding/trust mutation.
- A caller-provided Subject ID, boolean, display name, or recipient label never proves authentication.
- Exact Human Approval is bound to the selected `ExecutionPlan` fingerprint and required assurance profile.
- Material plan mutation after approval invalidates the approval and execution authorization.
- Reservation and usable Execution Grant issuance are one atomic CP2 transaction.
- Execution revalidates policy, grant/approval basis, trust/bindings, resource state, revocation, expiry, reservation, and selected-plan fingerprint immediately before commit.
- `INDETERMINATE` is terminal for automatic execution; no blind retry endpoint exists.
- Agent-facing routes expose no Hard Policy mutation, Standing Grant activation/amendment, Trust Registry administration, approval recording, or generic protected-resource extraction.
- Audit/log/error/telemetry structures are allowlisted and contain no protected plaintext or arbitrary payload maps.
- No universal protocol adapter base class, registry, or generic adapter callback is created in this plan.
- Every task follows red-green-refactor and ends with a reviewable commit.

---

## File map

```text
packages/ptf-runtime/
├── pyproject.toml
├── src/ptf_runtime/
│   ├── __init__.py
│   ├── errors.py
│   ├── models.py                  # runtime lifecycle values only
│   ├── ports.py                   # persistence/auth/audit ports, not protocol adapters
│   ├── authentication.py          # signed request/challenge verification
│   ├── runtime.py                 # deep ActionRuntime public interface
│   └── audit.py                   # AI0 record/checkpoint orchestration
└── tests/
    ├── test_authentication.py
    ├── test_runtime.py
    └── test_audit.py
packages/ptf-postgres/
├── pyproject.toml
├── migrations/
│   ├── 0001_runtime_state.sql
│   └── 0002_audit_state.sql
├── src/ptf_postgres/
│   ├── __init__.py
│   ├── pool.py
│   ├── trust_repository.py
│   ├── authority_repository.py
│   ├── personal_state_repository.py
│   ├── resource_repository.py
│   ├── action_repository.py
│   ├── coordinator.py
│   └── audit_repository.py
└── tests/
    ├── test_trust_repository.py
    ├── test_authority_repository.py
    └── test_coordinator.py
packages/ptf-api/
├── pyproject.toml
├── src/ptf_api/
│   ├── __init__.py
│   ├── app.py
│   ├── dependencies.py
│   ├── schemas.py
│   └── routes/
│       ├── agent.py
│       └── principal.py
└── tests/
    ├── test_agent_routes.py
    └── test_principal_routes.py
executors/synthetic/
├── pyproject.toml
├── src/ptf_synthetic_executor/
│   ├── __init__.py
│   └── executor.py
└── tests/test_executor.py
tests/integration/
├── test_runtime_action_lifecycle.py
├── test_runtime_concurrency.py
├── test_runtime_revocation.py
└── test_runtime_leak_canary.py
```

---

### Task 1: Bootstrap runtime, PostgreSQL, API, and synthetic-executor packages

**Files:**
- Create: `packages/ptf-runtime/pyproject.toml`
- Create: `packages/ptf-postgres/pyproject.toml`
- Create: `packages/ptf-api/pyproject.toml`
- Create: `executors/synthetic/pyproject.toml`
- Create package `__init__.py` files and import tests.
- Modify: root `pyproject.toml` only to add test markers required below.

**Interfaces:**
- Consumes: `ptf-core` from Plan 00.
- Produces importable `ptf_runtime`, `ptf_postgres`, `ptf_api`, `ptf_synthetic_executor` packages.

- [ ] **Step 1: Write failing import tests**

Create `packages/ptf-runtime/tests/test_import.py`:
```python
def test_runtime_imports() -> None:
    import ptf_runtime

    assert ptf_runtime.__all__ == []
```
Create equivalent tests for the other three packages.

- [ ] **Step 2: Run the import tests and verify red state**

Run:
```bash
uv run pytest packages/ptf-runtime/tests/test_import.py packages/ptf-postgres/tests/test_import.py packages/ptf-api/tests/test_import.py executors/synthetic/tests/test_import.py -q
```
Expected: FAIL because packages do not exist.

- [ ] **Step 3: Create package metadata**

`packages/ptf-runtime/pyproject.toml`:
```toml
[project]
name = "ptf-runtime"
version = "0.1.0"
requires-python = ">=3.14,<3.15"
dependencies = [
  "ptf-core",
  "cryptography>=50,<51",
]

[tool.uv.sources]
ptf-core = { workspace = true }

[build-system]
requires = ["hatchling>=1.27,<2"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/ptf_runtime"]
```

`packages/ptf-postgres/pyproject.toml`:
```toml
[project]
name = "ptf-postgres"
version = "0.1.0"
requires-python = ">=3.14,<3.15"
dependencies = [
  "ptf-core",
  "ptf-runtime",
  "psycopg[binary,pool]>=3.3,<3.4",
]

[tool.uv.sources]
ptf-core = { workspace = true }
ptf-runtime = { workspace = true }

[build-system]
requires = ["hatchling>=1.27,<2"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/ptf_postgres"]
```

`packages/ptf-api/pyproject.toml`:
```toml
[project]
name = "ptf-api"
version = "0.1.0"
requires-python = ">=3.14,<3.15"
dependencies = [
  "ptf-core",
  "ptf-runtime",
  "fastapi>=0.141,<0.142",
  "uvicorn>=0.35,<0.36",
]

[tool.uv.sources]
ptf-core = { workspace = true }
ptf-runtime = { workspace = true }

[build-system]
requires = ["hatchling>=1.27,<2"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/ptf_api"]
```

`executors/synthetic/pyproject.toml`:
```toml
[project]
name = "ptf-synthetic-executor"
version = "0.1.0"
requires-python = ">=3.14,<3.15"
dependencies = ["ptf-core", "ptf-runtime"]

[tool.uv.sources]
ptf-core = { workspace = true }
ptf-runtime = { workspace = true }

[build-system]
requires = ["hatchling>=1.27,<2"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/ptf_synthetic_executor"]
```

- [ ] **Step 4: Sync, lock, and rerun imports**

```bash
uv sync --all-packages --all-groups
uv lock --check
uv run pytest packages/ptf-runtime/tests/test_import.py packages/ptf-postgres/tests/test_import.py packages/ptf-api/tests/test_import.py executors/synthetic/tests/test_import.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml uv.lock packages/ptf-runtime packages/ptf-postgres packages/ptf-api executors/synthetic
git commit -m "build: scaffold PTF runtime packages"
```

---

### Task 2: Define runtime lifecycle values and narrow persistence ports

**Files:**
- Create: `packages/ptf-runtime/src/ptf_runtime/models.py`
- Create: `packages/ptf-runtime/src/ptf_runtime/ports.py`
- Create: `packages/ptf-runtime/src/ptf_runtime/errors.py`
- Create: `packages/ptf-runtime/tests/test_runtime_models.py`

**Interfaces:**
- Produces: `AuthenticatedActor`, `ActorKind`, `PreparedAction`, `PreparedActionState`, `ApprovalEvidence`, `ExactApprovalRecord`, `ExecutionGrantRecord`, `ReservationRecord`, `RevalidationResult`, `ExternalExecutionResult`.
- Produces persistence ports: `StateReader`, `ActionStore`, `AuthorityCoordinator`, `AuditSink`.
- Does not define `ProtocolAdapter`, `AdapterRegistry`, or a generic protocol request/response type.

- [ ] **Step 1: Write the failing lifecycle-model tests**

Create tests asserting:
```python
from ptf_runtime.models import ActorKind, PreparedActionState


def test_runtime_states_are_explicit() -> None:
    assert {s.value for s in PreparedActionState} == {
        "PREPARED",
        "APPROVAL_REQUIRED",
        "AUTHORIZED",
        "EXECUTING",
        "CONSUMED",
        "RELEASED_NO_EFFECT",
        "INDETERMINATE",
        "DENIED",
        "EXPIRED",
        "REVOKED",
    }
    assert ActorKind.AGENT.value == "AGENT"
    assert ActorKind.PRINCIPAL.value == "PRINCIPAL"
```
Also assert all runtime values inherit `FrozenModel` and reject unknown fields.

- [ ] **Step 2: Run and verify failure**

```bash
uv run pytest packages/ptf-runtime/tests/test_runtime_models.py -q
```
Expected: import failure.

- [ ] **Step 3: Implement immutable runtime values**

Required shapes:
```python
class AuthenticatedActor(FrozenModel):
    subject_id: str
    actor_kind: ActorKind
    binding_id: str
    key_id: str
    authenticated_at: datetime
    assurance_profile: str

class ApprovalEvidence(FrozenModel):
    principal_id: str
    plan_fingerprint: str
    assurance_profile: str
    challenge_id: str
    authenticated_at: datetime
    expires_at: datetime

class ExternalExecutionResult(FrozenModel):
    outcome: ExecutionOutcome
    external_evidence_ref: str | None = None
    external_result_digest: str | None = None
    committed_at: datetime | None = None
```
`PreparedAction` must reference IDs/fingerprints and safe summaries, not raw protected values.

- [ ] **Step 4: Define deep ports with no protocol abstraction**

`ports.py` must expose only persistence/coordination/audit interfaces used by `ActionRuntime`. The authority transaction interface is:
```python
class AuthorityCoordinator(Protocol):
    def reserve_and_issue(
        self,
        *,
        prepared: PreparedAction,
        expected_grant_version: int | None,
        reservation_amount_minor: int | None,
        now: datetime,
    ) -> tuple[ReservationRecord | None, ExecutionGrantRecord]: ...

    def reconcile(
        self,
        *,
        execution_grant_id: str,
        outcome: ExecutionOutcome,
        now: datetime,
    ) -> ReservationRecord | None: ...
```
No callable for external protocol execution belongs in this port.

- [ ] **Step 5: Run model/type tests**

```bash
uv run pytest packages/ptf-runtime/tests/test_runtime_models.py -q
uv run pyright
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-runtime/src/ptf_runtime packages/ptf-runtime/tests
git commit -m "feat(runtime): define lifecycle and coordination seams"
```

---

### Task 3: Create durable PostgreSQL schema with class-specific state

**Files:**
- Create: `packages/ptf-postgres/migrations/0001_runtime_state.sql`
- Create: `packages/ptf-postgres/src/ptf_postgres/pool.py`
- Create: `packages/ptf-postgres/tests/test_schema.py`

**Interfaces:**
- Produces durable tables for Personal State, Security Configuration, Trust Registry, Protected Resource Catalog, Action/Plan/Approval state, and Usage/Reservation Ledger.
- Does not store reusable protected plaintext in the resource catalog.

- [ ] **Step 1: Write a schema acceptance test**

The test applies migration `0001_runtime_state.sql` to an isolated PostgreSQL 18 database and asserts these tables exist:
```text
ptf_registry_epoch
ptf_identity_bindings
ptf_endpoint_bindings
ptf_trust_relations
ptf_hard_policies
ptf_standing_grants
ptf_grant_usage
ptf_personal_observations
ptf_personal_claims
ptf_personal_preferences
ptf_protected_resources
ptf_actions
ptf_execution_plans
ptf_exact_approvals
ptf_reservations
ptf_execution_grants
ptf_request_nonces
```
Also query `information_schema.columns` and assert `ptf_protected_resources` has no columns named `secret`, `private_key`, `card_number`, `passport_number`, `refresh_token`, or `raw_credential`.

- [ ] **Step 2: Run the test and verify red state**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest packages/ptf-postgres/tests/test_schema.py -q
```
Expected: FAIL because migration/schema is absent.

- [ ] **Step 3: Implement the migration**

Use UUID/text identifiers generated by the application and `jsonb` only for canonical typed model serialization, never untyped arbitrary request payloads. Critical ledger tables must include:
```sql
CREATE TABLE ptf_grant_usage (
    grant_id text PRIMARY KEY,
    grant_version bigint NOT NULL,
    limit_amount_minor bigint,
    currency text,
    committed_amount_minor bigint NOT NULL DEFAULT 0 CHECK (committed_amount_minor >= 0),
    reserved_amount_minor bigint NOT NULL DEFAULT 0 CHECK (reserved_amount_minor >= 0),
    updated_at timestamptz NOT NULL
);

CREATE TABLE ptf_reservations (
    reservation_id text PRIMARY KEY,
    grant_id text NOT NULL,
    execution_grant_id text NOT NULL UNIQUE,
    amount_minor bigint,
    state text NOT NULL CHECK (state IN ('OUTSTANDING','COMMITTED','RELEASED','HELD_INDETERMINATE')),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
```
`ptf_registry_epoch` contains exactly one deployment row and a non-negative `epoch bigint`.

- [ ] **Step 4: Add migration idempotence guard**

A second application of the migration through the migration runner must report the migration as already applied rather than re-executing DDL. Do this with a `ptf_schema_migrations` table in `pool.py` runner code.

- [ ] **Step 5: Run schema tests**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest packages/ptf-postgres/tests/test_schema.py -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-postgres/migrations packages/ptf-postgres/src/ptf_postgres/pool.py packages/ptf-postgres/tests/test_schema.py
git commit -m "feat(postgres): add durable PTF runtime schema"
```

---

### Task 4: Implement Trust Registry epoching and cryptographic actor authentication

**Files:**
- Create: `packages/ptf-postgres/src/ptf_postgres/trust_repository.py`
- Create: `packages/ptf-runtime/src/ptf_runtime/authentication.py`
- Create: `packages/ptf-postgres/tests/test_trust_repository.py`
- Create: `packages/ptf-runtime/tests/test_authentication.py`

**Interfaces:**
- Produces: authoritative `TrustSnapshot` reads, monotonic epoch mutation, Ed25519 request authentication, nonce replay rejection.
- Consumes Plan 00 `IdentityBinding`, `EndpointBinding`, `TrustRelation`, `TrustSnapshot`.

- [ ] **Step 1: Write Trust Registry epoch tests**

Test sequence:
```python
e0 = repo.current_epoch()
repo.upsert_identity_binding(binding)
e1 = repo.current_epoch()
repo.upsert_trust_relation(relation)
e2 = repo.current_epoch()
assert e1 == e0 + 1
assert e2 == e1 + 1
assert repo.snapshot(...).registry_epoch == e2
```
Also verify importing a serialized `TrustRelation` is rejected until `upsert_trust_relation` is called through the authenticated admin path.

- [ ] **Step 2: Write signed-request tests**

Use an Ed25519 fixture key and canonical message:
```text
PTF-SIGNED-REQUEST\n<method>\n<path>\n<body_sha256>\n<unix_seconds>\n<nonce>
```
Assert valid signature authenticates the bound Agent Instance, a changed body/path fails, an unknown key fails, and replaying the same nonce fails.

- [ ] **Step 3: Implement `TrustRepository` and authentication verifier**

`verify_signed_request(...)` signature:
```python
def verify_signed_request(
    *,
    method: str,
    path: str,
    body: bytes,
    timestamp: datetime,
    nonce: str,
    subject_id: str,
    key_id: str,
    signature_b64url: str,
    trust_snapshot: TrustSnapshot,
    nonce_store: NonceStore,
    now: datetime,
    max_clock_skew_seconds: int = 120,
) -> AuthenticatedActor:
    ...
```
The verifier looks up a validated active key binding from `TrustSnapshot`; it never accepts a public key carried only by the request.

- [ ] **Step 4: Run tests**

```bash
uv run pytest packages/ptf-runtime/tests/test_authentication.py packages/ptf-postgres/tests/test_trust_repository.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ptf-runtime/src/ptf_runtime/authentication.py packages/ptf-runtime/tests/test_authentication.py packages/ptf-postgres/src/ptf_postgres/trust_repository.py packages/ptf-postgres/tests/test_trust_repository.py
git commit -m "feat(runtime): authenticate actors against epoch-bound trust state"
```

---

### Task 5: Persist Hard Policy and Standing Grant lifecycle outside Agent authority

**Files:**
- Create: `packages/ptf-postgres/src/ptf_postgres/authority_repository.py`
- Create: `packages/ptf-postgres/tests/test_authority_repository.py`

**Interfaces:**
- Produces durable policy/grant versions and lifecycle transitions.
- Consumes authenticated Principal/admin actor context from Task 4.

- [ ] **Step 1: Write lifecycle tests**

Verify:
- proposed grant is not returned by `list_active_grants`;
- activation requires canonical grant fingerprint + `ApprovalEvidence` meeting required AA profile;
- broadening amount/recipients/operations creates a new proposal/version and never mutates an active historical row;
- suspend/resume/revoke are distinct state transitions;
- a one-time exact approval never changes `ptf_standing_grants`;
- Hard Policy relaxation does not rewrite grants; tightening affects later runtime revalidation.

- [ ] **Step 2: Implement immutable historical version storage**

Public repository methods:
```python
propose_grant(principal: AuthenticatedActor, grant: StandingGrant) -> StandingGrant
activate_grant(principal: AuthenticatedActor, grant_id: str, version: int, approval: ApprovalEvidence) -> StandingGrant
suspend_grant(principal: AuthenticatedActor, grant_id: str, version: int) -> StandingGrant
resume_grant(principal: AuthenticatedActor, grant_id: str, version: int) -> StandingGrant
revoke_grant(principal: AuthenticatedActor, grant_id: str, version: int) -> StandingGrant
set_hard_policy(principal: AuthenticatedActor, policy: HardPolicy) -> HardPolicy
```
Every mutating method rejects `ActorKind.AGENT` before persistence.

- [ ] **Step 3: Run tests**

```bash
uv run pytest packages/ptf-postgres/tests/test_authority_repository.py -q
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ptf-postgres/src/ptf_postgres/authority_repository.py packages/ptf-postgres/tests/test_authority_repository.py
git commit -m "feat(postgres): persist policy and standing authority lifecycle"
```

---

### Task 6: Implement CP2 atomic reservation and usable Execution Grant issuance

**Files:**
- Create: `packages/ptf-postgres/src/ptf_postgres/coordinator.py`
- Create: `packages/ptf-postgres/tests/test_coordinator.py`
- Create: `tests/integration/test_runtime_concurrency.py`

**Interfaces:**
- Implements `AuthorityCoordinator.reserve_and_issue(...)` and `.reconcile(...)` from Task 2.
- Produces one usable `ExecutionGrantRecord` only when capacity/version/state checks win the transaction.

- [ ] **Step 1: Write the concurrency failure test**

Seed one active grant with limit `10_000` minor units and concurrently request three reservations of `4_000`. Assert exactly two succeed, one fails with typed `AuthorityCapacityExceeded`, and:
```python
usage = repo.get_usage(grant_id)
assert usage.committed_amount_minor + usage.reserved_amount_minor <= 10_000
assert usage.reserved_amount_minor == 8_000
```
Run the race at least 50 schedules using a thread/process barrier.

- [ ] **Step 2: Verify red state**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest tests/integration/test_runtime_concurrency.py -q
```
Expected: FAIL because coordinator is absent.

- [ ] **Step 3: Implement one serializable transaction**

The transaction must:
1. `SELECT ... FOR UPDATE` active grant/version and usage row;
2. verify grant state/expiry/version;
3. compute `committed + reserved + requested`;
4. insert reservation;
5. increment reserved usage;
6. insert usable Execution Grant bound to `prepared.plan_fingerprint`;
7. commit once.

No usable grant row may survive a losing/rolled-back transaction.

- [ ] **Step 4: Implement reconciliation semantics**

`CONSUMED`: move reservation amount from reserved to committed.  
`RELEASED_NO_EFFECT`: subtract from reserved and mark released.  
`INDETERMINATE`: keep capacity held as `HELD_INDETERMINATE`; do not release automatically.

- [ ] **Step 5: Run CP2 and property tests**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest packages/ptf-postgres/tests/test_coordinator.py tests/integration/test_runtime_concurrency.py -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-postgres/src/ptf_postgres/coordinator.py packages/ptf-postgres/tests/test_coordinator.py tests/integration/test_runtime_concurrency.py
git commit -m "feat(postgres): enforce CP2 atomic authority reservations"
```

---

### Task 7: Implement the deep `ActionRuntime` lifecycle and approval mutation oracle

**Files:**
- Create: `packages/ptf-runtime/src/ptf_runtime/runtime.py`
- Create: `packages/ptf-postgres/src/ptf_postgres/action_repository.py`
- Create: `packages/ptf-runtime/tests/test_runtime.py`
- Create: `tests/integration/test_runtime_action_lifecycle.py`
- Create: `tests/integration/test_runtime_revocation.py`

**Interfaces:**
- Produces the only orchestration interface needed by Plans 02–04:
```python
class ActionRuntime:
    def request_action(self, *, agent: AuthenticatedActor, request: ActionRequest, now: datetime) -> PreparedAction: ...
    def select_plan(self, *, agent: AuthenticatedActor, action_id: str, plan: ExecutionPlan, source_constraints: tuple[str, ...], now: datetime) -> PreparedAction: ...
    def record_exact_approval(self, *, principal: AuthenticatedActor, action_id: str, approval: ApprovalEvidence, now: datetime) -> PreparedAction: ...
    def authorize_execution(self, *, action_id: str, now: datetime) -> ExecutionGrantRecord: ...
    def revalidate_execution(self, *, execution_grant_id: str, now: datetime) -> RevalidationResult: ...
    def reconcile(self, *, execution_grant_id: str, result: ExternalExecutionResult, now: datetime) -> PTFReceipt: ...
```
- No method accepts a generic adapter/executor callback.

- [ ] **Step 1: Write end-to-end lifecycle tests through the public interface**

Cover:
- DENY request returns safe denied state with no execution grant;
- grant-covered request selects an enforceable plan and can authorize without exact approval only when Standing Grant terms independently cover it;
- approval-required request stays blocked until exact approval exists;
- approval fingerprint mismatch is rejected;
- selected-plan mutation after approval returns to `APPROVAL_REQUIRED` and invalidates prior approval;
- revoked grant between authorization and `revalidate_execution` causes fail-closed result;
- tightened policy between authorization and revalidation blocks commit;
- expired trust binding blocks commit.

- [ ] **Step 2: Verify red state**

```bash
uv run pytest packages/ptf-runtime/tests/test_runtime.py tests/integration/test_runtime_action_lifecycle.py tests/integration/test_runtime_revocation.py -q
```
Expected: FAIL because runtime is absent.

- [ ] **Step 3: Implement runtime sequencing**

`request_action` obtains an authoritative trust snapshot and durable policy/grants, then calls Plan 00 `resolve_preliminary`. `select_plan` calls `validate_execution_plan` and persists its exact fingerprint. `record_exact_approval` verifies Principal identity, assurance, fingerprint, challenge freshness, and single-use challenge. `authorize_execution` re-resolves authoritative state and calls CP2 `reserve_and_issue`. `revalidate_execution` performs all spec section 5 invariant checks again immediately before an external commit.

- [ ] **Step 4: Make `INDETERMINATE` non-retriable by construction**

If an execution grant has reconciled as `INDETERMINATE`, `authorize_execution` and `revalidate_execution` for that action/grant must raise `IndeterminateOutcomeRequiresReconciliation`. There is no automatic retry method.

- [ ] **Step 5: Run lifecycle suite**

```bash
uv run pytest packages/ptf-runtime/tests/test_runtime.py tests/integration/test_runtime_action_lifecycle.py tests/integration/test_runtime_revocation.py -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-runtime/src/ptf_runtime/runtime.py packages/ptf-runtime/tests/test_runtime.py packages/ptf-postgres/src/ptf_postgres/action_repository.py tests/integration/test_runtime_action_lifecycle.py tests/integration/test_runtime_revocation.py
git commit -m "feat(runtime): orchestrate plan-bound authority lifecycle"
```

---

### Task 8: Add a truthful synthetic Protected Executor and leak-canary profile

**Files:**
- Create: `executors/synthetic/src/ptf_synthetic_executor/executor.py`
- Create: `executors/synthetic/tests/test_executor.py`
- Create: `tests/integration/test_runtime_leak_canary.py`

**Interfaces:**
- Produces concrete `SyntheticProtectedExecutor.execute_token_use(...)` for Plan 01 tests only.
- Consumes `ExecutionGrantRecord`, `ExecutionPlan`, and a protected token held only inside the executor instance.
- Returns `ExternalExecutionResult` and safe artifact/evidence references; never returns the token.

- [ ] **Step 1: Write the canary test**

Use protected token `PTF_CANARY_RUNTIME_SECRET_71B3` and assert it is absent from:
- Agent safe status serialization;
- `PreparedAction` serialization;
- `ExecutionGrantRecord` serialization;
- `ExternalExecutionResult` serialization;
- `PTFReceipt` serialization;
- captured structured logs and exception strings.

- [ ] **Step 2: Implement bounded synthetic use**

`SyntheticProtectedExecutor` accepts the secret only at construction and exposes:
```python
def execute_token_use(
    self,
    *,
    execution_grant: ExecutionGrantRecord,
    plan: ExecutionPlan,
    recipient_binding_id: str,
) -> ExternalExecutionResult:
    ...
```
It verifies the grant plan fingerprint, expected recipient binding, state/expiry, and returns only a digest/reference indicating the synthetic effect.

- [ ] **Step 3: Emit a truthful Assurance Manifest fixture**

The profile must explicitly state that the synthetic executor process and reference runtime can observe plaintext, while the Agent/model cannot through controlled Agent surfaces. Do not claim operator non-possession.

- [ ] **Step 4: Run leak tests**

```bash
uv run pytest executors/synthetic/tests/test_executor.py tests/integration/test_runtime_leak_canary.py -q
```
Expected: PASS and no canary in captured output.

- [ ] **Step 5: Commit**

```bash
git add executors/synthetic tests/integration/test_runtime_leak_canary.py
git commit -m "feat(executor): add bounded synthetic protected execution"
```

---

### Task 9: Implement AI0 durable audit chain and signed checkpoints

**Files:**
- Create: `packages/ptf-postgres/migrations/0002_audit_state.sql`
- Create: `packages/ptf-postgres/src/ptf_postgres/audit_repository.py`
- Create: `packages/ptf-runtime/src/ptf_runtime/audit.py`
- Create: `packages/ptf-runtime/tests/test_audit.py`

**Interfaces:**
- Implements `AuditSink`.
- Produces `append_event(event)`, `create_checkpoint()`, and `verify_history()` through a narrow audit module.

- [ ] **Step 1: Write tamper/reorder/deletion tests**

Append three allowlisted `AuditEvent`s, create a signed checkpoint, verify clean history, then in isolated database copies mutate an event, delete an event, and reorder sequence numbers. `verify_history()` must fail each case.

- [ ] **Step 2: Implement AI0 storage**

Store ordered event digest chain and signed checkpoint metadata. Sign checkpoints with a deployment audit Ed25519 key loaded through an injected key provider. Audit payload schema contains typed event fields only; no `dict[str, Any]` arbitrary payload.

- [ ] **Step 3: Test residual-risk metadata**

AI0 Assurance Manifest/audit status must explicitly say that compromise of both local storage and deployment audit signing key can permit reconstructed future history. The verifier reports this as residual risk rather than claiming external immutability.

- [ ] **Step 4: Run audit tests**

```bash
uv run pytest packages/ptf-runtime/tests/test_audit.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ptf-postgres/migrations/0002_audit_state.sql packages/ptf-postgres/src/ptf_postgres/audit_repository.py packages/ptf-runtime/src/ptf_runtime/audit.py packages/ptf-runtime/tests/test_audit.py
git commit -m "feat(audit): implement AI0 tamper-evident audit"
```

---

### Task 10: Expose separate Agent and Principal FastAPI trust-level seams

**Files:**
- Create: `packages/ptf-api/src/ptf_api/schemas.py`
- Create: `packages/ptf-api/src/ptf_api/dependencies.py`
- Create: `packages/ptf-api/src/ptf_api/routes/agent.py`
- Create: `packages/ptf-api/src/ptf_api/routes/principal.py`
- Create: `packages/ptf-api/src/ptf_api/app.py`
- Create: `packages/ptf-api/tests/test_agent_routes.py`
- Create: `packages/ptf-api/tests/test_principal_routes.py`

**Interfaces:**
- Agent API exposes only action request/safe view/status/receipt reads.
- Principal API exposes exact approval and policy/grant lifecycle controls behind Principal authentication.

- [ ] **Step 1: Write route-surface tests before app creation**

Agent routes must be exactly:
```text
POST /v1/agent/actions
PUT  /v1/agent/actions/{action_id}/plan
GET  /v1/agent/actions/{action_id}
GET  /v1/agent/actions/{action_id}/receipt
GET  /v1/agent/safe-view
```
Principal routes in Plan 01:
```text
POST /v1/principal/actions/{action_id}/approve
POST /v1/principal/grants
POST /v1/principal/grants/{grant_id}/activate
POST /v1/principal/grants/{grant_id}/suspend
POST /v1/principal/grants/{grant_id}/resume
POST /v1/principal/grants/{grant_id}/revoke
PUT  /v1/principal/policy
```
Assert no Agent route contains `approve`, `policy`, `grant`, `trust`, `binding`, `secret`, `key`, or `resource/extract` administration.

- [ ] **Step 2: Implement signed-request dependencies**

Both routers use Task 4 request authentication. Principal routes additionally require `ActorKind.PRINCIPAL`. Do not accept actor identity from request JSON body.

- [ ] **Step 3: Keep API schemas safe by construction**

API response models are explicit Pydantic models containing safe status, IDs, plan/receipt summaries, and approval-required state. No endpoint returns database row dictionaries or arbitrary serialized core objects.

- [ ] **Step 4: Run API tests**

```bash
uv run pytest packages/ptf-api/tests -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ptf-api
git commit -m "feat(api): expose separated Agent and Principal surfaces"
```

---

### Task 11: Lock Plan 01 acceptance and architecture boundaries

**Files:**
- Create: `tests/acceptance/test_runtime_invariants.py`
- Create: `docs/threat-model/runtime-boundaries.md`

**Interfaces:**
- Consumes all Plan 01 public seams.
- Produces locked runtime acceptance evidence for Plans 02–04.

- [ ] **Step 1: Add acceptance cases**

The suite must include:
- signed Agent identity required;
- subject label substitution rejected;
- Trust Registry epoch advances and stale snapshot cannot commit;
- exact approval mutation rejection;
- no grant union after persistence round-trip;
- CP2 aggregate race safety;
- revocation/policy tightening before commit;
- `ProtectedResourceRef` alone cannot invoke synthetic executor;
- `INDETERMINATE` cannot auto-retry;
- Agent route inventory has no authority/trust administration;
- canary absent from Agent/API/audit/log/error outputs.

- [ ] **Step 2: Document the actual Plan 01 TCB**

`docs/threat-model/runtime-boundaries.md` must state which processes/keys/databases can observe which values, the fact that Plan 01 uses authoritative PostgreSQL reads with staleness profile `0`, and that synthetic executor/operator non-possession is not claimed.

- [ ] **Step 3: Run complete verification**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest -q
uv run ruff check .
uv run pyright
```
Expected: all exit 0.

- [ ] **Step 4: Scan for forbidden speculative adapter abstractions**

```bash
python - <<'PY'
from pathlib import Path
roots = [Path('packages/ptf-runtime/src'), Path('packages/ptf-postgres/src')]
for root in roots:
    for path in root.rglob('*.py'):
        text = path.read_text().lower()
        for forbidden in ('class protocoladapter', 'class adapterregistry', 'genericprotocoladapter'):
            assert forbidden not in text, (path, forbidden)
PY
```
Expected: exit 0.

- [ ] **Step 5: Independent review gate**

Reviewer must verify the `ActionRuntime` interface is deep and protocol-neutral, persistence mechanics are not leaked to callers, CP2 issuance is atomic, and tests exercise public seams rather than private helpers.

- [ ] **Step 6: Commit**

```bash
git add tests/acceptance/test_runtime_invariants.py docs/threat-model/runtime-boundaries.md
git commit -m "test: lock durable PTF runtime invariants"
```

---

## Plan 01 completion gate

Before Plan 02 or Plan 03 begins:

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest -q
uv run ruff check .
uv run pyright
```

must pass, and an independent reviewer must explicitly accept:

1. `ActionRuntime` as the stable core orchestration seam;
2. authoritative Trust Registry epoch/revalidation behavior;
3. cryptographic actor authentication and replay protection;
4. immutable/versioned policy/grant history;
5. atomic CP2 reservation + usable grant issuance;
6. exact plan/approval binding and mutation invalidation;
7. truthful synthetic Assurance Manifest and leak-canary evidence;
8. AI0 limitations/residual risk statement;
9. separate Agent and Principal route inventories;
10. absence of a speculative universal protocol-adapter abstraction.

Plans 02 and 03 may then proceed in isolated parallel worktrees against these accepted public seams.