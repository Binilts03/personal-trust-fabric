# PTF v1 Strict C10 Plan 01 Fixes — Fixture/Helper Closure

Status: **BINDING OVER `2026-09-04-ptf-v1-strict-c10-plan01.md`; APPROVED SPEC UNCHANGED**

This file replaces the remaining shorthand/magic fixtures in the strict Plan 01 supplement with executable local fixtures/helpers.

---

## T4 authentication test — bind the exact generated key into TrustSnapshot

The earlier test that generated an Ed25519 key separately from `trust_snapshot_with_agent_key` is superseded.

Use this complete test in `packages/ptf-runtime/tests/test_authentication.py`:

```python
import base64
import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ptf_core.identity.models import IdentityBinding, TrustSnapshot
from ptf_runtime.authentication import AuthenticationFailed, verify_signed_request

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(minutes=5)


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


class MemoryNonceStore:
    def __init__(self) -> None:
        self._used: set[str] = set()

    def consume(self, *, subject_id: str, nonce: str, expires_at: datetime) -> None:
        key = f"{subject_id}:{nonce}"
        if key in self._used:
            raise AuthenticationFailed("nonce replay")
        self._used.add(key)


def make_agent_snapshot(public_key: bytes) -> TrustSnapshot:
    return TrustSnapshot(
        principal_id="P1",
        registry_epoch=1,
        identity_bindings=(
            IdentityBinding(
                binding_id="agent-key-1",
                subject_id="agent-1",
                binding_type="ED25519_PUBLIC_KEY_RAW_B64URL",
                binding_value=b64url(public_key),
                display_name="Test Agent",
                status="ACTIVE",
                verified_at=NOW,
                valid_until=LATER,
                provenance_ref="fixture:agent-enrollment",
            ),
        ),
        endpoint_bindings=(),
        trust_relations=(),
    )


def signed_request(
    *,
    private_key: Ed25519PrivateKey,
    method: str,
    path: str,
    body: bytes,
    nonce: str,
) -> str:
    canonical = (
        f"PTF-SIGNED-REQUEST\n{method}\n{path}\n"
        f"{hashlib.sha256(body).hexdigest()}\n{int(NOW.timestamp())}\n{nonce}"
    ).encode()
    return b64url(private_key.sign(canonical))


def test_valid_agent_signature_authenticates_bound_key() -> None:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    body = b'{"principal_id":"P1"}'
    actor = verify_signed_request(
        method="POST",
        path="/v1/agent/actions",
        body=body,
        timestamp=NOW,
        nonce="n-1",
        subject_id="agent-1",
        key_id="agent-key-1",
        signature_b64url=signed_request(
            private_key=private_key,
            method="POST",
            path="/v1/agent/actions",
            body=body,
            nonce="n-1",
        ),
        trust_snapshot=make_agent_snapshot(public_key),
        nonce_store=MemoryNonceStore(),
        now=NOW,
    )
    assert actor.subject_id == "agent-1"
    assert actor.binding_id == "agent-key-1"


def test_path_mutation_breaks_agent_authentication() -> None:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    body = b'{"principal_id":"P1"}'
    signature = signed_request(
        private_key=private_key,
        method="POST",
        path="/v1/agent/actions",
        body=body,
        nonce="n-2",
    )
    with pytest.raises(AuthenticationFailed):
        verify_signed_request(
            method="POST",
            path="/v1/agent/other",
            body=body,
            timestamp=NOW,
            nonce="n-2",
            subject_id="agent-1",
            key_id="agent-key-1",
            signature_b64url=signature,
            trust_snapshot=make_agent_snapshot(public_key),
            nonce_store=MemoryNonceStore(),
            now=NOW,
        )


def test_nonce_replay_fails() -> None:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    body = b'{}'
    nonce_store = MemoryNonceStore()
    signature = signed_request(
        private_key=private_key,
        method="GET",
        path="/v1/agent/actions/a1",
        body=body,
        nonce="n-replay",
    )
    kwargs = dict(
        method="GET",
        path="/v1/agent/actions/a1",
        body=body,
        timestamp=NOW,
        nonce="n-replay",
        subject_id="agent-1",
        key_id="agent-key-1",
        signature_b64url=signature,
        trust_snapshot=make_agent_snapshot(public_key),
        nonce_store=nonce_store,
        now=NOW,
    )
    verify_signed_request(**kwargs)
    with pytest.raises(AuthenticationFailed):
        verify_signed_request(**kwargs)
```

`NonceStore` production port must expose the same `consume(subject_id, nonce, expires_at)` behavior. The test uses an in-memory implementation because nonce replay semantics are the unit under test; PostgreSQL nonce persistence is exercised in repository/integration tests.

---

## T6 CP2 race — remove undefined `fresh_limit_fixture`

Use a same-file helper in `tests/integration/test_runtime_concurrency.py`:

```python
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from ptf_runtime.errors import AuthorityCapacityExceeded


def run_three_way_race(*, coordinator, prepared, usage_repository) -> tuple[int, int]:
    barrier = Barrier(3)

    def reserve(_: int) -> bool:
        barrier.wait()
        try:
            coordinator.reserve_and_issue(
                prepared=prepared,
                expected_grant_version=1,
                reservation_amount_minor=4_000,
                now=NOW,
            )
            return True
        except AuthorityCapacityExceeded:
            return False

    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(reserve, range(3)))

    usage = usage_repository.get_usage(grant_id="g-limit")
    assert usage.committed_amount_minor + usage.reserved_amount_minor <= 10_000
    return sum(results), usage.reserved_amount_minor


@pytest.mark.parametrize("schedule", range(50))
def test_cp2_race_schedules_never_oversubscribe(
    schedule,
    postgres_test_context,
) -> None:
    # `schedule` forces 50 independent database setups; no claim is made that
    # Python controls the database scheduler beyond starting concurrent contenders.
    ctx = postgres_test_context(seed=f"cp2-{schedule}")
    ctx.seed_active_grant(
        grant_id="g-limit",
        principal_id="P1",
        agent_subject_id="agent-1",
        amount_limit_minor=10_000,
        currency="USD",
        version=1,
    )
    prepared = ctx.prepared_action(
        grant_id="g-limit",
        grant_version=1,
        plan_fingerprint=f"fp-{schedule}",
    )
    successes, reserved = run_three_way_race(
        coordinator=ctx.coordinator,
        prepared=prepared,
        usage_repository=ctx.usage_repository,
    )
    assert successes == 2
    assert reserved == 8_000
```

`postgres_test_context` is defined in the same file as:

```python
@pytest.fixture
def postgres_test_context():
    from tests.integration.runtime_context import RuntimeTestContext

    contexts: list[RuntimeTestContext] = []

    def factory(*, seed: str) -> RuntimeTestContext:
        ctx = RuntimeTestContext.create(
            dsn=os.environ["PTF_TEST_DATABASE_URL"],
            namespace=seed,
        )
        contexts.append(ctx)
        return ctx

    yield factory

    for ctx in contexts:
        ctx.close()
```

Add exact file to T6:

```text
tests/integration/runtime_context.py
```

`RuntimeTestContext` is a test harness, not production API. Its public test methods are exactly:

```python
class RuntimeTestContext:
    @classmethod
    def create(cls, *, dsn: str, namespace: str) -> "RuntimeTestContext": ...
    def seed_active_grant(
        self,
        *,
        grant_id: str,
        principal_id: str,
        agent_subject_id: str,
        amount_limit_minor: int,
        currency: str,
        version: int,
    ) -> None: ...
    def prepared_action(
        self,
        *,
        grant_id: str,
        grant_version: int,
        plan_fingerprint: str,
    ) -> PreparedAction: ...
    @property
    def coordinator(self) -> PostgresAuthorityCoordinator: ...
    @property
    def usage_repository(self) -> PostgresAuthorityRepository: ...
    def close(self) -> None: ...
```

The implementation creates a per-namespace schema or otherwise transactionally isolated rows, applies migrations, and cleans only its own test namespace. It does not expose arbitrary SQL to the test case.

---

## T8 synthetic executor — use exact typed rejection

`executors/synthetic/src/ptf_synthetic_executor/executor.py` defines:

```python
class SyntheticExecutionRejected(PTFDomainError):
    pass
```

Use:

```python
from ptf_synthetic_executor.executor import SyntheticExecutionRejected


def test_plan_fingerprint_mismatch_is_rejected(executor, execution_grant, plan) -> None:
    wrong = plan.model_copy(update={"transaction_binding": "changed"})
    with pytest.raises(SyntheticExecutionRejected):
        executor.execute_token_use(
            execution_grant=execution_grant,
            plan=wrong,
            recipient_binding_id="eb-1",
        )
```

No generic `Exception` assertion is permitted in the strict plan.

---

## T9 AI0 storage test helper — exact test-only seam

The earlier `audit_storage.clone()/mutate_event()` shorthand is replaced by a test-only repository helper in:

```text
packages/ptf-postgres/tests/audit_test_support.py
```

```python
class AuditTestStore:
    @classmethod
    def create(cls, *, dsn: str, namespace: str) -> "AuditTestStore": ...
    def service(self) -> AuditService: ...
    def append_safe_event(self, *, event_id: str) -> None: ...
    def checkpoint(self) -> None: ...
    def clone(self, *, namespace: str) -> "AuditTestStore": ...
    def mutate_event_type(self, *, event_id: str, value: str) -> None: ...
    def delete_event(self, *, event_id: str) -> None: ...
    def swap_sequence(self, *, first_event_id: str, second_event_id: str) -> None: ...
    def close(self) -> None: ...
```

The three tamper tests create independent clones and call only these exact helper operations. This helper is test-only and must not be packaged/exported by `ptf_postgres`.

---

## C10 effect

These snippets eliminate the remaining undefined/misaligned test helpers in strict Plan 01. The task-quality matrix must use this file over conflicting shorthand in `strict-c10-plan01.md`.