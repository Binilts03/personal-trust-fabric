# PTF v1 Strict C10 Code Supplement — Plan 03 AP2

Status: **BINDING TEST/IMPLEMENTATION SUPPLEMENT FOR SUPERPOWERS PLAN QUALITY**

This supplement supplies executable fixtures/tests and exact implementation call shapes for Plan 03 where the original AP2 plan and corrections remained prose-heavy. It is read with the final interface registry, AP2 pinned-API research, corrections 4/8, the task-review protocol, and the original Plan 03.

All canonical PTF values use the names from the final interface registry. AP2 artifacts remain protocol Evidence Artifacts; they never become canonical authority.

---

## Shared reference fixture

Create `adapters/ap2/tests/reference.py` in T3:

```python
from datetime import UTC, datetime, timedelta

from ptf_core.authority.models import AmountLimit, AuthorityScope, StandingGrant

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(hours=1)

GRANT = StandingGrant(
    grant_id="g-ap2-1",
    principal_id="P1",
    agent_subject_id="agent-1",
    version=1,
    scope=AuthorityScope(
        operations=frozenset({"payment.authorize"}),
        resource_refs=frozenset({"wallet-resource-1"}),
        recipient_ids=frozenset({"M-1"}),
        purposes=frozenset({"purchase"}),
        amount_limits=(AmountLimit(currency="USD", max_amount_minor=5_000),),
        max_uses=10,
        valid_until=LATER,
        disclosure_permissions=frozenset({"amount", "recipient"}),
        max_delegation_depth=1,
        min_assurance="AA1",
    ),
    status="ACTIVE",
    created_at=NOW,
    activated_at=NOW,
)
```

Protocol fixture keys are generated inside executor tests. Private JWK `d` values are never stored in shared safe fixtures.

---

## T1 — dependency convergence

`verification_only: true` from correction 4 is binding. No behavioral red test is fabricated.

Precondition/verification commands are exactly the original pinned AP2 metadata/dependency checks plus the complete accepted Plan 00–02 suite. The task performs no dependency edit when the reviewed pins already match.

---

## T2 — pinned AP2 package bootstrap

Before creating packages, run:

```bash
uv run python -c "import ptf_ap2, ptf_ap2_signing"
```

Expected: non-zero import failure.

Create the original import tests, then package metadata using the exact AP2 Git commit from the verified profile. Green:

```bash
uv run pytest adapters/ap2/tests/test_import.py executors/ap2-signing/tests/test_import.py -q
```

---

## T3 — no-broadening mandate mapping

Create `adapters/ap2/tests/test_mapping.py` before `mapping.py`:

```python
import pytest

from ptf_ap2.errors import AP2MappingRejected
from ptf_ap2.mapping import build_open_payment_mandate
from .reference import GRANT, NOW, LATER

HOLDER_JWK = {
    "kty": "EC",
    "crv": "P-256",
    "x": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "y": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
}


def test_open_mandate_cannot_exceed_standing_grant() -> None:
    mandate = build_open_payment_mandate(
        grant=GRANT,
        holder_public_jwk=HOLDER_JWK,
        issued_at=NOW,
        expires_at=LATER,
    )
    dumped = mandate.model_dump(mode="python", by_alias=True)
    text = repr(dumped)
    assert "M-1" in text
    assert "5000" in text
    assert "cnf" in text


def test_inactive_grant_cannot_map_to_open_authority() -> None:
    with pytest.raises(AP2MappingRejected):
        build_open_payment_mandate(
            grant=GRANT.model_copy(update={"status": "SUSPENDED"}),
            holder_public_jwk=HOLDER_JWK,
            issued_at=NOW,
            expires_at=LATER,
        )


def test_open_mandate_expiry_cannot_exceed_grant_expiry() -> None:
    with pytest.raises(AP2MappingRejected):
        build_open_payment_mandate(
            grant=GRANT,
            holder_public_jwk=HOLDER_JWK,
            issued_at=NOW,
            expires_at=LATER + timedelta(seconds=1),
        )
```

Add a closed-mandate test using a registry-conformant `ExecutionPlan` fixture and assert recipient `M-1`, amount `2_500`, transaction ID, and payment instrument **reference** are exact to that plan. Add rejection cases for recipient/amount broadening and a raw credential value.

Red:

```bash
uv run pytest adapters/ap2/tests/test_mapping.py -q
```

Expected: import failure.

Minimal implementation signatures are exactly:

```python
def build_open_payment_mandate(
    *, grant: StandingGrant, holder_public_jwk: dict[str, object],
    issued_at: datetime, expires_at: datetime,
) -> OpenPaymentMandate: ...


def build_closed_payment_mandate(
    *, plan: ExecutionPlan, transaction_id: str,
    payment_instrument_reference: str,
    issued_at: datetime, expires_at: datetime,
) -> PaymentMandate: ...
```

Use pinned upstream AP2 generated models, not PTF copies. Green is the same pytest command.

---

## T4 — AP2 Enforcement Map

Create `adapters/ap2/tests/test_enforcement.py` before `enforcement.py`:

```python
import pytest

from ptf_ap2.enforcement import build_ap2_enforcement_map
from ptf_core.planning.validation import validate_execution_plan


def test_ap2_map_does_not_claim_hard_policy_is_enforced_by_signature(ap2_plan, grant) -> None:
    result = build_ap2_enforcement_map(
        grant=grant,
        plan=ap2_plan,
        mandate_kind="CLOSED_PAYMENT",
        disclosure_hash_mode="sd_hash",
    )
    by_id = {entry.constraint_id: entry for entry in result.entries}
    assert "PROTOCOL" not in {x.value for x in by_id["hard-policy"].locations}
    assert {x.value for x in by_id["merchant-audience-nonce"].locations} >= {"PTF", "PROTOCOL"}


def test_issuer_jwt_hash_requires_explicit_downstream_minimization(ap2_plan, grant) -> None:
    with pytest.raises(Exception):
        build_ap2_enforcement_map(
            grant=grant,
            plan=ap2_plan,
            mandate_kind="CLOSED_PAYMENT",
            disclosure_hash_mode="issuer_jwt_hash",
        )
```

A third test deletes one source constraint mapping and asserts `validate_execution_plan(...)` fails.

Red:

```bash
uv run pytest adapters/ap2/tests/test_enforcement.py -q
```

Implementation seam remains:

```python
def build_ap2_enforcement_map(
    *, grant: StandingGrant | None, plan: ExecutionPlan,
    mandate_kind: str, disclosure_hash_mode: str,
) -> EnforcementMap: ...
```

Green is the same pytest command.

---

## T5 — protected AP2 signing executor

Create `executors/ap2-signing/tests/test_executor.py` before implementation. The test generates P-256 issuer/holder keys in-process and uses canary `PTF_CANARY_AP2_SIGNING_KEY_83C1` only as a separately tracked marker.

Required executable tests:

```python
def test_executor_rejects_plan_fingerprint_mismatch(executor, execution_grant, plan, open_payload) -> None:
    bad = execution_grant.model_copy(update={"plan_fingerprint": "0" * 64})
    with pytest.raises(Exception):
        executor.issue_open_mandate(execution_grant=bad, plan=plan, payload=open_payload)


def test_artifact_safe_metadata_contains_no_private_jwk(executor, execution_grant, plan, open_payload) -> None:
    artifact = executor.issue_open_mandate(
        execution_grant=execution_grant,
        plan=plan,
        payload=open_payload,
    )
    safe = artifact.safe_metadata.model_dump_json()
    assert '"d"' not in safe
    assert "PTF_CANARY_AP2_SIGNING_KEY_83C1" not in safe
```

Add explicit wrong audience, expired grant, broadened payload, and disallowed hash-mode tests for `present_closed_mandate`.

Red:

```bash
uv run pytest executors/ap2-signing/tests/test_executor.py tests/integration/test_ap2_leak_canary.py -q
```

Minimal executor interface is exactly the two signatures in correction 4/original T5. The implementation must call pinned upstream `MandateClient.create(...)`/`present(...)`; keys are constructor dependencies and never method/request DTO arguments.

Green is the same pytest command.

---

## T6 — plan-bound AP2 flow

Correction 4's two-stage open-authority seam is binding. Create `adapters/ap2/tests/test_flow.py` with a spy signing executor:

```python
class SpySigningExecutor:
    def __init__(self) -> None:
        self.issue_calls = 0

    def issue_open_mandate(self, *, execution_grant, plan, payload):
        self.issue_calls += 1
        assert execution_grant.plan_fingerprint == plan_fingerprint(plan)
        return AP2Artifact.safe_fixture()
```

Required tests:

```python
def test_no_active_grant_means_no_open_artifact(flow, spy_executor) -> None:
    with pytest.raises(Exception):
        flow.prepare_open_payment_authority(
            agent=AGENT,
            grant_id="missing",
            grant_version=1,
            holder_binding=HOLDER_BINDING,
            now=NOW,
        )
    assert spy_executor.issue_calls == 0


def test_open_artifact_requires_runtime_execution_grant(flow, spy_executor) -> None:
    prepared = flow.prepare_open_payment_authority(...)
    assert spy_executor.issue_calls == 0
    flow.issue_open_payment_authority(action_id=prepared.action_id, now=NOW)
    assert spy_executor.issue_calls == 1
```

Integration tests additionally prove merchant/audience/nonce substitution and disclosure escalation fail before final artifact delivery.

Red:

```bash
uv run pytest \
  adapters/ap2/tests/test_flow.py \
  tests/integration/test_ap2_delegation.py \
  tests/integration/test_ap2_merchant_binding.py \
  tests/integration/test_ap2_disclosure.py -q
```

Implementation public seam is exactly correction 4's four `AP2MandateFlow` methods. Canonical `ActionRequest.principal_id` and source grant Principal must match; a parent AP2 artifact never supplies PTF Principal authority by itself.

Green is the same command.

---

## T7 — AP2 receipt reconciliation

Create `adapters/ap2/tests/test_receipts.py` before `receipts.py`:

```python
def test_receipt_reference_must_match_closed_leaf(valid_receipt_jwt, issuer_public_key, closed_chain) -> None:
    evidence = verify_ap2_payment_receipt(
        receipt_jwt=valid_receipt_jwt,
        issuer_public_key=issuer_public_key,
        closed_mandate_token=closed_chain,
    )
    assert evidence.success is True
    assert evidence.closed_mandate_reference


def test_receipt_for_other_closed_leaf_is_rejected(valid_receipt_jwt, issuer_public_key, other_chain) -> None:
    with pytest.raises(Exception):
        verify_ap2_payment_receipt(
            receipt_jwt=valid_receipt_jwt,
            issuer_public_key=issuer_public_key,
            closed_mandate_token=other_chain,
        )
```

Add signature mismatch and ambiguous/missing-after-possible-effect classification tests.

Red:

```bash
uv run pytest adapters/ap2/tests/test_receipts.py tests/integration/test_ap2_receipt.py -q
```

Implementation seam remains:

```python
def verify_ap2_payment_receipt(
    *, receipt_jwt: str, issuer_public_key,
    closed_mandate_token: str,
) -> AP2ReceiptEvidence: ...
```

PTFReceipt stores safe reference/digest, never raw receipt JWT by default. Green is the same command.

---

## T8 — AP2 acceptance lock

`verification_only: true`.

Precondition:

```bash
test ! -f tests/acceptance/test_ap2_ptf_invariants.py
```

Acceptance test must assert all cases in correction 4, including that open AP2 authority issuance requires a plan-bound PTF Execution Grant. Green is the original full AP2 pytest/Ruff/Pyright suite.

---

## T9 — x402/AP2 seam review

`verification_only: true`.

Precondition:

```bash
test ! -f docs/review/ap2-x402-seam-review.md
```

The three candidate designs and deletion/depth tests in correction 4 are the exact review fixture. Default candidate is **no additional interface** unless accepted concrete implementations prove otherwise. Candidate 3 requires a separately accepted ADR.

If no-interface wins, the candidate commit stages only the review document. Any code seam requires its exact additional files/tests to be added to the task before editing source.

---

## C10 disposition

With this supplement, each Plan 03 behavioral task has a concrete red fixture/command and public implementation shape; T1/T8/T9 have explicit verification-only predicates. Green commands, commit boundaries, and inherited reviewer gates remain those in the corrected Plan 03 chain.