# PTF v1 Task-Quality Corrections 2 — Plan 00 and Plan 01

Status: **BINDING PLANNING CORRECTIONS; APPROVED SPEC UNCHANGED**

This document resolves the second-pass C10 findings for Plan 00 and Plan 01 and corrects the executable-task count discovered during line-by-line audit.

Read after the readiness addendum, task-review protocol, and first task-quality corrections document.

---

## Mechanical count correction

The runtime plan contains **Task 11: Lock Plan 01 acceptance and architecture boundaries**. The initial matrix scan truncated after Task 10 and undercounted the plan set.

Correct counts:

```text
Plan 00 Foundation:              8 original tasks
Plan 01 Runtime:                11 original tasks
Plan 02 x402:                    8 original tasks
Plan 03 AP2:                     9 original tasks
Plan 04 OpenID4VP:               8 original tasks
Plan 05 Product Surface:         8 original tasks
Plan 06 Conformance/Operations: 10 original tasks
-----------------------------------------------
Original tasks:                 62
Inserted Plan 01 corrections:   3
Total executable task units:   65
```

Any audit/matrix claiming 64 total units is superseded.

---

# Plan 00 corrections

## 00/T3 — Personal State freshness and ContextView fixtures

The original task has the correct red/green commands and a concrete `build_context_view(...)` signature, but its freshness and Safe View tests are not sufficiently exact under C10.

Use these fixed fixtures before implementation:

```python
NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)

# Freshness
STATIC_CURRENT = Preference(
    id="pref-static",
    key="preferred_form_factor",
    value="over-ear",
    source_class="EXPLICIT_PRINCIPAL",
    source_id="principal:P1",
    observed_at=NOW - timedelta(days=365),
    scope="commerce.headphones",
    sensitivity="LOW",
    evidence_ids=(),
    freshness_policy=FreshnessPolicy(kind=FreshnessKind.STATIC),
)

VALID_UNTIL_CURRENT = Claim(..., valid_until=NOW + timedelta(minutes=1))
VALID_UNTIL_STALE = Claim(..., valid_until=NOW - timedelta(microseconds=1))
MAX_AGE_CURRENT = Preference(..., observed_at=NOW - timedelta(seconds=59), max_age_seconds=60)
MAX_AGE_STALE = Preference(..., observed_at=NOW - timedelta(seconds=61), max_age_seconds=60)
STATUS_UNKNOWN = Claim(..., freshness_policy=FreshnessPolicy(kind=FreshnessKind.STATUS_CHECK))
STATUS_REVOKED = Claim(..., freshness_policy=FreshnessPolicy(kind=FreshnessKind.STATUS_CHECK))
```

Exact freshness assertions:

```python
assert evaluate_freshness(STATIC_CURRENT, now=NOW) is FreshnessState.CURRENT
assert evaluate_freshness(VALID_UNTIL_CURRENT, now=NOW) is FreshnessState.CURRENT
assert evaluate_freshness(VALID_UNTIL_STALE, now=NOW) is FreshnessState.STALE
assert evaluate_freshness(MAX_AGE_CURRENT, now=NOW) is FreshnessState.CURRENT
assert evaluate_freshness(MAX_AGE_STALE, now=NOW) is FreshnessState.STALE
assert evaluate_freshness(STATUS_UNKNOWN, now=NOW, status=None) is FreshnessState.UNKNOWN
assert evaluate_freshness(STATUS_REVOKED, now=NOW, status="REVOKED") is FreshnessState.REVOKED
```

Safe View fixture must contain at least:

```text
explicit requested preference: preferred_form_factor = over-ear, scope commerce.headphones
inferred requested preference: preferred_brand = ExampleBrand, same scope
sensitive unrelated claim: home_address = PTF_CANARY_HOME_4A2D, scope personal.address
stale reversible preference: preferred_colour = blue
```

For `requested_keys={"preferred_form_factor", "preferred_brand"}` and `context_scope="commerce.headphones"`:

```python
assert {item.key for item in view.items} == {"preferred_form_factor", "preferred_brand"}
assert next(x for x in view.items if x.key == "preferred_brand").basis == "inferred"
assert "PTF_CANARY_HOME_4A2D" not in view.model_dump_json()
assert not any(name.lower().startswith(("grant", "approval", "authority")) for name in ContextView.model_fields)
```

When stale reversible context is disallowed, `preferred_colour` is absent; when explicitly allowed for the same scope, it may appear and remains labelled stale/inferred as applicable.

Existing red command and green Personal State suite remain binding.

## 00/T4 — exact identity/trust model shape and red command

Before implementation, `test_identity_models.py` must include exact construction/rejection tests:

```python
def test_subject_id_alone_is_not_authentication() -> None:
    with pytest.raises(ValidationError):
        AuthenticationEvidence(subject_id="merchant-1")


def test_display_name_is_not_a_binding_key() -> None:
    a = IdentityBinding(
        binding_id="ib-1",
        subject_id="merchant-1",
        binding_type="PUBLIC_KEY",
        binding_value="key-thumbprint-A",
        display_name="Example Merchant",
        status="ACTIVE",
        verified_at=NOW,
        valid_until=LATER,
        provenance_ref="fixture:root-a",
    )
    b = a.model_copy(update={"binding_id": "ib-2", "subject_id": "merchant-2", "binding_value": "key-thumbprint-B"})
    assert a.display_name == b.display_name
    assert a.subject_id != b.subject_id
    assert a.binding_value != b.binding_value


def test_trust_relation_has_explicit_semantics_not_trusted_boolean() -> None:
    forbidden = {"trusted", "is_trusted"}
    assert forbidden.isdisjoint(TrustRelation.model_fields)
    relation = TrustRelation(
        relation_id="tr-1",
        subject_id="merchant-1",
        binding_ids=("ib-1",),
        role="recipient",
        purpose="purchase",
        functions=frozenset({"receive_payment"}),
        status="ACTIVE",
        valid_until=LATER,
    )
    assert relation.role == "recipient"
```

Red command, before identity models exist:

```bash
uv run pytest packages/ptf-core/tests/identity/test_identity_models.py -q
```

Expected: non-zero import failure.

Minimal model shape is:

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
    subject_id: str
    binding_ids: tuple[str, ...]
    role: str
    purpose: str
    functions: frozenset[str]
    status: str
    valid_until: datetime | None

class TrustSnapshot(FrozenModel):
    registry_epoch: int
    identity_bindings: tuple[IdentityBinding, ...]
    endpoint_bindings: tuple[EndpointBinding, ...]
    trust_relations: tuple[TrustRelation, ...]
```

These are semantic value shapes only; Plan 01 remains authoritative for cryptographic verification and registry persistence.

## 00/T5 — second-pass result

No additional task correction is required. The task already contains:

- exact files and public interfaces;
- a deterministic grant-union attack fixture;
- property oracles for containment/no-broadening;
- an explicit red command;
- concrete resolver and CP1 signatures/behavior;
- green command;
- commit boundary.

It inherits the task-review protocol. C10 status may be promoted to PASS after the final matrix recheck.

## 00/T8 — verification-only acceptance lock

Task 8 does not introduce a new production behavior; it locks already-implemented foundation semantics in an acceptance fixture. Mark:

```text
verification_only: true
```

Precondition predicate before creating the acceptance artifacts:

```bash
test ! -f tests/acceptance/test_foundation_invariants.py && \
test ! -f tests/fixtures/authorization_regression_v1.json
```

Expected: exit 0 on the clean rewrite branch.

After creating the fixed regression cases and acceptance tests, green is the existing full foundation verification:

```bash
uv run pytest -q
uv run ruff check .
uv run pyright
```

The acceptance test must fail if any locked case expectation is changed without an explicit reviewed fixture/spec change. It introduces no new core callable.

---

# Plan 01 corrections

## 01/T3 — second-pass result

No additional task correction is required. The schema task contains an exact table/column assertion fixture, red command, concrete critical DDL, idempotence behavior, green command, and commit boundary. It inherits the reviewer protocol.

## 01/T4 — Trust Registry/authentication red command

The epoch and signed-request fixtures are sufficiently exact and `verify_signed_request(...)` provides the implementation shape. Add red command before repository/authenticator creation:

```bash
uv run pytest \
  packages/ptf-runtime/tests/test_authentication.py \
  packages/ptf-postgres/tests/test_trust_repository.py -q
```

Expected: non-zero because target modules do not exist.

Green is the same command after implementation.

## 01/T5 — authority persistence red command + C3 alignment

The lifecycle assertions and repository methods are sufficiently explicit. Add red command before `authority_repository.py`:

```bash
uv run pytest packages/ptf-postgres/tests/test_authority_repository.py -q
```

Expected: non-zero because repository implementation is absent.

`activate_grant(...)` consumes the target-generic `ApprovalEvidence` from Contract C3 and verifies:

```text
target_kind == STANDING_GRANT
canonical_fingerprint == deterministic fingerprint of exact grant version
principal_id matches authenticated Principal
assurance/freshness/challenge requirements pass
```

It must not use the superseded `ApprovalEvidence.plan_fingerprint` field.

## 01/T6 — second-pass result

No additional correction is required. The CP2 task has an exact 10,000/4,000/4,000/4,000 race fixture, red command, serializable transaction algorithm, reconciliation semantics, green command, and commit. It inherits the reviewer protocol.

## 01/T7 — second-pass result with binding corrections

The ActionRuntime task already has an explicit public signature, attack/lifecycle fixture, red command, sequencing description, indeterminate rule, green command, and commit.

Apply existing corrections before implementation:

- Contract C3 target-generic ApprovalEvidence;
- readiness/C5 Personal State repository;
- readiness/C6 Protected Resource Catalog;
- Contract C4 task-scoped Safe View;
- Contract C9 route/SDK partition later in T10.

With those signatures read first, T7 may be promoted to PASS after the final matrix recheck.

## 01/T8 — synthetic Protected Executor red command + resource-ref oracle

Before creating the executor, write the existing canary tests plus:

```python
def test_protected_resource_ref_alone_is_not_a_callable_execution_interface(executor) -> None:
    with pytest.raises(TypeError):
        executor.execute_token_use(resource_ref="pr_token_1")
```

The point is structural: the only public execution method requires `ExecutionGrantRecord`, `ExecutionPlan`, and recipient binding; there is no overload that accepts only a resource reference.

Red command:

```bash
uv run pytest \
  executors/synthetic/tests/test_executor.py \
  tests/integration/test_runtime_leak_canary.py -q
```

Expected: non-zero before executor implementation exists.

Existing `execute_token_use(...)` signature is the minimal implementation shape. Green is the same pytest command.

## 01/T9 — AI0 audit red command + Personal-State erasure audit ownership

Before audit implementation, run:

```bash
uv run pytest packages/ptf-runtime/tests/test_audit.py -q
```

Expected: non-zero because audit implementation is absent.

Add the Personal-State erasure integration assertion moved from the inserted repository task:

```python
def test_personal_state_erasure_audit_is_opaque(runtime, audit_repository) -> None:
    runtime.erase_personal_state(principal=PRINCIPAL, item_id=SENSITIVE_CLAIM.id, now=NOW)
    event = audit_repository.latest_for_event_type("PERSONAL_STATE_ERASED")
    assert event.resource_ref == SENSITIVE_CLAIM.id
    serialized = event.model_dump_json()
    assert "passport_number" not in serialized
    assert SENSITIVE_CLAIM.value not in serialized
```

Minimal implementation shape remains the existing `AuditSink` implementation exposing `append_event`, `create_checkpoint`, and `verify_history` with typed event payloads and injected signing key provider.

Green is the existing audit pytest command.

## 01/T10 — API red command and corrected Agent route inventory

The original unscoped `GET /v1/agent/safe-view` is superseded. The Agent route fixture is exactly:

```text
POST /v1/agent/safe-view
POST /v1/agent/actions
PUT  /v1/agent/actions/{action_id}/plan
GET  /v1/agent/actions/{action_id}
GET  /v1/agent/actions/{action_id}/receipt
```

Before API app/router implementation, run:

```bash
uv run pytest \
  packages/ptf-api/tests/test_agent_routes.py \
  packages/ptf-api/tests/test_principal_routes.py -q
```

Expected: non-zero because routes/app do not exist.

`POST /v1/agent/safe-view` requires a `SafeViewRequest` body and invokes `ActionRuntime.get_safe_view(...)`; no parameterless/unscoped endpoint is permitted.

Green is the same API pytest command.

## 01/T11 — acceptance lock is verification-only and must use corrected seams

Task 11 is a verification/review task, not a new production behavior. Mark:

```text
verification_only: true
```

Its existing full pytest/Ruff/Pyright command is the green verification. Its existing Step 5 is already a task-scoped independent review gate and is compatible with the inherited review protocol.

The acceptance route inventory must use the corrected POST Safe View route, and the acceptance suite must include the inserted Personal State/Resource Catalog semantics plus target-generic ApprovalEvidence.

Task 11 commit remains:

```bash
git add tests/acceptance/test_runtime_invariants.py docs/threat-model/runtime-boundaries.md
git commit -m "test: lock durable PTF runtime invariants"
```

---

## Plan 01 second-pass disposition

After applying this document and the earlier September 4 corrections, Plan 01 has 14 executable units for readiness accounting:

```text
11 original runtime tasks
+ Personal State repository insertion
+ Protected Resource Catalog insertion
+ task-scoped Safe View insertion
= 14
```

No Plan 01 task may be marked PASS merely from this summary; the final matrix recheck must verify each dimension against the exact final document chain.