# PTF v1 Task-Quality Corrections 11 — Principal Authorization and OpenID4VP Protected Delivery

Status: **BINDING CROSS-TASK SEAM CORRECTION; APPROVED SPEC UNCHANGED**

This correction closes two interface ambiguities discovered by the final Superpowers/Matt codebase-design pass. It supersedes only conflicting Plan 04 T5–T7 and Plan 05 T4/T5 examples.

---

# A. Plan 05 Principal authorization — exact action/grant challenge interface

## Problem

Older Plan 05 material named `PrincipalAuthorizationService.begin(...)/verify(...)` but left their action/grant parameters as ellipses. The strict Plan 05 supplement then introduced a convenience `CanonicalAuthorizationTarget` that is not part of the frozen planning registry. That would make the implementer invent a product-security type.

## Exact canonical approval view

Plan 05 T4 owns this product-safe view model:

```python
class CanonicalApprovalView(FrozenModel):
    authorization_kind: AuthorizationTargetKind
    canonical_fingerprint: str
    title: str
    operation: str
    recipient: str
    purpose: str
    resource: str
    amount_minor: int | None
    currency: str | None
    disclosure_summary: tuple[str, ...]
    route_summary: str
    downgrade_summary: str | None
    residual_risks: tuple[str, ...]
    expires_at: datetime | None
    use_count: int | None
    required_assurance: str
```

`authorization_kind` is typed `AuthorizationTargetKind`, not an arbitrary string.

## Exact challenge value

```python
class PrincipalAuthorizationChallenge(FrozenModel):
    challenge_id: str
    principal_id: str
    target_kind: AuthorizationTargetKind
    canonical_fingerprint: str
    required_assurance: str
    rp_id: str
    origin: str
    public_key_options: dict[str, object]
    created_at: datetime
    expires_at: datetime
    used: bool
```

The `public_key_options` field is browser-facing ceremony data only. The authoritative target kind/fingerprint/assurance are server-stored fields in the same challenge record.

## Exact service seam for action/grant authorization

```python
class PrincipalAuthorizationService:
    def begin(
        self,
        *,
        principal: AuthenticatedActor,
        view: CanonicalApprovalView,
        now: datetime,
    ) -> PrincipalAuthorizationChallenge: ...

    def verify(
        self,
        *,
        principal: AuthenticatedActor,
        challenge_id: str,
        credential_response: dict[str, object],
        now: datetime,
    ) -> ApprovalEvidence: ...
```

`begin(...)` persists the complete server-side challenge record. It must not rely on the browser to return `canonical_fingerprint`, `authorization_kind`, RP ID, origin, or required assurance correctly.

`verify(...)` loads that challenge, verifies WebAuthn response/challenge/origin/RP/freshness/single-use and AA profile, marks the challenge used atomically, and returns:

```python
ApprovalEvidence(
    principal_id=principal.subject_id,
    target_kind=challenge.target_kind,
    canonical_fingerprint=challenge.canonical_fingerprint,
    assurance_profile=<verified profile>,
    challenge_id=challenge.challenge_id,
    authenticated_at=now,
    expires_at=<approval evidence expiry>,
)
```

Action approval uses `AuthorizationTargetKind.EXECUTION_PLAN`; grant activation uses `AuthorizationTargetKind.STANDING_GRANT`. The same challenge cannot be replayed across kinds or fingerprints.

The undefined `CanonicalAuthorizationTarget` helper in the strict Plan 05 supplement is superseded and forbidden.

## T4 test correction

Use:

```python
PLAN_VIEW = CanonicalApprovalView(
    authorization_kind=AuthorizationTargetKind.EXECUTION_PLAN,
    canonical_fingerprint="a" * 64,
    title="Pay Merchant One",
    operation="payment.authorize",
    recipient="Merchant One",
    purpose="purchase",
    resource="wallet-resource-1",
    amount_minor=2500,
    currency="USD",
    disclosure_summary=(),
    route_summary="x402 exact",
    downgrade_summary=None,
    residual_risks=(),
    expires_at=LATER,
    use_count=1,
    required_assurance="AA2",
)

challenge = service.begin(principal=PRINCIPAL, view=PLAN_VIEW, now=NOW)
```

All other T4 mutation/replay/AA tests remain binding.

Correction 10's device-registration methods extend this same service and remain binding.

---

# B. Plan 04 OpenID4VP — wallet executor owns raw VP token and direct-post delivery

## Problem

The Plan 04 architecture states that the wallet executor owns the credential/holder key and produces the VP Token/direct-post response. Older T5/T6 examples instead returned a presentation artifact to an adapter-level `deliver_direct_post(..., http_client=...)`, leaving it ambiguous whether the raw VP token crossed into the PTF control/runtime process.

The reference profile must not depend on that ambiguity.

## Protected delivery value

Adapter/control-plane code receives only safe delivery evidence:

```python
class OID4VPDeliveryEvidence(FrozenModel):
    artifact_digest: str
    verifier_subject_id: str
    endpoint_binding_id: str
    response_status: str
    response_digest: str | None
    request_was_submitted: bool
    accepted: bool | None
```

It has no VP token, SD-JWT disclosures, credential bytes, holder key, arbitrary response body, or raw protocol payload.

## Wallet executor seam

Replace the old public `present(...) -> OID4VPPresentationArtifact` method with:

```python
class OpenID4VPWalletExecutor:
    async def present_and_deliver(
        self,
        *,
        execution_grant: ExecutionGrantRecord,
        plan: ExecutionPlan,
        request: OID4VPRequestSnapshot,
        credential_ref: str,
        disclosure_plan: DisclosurePlan,
        now: datetime,
    ) -> OID4VPDeliveryEvidence: ...
```

The executor/provider privately performs all of:

```text
resolve Protected Resource Catalog record
load raw credential + holder key from private provider
verify execution grant / plan fingerprint / principal / resource / verifier / nonce / status
select only DisclosurePlan claims
create holder-bound VP token
POST the VP token to exactly request.response_uri through executor-owned protected HTTP transport
retain no reusable raw VP token in PTF state
return OID4VPDeliveryEvidence only
```

The raw VP token never becomes an `ActionRuntime`, Agent API, PTFReceipt, generic adapter DTO, generic log/error/telemetry, or browser-storage value.

## T6 responsibility after correction

`adapters/openid4vp/src/ptf_openid4vp/response.py` is a **safe evidence classifier**, not an HTTP sender of raw VP tokens.

Its public seam is:

```python
def classify_direct_post_evidence(
    *,
    evidence: OID4VPDeliveryEvidence,
) -> ExternalExecutionResult: ...
```

Deterministic rules:

```text
request_was_submitted=False + deterministic local/transport failure -> RELEASED_NO_EFFECT
accepted=True -> CONSUMED
accepted=False with verifier evidence proving no accepted presentation effect -> RELEASED_NO_EFFECT
request_was_submitted=True + accepted is None -> INDETERMINATE
contradictory/malformed safe evidence after submission -> INDETERMINATE
```

The adapter sees only safe evidence, never `vp_token`.

## T5/T6 test corrections

Structural negative test:

```python
def test_wallet_executor_exposes_no_present_method() -> None:
    assert not hasattr(OpenID4VPWalletExecutor, "present")
    assert hasattr(OpenID4VPWalletExecutor, "present_and_deliver")
```

Leak test invokes `present_and_deliver(...)`, then serializes the returned `OID4VPDeliveryEvidence`, `ExternalExecutionResult`, `PTFReceipt`, Agent responses/log/error capture and asserts the raw credential/VP canaries are absent.

T6 tests call `classify_direct_post_evidence(...)`; they do not take `httpx.AsyncClient` or a raw presentation artifact.

The local FastAPI verifier fixture is injected into the **executor's protected HTTP transport test dependency**, so end-to-end response behavior is still tested without putting token delivery in the control-plane adapter.

## T7 flow correction

Execution sequence becomes exactly:

```text
runtime.authorize_execution
-> runtime.revalidate_execution immediately before credential use
-> wallet_executor.present_and_deliver(...)
-> classify_direct_post_evidence(safe evidence)
-> runtime.reconcile
-> PTFReceipt
```

A verifier/response URI/nonce/DCQL/credential/disclosure mutation must fail before `present_and_deliver` is invoked or at its exact plan/binding checks. Post-submit ambiguous delivery yields `INDETERMINATE` and cannot be blindly retried.

---

## Effect

This correction introduces no generic protocol adapter. It makes the Trusted authorization and OpenID4VP protected-delivery boundaries deep and explicit:

```text
canonical human authorization -> PrincipalAuthorizationService
credential + holder key + raw VP token + network submission -> OpenID4VPWalletExecutor
safe response/outcome classification -> OpenID4VP adapter
canonical authority/reconciliation -> ActionRuntime
```

Any older test/code snippet using `CanonicalAuthorizationTarget`, `OpenID4VPWalletExecutor.present(...)`, or adapter-level raw-token `deliver_direct_post(...)` is superseded.