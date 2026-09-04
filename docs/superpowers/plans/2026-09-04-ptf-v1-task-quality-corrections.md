# PTF v1 Task-Quality Corrections — Confirmed C10 Defects

Status: **BINDING PLANNING CORRECTIONS; PLAN SET STILL REOPENED**

This document repairs confirmed task-quality defects discovered after the initial September 4 audit. It does not modify the approved specification. It is read after the plan-readiness addendum and task-review protocol, and before the older plan-set contract/subsystem plans.

## C10 interpretation without weakening the gate

The following existing plan material counts toward C10 only under these rules:

1. An explicit assertion table/list counts as the red-test fixture only when it names deterministic expected outcomes and the task names the test file that will encode them.
2. An `Interfaces` block counts as minimal implementation shape only when it gives a concrete callable/model signature or an exact external behavior contract. A list of class names alone is insufficient.
3. A test-only/review-only/dependency-verification task may be marked `verification_only: true`; it then uses an exact failing/precondition predicate rather than fabricating a behavioral TDD failure.
4. Every task inherits the reviewer gate from `2026-09-04-ptf-v1-task-review-protocol.md`.
5. A combined “implement and run” step is not a red command. Red evidence must be recorded before the implementation change for behavioral tasks.

---

## Plan 00 corrections

### 00/T1 — bootstrap red evidence

After the runtime/tool-version check and before creating `ptf_core`, run:

```bash
python3.14 -c "import ptf_core"
```

Expected: non-zero with `ModuleNotFoundError: No module named 'ptf_core'`.

The existing import test is then the green verification after workspace/package creation.

### 00/T6 — planning/Enforcement Map/Assurance task

The existing semantic-loss list and fingerprint-mutation dimensions are the required assertion fixtures. Materialize them as these tests before implementation:

```text
packages/ptf-core/tests/planning/test_enforcement_map.py
  test_every_source_constraint_has_enforcement_or_explicit_unenforceable
  test_unenforceable_without_approved_downgrade_fails_closed
  test_deleting_one_enforcement_entry_fails_validation

packages/ptf-core/tests/planning/test_plan_fingerprint.py
  test_each_approval_relevant_mutation_changes_plan_fingerprint

packages/ptf-core/tests/protected_resources/test_assurance_manifest.py
  test_assurance_manifest_is_typed_and_carried_by_execution_plan
```

Fingerprint mutation fixture must cover at least recipient/binding, amount/currency, Protected Resource ref, DisclosurePlan/representation, protocol route/operation, executor/profile, downgrade/residual risk, expiry, transaction binding, Enforcement Map, reservation/replay semantics, and Assurance Manifest. These dimensions come from approved Sections 9–13; adding protocol-specific authority fields is forbidden.

Red command, before creating planning/protected-resource implementation modules:

```bash
uv run pytest \
  packages/ptf-core/tests/planning/test_enforcement_map.py \
  packages/ptf-core/tests/planning/test_plan_fingerprint.py \
  packages/ptf-core/tests/protected_resources/test_assurance_manifest.py -q
```

Expected: non-zero due missing target modules/types/functions.

Minimal implementation shape remains protocol-neutral:

```python
class DisclosurePlan(FrozenModel): ...
class EnforcementMap(FrozenModel): ...
class AssuranceManifest(FrozenModel): ...
class ExecutionPlan(FrozenModel): ...

def plan_fingerprint(plan: ExecutionPlan) -> str: ...

def validate_execution_plan(
    plan: ExecutionPlan,
    source_constraints: tuple[object, ...],
) -> None: ...
```

`ExecutionPlan` must capture the approval/security-relevant semantic categories listed in approved Section 10; `AssuranceManifest` must capture the normative semantic categories in Section 13.1. The implementation is not allowed to replace those categories with a generic score or arbitrary payload dict.

Green command remains the existing planning/protected-resource pytest command.

### 00/T7 — AuditEvent/PTFReceipt

Required tests before implementation:

```text
packages/ptf-core/tests/audit/test_receipt.py
  test_receipt_explains_all_normative_safe_semantics
  test_receipt_has_no_arbitrary_raw_payload_field
  test_receipt_schema_rejects_known_protected_value_fields
```

The first test constructs a receipt containing typed/safe representations of: authority basis; Agent/delegation provenance; action/recipient; plan fingerprint; Enforcement Map summary/reference; Protected Executor/profile; protocol; safe external evidence refs; result; aggregate accounting result; Assurance Manifest; downgrade/residual risk; and timestamps. This is the approved Section 18 semantic set.

Red command:

```bash
uv run pytest packages/ptf-core/tests/audit/test_receipt.py -q
```

Expected: non-zero because audit models do not yet exist.

Minimal implementation shape:

```python
class AuditEvent(FrozenModel): ...
class PTFReceipt(FrozenModel): ...
class ExecutionOutcome(StrEnum): ...
```

`AuditEvent` and `PTFReceipt` may contain typed safe summaries/references only; they must not expose generic arbitrary payload dictionaries or raw protected values.

Green command remains the same pytest command and must exit 0.

---

## Plan 01 inserted-task commit boundaries

The readiness addendum already corrects C5/C6/C4 interfaces, red/green commands, and test fixture ownership. Add these commit boundaries:

### 01/T6A Personal State repository

```bash
git add packages/ptf-postgres/src/ptf_postgres/personal_state_repository.py \
        packages/ptf-postgres/tests/test_personal_state_repository.py
git commit -m "feat(postgres): persist correctable personal state"
```

### 01/T6B Protected Resource Catalog

```bash
git add packages/ptf-postgres/src/ptf_postgres/resource_repository.py \
        packages/ptf-postgres/tests/test_resource_repository.py
git commit -m "feat(postgres): add safe protected resource catalog"
```

### 01/T6C task-scoped Safe View

Required files are additionally frozen as:

```text
packages/ptf-runtime/src/ptf_runtime/safe_view.py
packages/ptf-runtime/tests/test_safe_view.py
packages/ptf-runtime/tests/fixtures/safe_view.py
```

The public `ActionRuntime.get_safe_view(...)` method is wired in the later ActionRuntime task; the inserted task owns the typed values, derivation service/port, and tests.

Commit:

```bash
git add packages/ptf-runtime/src/ptf_runtime/safe_view.py \
        packages/ptf-runtime/tests/test_safe_view.py \
        packages/ptf-runtime/tests/fixtures/safe_view.py
git commit -m "feat(runtime): derive task-scoped agent safe views"
```

---

## Protocol-plan red-command corrections

The assertion lists already present in the named tasks are binding test fixtures under the C10 interpretation above. Add the following red commands before implementation.

### 02/T1 x402 package bootstrap

```bash
uv run python -c "import ptf_x402, ptf_x402_wallet"
```

Expected: non-zero import failure before package creation.

### 02/T3 x402 Enforcement Map

```bash
uv run pytest adapters/x402/tests/test_enforcement.py -q
```

Expected: non-zero before `enforcement.py` exists. The existing `build_x402_enforcement_map(...)` signature is the minimal implementation shape.

### 02/T4 protected x402 wallet executor

```bash
uv run pytest executors/x402-wallet/tests/test_executor.py tests/integration/test_x402_leak_canary.py -q
```

Expected: non-zero before the executor exists. The existing `X402WalletExecutor.create_payment_artifact(...)` signature is the minimal implementation shape.

### 03/T2 AP2 package bootstrap

```bash
uv run python -c "import ptf_ap2, ptf_ap2_signing"
```

Expected: non-zero import failure before package creation.

### 03/T3 AP2 mandate mapping

```bash
uv run pytest adapters/ap2/tests/test_mapping.py -q
```

Expected: non-zero before mapping implementation exists. Existing `build_open_payment_mandate(...)` and `build_closed_payment_mandate(...)` signatures are the minimal implementation shape.

### 03/T4 AP2 Enforcement Map

```bash
uv run pytest adapters/ap2/tests/test_enforcement.py -q
```

Expected: non-zero before `enforcement.py` exists. Existing `build_ap2_enforcement_map(...)` signature is the minimal implementation shape.

### 04/T1 OpenID4VP package bootstrap

```bash
uv run python -c "import ptf_openid4vp, ptf_openid4vp_wallet"
```

Expected: non-zero import failure before package creation.

### 04/T2 verifier request normalization

```bash
uv run pytest adapters/openid4vp/tests/test_request.py -q
```

Expected: non-zero before request models/normalizer exist. Existing `normalize_authorization_request(...)` signature is the minimal implementation shape.

### 04/T3 DCQL interpretation/minimization

```bash
uv run pytest adapters/openid4vp/tests/test_dcql.py -q
```

Expected: non-zero before DCQL implementation exists. Existing `interpret_dcql_request(...)` and `build_minimized_disclosure_plan(...)` signatures are the minimal implementation shape.

### 04/T4 OpenID4VP Enforcement Map

```bash
uv run pytest adapters/openid4vp/tests/test_enforcement.py -q
```

Expected: non-zero before `enforcement.py` exists. Existing `build_openid4vp_enforcement_map(...)` signature is the minimal implementation shape.

---

## Plan 05 product red-command corrections

### 05/T1 Node/TypeScript bootstrap

This is a bootstrap task. Before creating `.nvmrc`/`package.json`, record:

```bash
test -f package.json
```

Expected: non-zero on the documentation-only rewrite base.

Green remains `npm ci && npm run typecheck` after package creation.

### 05/T2 separate OpenAPI documents

The route-partition assertions already specified are the red-test fixture. Run before creating `ptf_api/openapi.py`:

```bash
uv run pytest packages/ptf-api/tests/test_openapi_surfaces.py -q
```

Expected: non-zero because the split schema generator does not exist.

Existing `agent_openapi_schema(app) -> dict` and `principal_openapi_schema(app) -> dict` are the minimal implementation shape.

### 05/T3 narrow Agent SDK

After generating the Agent-only type file and writing the public-surface test, but before creating `PtfClient`, run:

```bash
npm --workspace sdk/typescript test
```

Expected: non-zero because the client implementation is absent.

The corrected client contract is the task-scoped Safe View version from Contract C4:

```typescript
export interface PtfAgentClient {
  getSafeView(input: SafeViewRequest): Promise<SafeViewResponse>;
  requestAction(input: AgentActionRequest): Promise<PreparedActionResponse>;
  selectPlan(actionId: string, input: AgentPlanSelection): Promise<PreparedActionResponse>;
  getAction(actionId: string): Promise<PreparedActionResponse>;
  getReceipt(actionId: string): Promise<PtfReceiptResponse>;
}
```

### 05/T4 Principal WebAuthn authorization

Write the mutation/assurance tests before `principal_authorization.py`, then run:

```bash
uv run pytest packages/ptf-api/tests/test_principal_authorization.py -q
```

Expected: non-zero before authorization service exists.

The implementation must use Contract C3 target-generic `ApprovalEvidence` and must not retain the superseded `plan_fingerprint` field on ApprovalEvidence.

---

## Plan 06 sequencing and C10 corrections

### 06/T2 is split by ownership, not by product semantics

The original title “Implement every mandatory foundational conformance oracle” is misleading because these mandatory oracles depend on behavior not implemented until later Plan 06 tasks:

```text
PORTABILITY-IMPORT-NO-TRUST-ESCALATION -> Task 4
RECOVERY-TCB-NO-BROADENING             -> Task 5
MIGRATION-NO-SILENT-BROADENING         -> Task 8
```

Task 2 therefore becomes:

**“Register the complete mandatory oracle set, lock the authorization corpus, and implement all dependency-ready foundational oracles.”**

Task 2 must register all stable oracle IDs immediately, but the three IDs above are declared `PENDING_IMPLEMENTATION` in internal test registration until their owning tasks replace them with real black-box implementations. A conformance evidence artifact MUST treat any required pending oracle as non-PASS; no foundational conformance claim is possible yet.

Task 4 green gate includes implementation/passing tests for `PORTABILITY-IMPORT-NO-TRUST-ESCALATION`.

Task 5 green gate includes implementation/passing tests for `RECOVERY-TCB-NO-BROADENING`.

Task 8 green gate includes implementation/passing tests for `MIGRATION-NO-SILENT-BROADENING`.

The full `PTF-V1-FOUNDATION-1` profile runs only after all three owners are complete.

### 06/T2 minimal oracle shape and red command

Add protocol-neutral oracle seam:

```python
class ConformanceTarget(Protocol):
    def request_action(self, request: dict[str, object]) -> dict[str, object]: ...
    def get_action(self, action_id: str) -> dict[str, object]: ...
    def get_receipt(self, action_id: str) -> dict[str, object]: ...

class Oracle(Protocol):
    oracle_id: str
    def run(self, *, target: ConformanceTarget, fixture: object) -> OracleResult: ...
```

This is a harness seam only. It is not canonical authority and may be implemented as an HTTP/runtime public-seam client.

Before implementing oracle modules, run:

```bash
uv run pytest tests/conformance/test_foundation_profile.py -q
```

Expected: non-zero because required oracle registrations/implementations are absent.

Task 2 green command is:

```bash
uv run pytest packages/ptf-conformance/tests tests/conformance/test_foundation_profile.py -q
```

Expected: unit/registration tests pass while the profile itself still refuses an overall PASS if a required oracle remains pending. The task must not write a passing foundational conformance evidence artifact.

### 06/T3 protocol-specific conformance packs

The existing scenario lists are the assertion fixtures. Before creating the three protocol test modules, run:

```bash
uv run pytest \
  tests/conformance/test_x402_profile.py \
  tests/conformance/test_ap2_profile.py \
  tests/conformance/test_openid4vp_profile.py -q
```

Expected: non-zero because the test modules do not exist.

This task is test-only: its implementation shape is exactly the three named modules driving the already accepted public Plan 02–04 flows. It introduces no new production callable or authority type.

---

## Matrix implications

After this document is applied:

- reviewer-gate cells inherit `P` from the task-review protocol;
- confirmed red-command/implementation-shape failures corrected above may be changed to `P` after re-reading the exact task plus this correction;
- Plan 06 Task 2 remains non-release evidence until Tasks 4/5/8 complete their owned oracles;
- any `R` cell in the matrix still requires a fresh task-specific audit and cannot be promoted by assumption.

The plan set remains **NOT READY FOR SOURCE EXECUTION** until the matrix is fully re-audited and every row is PASS, and until the preservation baseline decision is closed.