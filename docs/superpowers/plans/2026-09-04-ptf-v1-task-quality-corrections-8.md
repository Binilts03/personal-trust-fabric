# PTF v1 Task-Quality Corrections 8 — Final Interface Ownership

Status: **BINDING PLANNING CORRECTIONS; APPROVED SPEC UNCHANGED**

This document assigns every new or clarified cross-plan interface in `2026-09-04-ptf-v1-final-interface-registry.md` to an executable task/file. It closes ownership gaps introduced while making the cross-plan contracts explicit.

---

## Plan 00 ownership

### 00/T4 — identity/trust values

`packages/ptf-core/src/ptf_core/identity/models.py` owns the final registry shapes for:

```text
Subject
IdentityBinding
EndpointBinding
AuthenticationEvidence
TrustRelation including principal_id
TrustSnapshot including principal_id + registry_epoch
```

All Plan 00 T4 tests use these exact field names.

### 00/T5 — authority values

`packages/ptf-core/src/ptf_core/authority/models.py` owns:

```text
AmountLimit
AuthorityScope
HardPolicy
StandingGrant
ActionRequest
AuthorityBasisKind
AuthorityBasis
AuthorizationDecision and existing decision enums/terms
```

Canonical action field is `resource_ref`; `resource_id` is not a core alias.

### 00/T6 — planning/enforcement/assurance values

`packages/ptf-core/src/ptf_core/planning/models.py` owns:

```text
DisclosurePlan
ConstraintEnforcement
EnforcementMap
ExecutionPlan
```

`packages/ptf-core/src/ptf_core/protected_resources/models.py` owns `AssuranceManifest` and custody enums.

`validate_execution_plan(...)` accepts `source_constraint_ids: tuple[str, ...]` exactly.

---

## Plan 01 ownership

### 01/T2 — runtime lifecycle values

`packages/ptf-runtime/src/ptf_runtime/models.py` owns the final registry shapes for:

```text
AuthenticatedActor
AuthorizationTargetKind
ApprovalEvidence
PreparedAction
ReservationRecord
ExecutionGrantRecord
RevalidationResult
ExternalExecutionResult
```

The older `ApprovalEvidence.plan_fingerprint` field is forbidden.

### 01/T4 — TrustRepository and trust-administration module

Extend Task 4 exact files with:

```text
packages/ptf-runtime/src/ptf_runtime/trust.py
packages/ptf-runtime/tests/test_trust_administration.py
```

Repository interface implemented by `ptf_postgres.trust_repository`:

```python
class TrustRepository(Protocol):
    def current_epoch(self) -> int: ...

    def get_identity_binding(self, *, binding_id: str) -> IdentityBinding: ...
    def get_endpoint_binding(self, *, binding_id: str) -> EndpointBinding: ...

    def upsert_identity_binding(
        self,
        *,
        principal: AuthenticatedActor,
        binding: IdentityBinding,
    ) -> IdentityBinding: ...

    def upsert_endpoint_binding(
        self,
        *,
        principal: AuthenticatedActor,
        binding: EndpointBinding,
    ) -> EndpointBinding: ...

    def create_trust_relation(
        self,
        *,
        principal: AuthenticatedActor,
        relation: TrustRelation,
    ) -> TrustRelation: ...

    def revoke_trust_relation(
        self,
        *,
        principal: AuthenticatedActor,
        relation_id: str,
        now: datetime,
    ) -> TrustRelation: ...

    def list_trust_relations(
        self,
        *,
        principal_id: str,
    ) -> tuple[TrustRelation, ...]: ...

    def snapshot(
        self,
        *,
        principal_id: str,
        subject_ids: frozenset[str],
        now: datetime,
    ) -> TrustSnapshot: ...
```

Every security-relevant mutation increments the deployment registry epoch transactionally.

Runtime administration seam:

```python
class TrustAdministrationService:
    def list_relations(
        self,
        *,
        principal: AuthenticatedActor,
    ) -> tuple[TrustRelation, ...]: ...

    def create_relation(
        self,
        *,
        principal: AuthenticatedActor,
        subject_id: str,
        binding_ids: tuple[str, ...],
        role: str,
        purpose: str,
        functions: frozenset[str],
        now: datetime,
    ) -> TrustRelation: ...

    def revoke_relation(
        self,
        *,
        principal: AuthenticatedActor,
        relation_id: str,
        now: datetime,
    ) -> TrustRelation: ...
```

`create_relation` loads every binding ID, verifies active/current binding ownership to `subject_id`, rejects an empty set when the function requires external authentication, creates `TrustRelation(principal_id=principal.subject_id, ...)`, and calls the repository. Human/display labels are not inputs.

Plan 05 trust routes call this service rather than constructing TrustRelations inside FastAPI handlers.

### 01/T6A — Personal State persistence + administration service

Extend exact files with:

```text
packages/ptf-runtime/src/ptf_runtime/personal_state.py
packages/ptf-runtime/tests/test_personal_state_service.py
```

The repository implements the complete `PersonalStateRepository` interface in the final registry including `get`, `get_optional`, and `list_for_principal`.

`PersonalStateService` implements the final registry interface. Correction/erasure require `ActorKind.PRINCIPAL`; erasure emits only opaque/privacy-safe `PERSONAL_STATE_ERASED` audit metadata and never stores the erased value in the AuditEvent.

The earlier test call to undefined `ActionRuntime.erase_personal_state(...)` is forbidden. Plan 05 Personal State routes call `PersonalStateService`.

Updated T6A candidate commit:

```bash
git add \
  packages/ptf-postgres/src/ptf_postgres/personal_state_repository.py \
  packages/ptf-postgres/tests/test_personal_state_repository.py \
  packages/ptf-runtime/src/ptf_runtime/personal_state.py \
  packages/ptf-runtime/tests/test_personal_state_service.py
git commit -m "feat(runtime): persist and administer correctable personal state"
```

### 01/T6B — Protected Resource Catalog

No new file is required. The repository implements the exact final-registry `ResourceCatalogRepository` interface including `list_for_principal`.

### 01/T6C — Safe View

`SafeViewRequest` includes `principal_id` exactly as the final registry requires. `ActionRuntime.get_safe_view` must reject Principal-context mismatch/delegation absence; it cannot infer the Principal solely from an Agent display label/session string.

### 01/T7 — ActionRuntime

Use `source_constraint_ids` rather than `source_constraints` in the public `select_plan(...)` signature. All runtime public methods match the final interface registry exactly.

---

## Plan 02 ownership/name corrections

### 02/T2

`interpret_payment_required(...)` signature is the final registry version with:

```text
principal_id
resource_ref
```

The returned ActionRequest uses `resource_ref`, never `resource_id`.

### 02/T6

`X402PaymentFlow.prepare(...)` accepts:

```python
async def prepare(
    self,
    *,
    agent: AuthenticatedActor,
    principal_id: str,
    payment_required: PaymentRequired,
    selected_requirements: PaymentRequirements,
    recipient_binding: X402RecipientBinding,
    resource_ref: str,
    purpose: str,
    now: datetime,
) -> PreparedAction: ...
```

It verifies/propagates Principal context through the canonical ActionRequest and selected ExecutionPlan.

---

## Plan 03 ownership/name corrections

The T6 two-stage AP2 open-authority correction remains binding. Every canonical AP2 ActionRequest/ExecutionPlan carries the grant's `principal_id`; authenticated caller context must match the Principal/delegation state.

`prepare_payment(...)` must construct/validate an ActionRequest whose `principal_id` is explicit rather than relying on a parent AP2 artifact to establish PTF authority.

---

## Plan 04 ownership/name corrections

`OpenID4VPFlow.prepare(...)` becomes:

```python
class OpenID4VPFlow:
    def prepare(
        self,
        *,
        agent: AuthenticatedActor,
        principal_id: str,
        request_parameters: dict[str, object],
        verifier_subject_id: str,
        verifier_binding: OID4VPVerifierBinding,
        credential_ref: str,
        purpose: str,
        now: datetime,
    ) -> PreparedAction: ...
```

`interpret_dcql_request(...)` maps `credential_ref` to `ActionRequest.resource_ref` and carries the supplied `principal_id` in the ActionRequest. OpenID4VP protocol data still does not create Principal context or authority.

---

## Plan 05 ownership corrections

### 05/T7

Trust endpoints call `TrustAdministrationService`. Personal State endpoints call `PersonalStateService`. Resource and activity GETs remain Principal-authenticated safe read paths.

Authenticated Principal identity supplies `principal_id` for TrustRelation creation; request JSON cannot override it.

### Agent SDK

Generated `SafeViewRequest` includes `principal_id` and `getSafeView(input)` remains the only Safe View SDK method.

---

## Plan 06 ownership

Task-quality corrections 7 already assigns `PortabilityService`, `DeviceService`, recovery values, migration/recovery/portability oracles, and release/CI artifacts to exact files/tasks. No additional Plan 06 file ownership is introduced here.

---

## C10 consequence

A task consuming one of these corrected interfaces is not PASS until its red test and implementation snippet use the final-registry names. Merely relying on an older plan example and expecting the implementer to notice the registry is not sufficient for final Superpowers plan-quality certification; the C10 task manifest must spell out the corrected call in executable test/code snippets.
