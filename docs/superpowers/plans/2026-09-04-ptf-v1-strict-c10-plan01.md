# PTF v1 Strict C10 Code Supplement — Plan 01 Runtime

Status: **BINDING TEST/IMPLEMENTATION SUPPLEMENT FOR SUPERPOWERS PLAN QUALITY**

This supplement supplies executable code for Plan 01 prose-only tests and freezes the internal persistence ports needed to construct/test `ActionRuntime` without invented fixtures.

## Plan 01 persistence ports

`packages/ptf-runtime/src/ptf_runtime/ports.py` contains these deep protocol-neutral ports in addition to `AuthorityCoordinator`/`AuditSink`:

```python
class StateReader(Protocol):
    def get_hard_policy(self, *, principal_id: str) -> HardPolicy: ...

    def list_active_grants(
        self,
        *,
        principal_id: str,
        agent_subject_id: str,
        now: datetime,
    ) -> tuple[StandingGrant, ...]: ...

    def get_trust_snapshot(
        self,
        *,
        principal_id: str,
        subject_ids: frozenset[str],
        now: datetime,
    ) -> TrustSnapshot: ...

    def get_resource(
        self,
        *,
        principal_id: str,
        resource_ref: str,
    ) -> ProtectedResourceRecord: ...

    def get_execution_grant(
        self,
        *,
        execution_grant_id: str,
    ) -> ExecutionGrantRecord: ...


class ActionStore(Protocol):
    def create(self, prepared: PreparedAction) -> PreparedAction: ...
    def get(self, *, action_id: str) -> PreparedAction: ...
    def put_plan(self, *, action_id: str, plan: ExecutionPlan, fingerprint: str) -> None: ...
    def get_plan(self, *, action_id: str) -> ExecutionPlan: ...
    def put_approval(self, *, action_id: str, approval: ApprovalEvidence) -> None: ...
    def get_approval(self, *, action_id: str) -> ApprovalEvidence | None: ...
    def set_state(self, *, action_id: str, state: PreparedActionState) -> PreparedAction: ...
```

Reference PostgreSQL implementations are named:

```text
PostgresTrustRepository
PostgresAuthorityRepository
PostgresPersonalStateRepository
PostgresResourceCatalogRepository
PostgresActionRepository
PostgresAuditRepository
PostgresAuthorityCoordinator
```

Constructors accept the configured PostgreSQL pool/repository dependency defined in `ptf_postgres.pool`; callers do not receive raw connections.

`ActionRuntime` constructor is:

```python
class ActionRuntime:
    def __init__(
        self,
        *,
        state_reader: StateReader,
        action_store: ActionStore,
        coordinator: AuthorityCoordinator,
        audit_sink: AuditSink,
        safe_view_service: SafeViewService,
    ) -> None: ...
```

The concrete composition root may make a PostgreSQL façade implement `StateReader`; public callers still see `ActionRuntime`, not repository mechanics.

---

## T1 — package bootstrap

No strict supplement is required. The original task already includes concrete import tests/package files and green command; task-quality corrections supply the pre-creation red import check.

---

## T2 — runtime lifecycle values and ports

The original state-enum test is executable. Add target-generic approval tests from Contract C3 to `packages/ptf-runtime/tests/test_runtime_models.py`:

```python
from datetime import UTC, datetime, timedelta

from ptf_runtime.models import ApprovalEvidence, AuthorizationTargetKind

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)


def test_approval_evidence_is_target_generic() -> None:
    evidence = ApprovalEvidence(
        principal_id="P1",
        target_kind=AuthorizationTargetKind.EXECUTION_PLAN,
        canonical_fingerprint="fp-plan",
        assurance_profile="AA2",
        challenge_id="c1",
        authenticated_at=NOW,
        expires_at=NOW + timedelta(minutes=5),
    )
    assert evidence.canonical_fingerprint == "fp-plan"
    assert "plan_fingerprint" not in ApprovalEvidence.model_fields
```

Red/green remain the original `test_runtime_models.py` command; implement exact final-registry runtime shapes and the ports above.

---

## T3 — PostgreSQL schema

Extend `packages/ptf-postgres/src/ptf_postgres/pool.py` public migration seam:

```python
def apply_migrations(*, dsn: str) -> None: ...
```

`packages/ptf-postgres/tests/test_schema.py` contains:

```python
import os

import psycopg

from ptf_postgres.pool import apply_migrations

EXPECTED_TABLES = {
    "ptf_registry_epoch",
    "ptf_identity_bindings",
    "ptf_endpoint_bindings",
    "ptf_trust_relations",
    "ptf_hard_policies",
    "ptf_standing_grants",
    "ptf_grant_usage",
    "ptf_personal_observations",
    "ptf_personal_claims",
    "ptf_personal_preferences",
    "ptf_protected_resources",
    "ptf_actions",
    "ptf_execution_plans",
    "ptf_exact_approvals",
    "ptf_reservations",
    "ptf_execution_grants",
    "ptf_request_nonces",
}


def test_runtime_schema_and_resource_catalog_are_present_and_safe() -> None:
    dsn = os.environ["PTF_TEST_DATABASE_URL"]
    apply_migrations(dsn=dsn)
    with psycopg.connect(dsn) as conn:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema='public'"
            )
        }
        assert EXPECTED_TABLES <= tables
        columns = {
            row[0]
            for row in conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='ptf_protected_resources'"
            )
        }
    forbidden = {
        "secret", "private_key", "card_number", "passport_number",
        "refresh_token", "raw_credential",
    }
    assert forbidden.isdisjoint(columns)


def test_migration_runner_is_idempotent() -> None:
    dsn = os.environ["PTF_TEST_DATABASE_URL"]
    apply_migrations(dsn=dsn)
    apply_migrations(dsn=dsn)
    with psycopg.connect(dsn) as conn:
        count = conn.execute(
            "SELECT count(*) FROM ptf_schema_migrations WHERE version='0001_runtime_state'"
        ).fetchone()[0]
    assert count == 1
```

Red/green command is the original schema pytest command.

---

## T4 — Trust Registry, authentication, and trust administration

`packages/ptf-postgres/tests/test_trust_repository.py` contains:

```python
from datetime import UTC, datetime, timedelta

from ptf_core.identity.models import IdentityBinding, TrustRelation

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)


def test_security_mutations_increment_registry_epoch(repo, principal_actor) -> None:
    e0 = repo.current_epoch()
    binding = IdentityBinding(
        binding_id="ib-m1",
        subject_id="merchant-1",
        binding_type="PUBLIC_KEY",
        binding_value="thumbprint-m1",
        display_name="Merchant",
        status="ACTIVE",
        verified_at=NOW,
        valid_until=NOW + timedelta(days=30),
        provenance_ref="fixture:merchant-root",
    )
    repo.upsert_identity_binding(principal=principal_actor, binding=binding)
    e1 = repo.current_epoch()
    relation = TrustRelation(
        relation_id="tr-1",
        principal_id=principal_actor.subject_id,
        subject_id="merchant-1",
        binding_ids=(binding.binding_id,),
        role="recipient",
        purpose="purchase",
        functions=frozenset({"receive_payment"}),
        status="ACTIVE",
        valid_until=NOW + timedelta(days=30),
    )
    repo.create_trust_relation(principal=principal_actor, relation=relation)
    e2 = repo.current_epoch()
    assert e1 == e0 + 1
    assert e2 == e1 + 1
    assert repo.snapshot(
        principal_id=principal_actor.subject_id,
        subject_ids=frozenset({"merchant-1"}),
        now=NOW,
    ).registry_epoch == e2
```

The same file defines `repo` and `principal_actor` fixtures explicitly:

```python
import os
import pytest

from ptf_postgres.pool import open_pool
from ptf_postgres.trust_repository import PostgresTrustRepository
from ptf_runtime.models import ActorKind, AuthenticatedActor


@pytest.fixture
def repo():
    with open_pool(dsn=os.environ["PTF_TEST_DATABASE_URL"]) as pool:
        yield PostgresTrustRepository(pool=pool)


@pytest.fixture
def principal_actor() -> AuthenticatedActor:
    return AuthenticatedActor(
        subject_id="P1",
        actor_kind=ActorKind.PRINCIPAL,
        binding_id="principal-key-1",
        key_id="principal-key-1",
        authenticated_at=NOW,
        assurance_profile="AA2",
    )
```

`open_pool(*, dsn: str)` is a context-manager seam owned by T3.

`packages/ptf-runtime/tests/test_authentication.py` contains a real signed-request test:

```python
import base64
import hashlib

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ptf_runtime.authentication import AuthenticationFailed, verify_signed_request


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def test_path_or_body_mutation_breaks_agent_authentication(
    trust_snapshot_with_agent_key,
    nonce_store,
) -> None:
    key = Ed25519PrivateKey.generate()
    body = b'{"principal_id":"P1"}'
    canonical = (
        "PTF-SIGNED-REQUEST\nPOST\n/v1/agent/actions\n"
        f"{hashlib.sha256(body).hexdigest()}\n{int(NOW.timestamp())}\nn-1"
    ).encode()
    signature = b64url(key.sign(canonical))
    with pytest.raises(AuthenticationFailed):
        verify_signed_request(
            method="POST",
            path="/v1/agent/other",
            body=body,
            timestamp=NOW,
            nonce="n-1",
            subject_id="agent-1",
            key_id="agent-key-1",
            signature_b64url=signature,
            trust_snapshot=trust_snapshot_with_agent_key,
            nonce_store=nonce_store,
            now=NOW,
        )
```

The test-local trust snapshot fixture must contain the public key corresponding to the signing key; the implementation never trusts a request-carried public key.

`packages/ptf-runtime/tests/test_trust_administration.py` contains:

```python
import pytest

from ptf_runtime.trust import TrustAdministrationError


def test_label_or_empty_bindings_cannot_create_trust(trust_admin, principal_actor) -> None:
    with pytest.raises(TrustAdministrationError):
        trust_admin.create_relation(
            principal=principal_actor,
            subject_id="merchant-x",
            binding_ids=(),
            role="recipient",
            purpose="purchase",
            functions=frozenset({"receive_payment"}),
            now=NOW,
        )
```

Red:

```bash
uv run pytest \
  packages/ptf-runtime/tests/test_authentication.py \
  packages/ptf-runtime/tests/test_trust_administration.py \
  packages/ptf-postgres/tests/test_trust_repository.py -q
```

Expected: non-zero before T4 implementation. Green: same command.

---

## T5 — Hard Policy and Standing Grant lifecycle

`packages/ptf-postgres/tests/test_authority_repository.py` contains:

```python
import pytest

from ptf_runtime.errors import ApprovalTargetMismatch
from ptf_runtime.models import ApprovalEvidence, AuthorizationTargetKind


def test_proposed_grant_is_not_active(authority_repo, principal_actor, proposed_grant) -> None:
    stored = authority_repo.propose_grant(principal=principal_actor, grant=proposed_grant)
    assert stored.status == "PROPOSED"
    assert stored.grant_id not in {
        g.grant_id for g in authority_repo.list_active_grants(
            principal_id=principal_actor.subject_id,
            agent_subject_id=stored.agent_subject_id,
            now=NOW,
        )
    }


def test_execution_plan_approval_cannot_activate_grant(
    authority_repo,
    principal_actor,
    proposed_grant,
) -> None:
    stored = authority_repo.propose_grant(principal=principal_actor, grant=proposed_grant)
    wrong = ApprovalEvidence(
        principal_id=principal_actor.subject_id,
        target_kind=AuthorizationTargetKind.EXECUTION_PLAN,
        canonical_fingerprint="fp-plan",
        assurance_profile="AA2",
        challenge_id="c-plan",
        authenticated_at=NOW,
        expires_at=LATER,
    )
    with pytest.raises(ApprovalTargetMismatch):
        authority_repo.activate_grant(
            principal=principal_actor,
            grant_id=stored.grant_id,
            version=stored.version,
            approval=wrong,
        )
```

The same file defines complete `proposed_grant` using final-registry `AuthorityScope` and a repository fixture using `PostgresAuthorityRepository`.

Red/green: the T5 authority repository pytest command from corrections 2.

---

## T6 — CP2 atomic reservation

`tests/integration/test_runtime_concurrency.py` contains:

```python
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from ptf_runtime.errors import AuthorityCapacityExceeded


def test_three_4000_reservations_cannot_exceed_10000(
    coordinator,
    prepared_action_for_limit_10000,
) -> None:
    barrier = Barrier(3)

    def reserve() -> str:
        barrier.wait()
        try:
            _, grant = coordinator.reserve_and_issue(
                prepared=prepared_action_for_limit_10000,
                expected_grant_version=1,
                reservation_amount_minor=4_000,
                now=NOW,
            )
            return grant.execution_grant_id
        except AuthorityCapacityExceeded:
            return "CAPACITY"

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda _: reserve(), range(3)))

    assert results.count("CAPACITY") == 1
    assert len([x for x in results if x != "CAPACITY"]) == 2
    usage = coordinator.get_usage_for_test(grant_id="g-limit")
    assert usage.committed_amount_minor + usage.reserved_amount_minor <= 10_000
    assert usage.reserved_amount_minor == 8_000
```

Production interface does **not** expose `get_usage_for_test`; the concrete integration fixture may read the safe usage row through a test-only repository helper. Replace the line above in the committed test with `usage_repository.get_usage(grant_id="g-limit")`; `usage_repository` is a same-file fixture, not a coordinator public method.

Repeat the race 50 times under reset database state in a parametrized test:

```python
import pytest

@pytest.mark.parametrize("schedule", range(50))
def test_cp2_race_schedules_never_oversubscribe(schedule, fresh_limit_fixture):
    fresh_limit_fixture.run_three_way_race()
    assert fresh_limit_fixture.usage().reserved_amount_minor <= 10_000
```

Red/green are the original T6 commands.

---

## T6A — Personal State repository + service

Repository test:

```python
def test_correction_supersedes_without_rewriting_history(personal_repo, old_pref, new_pref) -> None:
    personal_repo.put_preference(old_pref)
    replacement = personal_repo.correct_item(
        item_id=old_pref.id,
        replacement=new_pref,
        principal_id="P1",
    )
    old = personal_repo.get(old_pref.id)
    assert old.status == "SUPERSEDED"
    assert old.superseded_by == replacement.id
```

Service erasure/audit test in `packages/ptf-runtime/tests/test_personal_state_service.py`:

```python
def test_erasure_audit_is_opaque(personal_state_service, audit_spy, sensitive_claim, principal_actor) -> None:
    personal_state_service.erase_item(
        principal=principal_actor,
        item_id=sensitive_claim.id,
        now=NOW,
    )
    event = audit_spy.events[-1]
    assert event.event_type == "PERSONAL_STATE_ERASED"
    assert event.resource_ref == sensitive_claim.id
    serialized = event.model_dump_json()
    assert str(sensitive_claim.value) not in serialized
    assert "passport_number" not in serialized
```

`audit_spy` is defined in the same test file:

```python
class AuditSpy:
    def __init__(self) -> None:
        self.events = []
    def append_event(self, event) -> None:
        self.events.append(event)
```

Red/green command covers both repository and service test files. Candidate commit is the corrections-8 T6A commit.

---

## T6B — Protected Resource Catalog

`packages/ptf-postgres/tests/test_resource_repository.py` contains:

```python
from ptf_core.protected_resources.models import ProtectedResourceRecord


def test_catalog_schema_has_no_known_secret_fields() -> None:
    forbidden = {
        "private_key", "card_number", "passport_number", "refresh_token",
        "raw_credential", "secret",
    }
    assert forbidden.isdisjoint(ProtectedResourceRecord.model_fields)


def test_status_update_is_version_checked(resource_repo) -> None:
    record = ProtectedResourceRecord(
        resource_ref="pr-wallet-1",
        principal_id="P1",
        resource_type="PAYMENT_WALLET",
        custody_profile="PROVIDER_BROKERED",
        executor_subject_id="executor-wallet",
        supported_operations=frozenset({"payment.authorize"}),
        safe_metadata={"network": "eip155:1"},
        status="ACTIVE",
        version=1,
    )
    stored = resource_repo.put(record)
    updated = resource_repo.set_status(
        principal_id="P1",
        resource_ref=stored.resource_ref,
        expected_version=1,
        status="SUSPENDED",
    )
    assert updated.status == "SUSPENDED"
    assert updated.version == 2
```

Red/green: the corrected resource repository pytest command.

---

## T6C — task-scoped Safe View runtime derivation

`packages/ptf-runtime/tests/test_safe_view.py` contains:

```python
def test_inferred_personal_state_does_not_change_authority_view(
    safe_view_service,
    personal_repo,
    agent_actor,
    inferred_autonomy_preference,
) -> None:
    request = SafeViewRequest(
        principal_id="P1",
        task_id="t1",
        context_scope="commerce.headphones",
        requested_keys=frozenset({"preferred_form_factor"}),
        purpose="product_selection",
    )
    before = safe_view_service.build(agent=agent_actor, request=request, now=NOW).authority
    personal_repo.put_preference(inferred_autonomy_preference)
    after = safe_view_service.build(agent=agent_actor, request=request, now=NOW).authority
    assert after == before
```

Minimal service seam owned by this inserted task:

```python
class SafeViewService:
    def __init__(
        self,
        *,
        state_reader: StateReader,
        personal_state_repository: PersonalStateRepository,
        resource_repository: ResourceCatalogRepository,
    ) -> None: ...

    def build(
        self,
        *,
        agent: AuthenticatedActor,
        request: SafeViewRequest,
        now: datetime,
    ) -> SafeView: ...
```

It verifies `request.principal_id` context through authoritative state before returning an AuthorityView.

Red/green: corrected Safe View pytest command.

---

## T7 — ActionRuntime lifecycle

`packages/ptf-runtime/tests/test_runtime.py` contains target mismatch/mutation code:

```python
import pytest

from ptf_runtime.errors import ApprovalTargetMismatch, PlanChangedRequiresApproval
from ptf_runtime.models import ApprovalEvidence, AuthorizationTargetKind


def test_grant_approval_cannot_be_recorded_as_exact_plan_approval(runtime, approval_required_action) -> None:
    evidence = ApprovalEvidence(
        principal_id="P1",
        target_kind=AuthorizationTargetKind.STANDING_GRANT,
        canonical_fingerprint=approval_required_action.plan_fingerprint,
        assurance_profile="AA2",
        challenge_id="c-grant",
        authenticated_at=NOW,
        expires_at=LATER,
    )
    with pytest.raises(ApprovalTargetMismatch):
        runtime.record_exact_approval(
            principal=PRINCIPAL,
            action_id=approval_required_action.action_id,
            approval=evidence,
            now=NOW,
        )


def test_plan_mutation_after_approval_requires_new_approval(runtime, approved_action, mutated_plan) -> None:
    with pytest.raises(PlanChangedRequiresApproval):
        runtime.select_plan(
            agent=AGENT,
            action_id=approved_action.action_id,
            plan=mutated_plan,
            source_constraint_ids=mutated_plan.source_constraint_ids,
            now=NOW,
        )
```

`tests/integration/test_runtime_revocation.py` contains:

```python
def test_revoked_grant_blocks_revalidation(runtime, issued_execution_grant, authority_repo) -> None:
    authority_repo.revoke_grant(
        principal=PRINCIPAL,
        grant_id=issued_execution_grant.grant_id,
        version=issued_execution_grant.grant_version,
    )
    result = runtime.revalidate_execution(
        execution_grant_id=issued_execution_grant.execution_grant_id,
        now=NOW,
    )
    assert result.status == "REVOKED"
```

Red/green: original T7 lifecycle command. Constructor/ports are frozen at top of this supplement.

---

## T8 — synthetic Protected Executor

`executors/synthetic/tests/test_executor.py` contains:

```python
import pytest


def test_resource_ref_alone_is_not_execution_authority(executor) -> None:
    with pytest.raises(TypeError):
        executor.execute_token_use(resource_ref="pr-token-1")


def test_plan_fingerprint_mismatch_is_rejected(executor, execution_grant, plan) -> None:
    wrong = plan.model_copy(update={"transaction_binding": "changed"})
    with pytest.raises(Exception):
        executor.execute_token_use(
            execution_grant=execution_grant,
            plan=wrong,
            recipient_binding_id="eb-1",
        )
```

Use the task's typed executor error instead of generic `Exception` in committed code; the implementation task must define `SyntheticExecutionRejected(PTFDomainError)` and the test imports that exact type.

`tests/integration/test_runtime_leak_canary.py` serializes all safe surfaces and checks `PTF_CANARY_RUNTIME_SECRET_71B3` is absent.

Red/green: corrected T8 command.

---

## T9 — AI0 audit chain

`packages/ptf-runtime/tests/test_audit.py` contains:

```python
def test_ai0_detects_mutation_deletion_and_reordering(audit_service, audit_storage) -> None:
    for index in range(3):
        audit_service.append_event(make_safe_event(event_id=f"e{index}"))
    audit_service.create_checkpoint()
    assert audit_service.verify_history() is True

    mutated = audit_storage.clone()
    mutated.mutate_event(event_id="e1", field="event_type", value="CHANGED")
    assert mutated.service().verify_history() is False

    deleted = audit_storage.clone()
    deleted.delete_event(event_id="e1")
    assert deleted.service().verify_history() is False

    reordered = audit_storage.clone()
    reordered.swap_sequence("e0", "e2")
    assert reordered.service().verify_history() is False
```

The test file defines `make_safe_event`; `audit_storage` is a concrete test repository helper over an isolated test database copy, not a production mutation API.

Add Personal State opaque-erasure event verification through `PersonalStateService`, as defined in T6A.

Red/green: T9 audit pytest command.

---

## T10 — Agent/Principal API seams

`packages/ptf-api/tests/test_agent_routes.py` contains:

```python
def test_agent_route_inventory(app) -> None:
    routes = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", set())
        if route.path.startswith("/v1/agent/")
    }
    assert routes == {
        ("POST", "/v1/agent/safe-view"),
        ("POST", "/v1/agent/actions"),
        ("PUT", "/v1/agent/actions/{action_id}/plan"),
        ("GET", "/v1/agent/actions/{action_id}"),
        ("GET", "/v1/agent/actions/{action_id}/receipt"),
    }
```

`packages/ptf-api/tests/test_principal_routes.py` contains:

```python
def test_agent_cannot_call_principal_policy_route(agent_client) -> None:
    response = agent_client.put("/v1/principal/policy", json={})
    assert response.status_code in {401, 403}


def test_safe_view_requires_principal_scoped_request(agent_client) -> None:
    response = agent_client.post(
        "/v1/agent/safe-view",
        json={
            "principal_id": "P1",
            "task_id": "t1",
            "context_scope": "commerce.headphones",
            "requested_keys": ["preferred_form_factor"],
            "purpose": "product_selection",
        },
    )
    assert response.status_code == 200
```

Red/green: corrected T10 API pytest command.

---

## T11 — Plan 01 acceptance lock (`verification_only: true`)

Create `tests/acceptance/test_runtime_invariants.py` with public-seam assertions including:

```python
def test_indeterminate_action_cannot_be_blindly_reauthorized(runtime, indeterminate_execution_grant) -> None:
    import pytest
    from ptf_runtime.errors import IndeterminateOutcomeRequiresReconciliation

    with pytest.raises(IndeterminateOutcomeRequiresReconciliation):
        runtime.authorize_execution(
            action_id=indeterminate_execution_grant.action_id,
            now=NOW,
        )
```

and route/secret/no-grant-union/revocation cases already specified by the original T11 list.

Precondition:

```bash
test ! -f tests/acceptance/test_runtime_invariants.py && \
test ! -f docs/threat-model/runtime-boundaries.md
```

Green is the complete T11 pytest/Ruff/Pyright + speculative-adapter scan. T11 already includes an independent architecture review and also inherits the global two-stage task-review protocol.

---

## Plan 01 strict disposition

All 14 Plan 01 units (11 original + T6A/T6B/T6C) now have concrete test code or an explicit verification-only predicate. Final matrix PASS additionally requires exact fixture/helper definitions in the committed test files and consistency with the final interface registry.