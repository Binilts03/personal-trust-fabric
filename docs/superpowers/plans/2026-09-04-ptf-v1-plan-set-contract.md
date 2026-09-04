# PTF v1 Plan-Set Execution Contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to execute the referenced subsystem plan task-by-task. This contract is mandatory alongside every subsystem plan.

**Goal:** Resolve the cross-plan inconsistencies found during the September 4, 2026 verification pass without changing the approved PTF v1 product semantics.

**Architecture:** The approved specification remains normative. This contract corrects implementation sequencing, cross-plan public types, task-scoped Safe View semantics, missing durable repositories, and product/backend dependency boundaries. Existing 2026-09-03 subsystem plans remain the detailed task maps except where this contract explicitly supersedes a statement, signature, dependency pin, route, or task order.

**Tech Stack:** Same as the subsystem plans, with the dependency convergence below applied from Plan 00 onward.

**Spec:** `docs/spec/PTF-V1-PROPOSED.md`, exact approved blob `32fc9bb6119142e10b854b09a95544c4ec25d1cc`, approved by `docs/spec/PTF-V1-APPROVAL.md`.

## Precedence

For implementation execution only:

1. platform/user instructions;
2. exact approved PTF v1 specification;
3. accepted ADRs;
4. this execution contract;
5. `2026-09-04-ptf-v1-execution-roadmap.md`;
6. the 2026-09-03 subsystem plans;
7. implementation defaults.

If a subsystem plan conflicts with this contract, this contract wins. This document MUST NOT be used to reinterpret or reduce the approved product boundary.

---

## Correction C1 — protocol plans are sequential through the seam review

The earlier roadmap statement that Plans 02 and 03 may execute in parallel is superseded.

Canonical order:

```text
Plan 00 Foundation
  -> Plan 01 Runtime
  -> Plan 02 x402
  -> Plan 03 AP2
  -> mandatory x402/AP2 seam review
  -> Plan 04 OpenID4VP
  -> Plan 05 Product Surface
  -> Plan 06 Conformance/Portability/Recovery/Release
```

Reason: AP2 dependency/profile verification and the post-x402/AP2 seam review consume the already-accepted x402 implementation. Sequential execution also prevents shared `uv.lock` and core/runtime package changes racing across worktrees.

Plan 05 and the backend-only portions of Plan 06 MAY later be parallelized by an execution coordinator only when their touched-file sets are disjoint. The default execution order is sequential.

---

## Correction C2 — dependency convergence happens before Plan 00 code

The reference workspace MUST begin on dependency versions compatible with the pinned AP2 implementation instead of downgrading foundational dependencies midway through execution.

Plan 00 package baseline:

```toml
# packages/ptf-core/pyproject.toml
"pydantic==2.12.5"
```

Plan 01 runtime baseline:

```toml
# packages/ptf-runtime/pyproject.toml
"cryptography==46.0.5"
```

The pinned AP2 source declares those exact versions. The pinned x402 2.22.0 package declares `pydantic>=2.0.0`, so Pydantic 2.12.5 is within its declared range.

Before Plan 00 source work:

```bash
uv lock
uv sync --all-packages --all-groups
python - <<'PY'
import pydantic
assert pydantic.__version__ == "2.12.5"
PY
```

Plan 03 Task 1 is therefore reinterpreted as a **verification-only dependency gate**. It MUST NOT change Pydantic/cryptography if the workspace already carries these exact pins. It reruns the complete Plan 00–02 regression suite before AP2 adapter code is added.

If these pins cannot resolve on the selected Python runtime, stop and open an implementation ADR for an isolated AP2 process/environment. Do not override upstream dependency declarations silently.

---

## Correction C3 — approval evidence is target-generic

The earlier `ApprovalEvidence.plan_fingerprint` field is superseded because the same evidence type authorizes both an ExecutionPlan and Standing Grant activation.

Use:

```python
from datetime import datetime
from enum import StrEnum

from ptf_core.canonical import FrozenModel


class AuthorizationTargetKind(StrEnum):
    EXECUTION_PLAN = "EXECUTION_PLAN"
    STANDING_GRANT = "STANDING_GRANT"


class ApprovalEvidence(FrozenModel):
    principal_id: str
    target_kind: AuthorizationTargetKind
    canonical_fingerprint: str
    assurance_profile: str
    challenge_id: str
    authenticated_at: datetime
    expires_at: datetime
```

Required invariants:

```python
def test_execution_approval_cannot_activate_grant() -> None:
    evidence = ApprovalEvidence(
        principal_id="P1",
        target_kind=AuthorizationTargetKind.EXECUTION_PLAN,
        canonical_fingerprint="fp-plan",
        assurance_profile="AA2",
        challenge_id="c1",
        authenticated_at=NOW,
        expires_at=LATER,
    )
    with pytest.raises(ApprovalTargetMismatch):
        repo.activate_grant(principal=PRINCIPAL, grant_id="g1", version=1, approval=evidence)


def test_grant_approval_cannot_authorize_execution_plan() -> None:
    evidence = ApprovalEvidence(
        principal_id="P1",
        target_kind=AuthorizationTargetKind.STANDING_GRANT,
        canonical_fingerprint="fp-grant",
        assurance_profile="AA2",
        challenge_id="c2",
        authenticated_at=NOW,
        expires_at=LATER,
    )
    with pytest.raises(ApprovalTargetMismatch):
        runtime.record_exact_approval(principal=PRINCIPAL, action_id="a1", approval=evidence, now=NOW)
```

For `record_exact_approval`, `canonical_fingerprint` MUST equal `plan_fingerprint(selected_plan)` and target kind MUST be `EXECUTION_PLAN`.

For `activate_grant`, `canonical_fingerprint` MUST equal the deterministic fingerprint of the exact canonical Standing Grant version and target kind MUST be `STANDING_GRANT`.

`ExecutionGrantRecord.plan_fingerprint` remains plan-specific and is not renamed.

Plan 05 `CanonicalApprovalView.canonical_fingerprint` already uses the generic terminology and MUST be aligned to this evidence model.

---

## Correction C4 — Safe View is task-scoped and has a real runtime interface

The earlier `GET /v1/agent/safe-view` and TypeScript `getSafeView()` with no request object are superseded.

Add to `ptf-runtime`:

```python
from datetime import datetime
from enum import StrEnum

from ptf_core.canonical import FrozenModel
from ptf_core.personal_state.safe_view import ContextView


class Requestability(StrEnum):
    MAY_REQUEST = "MAY_REQUEST"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    UNAVAILABLE = "UNAVAILABLE"


class SafeViewRequest(FrozenModel):
    task_id: str
    context_scope: str
    requested_keys: frozenset[str]
    purpose: str
    recipient_id: str | None = None
    allow_stale_reversible_preferences: bool = False


class RequestableActionView(FrozenModel):
    operation: str
    resource_ref: str | None
    recipient_id: str | None
    requestability: Requestability


class AuthorityView(FrozenModel):
    task_id: str
    actions: tuple[RequestableActionView, ...]


class SafeView(FrozenModel):
    task_id: str
    context: ContextView
    authority: AuthorityView
    generated_at: datetime
```

`AuthorityView` is independently derived from current Hard Policy, active Standing Grants, trust/binding state, resource status, and expiry/revocation. It MUST NOT consume inferred Personal State as an authority source and MUST NOT expose full grant records, aggregate private history, protected values, or raw trust-registry rows.

Add public runtime seam:

```python
class ActionRuntime:
    def get_safe_view(
        self,
        *,
        agent: AuthenticatedActor,
        request: SafeViewRequest,
        now: datetime,
    ) -> SafeView: ...
```

Required red tests:

```python
def test_safe_view_is_task_and_key_scoped(runtime: ActionRuntime) -> None:
    view = runtime.get_safe_view(
        agent=AGENT,
        request=SafeViewRequest(
            task_id="t1",
            context_scope="commerce.headphones",
            requested_keys=frozenset({"preferred_form_factor"}),
            purpose="product_selection",
            recipient_id=None,
        ),
        now=NOW,
    )
    assert set(item.key for item in view.context.items) == {"preferred_form_factor"}
    assert "home_address" not in view.model_dump_json()


def test_personal_state_mutation_does_not_broaden_authority_view(runtime: ActionRuntime) -> None:
    before = runtime.get_safe_view(agent=AGENT, request=SAFE_REQUEST, now=NOW).authority
    add_inferred_preference("autonomous_purchase_limit", "500000")
    after = runtime.get_safe_view(agent=AGENT, request=SAFE_REQUEST, now=NOW).authority
    assert after == before
```

Agent HTTP surface becomes:

```text
POST /v1/agent/safe-view
```

with a `SafeViewRequest` body. Remove the unscoped GET route.

TypeScript Agent SDK becomes:

```typescript
export interface PtfAgentClient {
  getSafeView(input: SafeViewRequest): Promise<SafeViewResponse>;
  requestAction(input: AgentActionRequest): Promise<PreparedActionResponse>;
  selectPlan(actionId: string, input: AgentPlanSelection): Promise<PreparedActionResponse>;
  getAction(actionId: string): Promise<PreparedActionResponse>;
  getReceipt(actionId: string): Promise<PtfReceiptResponse>;
}
```

No parameterless Safe View method is permitted.

---

## Correction C5 — Plan 01 must implement Personal State persistence

The Plan 01 file map listed `personal_state_repository.py` without an executable task. Insert this task before `ActionRuntime` implementation.

**Files:**

```text
packages/ptf-postgres/src/ptf_postgres/personal_state_repository.py
packages/ptf-postgres/tests/test_personal_state_repository.py
```

Required public repository behavior:

```python
class PersonalStateRepository:
    def append_observation(self, item: Observation) -> Observation: ...
    def put_claim(self, item: Claim) -> Claim: ...
    def put_preference(self, item: Preference) -> Preference: ...
    def correct_item(self, *, item_id: str, replacement: Claim | Preference, principal_id: str) -> Claim | Preference: ...
    def erase_item(self, *, item_id: str, principal_id: str) -> None: ...
    def context_candidates(self, *, principal_id: str, scope: str, keys: frozenset[str]) -> tuple[Claim | Preference, ...]: ...
```

Required tests:

```python
def test_correction_supersedes_without_rewriting_history(repo: PersonalStateRepository) -> None:
    repo.put_preference(OLD_PREF)
    new = repo.correct_item(item_id=OLD_PREF.id, replacement=NEW_PREF, principal_id="P1")
    assert repo.get(OLD_PREF.id).status == "SUPERSEDED"
    assert repo.get(OLD_PREF.id).superseded_by == new.id


def test_erasure_removes_personal_content_but_not_opaque_security_event(repo: PersonalStateRepository) -> None:
    repo.put_claim(SENSITIVE_CLAIM)
    repo.erase_item(item_id=SENSITIVE_CLAIM.id, principal_id="P1")
    assert repo.get_optional(SENSITIVE_CLAIM.id) is None
    event = latest_audit_event("PERSONAL_STATE_ERASED")
    assert event.resource_ref == SENSITIVE_CLAIM.id
    assert "passport_number" not in event.model_dump_json()
```

Do not implement a generic historical event store containing erased Personal State values.

---

## Correction C6 — Plan 01 must implement the Protected Resource Catalog

The Plan 01 file map listed `resource_repository.py` without an executable task. Insert this task before protocol plans.

**Files:**

```text
packages/ptf-postgres/src/ptf_postgres/resource_repository.py
packages/ptf-postgres/tests/test_resource_repository.py
```

Canonical safe record:

```python
class ProtectedResourceRecord(FrozenModel):
    resource_ref: str
    principal_id: str
    resource_type: str
    custody_profile: str
    executor_subject_id: str
    supported_operations: frozenset[str]
    safe_metadata: dict[str, str]
    status: str
    version: int
```

The catalog MUST NOT contain raw protected values or reusable credentials.

Required tests:

```python
def test_resource_ref_is_metadata_not_authority(repo: ResourceCatalogRepository) -> None:
    record = repo.put(RESOURCE_RECORD)
    assert record.resource_ref == "pr_wallet_1"
    with pytest.raises(TypeError):
        executor.execute(resource_ref=record.resource_ref)  # no Execution Grant/Plan accepted by interface


def test_catalog_schema_rejects_known_secret_fields() -> None:
    forbidden = {"private_key", "card_number", "passport_number", "refresh_token", "raw_credential"}
    assert forbidden.isdisjoint(ProtectedResourceRecord.model_fields)
```

`ActionRuntime` resource resolution and all protocol flows must consume this catalog or a repository port with equivalent safe semantics.

---

## Correction C7 — Trust administration must be explicit and validated

Plan 05's read-only `GET /v1/principal/trust` is insufficient for the approved reference-product trust-management requirement.

The Principal surface MAY create/revoke a TrustRelation only against an already validated active IdentityBinding/EndpointBinding. It MUST NOT create trust from a display name or arbitrary label.

Add Principal routes:

```text
GET    /v1/principal/trust
POST   /v1/principal/trust/relations
DELETE /v1/principal/trust/relations/{relation_id}
```

Creation body is structured:

```python
class CreateTrustRelationRequest(FrozenModel):
    subject_id: str
    binding_ids: tuple[str, ...]
    role: str
    purpose: str
    functions: frozenset[str]
```

Required test:

```python
def test_trust_relation_cannot_be_created_from_label_only(client) -> None:
    response = client.post(
        "/v1/principal/trust/relations",
        json={"subject_id": "merchant-x", "binding_ids": [], "role": "recipient", "purpose": "purchase", "functions": ["receive_payment"]},
    )
    assert response.status_code == 422
```

Principal authentication and policy-selected assurance apply to security-relevant trust mutations.

---

## Correction C8 — device management belongs after the device backend

Plan 05 MUST NOT expose a fake `GET /v1/principal/devices` or interactive device controls before Plan 06 implements device enrollment/revocation/recovery state.

Plan 05 Task 7 is limited to:

```text
Personal State
Protected Resource status
TrustRelation management
Activity/receipts
```

Plan 06 Task 5 implements the device backend. Plan 06 Task 7 then adds:

```text
GET  /v1/principal/devices
POST /v1/principal/devices/enroll
POST /v1/principal/devices/{device_id}/revoke
```

plus the device UI in the final Trusted Surface alongside portability/recovery.

No disabled or mock device-management UI counts as implementation.

---

## Correction C9 — API and SDK route partitions after Safe View correction

The Agent route allowlist is exactly:

```text
POST /v1/agent/safe-view
POST /v1/agent/actions
PUT  /v1/agent/actions/{action_id}/plan
GET  /v1/agent/actions/{action_id}
GET  /v1/agent/actions/{action_id}/receipt
```

The Agent OpenAPI document and generated TypeScript SDK MUST contain only these routes and their transitive schemas.

Principal/admin routes remain physically absent from the Agent schema and SDK.

---

## Correction C10 — implementation-plan quality gate

Before any subsystem task is dispatched, the execution coordinator must verify that the task has all of:

1. exact files;
2. exact consumed/produced interfaces;
3. a concrete red test or an explicit assertion fixture with exact expected values;
4. the command that demonstrates red state;
5. the minimal implementation shape/signature;
6. the command that demonstrates green state;
7. a commit boundary;
8. a reviewer acceptance gate.

A task that lacks one of these is returned to planning before code is written. The implementer is not allowed to invent a missing security semantic.

The existing plans contain no literal `TBD`, `TODO`, or `implement later` placeholders as of the September 4 review. Exact assertion lists in an existing task are normative test requirements; where implementation reveals an API mismatch, the task is amended through review rather than silently changing names.

---

## Corrected cross-plan public contract

The following names are frozen for implementation planning:

```text
ptf_core:
  Observation
  Claim
  Preference
  FreshnessPolicy
  FreshnessState
  ContextView
  Subject
  IdentityBinding
  EndpointBinding
  AuthenticationEvidence
  TrustRelation
  TrustSnapshot
  HardPolicy
  StandingGrant
  ActionRequest
  AuthorizationDecision
  ExecutionPlan
  EnforcementMap
  AssuranceManifest
  PTFReceipt
  ExecutionOutcome
  plan_fingerprint
  validate_execution_plan

ptf_runtime:
  AuthenticatedActor
  AuthorizationTargetKind
  ApprovalEvidence
  PreparedAction
  ExecutionGrantRecord
  RevalidationResult
  ExternalExecutionResult
  SafeViewRequest
  RequestableActionView
  AuthorityView
  SafeView
  ActionRuntime
```

Protocol-specific objects remain under their concrete adapter/executor packages.

No `ProtocolAdapter` base class is permitted before the accepted x402/AP2 seam review.

---

## Contract verification checklist

Before implementation begins, verify:

```bash
git rev-parse origin/legacy/webmcp-sandbox
# => 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9

git rev-list -n 1 webmcp-sandbox-v0.1
# => same SHA; absence is a hard stop
```

Then verify the selected execution branch contains the approved spec, approval record, accepted ADRs, this contract, corrected roadmap, and all subsystem plans.

No product source code is authorized on the documentation/planning branches.