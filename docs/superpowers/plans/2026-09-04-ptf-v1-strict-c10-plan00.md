# PTF v1 Strict C10 Code Supplement — Plan 00 Foundation

Status: **BINDING TEST/IMPLEMENTATION SUPPLEMENT FOR SUPERPOWERS PLAN QUALITY**

This file supplies concrete executable code where the original Plan 00 used prose-only test steps. Exact file ownership, interfaces, green commands, commits, and reviewer gates are read with the final interface registry, registry addendum, task-quality corrections, original Plan 00, and task-review protocol.

## T1/T2

No strict supplement is required: both tasks already contain concrete failing test code, red commands, implementation code, green commands, and commit boundaries. T1 uses the pre-creation import failure added by task-quality corrections 1.

---

## T3 — Personal State freshness and Safe View

Create `packages/ptf-core/tests/personal_state/test_freshness.py` with at least:

```python
from datetime import UTC, datetime, timedelta

from ptf_core.personal_state.freshness import evaluate_freshness
from ptf_core.personal_state.models import (
    FreshnessKind,
    FreshnessPolicy,
    FreshnessState,
    PersonalStateSourceClass,
    Preference,
)

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)


def pref(*, item_id: str, policy: FreshnessPolicy, observed_at: datetime) -> Preference:
    return Preference(
        id=item_id,
        principal_id="P1",
        key="preferred_form_factor",
        value="over-ear",
        source_class=PersonalStateSourceClass.EXPLICIT_PRINCIPAL,
        source_id="principal:P1",
        observed_at=observed_at,
        scope="commerce.headphones",
        sensitivity="LOW",
        evidence_ids=(),
        freshness_policy=policy,
    )


def test_static_is_current() -> None:
    item = pref(
        item_id="static",
        policy=FreshnessPolicy(kind=FreshnessKind.STATIC),
        observed_at=NOW - timedelta(days=365),
    )
    assert evaluate_freshness(item, now=NOW, status=None) is FreshnessState.CURRENT


def test_valid_until_boundary_is_stale_after_expiry() -> None:
    item = pref(
        item_id="until",
        policy=FreshnessPolicy(
            kind=FreshnessKind.VALID_UNTIL,
            valid_until=NOW - timedelta(microseconds=1),
        ),
        observed_at=NOW - timedelta(days=1),
    )
    assert evaluate_freshness(item, now=NOW, status=None) is FreshnessState.STALE


def test_max_age_boundary() -> None:
    current = pref(
        item_id="age-current",
        policy=FreshnessPolicy(kind=FreshnessKind.MAX_AGE, max_age_seconds=60),
        observed_at=NOW - timedelta(seconds=59),
    )
    stale = current.model_copy(
        update={"id": "age-stale", "observed_at": NOW - timedelta(seconds=61)}
    )
    assert evaluate_freshness(current, now=NOW, status=None) is FreshnessState.CURRENT
    assert evaluate_freshness(stale, now=NOW, status=None) is FreshnessState.STALE


def test_status_check_unknown_and_revoked() -> None:
    item = pref(
        item_id="status",
        policy=FreshnessPolicy(kind=FreshnessKind.STATUS_CHECK),
        observed_at=NOW,
    )
    assert evaluate_freshness(item, now=NOW, status=None) is FreshnessState.UNKNOWN
    assert evaluate_freshness(item, now=NOW, status="REVOKED") is FreshnessState.REVOKED
```

Create `packages/ptf-core/tests/personal_state/test_safe_view.py` with at least:

```python
from datetime import UTC, datetime, timedelta

from ptf_core.personal_state.models import (
    FreshnessKind,
    FreshnessPolicy,
    PersonalStateSourceClass,
    Preference,
)
from ptf_core.personal_state.safe_view import build_context_view

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
STATIC = FreshnessPolicy(kind=FreshnessKind.STATIC)


def make_pref(
    *,
    item_id: str,
    key: str,
    value: str,
    source: PersonalStateSourceClass,
    scope: str = "commerce.headphones",
    observed_at: datetime = NOW,
    policy: FreshnessPolicy = STATIC,
) -> Preference:
    return Preference(
        id=item_id,
        principal_id="P1",
        key=key,
        value=value,
        source_class=source,
        source_id=f"fixture:{item_id}",
        observed_at=observed_at,
        scope=scope,
        sensitivity="LOW",
        evidence_ids=(),
        freshness_policy=policy,
        confidence_millis=800 if source is PersonalStateSourceClass.INFERRED else None,
    )


def test_context_view_is_principal_scope_and_key_minimized() -> None:
    explicit = make_pref(
        item_id="p1", key="preferred_form_factor", value="over-ear",
        source=PersonalStateSourceClass.EXPLICIT_PRINCIPAL,
    )
    inferred = make_pref(
        item_id="p2", key="preferred_brand", value="ExampleBrand",
        source=PersonalStateSourceClass.INFERRED,
    )
    sensitive = make_pref(
        item_id="p3", key="home_address", value="PTF_CANARY_HOME_4A2D",
        source=PersonalStateSourceClass.EXPLICIT_PRINCIPAL,
        scope="personal.address",
    )
    view = build_context_view(
        principal_id="P1",
        claims=(),
        preferences=(explicit, inferred, sensitive),
        requested_keys=frozenset({"preferred_form_factor", "preferred_brand"}),
        context_scope="commerce.headphones",
        allow_stale_preferences=False,
        now=NOW,
    )
    assert {item.key for item in view.items} == {
        "preferred_form_factor", "preferred_brand"
    }
    assert next(x for x in view.items if x.key == "preferred_brand").basis == "inferred"
    assert "PTF_CANARY_HOME_4A2D" not in view.model_dump_json()
    assert "grant" not in " ".join(view.model_fields).lower()
    assert "authority" not in " ".join(view.model_fields).lower()
```

Red:

```bash
uv run pytest packages/ptf-core/tests/personal_state -q
```

Expected: non-zero before models/freshness/Safe View implementation exists.

Minimal implementation signatures are those in the final registry addendum, including `build_context_view(... principal_id, now ...)`.

Green: same command, exit 0.

---

## T4 — Subjects, bindings, authentication evidence, TrustRelations

`packages/ptf-core/tests/identity/test_identity_models.py` contains:

```python
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from ptf_core.identity.models import (
    AuthenticationEvidence,
    IdentityBinding,
    TrustRelation,
)

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(days=30)


def test_subject_id_alone_is_not_authentication() -> None:
    with pytest.raises(ValidationError):
        AuthenticationEvidence(subject_id="merchant-1")


def test_display_name_is_not_identity_binding() -> None:
    a = IdentityBinding(
        binding_id="ib-1",
        subject_id="merchant-1",
        binding_type="PUBLIC_KEY",
        binding_value="thumbprint-A",
        display_name="Example Merchant",
        status="ACTIVE",
        verified_at=NOW,
        valid_until=LATER,
        provenance_ref="fixture:root-a",
    )
    b = a.model_copy(update={
        "binding_id": "ib-2",
        "subject_id": "merchant-2",
        "binding_value": "thumbprint-B",
    })
    assert a.display_name == b.display_name
    assert a.subject_id != b.subject_id
    assert a.binding_value != b.binding_value


def test_trust_relation_is_principal_role_purpose_and_function_scoped() -> None:
    assert "trusted" not in TrustRelation.model_fields
    relation = TrustRelation(
        relation_id="tr-1",
        principal_id="P1",
        subject_id="merchant-1",
        binding_ids=("ib-1",),
        role="recipient",
        purpose="purchase",
        functions=frozenset({"receive_payment"}),
        status="ACTIVE",
        valid_until=LATER,
    )
    assert relation.principal_id == "P1"
    assert relation.role == "recipient"
    assert relation.purpose == "purchase"
```

Red:

```bash
uv run pytest packages/ptf-core/tests/identity/test_identity_models.py -q
```

Expected: non-zero before identity models exist.

Implement the exact final-registry identity shapes. Green: same command plus `uv run pyright`.

---

## T5 — Authority containment, no grant union, CP1

`packages/ptf-core/tests/authority/test_resolver.py` contains an isolated no-union test:

```python
from datetime import UTC, datetime, timedelta

from ptf_core.authority.models import (
    ActionRequest,
    AmountLimit,
    AuthorityScope,
    DecisionKind,
    HardPolicy,
    StandingGrant,
)
from ptf_core.authority.resolver import resolve_preliminary
from ptf_core.identity.models import TrustSnapshot

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(days=1)


def scope(*, recipient: str, max_amount: int) -> AuthorityScope:
    return AuthorityScope(
        operations=frozenset({"payment.authorize"}),
        resource_refs=frozenset({"wallet-1"}),
        recipient_ids=frozenset({recipient}),
        purposes=frozenset({"purchase"}),
        amount_limits=(AmountLimit(currency="USD", max_amount_minor=max_amount),),
        valid_until=LATER,
        min_assurance="AA1",
    )


def grant(grant_id: str, recipient: str, max_amount: int) -> StandingGrant:
    return StandingGrant(
        grant_id=grant_id,
        principal_id="P1",
        agent_subject_id="agent-1",
        version=1,
        scope=scope(recipient=recipient, max_amount=max_amount),
        status="ACTIVE",
        created_at=NOW,
        activated_at=NOW,
    )


def test_separate_grants_are_not_unioned() -> None:
    policy = HardPolicy(
        policy_id="hp1",
        principal_id="P1",
        version=1,
        scope=scope(recipient="merchant-x", max_amount=10_000),
        status="ACTIVE",
        updated_at=NOW,
    )
    request = ActionRequest(
        principal_id="P1",
        operation="payment.authorize",
        resource_ref="wallet-1",
        recipient_id="merchant-x",
        purpose="purchase",
        amount_minor=5_000,
        currency="USD",
    )
    decision = resolve_preliminary(
        request=request,
        hard_policy=policy,
        active_grants=(
            grant("g-a", "merchant-x", 500),
            grant("g-b", "merchant-y", 5_000),
        ),
        trust_snapshot=TrustSnapshot(
            principal_id="P1",
            registry_epoch=1,
            identity_bindings=(),
            endpoint_bindings=(),
            trust_relations=(),
        ),
        now=NOW,
    )
    assert decision.kind is DecisionKind.APPROVAL_REQUIRED
```

This expected result intentionally supersedes the old `grant-union-attack = DENY` fixture. Exact approval remains a valid separate authority path when Hard Policy permits it; the no-union invariant is that the request is **not** autonomously authorized from A+B.

`packages/ptf-core/tests/authority/test_containment.py` contains at least:

```python
from ptf_core.authority.constraints import constraint_contains
from ptf_core.authority.models import AmountLimit, AuthorityScope


def test_child_amount_must_be_contained() -> None:
    parent = AuthorityScope(
        operations=frozenset({"payment.authorize"}),
        resource_refs=frozenset({"wallet-1"}),
        recipient_ids=frozenset({"m1"}),
        purposes=frozenset({"purchase"}),
        amount_limits=(AmountLimit(currency="USD", max_amount_minor=5_000),),
    )
    broader = parent.model_copy(update={
        "amount_limits": (AmountLimit(currency="USD", max_amount_minor=5_001),)
    })
    assert constraint_contains(parent, parent)
    assert not constraint_contains(parent, broader)
```

Red:

```bash
uv run pytest packages/ptf-core/tests/authority -q
```

Expected: non-zero before authority implementation. Implement exact registry shapes/resolver/CP1 seam. Green: same command.

---

## T6 — planning, Enforcement Map, Assurance Manifest, plan fingerprint

`packages/ptf-core/tests/planning/test_enforcement_map.py` contains:

```python
import pytest

from ptf_core.planning.models import (
    ConstraintEnforcement,
    EnforcementLocation,
    EnforcementMap,
)
from ptf_core.planning.validation import PlanValidationError, validate_execution_plan


def test_missing_source_constraint_fails_closed(make_execution_plan) -> None:
    plan = make_execution_plan(
        source_constraint_ids=("operation", "recipient", "amount"),
        enforcement_map=EnforcementMap(entries=(
            ConstraintEnforcement(
                constraint_id="operation",
                locations=frozenset({EnforcementLocation.PTF}),
            ),
            ConstraintEnforcement(
                constraint_id="recipient",
                locations=frozenset({EnforcementLocation.PTF}),
            ),
        )),
    )
    with pytest.raises(PlanValidationError):
        validate_execution_plan(
            plan,
            source_constraint_ids=("operation", "recipient", "amount"),
        )
```

The test file defines `make_execution_plan` locally with complete final-registry constructors; it is not an undefined external fixture. Minimum factory body:

```python
def make_execution_plan(*, source_constraint_ids, enforcement_map):
    from datetime import UTC, datetime, timedelta
    from ptf_core.authority.models import AuthorityBasis, AuthorityBasisKind
    from ptf_core.planning.models import ExecutionPlan
    from ptf_core.protected_resources.models import AssuranceManifest, ArtifactCustodyMode

    now = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
    assurance = AssuranceManifest(
        profile_id="test",
        profile_version="1",
        control_runtime_admin_domain="test-runtime",
        protected_executor_admin_domain="test-executor",
        plaintext_observers=frozenset({"executor"}),
        usable_resource_invokers=frozenset({"executor"}),
        agent_model_visibility="NONE",
        recipient_disclosure=(),
        resource_exportability="NON_EXPORTABLE",
        recipient_authentication=("binding:eb-1",),
        principal_approval_assurance="AA1",
        remote_attestation=(),
        artifact_custody_mode=ArtifactCustodyMode.LOCAL_ONLY,
        recovery_parties=frozenset(),
        audit_integrity_profile="AI0",
        residual_risks=("test fixture",),
    )
    return ExecutionPlan(
        plan_id="plan-1",
        action_id="action-1",
        principal_id="P1",
        authority_basis=AuthorityBasis(
            kind=AuthorityBasisKind.STANDING_GRANT,
            principal_id="P1",
            source_id="g1",
            source_version=1,
            source_constraint_ids=tuple(source_constraint_ids),
        ),
        trust_registry_epoch=1,
        identity_binding_ids=("ib-1",),
        endpoint_binding_ids=("eb-1",),
        resource_refs=("wallet-1",),
        disclosure_plan=None,
        executor_subject_id="executor-1",
        executor_profile_id="test",
        protocol="synthetic",
        protocol_operation="synthetic.execute",
        transaction_binding="tx:test",
        enforcement_map=enforcement_map,
        source_constraint_ids=tuple(source_constraint_ids),
        reservation_amount_minor=None,
        reservation_currency=None,
        replay_key="replay-1",
        idempotency_mode="ONE_USE",
        expected_evidence_types=("synthetic",),
        failure_semantics="NO_EXTERNAL_EFFECT_BEFORE_COMMIT",
        expires_at=now + timedelta(minutes=5),
        assurance_manifest=assurance,
    )
```

`packages/ptf-core/tests/planning/test_plan_fingerprint.py` mutates all approved dimensions:

```python
from ptf_core.planning.fingerprint import plan_fingerprint


def test_material_plan_mutations_change_fingerprint(make_complete_plan) -> None:
    original = make_complete_plan()
    mutations = (
        {"transaction_binding": "tx:changed"},
        {"executor_profile_id": "different"},
        {"resource_refs": ("other-resource",)},
        {"protocol_operation": "synthetic.changed"},
    )
    for mutation in mutations:
        assert plan_fingerprint(original) != plan_fingerprint(
            original.model_copy(update=mutation)
        )
```

`make_complete_plan` is defined in the same file by calling the complete constructor pattern above. Additional mutation cases required by the original task are recipient/binding, amount/currency, disclosure, downgrade, expiry, Enforcement Map, reservation/replay semantics, and Assurance Manifest.

Red:

```bash
uv run pytest \
  packages/ptf-core/tests/planning \
  packages/ptf-core/tests/protected_resources -q
```

Expected: non-zero before planning models exist. Green: same command.

---

## T7 — AuditEvent/PTFReceipt protected-field rejection

`packages/ptf-core/tests/audit/test_receipt.py` contains:

```python
from ptf_core.audit.models import AuditEvent, PTFReceipt


def test_audit_and_receipt_have_no_raw_payload_escape_hatch() -> None:
    forbidden = {
        "payload", "raw", "context", "credential", "secret", "private_key",
        "card_number", "passport_number", "refresh_token", "raw_credential",
    }
    assert forbidden.isdisjoint(AuditEvent.model_fields)
    assert forbidden.isdisjoint(PTFReceipt.model_fields)


def test_receipt_requires_normative_explanation_fields() -> None:
    required = {
        "authority_basis", "agent_subject_id", "operation", "recipient_id",
        "plan_fingerprint", "enforcement_map", "executor_subject_id",
        "executor_profile_id", "protocol", "external_evidence_refs", "outcome",
        "assurance_manifest", "residual_risks", "started_at", "finished_at",
    }
    assert required.issubset(PTFReceipt.model_fields)
```

Red:

```bash
uv run pytest packages/ptf-core/tests/audit/test_receipt.py -q
```

Expected: non-zero before audit models exist. Implement exact registry-addendum models. Green: same command.

---

## T8 — foundation acceptance lock (`verification_only: true`)

The old corpus decisions are replaced by an isolation-safe set:

```json
[
  {"id":"hard-policy-deny","expected":"DENY"},
  {"id":"no-covering-grant","expected":"APPROVAL_REQUIRED"},
  {"id":"standing-grant-covered","expected":"PROVISIONALLY_AUTHORIZABLE"},
  {"id":"recipient-not-trusted","expected":"DENY"},
  {"id":"expired-grant-no-autonomy","expected":"APPROVAL_REQUIRED"},
  {"id":"grant-union-attack","expected":"APPROVAL_REQUIRED"}
]
```

The test code must make the distinguishing precondition explicit for each case; e.g. the grant-union fixture keeps Hard Policy permissive and trust valid so the only reason autonomous authorization fails is lack of one independently covering grant.

Create `tests/acceptance/test_foundation_invariants.py` with at least:

```python
from ptf_core.authority.models import DecisionKind


def test_personal_state_change_never_upgrades_authority(
    build_authority_case,
    evaluate_case,
) -> None:
    for case_id in (
        "hard-policy-deny",
        "no-covering-grant",
        "standing-grant-covered",
        "recipient-not-trusted",
        "expired-grant-no-autonomy",
        "grant-union-attack",
    ):
        case = build_authority_case(case_id)
        before = evaluate_case(case, inferred_preferences=())
        after = evaluate_case(
            case,
            inferred_preferences=(("autonomous_purchase_limit", "999999999"),),
        )
        rank = {
            DecisionKind.DENY: 0,
            DecisionKind.APPROVAL_REQUIRED: 1,
            DecisionKind.PROVISIONALLY_AUTHORIZABLE: 2,
        }
        assert rank[after.kind] <= rank[before.kind]
```

`build_authority_case` and `evaluate_case` are defined in the same test file using the final registry constructors; they are not external magic fixtures.

Precondition:

```bash
test ! -f tests/acceptance/test_foundation_invariants.py && \
test ! -f tests/fixtures/authorization_regression_v1.json
```

Green remains the complete Plan 00 pytest/Ruff/Pyright verification and forbidden-import scan.

---

## Plan 00 strict disposition

With this supplement, every behavioral Plan 00 task has executable test code and every verification-only task has an exact predicate plus executable acceptance code. Matrix status still requires the final cross-plan name check and reviewer-gate inheritance.