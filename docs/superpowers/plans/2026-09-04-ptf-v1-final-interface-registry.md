# PTF v1 Final Cross-Plan Interface Registry — September 4, 2026

Status: **BINDING IMPLEMENTATION-PLANNING INTERFACE ORACLE; APPROVED SPEC UNCHANGED**

This registry is the single name/signature oracle for cross-plan interfaces after the September 4 audit. It supersedes conflicting field names or incomplete public signatures in older subsystem plans and correction examples. It does not change PTF v1 semantics; it makes the approved semantics implementable without caller/implementer inference.

Task-local private helpers are not frozen here. Protocol-specific objects stay inside their concrete adapter/executor packages.

## Design rules

1. Principal context is explicit wherever state is Principal-scoped. Caller-supplied Principal IDs are routing inputs only; runtime authorization verifies the authenticated Agent/Principal is allowed to act in that Principal context.
2. `resource_ref` is the canonical core name. Older x402 examples using `resource_id` are superseded.
3. Human/display labels never authenticate Subjects, endpoints, devices, or trust.
4. Canonical authority uses typed deterministic fields; no arbitrary security-policy dicts or natural-language authoritative scopes.
5. Monetary security fields use integer minor/atomic units plus explicit currency/asset identifier; no floats.
6. Cross-plan callers test through these public seams, not private repository/adapter internals.
7. No universal `ProtocolAdapter`/registry interface exists before and unless the accepted x402/AP2 seam review proves one.

---

# `ptf_core` authority and identity values

```python
class AmountLimit(FrozenModel):
    currency: str
    max_amount_minor: int
    aggregate_limit_minor: int | None = None


class AuthorityScope(FrozenModel):
    operations: frozenset[str]
    resource_refs: frozenset[str]
    recipient_ids: frozenset[str]
    purposes: frozenset[str]
    amount_limits: tuple[AmountLimit, ...] = ()
    max_uses: int | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    disclosure_permissions: frozenset[str] = frozenset()
    max_delegation_depth: int = 0
    min_assurance: str = "AA0"
```

Validation rules:

```text
amount limits are non-negative integer units
one currency identifier appears at most once in amount_limits
valid_until > valid_from where both are present
max_uses is positive when present
max_delegation_depth >= 0
min_assurance is one of AA0/AA1/AA2/AA3
```

Hard Policy is a ceiling:

```python
class HardPolicy(FrozenModel):
    policy_id: str
    principal_id: str
    version: int
    scope: AuthorityScope
    status: str
    updated_at: datetime
```

Standing Grant is continuing authority:

```python
class StandingGrant(FrozenModel):
    grant_id: str
    principal_id: str
    agent_subject_id: str
    version: int
    scope: AuthorityScope
    status: str
    created_at: datetime
    activated_at: datetime | None = None
```

`status` follows the approved lifecycle (`PROPOSED`, `ACTIVE`, `SUSPENDED`, `REVOKED`, `EXPIRED`, `SUPERSEDED`). A grant contributes authority only while `ACTIVE` and current.

Canonical action request:

```python
class ActionRequest(FrozenModel):
    principal_id: str
    operation: str
    resource_ref: str | None
    recipient_id: str | None
    purpose: str
    amount_minor: int | None = None
    currency: str | None = None
    requested_disclosure: frozenset[str] = frozenset()
```

If `amount_minor` is present, `currency` is required; if absent, `currency` must be absent unless the operation's deterministic profile explicitly uses currency without an amount. Protocol-native request snapshots remain separate adapter values.

Authority basis:

```python
class AuthorityBasisKind(StrEnum):
    STANDING_GRANT = "STANDING_GRANT"
    EXACT_HUMAN_APPROVAL = "EXACT_HUMAN_APPROVAL"


class AuthorityBasis(FrozenModel):
    kind: AuthorityBasisKind
    principal_id: str
    source_id: str | None
    source_version: int | None
    source_constraint_ids: tuple[str, ...]
```

For a candidate plan requiring Exact Human Approval, `source_id`/`source_version` may be absent until the exact approval record exists; the selected plan fingerprint is the authorization target. A Standing Grant basis always carries exact grant ID/version.

Resolver public seam remains:

```python
def resolve_preliminary(
    *,
    request: ActionRequest,
    hard_policy: HardPolicy,
    active_grants: tuple[StandingGrant, ...],
    trust_snapshot: TrustSnapshot,
    now: datetime,
) -> AuthorizationDecision: ...
```

`request.principal_id`, `hard_policy.principal_id`, selected grant principal, and `trust_snapshot.principal_id` must agree. A mismatch fails closed.

---

# `ptf_core` identity/trust values

```python
class Subject(FrozenModel):
    subject_id: str
    roles: frozenset[SubjectRole]


class IdentityBinding(FrozenModel):
    binding_id: str
    subject_id: str
    binding_type: str
    binding_value: str
    display_name: str | None
    status: str
    verified_at: datetime
    valid_until: datetime | None
    provenance_ref: str


class EndpointBinding(FrozenModel):
    binding_id: str
    subject_id: str
    endpoint_type: str
    endpoint_value: str
    status: str
    verified_at: datetime
    valid_until: datetime | None
    provenance_ref: str


class AuthenticationEvidence(FrozenModel):
    subject_id: str
    binding_id: str
    key_id: str | None
    authenticated_at: datetime
    assurance_profile: str


class TrustRelation(FrozenModel):
    relation_id: str
    principal_id: str
    subject_id: str
    binding_ids: tuple[str, ...]
    role: str
    purpose: str
    functions: frozenset[str]
    status: str
    valid_until: datetime | None


class TrustSnapshot(FrozenModel):
    principal_id: str
    registry_epoch: int
    identity_bindings: tuple[IdentityBinding, ...]
    endpoint_bindings: tuple[EndpointBinding, ...]
    trust_relations: tuple[TrustRelation, ...]
```

`principal_id` on `TrustRelation` is the local Principal/security context owning the trust decision; `subject_id` is the trusted counterparty/Agent/issuer/recipient Subject. A TrustRelation cannot be constructed/activated with an empty binding set for a function requiring authenticated external identity.

---

# Personal State and Safe View

Plan 00 Personal State value types remain `Observation`, `Claim`, `Preference`, `FreshnessPolicy`, `FreshnessState`, and `ContextView`.

Repository interface:

```python
class PersonalStateRepository(Protocol):
    def append_observation(self, item: Observation) -> Observation: ...
    def put_claim(self, item: Claim) -> Claim: ...
    def put_preference(self, item: Preference) -> Preference: ...
    def get(self, item_id: str) -> Observation | Claim | Preference: ...
    def get_optional(self, item_id: str) -> Observation | Claim | Preference | None: ...
    def list_for_principal(
        self,
        *,
        principal_id: str,
    ) -> tuple[Observation | Claim | Preference, ...]: ...
    def correct_item(
        self,
        *,
        item_id: str,
        replacement: Claim | Preference,
        principal_id: str,
    ) -> Claim | Preference: ...
    def erase_item(self, *, item_id: str, principal_id: str) -> None: ...
    def context_candidates(
        self,
        *,
        principal_id: str,
        scope: str,
        keys: frozenset[str],
    ) -> tuple[Claim | Preference, ...]: ...
```

Principal mutation/audit module:

```python
class PersonalStateService:
    def list_items(
        self,
        *,
        principal: AuthenticatedActor,
    ) -> tuple[Observation | Claim | Preference, ...]: ...

    def correct_item(
        self,
        *,
        principal: AuthenticatedActor,
        item_id: str,
        replacement: Claim | Preference,
        now: datetime,
    ) -> Claim | Preference: ...

    def erase_item(
        self,
        *,
        principal: AuthenticatedActor,
        item_id: str,
        now: datetime,
    ) -> None: ...
```

`PersonalStateService` requires `ActorKind.PRINCIPAL`, calls the repository, and emits privacy-safe `AuditEvent` metadata through `AuditSink`. The earlier correction example calling undefined `ActionRuntime.erase_personal_state(...)` is superseded; product routes call this service instead.

Task-scoped Safe View request explicitly includes Principal context:

```python
class SafeViewRequest(FrozenModel):
    principal_id: str
    task_id: str
    context_scope: str
    requested_keys: frozenset[str]
    purpose: str
    recipient_id: str | None = None
    allow_stale_reversible_preferences: bool = False
```

The remaining `Requestability`, `RequestableActionView`, `AuthorityView`, and `SafeView` shapes from Correction C4 remain binding.

---

# Planning, enforcement, assurance

Constraint identifiers are stable strings representing deterministic source-authority dimensions. Cross-plan APIs pass **constraint IDs**, not untyped constraint objects.

```python
class ConstraintEnforcement(FrozenModel):
    constraint_id: str
    locations: frozenset[EnforcementLocation]
    downgrade_id: str | None = None


class EnforcementMap(FrozenModel):
    entries: tuple[ConstraintEnforcement, ...]
```

Every source constraint ID appears exactly once. `locations` is non-empty and uses the approved `PTF`, `PROTOCOL`, `EXECUTOR`, `RECIPIENT`, `COMPOSITE`, or `UNENFORCEABLE` values. Mandatory `UNENFORCEABLE` requires an explicit approved downgrade path.

Disclosure plan cross-plan shape:

```python
class DisclosurePlan(FrozenModel):
    recipient_id: str
    purpose: str
    resource_ref: str
    requested_items: frozenset[str]
    permitted_items: frozenset[str]
    selected_representation: DisclosureMode
    channel_constraints: frozenset[str]
    agent_model_visibility: str
    downstream_visibility: tuple[str, ...]
    assurance_properties: frozenset[str]
    downgrade_ids: tuple[str, ...] = ()
```

Assurance Manifest cross-plan shape:

```python
class AssuranceManifest(FrozenModel):
    profile_id: str
    profile_version: str
    control_runtime_admin_domain: str
    protected_executor_admin_domain: str
    plaintext_observers: frozenset[str]
    usable_resource_invokers: frozenset[str]
    agent_model_visibility: str
    recipient_disclosure: tuple[str, ...]
    resource_exportability: str
    recipient_authentication: tuple[str, ...]
    principal_approval_assurance: str
    remote_attestation: tuple[str, ...]
    artifact_custody_mode: ArtifactCustodyMode
    recovery_parties: frozenset[str]
    audit_integrity_profile: str
    residual_risks: tuple[str, ...]
    downgrade_ids: tuple[str, ...] = ()
```

Execution Plan cross-plan shape:

```python
class ExecutionPlan(FrozenModel):
    plan_id: str
    action_id: str
    principal_id: str
    authority_basis: AuthorityBasis
    trust_registry_epoch: int
    identity_binding_ids: tuple[str, ...]
    endpoint_binding_ids: tuple[str, ...]
    resource_refs: tuple[str, ...]
    disclosure_plan: DisclosurePlan | None
    executor_subject_id: str
    executor_profile_id: str
    protocol: str
    protocol_operation: str
    transaction_binding: str
    enforcement_map: EnforcementMap
    source_constraint_ids: tuple[str, ...]
    reservation_amount_minor: int | None
    reservation_currency: str | None
    replay_key: str
    idempotency_mode: str
    expected_evidence_types: tuple[str, ...]
    failure_semantics: str
    expires_at: datetime
    assurance_manifest: AssuranceManifest
    downgrade_ids: tuple[str, ...] = ()
```

`plan_fingerprint(plan)` is derived from canonical serialization of the complete model. It is not a mutable caller field inside `ExecutionPlan`.

Validation seam is exactly:

```python
def validate_execution_plan(
    plan: ExecutionPlan,
    source_constraint_ids: tuple[str, ...],
) -> None: ...
```

`plan.source_constraint_ids` must equal the supplied set/order-canonicalized constraint IDs and the Enforcement Map must totally cover them.

Older task examples using `source_constraints: tuple[object, ...]` or `source_constraints` without stating IDs are superseded.

---

# Protected Resource Catalog

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


class ResourceCatalogRepository(Protocol):
    def put(self, record: ProtectedResourceRecord) -> ProtectedResourceRecord: ...
    def get(
        self,
        *,
        principal_id: str,
        resource_ref: str,
    ) -> ProtectedResourceRecord: ...
    def get_optional(
        self,
        *,
        principal_id: str,
        resource_ref: str,
    ) -> ProtectedResourceRecord | None: ...
    def list_for_principal(
        self,
        *,
        principal_id: str,
    ) -> tuple[ProtectedResourceRecord, ...]: ...
    def set_status(
        self,
        *,
        principal_id: str,
        resource_ref: str,
        expected_version: int,
        status: str,
    ) -> ProtectedResourceRecord: ...
```

`resource_ref` is never a bearer credential. Every consequential executor method requires a valid plan-bound Execution Grant in addition to a resource reference/plan.

---

# `ptf_runtime` lifecycle values

```python
class AuthenticatedActor(FrozenModel):
    subject_id: str
    actor_kind: ActorKind
    binding_id: str
    key_id: str
    authenticated_at: datetime
    assurance_profile: str


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


class PreparedAction(FrozenModel):
    action_id: str
    principal_id: str
    state: PreparedActionState
    authorization_decision: str
    selected_plan_id: str | None
    plan_fingerprint: str | None
    authority_basis: AuthorityBasis | None
    trust_registry_epoch: int
    approval_required: bool
    safe_summary: tuple[str, ...]


class ReservationRecord(FrozenModel):
    reservation_id: str
    grant_id: str
    execution_grant_id: str
    amount_minor: int | None
    currency: str | None
    state: str
    created_at: datetime
    updated_at: datetime


class ExecutionGrantRecord(FrozenModel):
    execution_grant_id: str
    action_id: str
    principal_id: str
    plan_fingerprint: str
    authority_basis: AuthorityBasis
    grant_id: str | None
    grant_version: int | None
    reservation_id: str | None
    issued_at: datetime
    expires_at: datetime
    status: str


class RevalidationResult(FrozenModel):
    execution_grant_id: str
    plan_fingerprint: str
    trust_registry_epoch: int
    status: str
    revalidated_at: datetime


class ExternalExecutionResult(FrozenModel):
    outcome: ExecutionOutcome
    external_evidence_ref: str | None = None
    external_result_digest: str | None = None
    committed_at: datetime | None = None
```

Prepared/Execution Grant DTOs expose no protected resource plaintext or raw protocol artifact.

---

# Runtime coordination and action module

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

Action module public interface:

```python
class ActionRuntime:
    def get_safe_view(
        self,
        *,
        agent: AuthenticatedActor,
        request: SafeViewRequest,
        now: datetime,
    ) -> SafeView: ...

    def request_action(
        self,
        *,
        agent: AuthenticatedActor,
        request: ActionRequest,
        now: datetime,
    ) -> PreparedAction: ...

    def select_plan(
        self,
        *,
        agent: AuthenticatedActor,
        action_id: str,
        plan: ExecutionPlan,
        source_constraint_ids: tuple[str, ...],
        now: datetime,
    ) -> PreparedAction: ...

    def record_exact_approval(
        self,
        *,
        principal: AuthenticatedActor,
        action_id: str,
        approval: ApprovalEvidence,
        now: datetime,
    ) -> PreparedAction: ...

    def authorize_execution(
        self,
        *,
        action_id: str,
        now: datetime,
    ) -> ExecutionGrantRecord: ...

    def revalidate_execution(
        self,
        *,
        execution_grant_id: str,
        now: datetime,
    ) -> RevalidationResult: ...

    def reconcile(
        self,
        *,
        execution_grant_id: str,
        result: ExternalExecutionResult,
        now: datetime,
    ) -> PTFReceipt: ...
```

Every action/safe-view Principal context is checked against authoritative Principal-scoped policy/grants/trust/resources. A caller-supplied `principal_id` cannot by itself establish delegation.

---

# Audit module

```python
class AuditSink(Protocol):
    def append_event(self, event: AuditEvent) -> None: ...
```

AI0 implementation exposes:

```python
class AuditService:
    def append_event(self, event: AuditEvent) -> None: ...
    def create_checkpoint(self) -> str: ...
    def verify_history(self) -> bool: ...
```

Tests/repositories may expose a read helper such as `latest_for_event_type(event_type: str) -> AuditEvent | None`; that is not an Agent/API surface.

Personal-State erase auditing uses `PersonalStateService.erase_item(...)`, not an undefined ActionRuntime mutation method.

---

# Protocol adapter naming corrections

## x402

Canonical requirement interpreter:

```python
def interpret_payment_required(
    *,
    payment_required: PaymentRequired,
    selected_requirements: PaymentRequirements,
    recipient_subject_id: str,
    recipient_binding: X402RecipientBinding,
    principal_id: str,
    resource_ref: str,
    purpose: str,
) -> ActionRequest: ...
```

The returned ActionRequest uses `principal_id`, `resource_ref`, and `recipient_id=recipient_subject_id`. Older `resource_id` examples are superseded.

`X402PaymentFlow.prepare(...)` likewise accepts `principal_id` + `resource_ref` and passes them into this interpreter.

## AP2

The corrected two-stage open-authority flow in task-quality corrections 4 is binding. Its `prepare_open_payment_authority(...)` includes `principal_id` in the canonical ActionRequest/plan context; authenticated Principal/Agent context must match the grant's Principal.

No `StandingGrant -> AP2 signing executor` direct path exists.

## OpenID4VP

`OpenID4VPFlow.prepare(...)` receives explicit `principal_id` and maps `credential_ref` to canonical `ActionRequest.resource_ref`. `normalize_authorization_request(...)` performs protocol/profile/binding validation only; Hard Policy remains in ActionRuntime.

---

# Principal product/admin seams

Trust creation request is exactly:

```python
class CreateTrustRelationRequest(FrozenModel):
    subject_id: str
    binding_ids: tuple[str, ...]
    role: str
    purpose: str
    functions: frozenset[str]
```

Authenticated Principal context supplies `principal_id`; it is not trusted from the body.

Plan 05 Principal routes include Personal State, resources, trust relations, and activity, but no devices.

Plan 06 device backend/UI routes are exactly:

```text
GET  /v1/principal/devices
POST /v1/principal/devices/enroll
POST /v1/principal/devices/{device_id}/revoke
```

with the two-phase discriminated enrollment body defined in task-quality corrections 7.

Agent route allowlist remains exactly:

```text
POST /v1/agent/safe-view
POST /v1/agent/actions
PUT  /v1/agent/actions/{action_id}/plan
GET  /v1/agent/actions/{action_id}
GET  /v1/agent/actions/{action_id}/receipt
```

Agent TypeScript SDK remains exactly five public methods, with:

```typescript
getSafeView(input: SafeViewRequest): Promise<SafeViewResponse>;
```

and no Principal/admin/raw-path method.

---

# Plan 06 conformance/operations seams

The `ConformanceProfile`, `OracleResult`, and `ConformanceEvidence` shapes from Plan 06 Task 1 remain binding.

Harness seam:

```python
class ConformanceTarget(Protocol):
    def request_action(self, request: dict[str, object]) -> dict[str, object]: ...
    def get_action(self, action_id: str) -> dict[str, object]: ...
    def get_receipt(self, action_id: str) -> dict[str, object]: ...


class Oracle(Protocol):
    oracle_id: str
    def run(
        self,
        *,
        target: ConformanceTarget,
        fixture: object,
    ) -> OracleResult: ...
```

The harness representation may use transport dictionaries because it is a black-box test client, not a canonical authority model. It cannot call private resolver/repository helpers to manufacture PASS.

`PortabilityService`, `DeviceService`, recovery values, `AuditWitness`, migration oracle ownership, CI pins, and claim registry are exactly as defined in task-quality corrections 7.

---

# Cross-plan forbidden names/paths

These are superseded/invalid:

```text
ApprovalEvidence.plan_fingerprint
GET /v1/agent/safe-view
PtfAgentClient.getSafeView() with no input
ActionRequest.resource_id
X402PaymentFlow resource_id argument
source_constraints: tuple[object, ...] across a public seam
add_inferred_preference(...) as an undefined Safe View test helper
ActionRuntime.erase_personal_state(...)
executor.execute(resource_ref=...) as a supposed valid execution interface
GET /v1/principal/devices in Plan 05
TrustAndDevices.tsx in Plan 05
0003_portability_recovery.sql
StandingGrant -> AP2 signing executor direct issuance
OpenID4VP request normalizer evaluating Hard Policy
floating GitHub Action major tags in release workflows
undefined reviewed claim registry
```

If any final plan task still depends on one of these, that task is C10 FAIL until corrected.

---

# Registry verification rule

Before the task-quality matrix can report PASS for a task that consumes a cross-plan interface, the reviewer checks its names/fields against this registry. A mismatch cannot be waived by implementation convenience; planning must be amended first.
