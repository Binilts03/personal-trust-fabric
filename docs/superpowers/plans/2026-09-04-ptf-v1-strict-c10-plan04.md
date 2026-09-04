# PTF v1 Strict C10 Code Supplement — Plan 04 OpenID4VP

Status: **BINDING TEST/IMPLEMENTATION SUPPLEMENT FOR SUPERPOWERS PLAN QUALITY**

This supplement supplies executable fixtures/tests for Plan 04 while preserving the correction-5 responsibility boundary: OpenID4VP normalization validates protocol/profile/binding; PTF Hard Policy/authority remains in `ActionRuntime`.

Canonical PTF names come from the final interface registry. Protocol-native request/credential/artifact objects remain under the concrete OpenID4VP adapter/executor.

---

## Shared reference fixture

Create `adapters/openid4vp/tests/reference.py` in T2:

```python
from datetime import UTC, datetime, timedelta

from ptf_openid4vp.models import OID4VPVerifierBinding

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(minutes=10)
CLIENT_ID = "https://verifier.example/client"
RESPONSE_URI = "https://verifier.example/direct-post"
NONCE = "nonce-7f31"

VERIFIER = OID4VPVerifierBinding(
    subject_id="verifier-1",
    identity_binding_id="verifier-key-1",
    endpoint_binding_id="verifier-endpoint-1",
    client_id=CLIENT_ID,
    response_uri=RESPONSE_URI,
    verified_at=NOW,
)


def request_parameters(*, nonce: str = NONCE, response_uri: str = RESPONSE_URI) -> dict[str, object]:
    return {
        "response_type": "vp_token",
        "response_mode": "direct_post",
        "client_id": CLIENT_ID,
        "response_uri": response_uri,
        "nonce": nonce,
        "dcql_query": {
            "credentials": [
                {
                    "id": "adult-proof",
                    "format": "dc+sd-jwt",
                    "claims": [{"path": ["age_over_18"]}],
                }
            ]
        },
    }
```

---

## T1 — profile/package bootstrap

Before package creation:

```bash
uv run python -c "import ptf_openid4vp, ptf_openid4vp_wallet"
```

Expected: non-zero import failure. The original normative Final-spec check/package profile remains binding. Green is the original import suite.

---

## T2 — normalize verifier request, no Hard Policy logic

Create `adapters/openid4vp/tests/test_request.py` before `request.py`:

```python
import pytest

from ptf_openid4vp.errors import OID4VPRequestRejected
from ptf_openid4vp.request import normalize_authorization_request
from .reference import CLIENT_ID, NONCE, RESPONSE_URI, VERIFIER, NOW, request_parameters


def test_bound_final_profile_request_normalizes() -> None:
    snap = normalize_authorization_request(
        request_parameters=request_parameters(),
        verifier_subject_id="verifier-1",
        verifier_binding=VERIFIER,
        received_at=NOW,
    )
    assert snap.verifier_subject_id == "verifier-1"
    assert snap.client_id == CLIENT_ID
    assert snap.response_uri == RESPONSE_URI
    assert snap.response_mode == "direct_post"
    assert snap.nonce == NONCE
    assert len(snap.request_digest) == 64


def test_response_uri_substitution_is_rejected() -> None:
    with pytest.raises(OID4VPRequestRejected):
        normalize_authorization_request(
            request_parameters=request_parameters(response_uri="https://evil.example/post"),
            verifier_subject_id="verifier-1",
            verifier_binding=VERIFIER,
            received_at=NOW,
        )


def test_missing_nonce_is_rejected() -> None:
    params = request_parameters()
    params["nonce"] = ""
    with pytest.raises(OID4VPRequestRejected):
        normalize_authorization_request(
            request_parameters=params,
            verifier_subject_id="verifier-1",
            verifier_binding=VERIFIER,
            received_at=NOW,
        )
```

Add tests for wrong `client_id`, wrong response type, wrong response mode, and same display label/different verifier binding.

Red:

```bash
uv run pytest adapters/openid4vp/tests/test_request.py -q
```

Implementation signature and frozen models are exactly correction 5/original T2. `normalize_authorization_request` has no HardPolicy parameter/import and does not emit an authorization decision.

Green is the same pytest command.

---

## T3 — DCQL interpretation and minimum disclosure

Create `adapters/openid4vp/tests/test_dcql.py` before `dcql.py`:

```python
import pytest

from ptf_core.personal_state.models import FreshnessState
from ptf_openid4vp.dcql import (
    DisclosureRequirementUnsatisfied,
    build_minimized_disclosure_plan,
    interpret_dcql_request,
)
from ptf_openid4vp.models import CredentialMetadata

METADATA = CredentialMetadata(
    resource_ref="credential-1",
    format="dc+sd-jwt",
    claim_names=frozenset({"given_name", "family_name", "birthdate", "age_over_18", "address"}),
    issuer_subject_id="issuer-1",
    holder_binding=True,
    freshness_state=FreshnessState.CURRENT,
    status_checked_at=NOW,
)


def test_age_only_dcql_becomes_principal_scoped_action() -> None:
    request, requested = interpret_dcql_request(
        request=NORMALIZED_REQUEST,
        principal_id="P1",
        credential_ref="credential-1",
        credential_metadata=METADATA,
        purpose="age-verification",
    )
    assert request.principal_id == "P1"
    assert request.operation == "credential.present"
    assert request.resource_ref == "credential-1"
    assert request.requested_disclosure == frozenset({"age_over_18"})

    plan = build_minimized_disclosure_plan(
        requested=requested,
        permitted_claims=frozenset({"age_over_18"}),
        credential_ref="credential-1",
        verifier_subject_id="verifier-1",
        purpose="age-verification",
    )
    assert plan.permitted_items == frozenset({"age_over_18"})
    assert "birthdate" not in plan.permitted_items


def test_unpermitted_claims_never_expand_disclosure() -> None:
    with pytest.raises(DisclosureRequirementUnsatisfied):
        build_minimized_disclosure_plan(
            requested=REQUESTED_BIRTHDATE_AND_ADDRESS,
            permitted_claims=frozenset({"age_over_18"}),
            credential_ref="credential-1",
            verifier_subject_id="verifier-1",
            purpose="age-verification",
        )
```

Add a parameterized test that `STALE`, `UNKNOWN`, and `REVOKED` metadata cannot satisfy a request/plan requiring current verified credential state.

Red:

```bash
uv run pytest adapters/openid4vp/tests/test_dcql.py -q
```

Implementation signatures are exactly the final-registry-corrected versions: `interpret_dcql_request(...)` takes explicit `principal_id`, and maps `credential_ref` to `ActionRequest.resource_ref`.

Green is the same command.

---

## T4 — Enforcement Map and transaction binding

Create `adapters/openid4vp/tests/test_enforcement.py`:

```python
def test_openid4vp_enforcement_map_assigns_every_required_constraint() -> None:
    mapping = build_openid4vp_enforcement_map(
        request=NORMALIZED_REQUEST,
        disclosure_plan=AGE_ONLY_DISCLOSURE_PLAN,
        credential_metadata=METADATA,
        executor_profile_id="wallet-local-v1",
    )
    by_id = {entry.constraint_id: entry for entry in mapping.entries}
    assert {x.value for x in by_id["verifier-identity"].locations} >= {"PTF"}
    assert {x.value for x in by_id["nonce-session"].locations} >= {"PTF", "PROTOCOL", "EXECUTOR"}
    assert {x.value for x in by_id["selected-claims"].locations} >= {"PTF", "PROTOCOL", "EXECUTOR"}
```

Create a plan-mutation test that changes each of verifier Subject/binding, `client_id`, `response_uri`, nonce, request digest, credential ref, selected claim set, and response mode and asserts `plan_fingerprint` changes or `validate_execution_plan` rejects.

Red:

```bash
uv run pytest adapters/openid4vp/tests/test_enforcement.py -q
```

Implementation seam is exactly:

```python
def build_openid4vp_enforcement_map(
    *, request: OID4VPRequestSnapshot,
    disclosure_plan: DisclosurePlan,
    credential_metadata: CredentialMetadata,
    executor_profile_id: str,
) -> EnforcementMap: ...
```

Green is the same command.

---

## T5 — brokered wallet executor and resource-ref non-authority

Create `executors/openid4vp-wallet/tests/test_executor.py` before implementation. Use only synthetic fixture values; raw fixture contains canary `PTF_CANARY_RAW_CREDENTIAL_1D47`.

Required tests:

```python
def test_resource_ref_alone_cannot_present(executor) -> None:
    with pytest.raises(TypeError):
        executor.present(credential_ref="credential-1")


def test_plan_fingerprint_mismatch_is_rejected(executor, execution_grant, plan) -> None:
    bad = execution_grant.model_copy(update={"plan_fingerprint": "0" * 64})
    with pytest.raises(Exception):
        executor.present(
            execution_grant=bad,
            plan=plan,
            request=NORMALIZED_REQUEST,
            credential_ref="credential-1",
            disclosure_plan=AGE_ONLY_DISCLOSURE_PLAN,
            now=NOW,
        )


def test_safe_artifact_surfaces_do_not_contain_raw_credential(executor, execution_grant, plan) -> None:
    artifact = executor.present(...)
    assert "PTF_CANARY_RAW_CREDENTIAL_1D47" not in artifact.safe_metadata.model_dump_json()
```

Add wrong verifier/nonce, claim outside plan, stale/revoked catalog status, and executor-profile mismatch tests. The executor must resolve Plan 01 `ProtectedResourceRecord` and validate principal, status, resource type, executor subject/profile and supported operation before loading the private credential/provider object.

Red:

```bash
uv run pytest executors/openid4vp-wallet/tests/test_executor.py tests/integration/test_openid4vp_leak_canary.py -q
```

Implementation method is exactly the original/correction-5 `OpenID4VPWalletExecutor.present(...)`; raw credential and holder key are private provider dependencies, never public method arguments.

Green is the same command.

---

## T6 — direct-post response and one-use session

Create `adapters/openid4vp/tests/test_response.py` before implementation:

```python
@pytest.mark.asyncio
async def test_delivery_uses_only_bound_response_uri(http_client, artifact) -> None:
    result = await deliver_direct_post(
        request=NORMALIZED_REQUEST,
        artifact=artifact,
        http_client=http_client,
    )
    assert result.outcome is ExecutionOutcome.CONSUMED
    assert "vp_token" not in (result.external_evidence_ref or "")


@pytest.mark.asyncio
async def test_post_submit_timeout_is_indeterminate(timeout_after_receive_client, artifact) -> None:
    result = await deliver_direct_post(
        request=NORMALIZED_REQUEST,
        artifact=artifact,
        http_client=timeout_after_receive_client,
    )
    assert result.outcome is ExecutionOutcome.INDETERMINATE
```

Integration test reuses the same session/nonce after one successful presentation and must fail before a second presentation/delivery. A different verifier with the same nonce also fails binding checks.

Red:

```bash
uv run pytest adapters/openid4vp/tests/test_response.py tests/integration/test_openid4vp_nonce_replay.py -q
```

Implementation seam is exactly `deliver_direct_post(...)` from original T6. Green is the same command.

---

## T7 — concrete flow through ActionRuntime

Create `adapters/openid4vp/tests/test_flow.py` with a spy wallet executor that increments only when execution reaches the protected presentation step.

Required tests:

```python
def test_protocol_valid_request_can_still_require_ptf_approval(flow, spy_wallet) -> None:
    prepared = flow.prepare(
        agent=AGENT,
        principal_id="P1",
        request_parameters=request_parameters(),
        verifier_subject_id="verifier-1",
        verifier_binding=VERIFIER,
        credential_ref="credential-1",
        purpose="age-verification",
        now=NOW,
    )
    assert prepared.approval_required is True
    assert spy_wallet.calls == 0


def test_verifier_mutation_after_approval_never_reaches_wallet(flow, spy_wallet, approved_action) -> None:
    mutate_bound_response_uri(approved_action, "https://evil.example/post")
    with pytest.raises(Exception):
        flow.execute(action_id=approved_action.action_id, now=NOW)
    assert spy_wallet.calls == 0
```

Integration tests cover verifier Subject/binding, response URI, nonce, DCQL claim set, credential ref, and disclosure-mode substitutions.

Red:

```bash
uv run pytest \
  adapters/openid4vp/tests/test_flow.py \
  tests/integration/test_openid4vp_end_to_end.py \
  tests/integration/test_openid4vp_verifier_substitution.py \
  tests/integration/test_openid4vp_disclosure_escalation.py -q
```

Implementation public seam is the final-registry-corrected `OpenID4VPFlow.prepare(... principal_id=...)` and `.execute(...)`. Preparation order is normalize -> interpret -> `runtime.request_action` -> minimized plan/map/manifest -> `runtime.select_plan`. Execution is authorize -> revalidate -> wallet present -> direct-post -> classify -> reconcile.

Green is the same command.

---

## T8 — acceptance and core-generality review

`verification_only: true`.

Precondition:

```bash
test ! -f tests/acceptance/test_openid4vp_ptf_invariants.py && \
test ! -f docs/review/openid4vp-core-generality-review.md
```

Acceptance uses the ten correction-5 cases. The review also asserts no parser/normalizer imports HardPolicy/resolver logic and no payment/mandate/credential-specific field was added to canonical core solely for this adapter. Architecture stop rule remains binding.

Green is the complete Python test/Ruff/Pyright suite.

---

## C10 disposition

All Plan 04 behavioral tasks now have concrete red fixtures/commands and exact implementation seams; T8 has a verification-only precondition. Existing green commands/commit boundaries plus the inherited reviewer gate complete the C10 task shape.