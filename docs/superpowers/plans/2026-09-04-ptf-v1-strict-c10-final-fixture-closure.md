# PTF v1 Strict C10 Final Fixture/Helper Closure

Status: **BINDING OVER STRICT SUPPLEMENTS 03–06; APPROVED SPEC UNCHANGED**

The final Superpowers/Matt TDD review found several strict-supplement snippets that still relied on undefined pytest fixtures, helper names, ellipses, or a superseded interface. This file assigns those helpers to exact test files and supplies the minimal executable shapes. It does not add production architecture.

If an older strict snippet conflicts with corrections 10/11 or this closure, this closure wins for test-fixture mechanics while the final interface registry/corrections remain the semantic oracle.

---

# Shared rule

A code block containing `...` in an older strict supplement is not copyable test code unless the missing value is supplied by one of the exact helper files below. Committed tests use the task's typed domain/protocol errors rather than bare `Exception` for expected rejection paths.

---

# Plan 03 AP2 fixture closure

## T3 exact reference file

`adapters/ap2/tests/reference.py` additionally contains:

```python
from datetime import UTC, datetime, timedelta
from jwcrypto import jwk

from ptf_core.authority.models import (
    AmountLimit,
    AuthorityBasis,
    AuthorityBasisKind,
    AuthorityScope,
    StandingGrant,
)
from ptf_core.identity.models import IdentityBinding
from ptf_core.planning.models import (
    ConstraintEnforcement,
    EnforcementLocation,
    EnforcementMap,
    ExecutionPlan,
)
from ptf_core.protected_resources.models import AssuranceManifest, ArtifactCustodyMode
from ptf_core.planning.fingerprint import plan_fingerprint
from ptf_runtime.models import AuthenticatedActor, ActorKind, ExecutionGrantRecord

NOW = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(hours=1)


def holder_public_jwk() -> dict[str, object]:
    key = jwk.JWK.generate(kty="EC", crv="P-256")
    return key.export_public(as_dict=True)


def make_assurance() -> AssuranceManifest:
    return AssuranceManifest(
        profile_id="ap2-test",
        profile_version="1",
        control_runtime_admin_domain="ptf-test",
        protected_executor_admin_domain="ap2-signing-test",
        plaintext_observers=frozenset({"ap2-signing-executor"}),
        usable_resource_invokers=frozenset({"ap2-signing-executor"}),
        agent_model_visibility="NONE",
        recipient_disclosure=("amount", "recipient"),
        resource_exportability="NON_EXPORTABLE",
        recipient_authentication=("binding:merchant-eb-1",),
        principal_approval_assurance="AA1",
        remote_attestation=(),
        artifact_custody_mode=ArtifactCustodyMode.LOCAL_ONLY,
        recovery_parties=frozenset(),
        audit_integrity_profile="AI0",
        residual_risks=("test executor compromise",),
    )


def make_enforcement_map() -> EnforcementMap:
    return EnforcementMap(entries=(
        ConstraintEnforcement(
            constraint_id="operation",
            locations=frozenset({EnforcementLocation.PTF, EnforcementLocation.EXECUTOR}),
        ),
        ConstraintEnforcement(
            constraint_id="recipient",
            locations=frozenset({EnforcementLocation.PTF, EnforcementLocation.PROTOCOL}),
        ),
        ConstraintEnforcement(
            constraint_id="amount",
            locations=frozenset({EnforcementLocation.PTF, EnforcementLocation.PROTOCOL}),
        ),
    ))


def make_plan(*, amount_minor: int = 2_500, recipient_id: str = "M-1") -> ExecutionPlan:
    source_ids = ("operation", "recipient", "amount")
    return ExecutionPlan(
        plan_id="plan-ap2-1",
        action_id="action-ap2-1",
        principal_id="P1",
        authority_basis=AuthorityBasis(
            kind=AuthorityBasisKind.STANDING_GRANT,
            principal_id="P1",
            source_id="g-ap2-1",
            source_version=1,
            source_constraint_ids=source_ids,
        ),
        trust_registry_epoch=1,
        identity_binding_ids=("merchant-ib-1",),
        endpoint_binding_ids=("merchant-eb-1",),
        resource_refs=("wallet-resource-1",),
        disclosure_plan=None,
        executor_subject_id="ap2-signing-executor",
        executor_profile_id="ap2-test",
        protocol="ap2",
        protocol_operation="payment.mandate",
        transaction_binding=f"merchant={recipient_id};amount={amount_minor};tx=tx-1",
        enforcement_map=make_enforcement_map(),
        source_constraint_ids=source_ids,
        reservation_amount_minor=amount_minor,
        reservation_currency="USD",
        replay_key="ap2-replay-1",
        idempotency_mode="ONE_USE",
        expected_evidence_types=("AP2_MANDATE",),
        failure_semantics="AMBIGUOUS_AFTER_EXTERNAL_DELIVERY_IS_INDETERMINATE",
        expires_at=LATER,
        assurance_manifest=make_assurance(),
    )


def make_execution_grant(plan: ExecutionPlan) -> ExecutionGrantRecord:
    return ExecutionGrantRecord(
        execution_grant_id="eg-ap2-1",
        action_id=plan.action_id,
        principal_id="P1",
        plan_fingerprint=plan_fingerprint(plan),
        authority_basis=plan.authority_basis,
        grant_id="g-ap2-1",
        grant_version=1,
        reservation_id="res-ap2-1",
        issued_at=NOW,
        expires_at=LATER,
        status="ACTIVE",
    )

AGENT = AuthenticatedActor(
    subject_id="agent-1",
    actor_kind=ActorKind.AGENT,
    binding_id="agent-binding-1",
    key_id="agent-key-1",
    authenticated_at=NOW,
    assurance_profile="AA1",
)

HOLDER_BINDING = IdentityBinding(
    binding_id="holder-key-1",
    subject_id="holder-1",
    binding_type="P256_PUBLIC_JWK_THUMBPRINT",
    binding_value="holder-thumbprint-1",
    display_name="Holder",
    status="ACTIVE",
    verified_at=NOW,
    valid_until=LATER,
    provenance_ref="fixture:holder-registration",
)
```

This fixes the missing `timedelta` import and removes invalid static pseudo-JWK coordinates. T3 uses `holder_public_jwk()`.

## AP2 protocol-specific safe values/errors

T3/T5 own these exact safe models/errors:

```python
class AP2MappingRejected(PTFDomainError): ...
class AP2EnforcementRejected(PTFDomainError): ...
class AP2SigningRejected(PTFDomainError): ...
class AP2ReceiptRejected(PTFDomainError): ...

class AP2Artifact(FrozenModel):
    artifact_id: str
    artifact_type: str
    artifact_digest: str
    delivery_ref: str
    safe_metadata: dict[str, str]

class AP2ReceiptEvidence(FrozenModel):
    success: bool | None
    closed_mandate_reference: str
    issuer_binding_ref: str
    receipt_digest: str
    proves_no_effect: bool
```

`delivery_ref` is an opaque executor/protocol-path reference; PTF safe surfaces do not serialize the raw mandate token.

Expected rejection tests import the exact corresponding typed error. The `SpySigningExecutor` in T6 returns:

```python
AP2Artifact(
    artifact_id="ap2-artifact-1",
    artifact_type="OPEN_PAYMENT_MANDATE",
    artifact_digest="d" * 64,
    delivery_ref="executor-private:ap2-artifact-1",
    safe_metadata={"protocol": "ap2"},
)
```

There is no invented `AP2Artifact.safe_fixture()` production method.

T6 imports `AGENT`, `HOLDER_BINDING`, `make_plan`, and `make_execution_grant` from `reference.py`; no undefined uppercase fixture name remains.

---

# Plan 04 OpenID4VP fixture/interface closure

Correction 11 supersedes old raw-artifact delivery snippets.

## T3+ reference values

Extend `adapters/openid4vp/tests/reference.py` with:

```python
from ptf_core.personal_state.models import FreshnessState
from ptf_openid4vp.models import CredentialMetadata, OID4VPRequestSnapshot

NORMALIZED_REQUEST = OID4VPRequestSnapshot(
    verifier_subject_id="verifier-1",
    verifier_binding_id="verifier-key-1",
    client_id=CLIENT_ID,
    response_uri=RESPONSE_URI,
    response_mode="direct_post",
    nonce=NONCE,
    dcql={
        "credentials": [{
            "id": "adult-proof",
            "format": "dc+sd-jwt",
            "claims": [{"path": ["age_over_18"]}],
        }]
    },
    request_digest="1" * 64,
)

METADATA = CredentialMetadata(
    resource_ref="credential-1",
    format="dc+sd-jwt",
    claim_names=frozenset({"given_name", "family_name", "birthdate", "age_over_18", "address"}),
    issuer_subject_id="issuer-1",
    holder_binding=True,
    freshness_state=FreshnessState.CURRENT,
    status_checked_at=NOW,
)
```

`REQUESTED_BIRTHDATE_AND_ADDRESS` is created by interpreting a second explicit request snapshot in the test file; it is not a global magic object.

## Exact safe delivery value/errors

T5/T6 own:

```python
class OID4VPRequestRejected(PTFDomainError): ...
class DisclosureRequirementUnsatisfied(PTFDomainError): ...
class OID4VPExecutionRejected(PTFDomainError): ...
class OID4VPEvidenceRejected(PTFDomainError): ...

class OID4VPDeliveryEvidence(FrozenModel):
    artifact_digest: str
    verifier_subject_id: str
    endpoint_binding_id: str
    response_status: str
    response_digest: str | None
    request_was_submitted: bool
    accepted: bool | None
```

The strict T5/T6 tests are replaced by correction-11-compatible calls:

```python
@pytest.mark.asyncio
async def test_safe_delivery_evidence_contains_no_raw_vp(
    executor, execution_grant, plan, disclosure_plan
) -> None:
    evidence = await executor.present_and_deliver(
        execution_grant=execution_grant,
        plan=plan,
        request=NORMALIZED_REQUEST,
        credential_ref="credential-1",
        disclosure_plan=disclosure_plan,
        now=NOW,
    )
    text = evidence.model_dump_json()
    assert "PTF_CANARY_RAW_CREDENTIAL_1D47" not in text
    assert "PTF_CANARY_VP_TOKEN_70E2" not in text


def test_submitted_unknown_result_is_indeterminate() -> None:
    result = classify_direct_post_evidence(
        evidence=OID4VPDeliveryEvidence(
            artifact_digest="a" * 64,
            verifier_subject_id="verifier-1",
            endpoint_binding_id="verifier-endpoint-1",
            response_status="TIMEOUT_AFTER_SUBMIT",
            response_digest=None,
            request_was_submitted=True,
            accepted=None,
        )
    )
    assert result.outcome is ExecutionOutcome.INDETERMINATE
```

There is no adapter-level `deliver_direct_post(... http_client ...)` and no public `OpenID4VPWalletExecutor.present(...)` after correction 11.

The T7 spy implements only `async present_and_deliver(...)` and counts calls; it returns the explicit safe delivery evidence above.

---

# Plan 05 fixture closure

## T4 authorization target

The strict Plan 05 `CanonicalAuthorizationTarget` fixture is superseded. Tests use correction 11's explicit `PLAN_VIEW: CanonicalApprovalView` and:

```python
challenge = service.begin(principal=PRINCIPAL, view=PLAN_VIEW, now=NOW)
```

No `replace_target_for_test(...)` production/service method is added. The mutation test instead changes the authoritative selected plan/fingerprint in the test repository between `begin` and `verify`, then asserts verification detects that the challenge target no longer matches the current canonical target before approval is recorded.

## T5 E2E support ownership

Create in T5:

```text
tests/e2e/support/trusted-surface.ts
```

It exports only test-harness functions:

```typescript
export async function mutateSelectedPlan(
  request: APIRequestContext,
  actionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const response = await request.post(`/__test__/actions/${actionId}/mutate-plan`, { data: patch });
  expect(response.ok()).toBeTruthy();
}

export async function executionGrantCount(
  request: APIRequestContext,
  actionId: string,
): Promise<number> {
  const response = await request.get(`/__test__/actions/${actionId}/execution-grants`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).count;
}
```

These `__test__` endpoints exist only in the isolated E2E fixture application, are never registered in production `ptf_api.app`, and are source-scanned out of production route modules. The Playwright test imports these helpers explicitly; no undefined `mutateServerPlan` global exists.

## T6/T7 Python support ownership

Create:

```text
packages/ptf-api/tests/product_support.py
```

This test-only module exports `activate_fixture_grant`, `load_grant`, `snapshot_authority_state`, and typed request builders over an isolated test database. Each helper calls public repository/service methods; it does not update SQL directly or bypass the security module under test.

T6/T7 tests import those helpers explicitly. No magic `active_grant_ids()`/`propose_broadening()`/`snapshot_authority_state()` name is assumed from pytest global state.

---

# Plan 06 fixture closure

## Conformance target test harness

Create in T1:

```text
packages/ptf-conformance/tests/support.py
```

It defines `TestConformanceTarget`, an adapter over public `ActionRuntime`/Principal service seams. It must not import private resolver functions or raw PostgreSQL connections.

T2/T4/T5/T8 tests import target builders from this file instead of assuming magic `target` fixtures.

## Portability support

Create in T4:

```text
tests/integration/portability_support.py
```

It defines explicit synthetic package/resource builders including `make_source_package_with_trusted_merchant()` and controlled canaries. Portability tests import these functions; no undeclared pytest fixture name remains.

`PortabilityService.commit_import(...)` uses the exact final T4 interface from correction 7. Where an older strict snippet says `inspected_digest`, use the actual reviewed parameter name from that interface (`expected_package_digest`) and pass the digest returned/confirmed by inspection. No alternative alias is created.

## Device/recovery support

Create in T5:

```text
tests/integration/device_recovery_support.py
```

It exports test-only builders for verified `IdentityBinding`, `DeviceEnrollmentChallenge`, pre-loss Assurance Manifest, broader post-recovery manifest, and authenticated Principal actors. It calls `DeviceService.complete_enrollment(...)` with an already verified synthetic binding; cryptographic WebAuthn registration is tested separately at T7 through `PrincipalAuthorizationService`.

The old pseudo-expression `authentication_with(...).fails_closed()` is replaced by a real call through the public authentication verifier/API fixture and an explicit `pytest.raises(AuthenticationFailed)` assertion for the revoked binding.

## AI1 witness support

`tests/integration/test_ai1_witness.py` defines its `WitnessReceipt` test value/factory locally using the exact safe witness fields implemented by T6; there is no invented production `WitnessReceipt.fixture()` method.

## T9 workflow parser

`tests/acceptance/test_ci_configuration.py` defines its own YAML `uses:` extractor (or uses a pinned YAML parser already in the reviewed dev dependencies). `workflow_uses`/`workflow_text` are local fixture functions in that file, not undeclared globals. Repository+SHA is compared to correction 10's reviewed allowlist.

---

## Updated file/commit rule

The helper files above are part of the task that first uses them and are included in that task's candidate commit. They are test-only support; they do not become production packages or public APIs.

## Final strict rule

After applying this closure, a task is not considered C10-ready if its committed test would still require an undefined fixture/helper, an invented convenience constructor on a production type, a bare expected `Exception` where the task defines a typed error, or a superseded interface from correction 10/11.