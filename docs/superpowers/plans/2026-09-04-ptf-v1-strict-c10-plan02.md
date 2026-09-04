# PTF v1 Strict C10 Code Supplement — Plan 02 x402

Status: **BINDING TEST/IMPLEMENTATION SUPPLEMENT FOR SUPERPOWERS PLAN QUALITY**

This supplement uses the verified x402 `2.22.0` Python API recorded in `docs/research/2026-09-04-x402-2.22.0-api-verification.md`. It replaces prose-only tests and any guessed SDK usage in the original Plan 02.

## Plan 02 reference values and errors

Create `adapters/x402/tests/reference.py` in T2:

```python
from datetime import UTC, datetime, timedelta

from x402.schemas.payments import PaymentRequired, PaymentRequirements, ResourceInfo

from ptf_x402.models import X402RecipientBinding

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
NETWORK = "eip155:84532"
ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
PAY_TO = "0x1111111111111111111111111111111111111111"
CURRENCY_ID = f"x402:{NETWORK}:{ASSET.lower()}"


def requirements(*, amount: str = "2500000", pay_to: str = PAY_TO) -> PaymentRequirements:
    return PaymentRequirements(
        scheme="exact",
        network=NETWORK,
        asset=ASSET,
        amount=amount,
        pay_to=pay_to,
        max_timeout_seconds=60,
        extra={"name": "USDC", "version": "2"},
    )


def payment_required(*, selected: PaymentRequirements | None = None) -> PaymentRequired:
    req = selected or requirements()
    return PaymentRequired(
        x402_version=2,
        resource=ResourceInfo(url="https://merchant.example/protected"),
        accepts=[req],
        extensions={},
    )


def recipient_binding() -> X402RecipientBinding:
    return X402RecipientBinding(
        subject_id="merchant-subject-1",
        endpoint_binding_id="payment-eb-1",
        network=NETWORK,
        asset=ASSET,
        pay_to=PAY_TO,
        verified_at=NOW,
    )
```

The authoritative PTF `ActionRequest.currency` for the reference x402 asset is `CURRENCY_ID`, not the display ticker `USDC`. The display token name from x402 `extra` is non-authoritative metadata. This prevents ticker collisions and binds authority to network+asset.

`adapters/x402/src/ptf_x402/errors.py` defines:

```python
from ptf_core.errors import PTFDomainError


class X402RequirementRejected(PTFDomainError):
    pass


class X402ExecutionRejected(PTFDomainError):
    pass


class X402OutcomeEvidenceInvalid(PTFDomainError):
    pass
```

---

## T1 — package/provenance bootstrap

The original T1 plus corrections 9 is already strict enough. Red import command runs before package creation. The provenance command checks the exact wheel hash/source commit. No fallback API adaptation is permitted.

---

## T2 — normalize x402 requirements without creating authority

`adapters/x402/tests/test_requirements.py` contains:

```python
import pytest

from ptf_x402.errors import X402RequirementRejected
from ptf_x402.requirements import interpret_payment_required
from .reference import CURRENCY_ID, NETWORK, ASSET, PAY_TO, payment_required, recipient_binding, requirements


def test_exact_requirement_becomes_principal_scoped_action_request() -> None:
    selected = requirements()
    request = interpret_payment_required(
        payment_required=payment_required(selected=selected),
        selected_requirements=selected,
        recipient_subject_id="merchant-subject-1",
        recipient_binding=recipient_binding(),
        principal_id="P1",
        resource_ref="wallet-resource-1",
        purpose="purchase",
    )
    assert request.principal_id == "P1"
    assert request.operation == "payment.authorize"
    assert request.recipient_id == "merchant-subject-1"
    assert request.resource_ref == "wallet-resource-1"
    assert request.purpose == "purchase"
    assert request.amount_minor == 2_500_000
    assert request.currency == CURRENCY_ID


def test_pay_to_substitution_is_rejected() -> None:
    selected = requirements(pay_to="0x2222222222222222222222222222222222222222")
    with pytest.raises(X402RequirementRejected):
        interpret_payment_required(
            payment_required=payment_required(selected=selected),
            selected_requirements=selected,
            recipient_subject_id="merchant-subject-1",
            recipient_binding=recipient_binding(),
            principal_id="P1",
            resource_ref="wallet-resource-1",
            purpose="purchase",
        )


def test_non_integer_atomic_amount_is_rejected() -> None:
    selected = requirements(amount="2.5")
    with pytest.raises(X402RequirementRejected):
        interpret_payment_required(
            payment_required=payment_required(selected=selected),
            selected_requirements=selected,
            recipient_subject_id="merchant-subject-1",
            recipient_binding=recipient_binding(),
            principal_id="P1",
            resource_ref="wallet-resource-1",
            purpose="purchase",
        )
```

Minimal implementation includes exact original models plus:

```python
def x402_currency_id(*, network: str, asset: str) -> str:
    return f"x402:{network}:{asset.lower()}"
```

`interpret_payment_required` verifies the selected requirement is one of `payment_required.accepts` by canonical model equality, binding subject/pay-to/network/asset matches, and `amount` matches `^\d+$` before conversion to `int`.

Red/green:

```bash
uv run pytest adapters/x402/tests/test_requirements.py -q
```

---

## T3 — truthful x402 Enforcement Map

`adapters/x402/tests/test_enforcement.py` contains:

```python
import pytest

from ptf_core.planning.models import EnforcementLocation
from ptf_x402.enforcement import build_x402_enforcement_map
from .reference import payment_required, recipient_binding, requirements


def entries_by_id(enforcement_map):
    return {entry.constraint_id: entry.locations for entry in enforcement_map.entries}


def test_reference_x402_enforcement_locations_are_explicit(action_request) -> None:
    selected = requirements()
    mapping = build_x402_enforcement_map(
        request=action_request,
        requirement=selected,
        recipient_binding=recipient_binding(),
        executor_profile_id="x402-evm-exact-1",
    )
    entries = entries_by_id(mapping)
    assert entries["operation"] == frozenset({EnforcementLocation.PTF, EnforcementLocation.EXECUTOR})
    assert entries["amount"] == frozenset({
        EnforcementLocation.PTF, EnforcementLocation.PROTOCOL, EnforcementLocation.EXECUTOR
    })
    assert entries["currency"] == frozenset({
        EnforcementLocation.PTF, EnforcementLocation.PROTOCOL, EnforcementLocation.EXECUTOR
    })
    assert entries["recipient"] == frozenset({EnforcementLocation.PTF})
    assert entries["x402.payment_endpoint"] == frozenset({
        EnforcementLocation.PTF, EnforcementLocation.PROTOCOL, EnforcementLocation.EXECUTOR
    })
    assert entries["x402.network"] == frozenset({
        EnforcementLocation.PTF, EnforcementLocation.PROTOCOL, EnforcementLocation.EXECUTOR
    })
    assert "hard_policy" not in entries
```

The file defines `action_request` locally with the T2 interpreter:

```python
@pytest.fixture
def action_request():
    selected = requirements()
    return interpret_payment_required(
        payment_required=payment_required(selected=selected),
        selected_requirements=selected,
        recipient_subject_id="merchant-subject-1",
        recipient_binding=recipient_binding(),
        principal_id="P1",
        resource_ref="wallet-resource-1",
        purpose="purchase",
    )
```

Unsupported mandatory constraint is tested through the canonical validator, not by asking the adapter to invent policy:

```python
def test_unmapped_mandatory_constraint_fails_plan_validation(make_x402_plan, action_request) -> None:
    mapping = build_x402_enforcement_map(
        request=action_request,
        requirement=requirements(),
        recipient_binding=recipient_binding(),
        executor_profile_id="x402-evm-exact-1",
    )
    plan = make_x402_plan(
        enforcement_map=mapping,
        source_constraint_ids=("operation", "amount", "currency", "recipient", "mandatory.custom"),
    )
    with pytest.raises(PlanValidationError):
        validate_execution_plan(
            plan,
            source_constraint_ids=plan.source_constraint_ids,
        )
```

`make_x402_plan` is a same-file complete final-registry `ExecutionPlan` constructor copied from the Plan 00 strict factory with protocol=`x402`, protocol operation=`payment.exact`, x402 transaction binding, and x402 Assurance Manifest. No undefined global fixture is permitted in committed code.

Red/green:

```bash
uv run pytest adapters/x402/tests/test_enforcement.py -q
```

---

## T4 — protected x402 wallet executor using verified SDK

`executors/x402-wallet/src/ptf_x402_wallet/executor.py` has this constructor/public shape:

```python
from x402 import x402Client
from x402.mechanisms.evm.exact import ExactEvmScheme
from x402.mechanisms.evm.signer import ClientEvmSigner


class X402WalletExecutor:
    def __init__(
        self,
        *,
        signer: ClientEvmSigner,
        profile_id: str,
        network: str,
    ) -> None:
        self._client = x402Client()
        self._client.set_spend_controls(False)
        self._client.register(network, ExactEvmScheme(signer=signer))
        self._profile_id = profile_id
        self._network = network

    async def create_payment_artifact(
        self,
        *,
        execution_grant: ExecutionGrantRecord,
        plan: ExecutionPlan,
        payment_required: PaymentRequired,
        selected_requirements: PaymentRequirements,
        recipient_binding: X402RecipientBinding,
        now: datetime,
    ) -> X402PaymentArtifact: ...
```

`X402PaymentArtifact` is internal protected-delivery data:

```python
@dataclass(frozen=True)
class X402PaymentArtifact:
    payment_payload: PaymentPayload
    payload_digest: str
    protocol: str
    network: str
    pay_to: str
```

It is never embedded in Agent DTOs or `PTFReceipt`; only digest/reference enters safe PTF evidence.

`executors/x402-wallet/tests/test_executor.py` uses a protocol-valid fake signer:

```python
from typing import Any

import pytest

from ptf_x402_wallet.executor import X402ExecutionRejected, X402WalletExecutor
from x402.mechanisms.evm.types import TypedDataDomain, TypedDataField

from adapters.x402.tests.reference import NETWORK, payment_required, recipient_binding, requirements


class TestSigner:
    @property
    def address(self) -> str:
        return "0x3333333333333333333333333333333333333333"

    def sign_typed_data(
        self,
        domain: TypedDataDomain,
        types: dict[str, list[TypedDataField]],
        primary_type: str,
        message: dict[str, Any],
    ) -> bytes:
        return b"\x11" * 65


@pytest.mark.asyncio
async def test_plan_fingerprint_mismatch_rejected_before_signing(
    execution_grant,
    x402_plan,
) -> None:
    executor = X402WalletExecutor(
        signer=TestSigner(),
        profile_id="x402-evm-exact-1",
        network=NETWORK,
    )
    wrong = x402_plan.model_copy(update={"transaction_binding": "changed"})
    with pytest.raises(X402ExecutionRejected):
        await executor.create_payment_artifact(
            execution_grant=execution_grant,
            plan=wrong,
            payment_required=payment_required(),
            selected_requirements=requirements(),
            recipient_binding=recipient_binding(),
            now=NOW,
        )
```

The test file defines complete `execution_grant` and `x402_plan` fixtures with final-registry constructors. Add a `RecordingSigner` subclass whose `sign_typed_data` increments `calls`; mismatch/pay-to/network/amount rejection tests assert `calls == 0` to prove rejection happens before signing.

Leak test scans safe runtime/API/receipt/log/error captures for:

```text
PTF_CANARY_X402_KEY_5F12
```

and signer/private-key serialization markers.

Red/green:

```bash
uv run pytest executors/x402-wallet/tests/test_executor.py tests/integration/test_x402_leak_canary.py -q
```

---

## T5 — deterministic facilitator evidence classification

`adapters/x402/src/ptf_x402/evidence.py` owns:

```python
class X402VerificationEvidence(FrozenModel):
    accepted: bool
    reason_code: str | None
    response_digest: str


class X402SettlementEvidence(FrozenModel):
    success: bool
    proves_no_effect: bool
    transaction_ref: str | None
    response_digest: str
```

`adapters/x402/tests/test_evidence.py` contains:

```python
import pytest

from ptf_core.audit.models import ExecutionOutcome
from ptf_x402.evidence import (
    X402SettlementEvidence,
    X402VerificationEvidence,
    classify_x402_outcome,
)


def verify(accepted: bool) -> X402VerificationEvidence:
    return X402VerificationEvidence(
        accepted=accepted,
        reason_code=None if accepted else "REJECTED",
        response_digest="verify-digest",
    )


def settle(success: bool, proves_no_effect: bool = False) -> X402SettlementEvidence:
    return X402SettlementEvidence(
        success=success,
        proves_no_effect=proves_no_effect,
        transaction_ref="0xtx" if success else None,
        response_digest="settle-digest",
    )


@pytest.mark.parametrize(
    ("verification", "settlement", "phase", "submitted", "expected"),
    [
        (verify(False), None, "VERIFY", False, ExecutionOutcome.RELEASED_NO_EFFECT),
        (verify(True), settle(True), "SETTLE", True, ExecutionOutcome.CONSUMED),
        (verify(True), settle(False, True), "SETTLE", True, ExecutionOutcome.RELEASED_NO_EFFECT),
        (None, None, "CONNECT", False, ExecutionOutcome.RELEASED_NO_EFFECT),
        (verify(True), None, "SUBMIT_TIMEOUT", True, ExecutionOutcome.INDETERMINATE),
        (verify(True), None, "MALFORMED_RESPONSE", True, ExecutionOutcome.INDETERMINATE),
    ],
)
def test_outcome_classification(verification, settlement, phase, submitted, expected) -> None:
    result = classify_x402_outcome(
        verification=verification,
        settlement=settlement,
        transport_phase=phase,
        request_was_submitted=submitted,
    )
    assert result.outcome is expected
```

Red/green: `uv run pytest adapters/x402/tests/test_evidence.py -q`.

---

## T6 — concrete X402PaymentFlow through ActionRuntime

Define x402-specific external I/O seam in `adapters/x402/src/ptf_x402/flow.py`:

```python
class X402ExternalGateway(Protocol):
    async def submit(
        self,
        *,
        payment_required: PaymentRequired,
        payment_payload: PaymentPayload,
    ) -> tuple[X402VerificationEvidence | None, X402SettlementEvidence | None]: ...
```

This is not a universal adapter API; it is an x402-local dependency for the resource-server/facilitator exchange.

`X402PaymentFlow` constructor is:

```python
class X402PaymentFlow:
    def __init__(
        self,
        *,
        runtime: ActionRuntime,
        wallet_executor: X402WalletExecutor,
        gateway: X402ExternalGateway,
        resource_repository: ResourceCatalogRepository,
    ) -> None: ...
```

Prepare signature is the corrections-8 version with explicit `principal_id` and `resource_ref`.

`adapters/x402/tests/test_flow.py` contains recording fakes:

```python
class RecordingWallet:
    def __init__(self) -> None:
        self.calls = 0

    async def create_payment_artifact(self, **kwargs):
        self.calls += 1
        return SAFE_TEST_ARTIFACT


@pytest.mark.asyncio
async def test_approval_required_flow_does_not_sign_before_exact_approval(flow, recording_wallet) -> None:
    prepared = await flow.prepare(
        agent=AGENT,
        principal_id="P1",
        payment_required=payment_required(),
        selected_requirements=requirements(),
        recipient_binding=recipient_binding(),
        resource_ref="wallet-resource-1",
        purpose="purchase",
        now=NOW,
    )
    assert prepared.approval_required is True
    assert recording_wallet.calls == 0
```

The same file defines `RecordingRuntime` with exact `ActionRuntime` method names; it records ordering. A grant-covered execution test asserts call order:

```text
request_action
select_plan
authorize_execution
revalidate_execution
wallet.create_payment_artifact
gateway.submit
reconcile
```

and that `revalidate_execution` precedes wallet signing.

Integration `test_x402_end_to_end.py` uses the concrete runtime/PostgreSQL fixture and a local no-value gateway; no live blockchain transfer occurs.

Red/green:

```bash
uv run pytest adapters/x402/tests/test_flow.py tests/integration/test_x402_end_to_end.py -q
```

---

## T7 — substitution/replay/indeterminate evidence (`verification_only: true`)

`tests/integration/test_x402_recipient_substitution.py` parameterizes exact mutations:

```python
import pytest


@pytest.mark.parametrize(
    "mutation",
    [
        {"pay_to": "0x2222222222222222222222222222222222222222"},
        {"network": "eip155:1"},
        {"amount": "2500001"},
    ],
)
@pytest.mark.asyncio
async def test_requirement_mutation_fails_before_signing(
    prepared_x402_action,
    mutation,
    recording_signer,
) -> None:
    changed = requirements().model_copy(update=mutation)
    with pytest.raises(X402ExecutionRejected):
        await prepared_x402_action.executor.create_payment_artifact(
            execution_grant=prepared_x402_action.execution_grant,
            plan=prepared_x402_action.plan,
            payment_required=payment_required(selected=changed),
            selected_requirements=changed,
            recipient_binding=recipient_binding(),
            now=NOW,
        )
    assert recording_signer.calls == 0
```

`test_x402_indeterminate.py` uses a gateway that records receipt then raises timeout; it asserts final receipt outcome `INDETERMINATE`, reservation `HELD_INDETERMINATE`, and second `execute(action_id)` raises `IndeterminateOutcomeRequiresReconciliation` before a second gateway submission.

Precondition and green commands remain corrections 3.

---

## T8 — x402 acceptance lock (`verification_only: true`)

`tests/acceptance/test_x402_ptf_invariants.py` contains executable source/public-surface assertions including:

```python
def test_requirement_interpreter_returns_action_request_not_authority() -> None:
    selected = requirements()
    result = interpret_payment_required(
        payment_required=payment_required(selected=selected),
        selected_requirements=selected,
        recipient_subject_id="merchant-subject-1",
        recipient_binding=recipient_binding(),
        principal_id="P1",
        resource_ref="wallet-resource-1",
        purpose="purchase",
    )
    assert isinstance(result, ActionRequest)
    assert not isinstance(result, (StandingGrant, ApprovalEvidence, ExecutionGrantRecord))


def test_x402_specific_names_delete_with_adapter() -> None:
    from pathlib import Path

    core_text = "\n".join(
        p.read_text()
        for root in (Path("packages/ptf-core/src"), Path("packages/ptf-runtime/src"))
        for p in root.rglob("*.py")
    ).lower()
    for term in ("paymentrequired", "paymentrequirements", "exactevmscheme", "x402client"):
        assert term not in core_text
```

The acceptance module also calls the Plan 02 leak/substitution/indeterminate fixtures through public seams and asserts Evidence Artifact IDs/digests are not equal to Execution Grant IDs.

Precondition and full green verification are those in corrections 3.

---

## Plan 02 strict disposition

All eight Plan 02 tasks now have executable test code or verification-only predicates, verified x402 2.22.0 API calls, and no “adapt if API differs” placeholder. Matrix PASS still requires a fresh strict review against the final interface registry and exact test-helper ownership.