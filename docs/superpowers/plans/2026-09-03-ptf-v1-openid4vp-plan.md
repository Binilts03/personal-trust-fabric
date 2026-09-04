# PTF v1 OpenID4VP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that PTF’s authority/disclosure model generalizes beyond payments by implementing a concrete OpenID for Verifiable Presentations 1.0 Final wallet-side flow with authenticated verifier binding, DCQL claim minimization, nonce/session binding, brokered credential presentation, and no unnecessary credential copying into the Agent/control plane.

**Architecture:** `adapters/openid4vp` interprets a verifier’s OpenID4VP request into a PTF ActionRequest and exact DisclosurePlan/ExecutionPlan. A separate wallet executor owns the credential and holder-binding key and produces the VP Token/direct-post response only after PTF authorization/revalidation. The Agent sees only Safe View, approval state, and safe evidence references. The reference profile uses OpenID4VP 1.0 Final over HTTPS `direct_post` with a `dc+sd-jwt` credential fixture; protocol mechanics remain concrete and do not redefine PTF core types.

**Tech Stack:** Python 3.14.7; existing converged PTF workspace; `jwcrypto==1.5.6`; `sd-jwt==0.10.4` for the controlled SD-JWT fixture path where compatible with the OpenID4VP Final reference; FastAPI/httpx for local verifier fixtures; pytest; Hypothesis; Ruff; Pyright. OpenID4VP normative target: OpenID for Verifiable Presentations 1.0 Final (July 2025). No OIDF certification/conformance claim is made by this plan.

**Spec:** `docs/spec/PTF-V1-PROPOSED.md`, exact approved blob recorded by `docs/spec/PTF-V1-APPROVAL.md`. Primary sections: 6–7, 9–17, 19, 21–24, 28.

## Global Constraints

- Execute only after Plans 02 and 03 are accepted and the x402/AP2 seam review is complete.
- Target OpenID4VP 1.0 Final, not a draft or 1.1 working draft, for foundational v1.
- The reference profile is wallet-side presentation using `response_type=vp_token`, `response_mode=direct_post`, DCQL, and `dc+sd-jwt` fixture credentials.
- Verifier client identity, response URI, web origin, public key/certificate, and TrustRelation remain distinct until validated PTF bindings connect them.
- A verifier request string/QR/deep link is untrusted input; it cannot create TrustRelations or authority.
- Requested claims are an upper-bound request, not permission to disclose. PTF DisclosurePlan selects the minimum set allowed by Hard Policy, source authority/approval, credential handling, and verifier trust.
- The raw credential, holder private key, SD-JWT disclosures, and raw VP Token must not appear in Agent Safe View, Agent API responses, PTFReceipt, generic logs, errors, or telemetry.
- Credential custody is brokered in the reference profile: PTF control runtime stores only `ProtectedResourceRef` + credential metadata/status; the wallet executor/provider stores the credential and holder key.
- `ProtectedResourceRef` is not bearer authority.
- Nonce/session/request binding is single-use; replay fails.
- Credential freshness/status is evaluated before consequential presentation where the configured fixture profile requires it.
- OpenID4VP protocol validity does not create PTF authority; it only contributes request/binding/evidence semantics.
- Do not add payment-specific fields to `ActionRequest`, `ExecutionPlan`, `ExternalExecutionResult`, or other canonical PTF core types to make this flow work.
- Do not claim OpenID Foundation certification. Plan 06 may run the official conformance programme and record actual results.
- Every task follows red-green-refactor and ends with a reviewable commit.

---

## File map

```text
adapters/openid4vp/
├── pyproject.toml
├── src/ptf_openid4vp/
│   ├── __init__.py
│   ├── errors.py
│   ├── models.py                  # normalized request/session/evidence metadata
│   ├── request.py                 # authorization request parsing/binding
│   ├── dcql.py                    # requested-claim normalization/minimization
│   ├── enforcement.py             # OID4VP-specific EnforcementMap
│   ├── response.py                # safe response/evidence handling
│   └── flow.py                    # concrete OpenID4VPFlow
└── tests/
    ├── test_request.py
    ├── test_dcql.py
    ├── test_enforcement.py
    ├── test_response.py
    └── test_flow.py
executors/openid4vp-wallet/
├── pyproject.toml
├── src/ptf_openid4vp_wallet/
│   ├── __init__.py
│   └── executor.py
└── tests/test_executor.py
tests/fixtures/openid4vp/
├── verifier_key.json
├── credential_metadata.json
└── credential_claims.json
tests/integration/
├── test_openid4vp_end_to_end.py
├── test_openid4vp_verifier_substitution.py
├── test_openid4vp_nonce_replay.py
├── test_openid4vp_disclosure_escalation.py
└── test_openid4vp_leak_canary.py
tests/acceptance/test_openid4vp_ptf_invariants.py
docs/research/openid4vp-reference-profile.md
docs/review/openid4vp-core-generality-review.md
```

---

### Task 1: Pin the OpenID4VP 1.0 Final reference profile and package structure

**Files:**
- Create: `adapters/openid4vp/pyproject.toml`
- Create: `adapters/openid4vp/src/ptf_openid4vp/__init__.py`
- Create: `adapters/openid4vp/tests/test_import.py`
- Create: `executors/openid4vp-wallet/pyproject.toml`
- Create: `executors/openid4vp-wallet/src/ptf_openid4vp_wallet/__init__.py`
- Create: `executors/openid4vp-wallet/tests/test_import.py`
- Create: `docs/research/openid4vp-reference-profile.md`

**Interfaces:**
- Produces importable concrete adapter/executor packages and a fixed profile statement.

- [ ] **Step 1: Verify the normative Final specification status**

Run:
```bash
python - <<'PY'
import urllib.request
u = 'https://openid.net/specs/openid-4-verifiable-presentations-1_0-final.html'
text = urllib.request.urlopen(u).read().decode('utf-8', errors='ignore')
assert 'OpenID for Verifiable Presentations 1.0' in text
assert 'Final' in text
assert 'vp_token' in text
assert 'dc+sd-jwt' in text
print('OpenID4VP 1.0 Final reference verified')
PY
```
Expected: verification message. If the Final artifact cannot be retrieved, stop rather than substituting a draft URL.

- [ ] **Step 2: Write failing imports**

```python
def test_ptf_openid4vp_imports() -> None:
    import ptf_openid4vp

    assert ptf_openid4vp.__all__ == []
```
Create the equivalent wallet-executor import test.

- [ ] **Step 3: Create package metadata**

`adapters/openid4vp/pyproject.toml`:
```toml
[project]
name = "ptf-openid4vp"
version = "0.1.0"
requires-python = ">=3.14,<3.15"
dependencies = [
  "ptf-core",
  "ptf-runtime",
  "httpx>=0.28,<0.29",
  "jwcrypto==1.5.6",
]

[tool.uv.sources]
ptf-core = { workspace = true }
ptf-runtime = { workspace = true }

[build-system]
requires = ["hatchling>=1.27,<2"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/ptf_openid4vp"]
```

`executors/openid4vp-wallet/pyproject.toml` uses `ptf-core`, `ptf-runtime`, `jwcrypto==1.5.6`, and `sd-jwt==0.10.4`, with package `src/ptf_openid4vp_wallet`.

- [ ] **Step 4: Record the exact reference profile**

`docs/research/openid4vp-reference-profile.md`:
```text
Normative protocol: OpenID for Verifiable Presentations 1.0 Final
Role under test: Wallet / holder-side PTF integration
Response type: vp_token
Response mode: direct_post
Query language: DCQL
Reference credential format: dc+sd-jwt
Credential custody: wallet-executor/provider, not Agent/control-plane canonical storage
Verifier trust: prevalidated PTF Subject + IdentityBinding + EndpointBinding + TrustRelation
Certification claim: none; official OIDF conformance programme deferred to release Plan 06
```

- [ ] **Step 5: Lock and run imports**

```bash
uv lock
uv sync --all-packages --all-groups
uv run pytest adapters/openid4vp/tests/test_import.py executors/openid4vp-wallet/tests/test_import.py -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add adapters/openid4vp executors/openid4vp-wallet docs/research/openid4vp-reference-profile.md uv.lock
git commit -m "build(openid4vp): pin final credential-presentation profile"
```

---

### Task 2: Normalize and authenticate verifier authorization requests

**Files:**
- Create: `adapters/openid4vp/src/ptf_openid4vp/models.py`
- Create: `adapters/openid4vp/src/ptf_openid4vp/errors.py`
- Create: `adapters/openid4vp/src/ptf_openid4vp/request.py`
- Create: `adapters/openid4vp/tests/test_request.py`

**Interfaces:**
- Produces `OID4VPVerifierBinding`, `OID4VPRequestSnapshot`, `OID4VPSessionBinding`, and:
```python
def normalize_authorization_request(
    *,
    request_parameters: dict[str, object],
    verifier_subject_id: str,
    verifier_binding: OID4VPVerifierBinding,
    received_at: datetime,
) -> OID4VPRequestSnapshot: ...
```

- [ ] **Step 1: Write accepted-request tests**

Reference request must include/normalize:
```text
response_type = vp_token
response_mode = direct_post
client_id
response_uri
nonce
DCQL query
transaction/session identifier generated by PTF
```
Assert normalized snapshot carries a canonical request digest and the validated verifier Subject/binding IDs.

- [ ] **Step 2: Add verifier-binding attacks**

Reject when:
- request `client_id` is not bound to the expected verifier Subject;
- `response_uri` differs from the validated EndpointBinding;
- same display name but different verifier key/origin is used;
- request asks for a response mode/profile not allowed by the reference Hard Policy;
- nonce is missing/empty;
- `response_type` is not `vp_token`.

- [ ] **Step 3: Implement frozen normalized models**

Required shape:
```python
class OID4VPVerifierBinding(FrozenModel):
    subject_id: str
    identity_binding_id: str
    endpoint_binding_id: str
    client_id: str
    response_uri: str
    verified_at: datetime

class OID4VPRequestSnapshot(FrozenModel):
    verifier_subject_id: str
    verifier_binding_id: str
    client_id: str
    response_uri: str
    response_mode: str
    nonce: str
    dcql: dict[str, object]
    request_digest: str
```
`dcql` is protocol request data, not a PTF authorization policy. Before security fingerprinting, canonicalize it deterministically and reject unknown unsupported extensions that affect disclosure semantics.

- [ ] **Step 4: Run**

```bash
uv run pytest adapters/openid4vp/tests/test_request.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/openid4vp/src/ptf_openid4vp adapters/openid4vp/tests/test_request.py
git commit -m "feat(openid4vp): bind verifier authorization requests"
```

---

### Task 3: Convert DCQL requests into minimized PTF disclosure/action semantics

**Files:**
- Create: `adapters/openid4vp/src/ptf_openid4vp/dcql.py`
- Create: `adapters/openid4vp/tests/test_dcql.py`

**Interfaces:**
- Produces `RequestedCredentialClaims`, and:
```python
def interpret_dcql_request(
    *,
    request: OID4VPRequestSnapshot,
    credential_ref: str,
    credential_metadata: CredentialMetadata,
    purpose: str,
) -> tuple[ActionRequest, RequestedCredentialClaims]: ...


def build_minimized_disclosure_plan(
    *,
    requested: RequestedCredentialClaims,
    permitted_claims: frozenset[str],
    credential_ref: str,
    verifier_subject_id: str,
    purpose: str,
) -> DisclosurePlan: ...
```

- [ ] **Step 1: Write minimum-disclosure tests**

Fixture credential metadata exposes claims `given_name`, `family_name`, `birthdate`, `age_over_18`, `address`. Verifier requests only `age_over_18`. Assert PTF ActionRequest operation is `credential.present`, and DisclosurePlan contains only `age_over_18` with `DisclosureMode.SELECTIVE_CLAIM` or stronger/minimizing mode supported by the credential provider.

- [ ] **Step 2: Add escalation tests**

If DCQL requests `birthdate` + `address` but PTF permitted claims contain only `age_over_18`, the adapter must not silently expand disclosure. Either produce a plan that satisfies the legitimate subset only when protocol semantics allow the request to be fulfilled that way, or fail with typed `DisclosureRequirementUnsatisfied`; never disclose unpermitted claims.

- [ ] **Step 3: Keep freshness/verification explicit**

`CredentialMetadata` contains safe status/freshness metadata only:
```python
class CredentialMetadata(FrozenModel):
    resource_ref: str
    format: str
    claim_names: frozenset[str]
    issuer_subject_id: str
    holder_binding: bool
    freshness_state: FreshnessState
    status_checked_at: datetime | None
```
A `STALE`, `UNKNOWN`, or `REVOKED` credential cannot satisfy a plan requiring a current verified credential.

- [ ] **Step 4: Run**

```bash
uv run pytest adapters/openid4vp/tests/test_dcql.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/openid4vp/src/ptf_openid4vp/dcql.py adapters/openid4vp/tests/test_dcql.py
git commit -m "feat(openid4vp): minimize requested credential disclosure"
```

---

### Task 4: Build OpenID4VP-specific Enforcement Maps and exact transaction binding

**Files:**
- Create: `adapters/openid4vp/src/ptf_openid4vp/enforcement.py`
- Create: `adapters/openid4vp/tests/test_enforcement.py`

**Interfaces:**
- Produces:
```python
def build_openid4vp_enforcement_map(
    *,
    request: OID4VPRequestSnapshot,
    disclosure_plan: DisclosurePlan,
    credential_metadata: CredentialMetadata,
    executor_profile_id: str,
) -> EnforcementMap: ...
```

- [ ] **Step 1: Write enforcement mapping tests**

At minimum:
```text
verifier Subject/trust            -> PTF
client_id/response_uri binding     -> PTF + PROTOCOL
nonce/session binding              -> PTF + PROTOCOL + EXECUTOR
requested/permitted claims         -> PTF + EXECUTOR + PROTOCOL presentation
credential holder binding          -> EXECUTOR + PROTOCOL
credential freshness/status        -> PTF + provider/status mechanism
plan fingerprint                   -> PTF + EXECUTOR
raw credential non-disclosure      -> EXECUTOR/TCB + PTF safe surfaces
response delivery endpoint         -> PTF + PROTOCOL
```

- [ ] **Step 2: Bind all approval-relevant request data into the ExecutionPlan**

Transaction binding must include verifier Subject/binding, `client_id`, `response_uri`, nonce, request digest, credential resource ref, selected claims/disclosure mode, and response mode. Mutating any of these after approval must change plan fingerprint or fail revalidation.

- [ ] **Step 3: Run**

```bash
uv run pytest adapters/openid4vp/tests/test_enforcement.py -q
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add adapters/openid4vp/src/ptf_openid4vp/enforcement.py adapters/openid4vp/tests/test_enforcement.py
git commit -m "feat(openid4vp): bind presentation enforcement semantics"
```

---

### Task 5: Implement brokered wallet execution with raw credential isolation

**Files:**
- Create: `tests/fixtures/openid4vp/verifier_key.json`
- Create: `tests/fixtures/openid4vp/credential_metadata.json`
- Create: `tests/fixtures/openid4vp/credential_claims.json`
- Create: `executors/openid4vp-wallet/src/ptf_openid4vp_wallet/executor.py`
- Create: `executors/openid4vp-wallet/tests/test_executor.py`
- Create: `tests/integration/test_openid4vp_leak_canary.py`

**Interfaces:**
- Produces:
```python
class OpenID4VPWalletExecutor:
    def present(
        self,
        *,
        execution_grant: ExecutionGrantRecord,
        plan: ExecutionPlan,
        request: OID4VPRequestSnapshot,
        credential_ref: str,
        disclosure_plan: DisclosurePlan,
        now: datetime,
    ) -> OID4VPPresentationArtifact: ...
```
- Credential bytes/holder key are loaded by the executor from its private provider/catalog and are not arguments to the public method.

- [ ] **Step 1: Create deterministic synthetic credential fixtures**

`credential_claims.json` contains only synthetic values and a leak marker `PTF_CANARY_RAW_CREDENTIAL_1D47`. `credential_metadata.json` separately contains safe metadata. The executor fixture creates a signed/holder-bound `dc+sd-jwt` presentation from these synthetic values using the pinned local credential library path; no real identity data is used.

- [ ] **Step 2: Write executor denial tests**

Reject missing/expired Execution Grant, plan fingerprint mismatch, wrong verifier binding, wrong nonce, disclosure claim outside plan, stale/revoked credential when current status is required, and `ProtectedResourceRef` without Execution Grant.

- [ ] **Step 3: Implement selective presentation**

The executor resolves `credential_ref` internally, selects only the claims listed in `DisclosurePlan`, binds the holder presentation to the request nonce/verifier audience as required by the reference `dc+sd-jwt` profile, and returns `OID4VPPresentationArtifact` containing raw `vp_token` only on the protected protocol-delivery path plus a safe digest/reference for PTF.

- [ ] **Step 4: Generate truthful Assurance Manifest data**

Reference profile states:
- credential/holder key visible to wallet executor/provider only;
- Agent/model raw credential and VP token visibility `none` on controlled Agent surfaces;
- control runtime receives only resource metadata and artifact digest/reference;
- recipient disclosure is exact selected claim set;
- recovery/non-exportability properties match the fixture provider;
- residual risk includes wallet executor/provider compromise and verifier retention after legitimate disclosure.

- [ ] **Step 5: Run leak/executor tests**

```bash
uv run pytest executors/openid4vp-wallet/tests/test_executor.py tests/integration/test_openid4vp_leak_canary.py -q
```
Expected: PASS and the canary is absent from Agent/API/receipt/log/error capture.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/openid4vp executors/openid4vp-wallet tests/integration/test_openid4vp_leak_canary.py
git commit -m "feat(openid4vp): broker protected credential presentation"
```

---

### Task 6: Implement direct-post response handling and single-use session evidence

**Files:**
- Create: `adapters/openid4vp/src/ptf_openid4vp/response.py`
- Create: `adapters/openid4vp/tests/test_response.py`
- Create: `tests/integration/test_openid4vp_nonce_replay.py`

**Interfaces:**
- Produces `OID4VPResponseEvidence` and:
```python
async def deliver_direct_post(
    *,
    request: OID4VPRequestSnapshot,
    artifact: OID4VPPresentationArtifact,
    http_client: httpx.AsyncClient,
) -> ExternalExecutionResult: ...
```

- [ ] **Step 1: Write response endpoint tests**

Use a local FastAPI verifier fixture. Assert response posts only to the already-bound `response_uri`, sends required `vp_token`/state/session fields for the reference profile, and records a safe response digest/status—not raw VP token—in PTF evidence.

- [ ] **Step 2: Write replay tests**

After one accepted response, reuse the same PTF session/nonce. The adapter/executor must reject before a second presentation/delivery. Different verifier with same nonce must also fail binding checks.

- [ ] **Step 3: Define outcome classification**

Deterministic verifier rejection before presentation acceptance -> `RELEASED_NO_EFFECT`. Verified successful response acceptance -> `CONSUMED` for the one-use presentation authority. Timeout/connection ambiguity after VP token submission -> `INDETERMINATE`; no blind retry with the same one-use presentation without proof/no-effect or fresh reauthorization.

- [ ] **Step 4: Run**

```bash
uv run pytest adapters/openid4vp/tests/test_response.py tests/integration/test_openid4vp_nonce_replay.py -q
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add adapters/openid4vp/src/ptf_openid4vp/response.py adapters/openid4vp/tests/test_response.py tests/integration/test_openid4vp_nonce_replay.py
git commit -m "feat(openid4vp): bind direct-post presentation sessions"
```

---

### Task 7: Implement the concrete OpenID4VP flow through `ActionRuntime`

**Files:**
- Create: `adapters/openid4vp/src/ptf_openid4vp/flow.py`
- Create: `adapters/openid4vp/tests/test_flow.py`
- Create: `tests/integration/test_openid4vp_end_to_end.py`
- Create: `tests/integration/test_openid4vp_verifier_substitution.py`
- Create: `tests/integration/test_openid4vp_disclosure_escalation.py`

**Interfaces:**
- Produces:
```python
class OpenID4VPFlow:
    def prepare(
        self,
        *,
        agent: AuthenticatedActor,
        request_parameters: dict[str, object],
        verifier_subject_id: str,
        verifier_binding: OID4VPVerifierBinding,
        credential_ref: str,
        purpose: str,
        now: datetime,
    ) -> PreparedAction: ...

    async def execute(
        self,
        *,
        action_id: str,
        now: datetime,
    ) -> PTFReceipt: ...
```

- [ ] **Step 1: Write approval-required and grant-covered scenarios**

A standing disclosure grant may autonomously allow only a precise verifier/purpose/credential/claim set. Anything broader must return `APPROVAL_REQUIRED` or DENY according to Hard Policy. Exact approval binds the final selected verifier, claims, nonce, response URI, credential ref, and disclosure mode.

- [ ] **Step 2: Write verifier/claim substitution attacks**

After plan selection/approval mutate:
- verifier Subject/binding;
- response URI;
- nonce;
- DCQL claim set;
- credential ref;
- disclosure mode.
Each must fail revalidation before wallet presentation or require a new plan/approval.

- [ ] **Step 3: Implement preparation**

Sequence:
1. normalize/authenticate verifier request;
2. interpret DCQL into PTF ActionRequest;
3. `runtime.request_action`;
4. build minimized DisclosurePlan, EnforcementMap, AssuranceManifest;
5. build protocol-specific ExecutionPlan transaction binding;
6. `runtime.select_plan`;
7. return safe PreparedAction.

- [ ] **Step 4: Implement execution**

Sequence:
1. `runtime.authorize_execution`;
2. `runtime.revalidate_execution` immediately before credential use;
3. wallet executor creates presentation artifact;
4. direct-post delivery to bound verifier endpoint;
5. classify outcome;
6. `runtime.reconcile`;
7. return PTFReceipt.

- [ ] **Step 5: Run flow/integration tests**

```bash
uv run pytest adapters/openid4vp/tests/test_flow.py tests/integration/test_openid4vp_end_to_end.py tests/integration/test_openid4vp_verifier_substitution.py tests/integration/test_openid4vp_disclosure_escalation.py -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add adapters/openid4vp/src/ptf_openid4vp/flow.py adapters/openid4vp/tests/test_flow.py tests/integration/test_openid4vp_end_to_end.py tests/integration/test_openid4vp_verifier_substitution.py tests/integration/test_openid4vp_disclosure_escalation.py
git commit -m "feat(openid4vp): execute minimum-disclosure presentation through PTF"
```

---

### Task 8: Lock OpenID4VP acceptance and perform the core-generality review

**Files:**
- Create: `tests/acceptance/test_openid4vp_ptf_invariants.py`
- Create: `docs/review/openid4vp-core-generality-review.md`

**Interfaces:**
- Produces the third materially different protocol proof and the architecture-generalization decision required before Plan 05.

- [ ] **Step 1: Add acceptance cases**

Prove:
- untrusted verifier request cannot create TrustRelation;
- verifier binding uses actual client/endpoint identity, not display label;
- DCQL request cannot broaden PTF disclosure permission;
- credential status/freshness is enforced where required;
- nonce/session replay fails;
- raw credential/holder key/VP token absent from Agent/API/receipt/log/error surfaces;
- artifact is separate from PTF authority records;
- `ProtectedResourceRef` alone cannot present a credential;
- plan mutation requires reapproval/re-resolution;
- timeout after possible presentation delivery becomes `INDETERMINATE` and is not blindly retried.

- [ ] **Step 2: Perform the cross-domain core-generality review**

In `docs/review/openid4vp-core-generality-review.md`, compare x402, AP2, and OpenID4VP usage of:
```text
ActionRequest
HardPolicy / StandingGrant / ExactApproval
TrustSnapshot / bindings
DisclosurePlan
ExecutionPlan / plan_fingerprint
EnforcementMap
ExecutionGrantRecord
AssuranceManifest
ExternalExecutionResult
PTFReceipt
```
List any canonical core field introduced solely for a payment/mandate/credential protocol. Expected: none.

- [ ] **Step 3: Apply the architecture stop rule**

If the credential flow requires payment-specific conditionals in canonical core types or cannot express verifier/claim disclosure without protocol leakage, stop Plan 04 and open a spec/ADR review. Do not add `protocol == ...` branches to core authorization models as a shortcut.

- [ ] **Step 4: Run full verification**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest -q
uv run ruff check .
uv run pyright
```
Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/acceptance/test_openid4vp_ptf_invariants.py docs/review/openid4vp-core-generality-review.md
git commit -m "test(openid4vp): prove cross-domain PTF generality"
```

---

## Plan 04 completion gate

Plan 04 is accepted only when:

1. the reference implementation targets OpenID4VP 1.0 Final explicitly;
2. verifier identity/endpoint/trust is authenticated through PTF bindings rather than request labels;
3. DCQL disclosure is minimized and cannot exceed PTF permission;
4. exact approval/standing disclosure authority remains distinct from the verifier request;
5. raw credentials and holder keys remain within the declared wallet-executor TCB;
6. nonce/session/replay and plan-mutation attacks fail;
7. credential freshness/status is fail-closed for consequential use under its profile;
8. PTFReceipt contains safe presentation evidence references, not raw credential/VP content;
9. x402, AP2, and OpenID4VP all use the same canonical PTF authority/planning concepts without domain-specific leakage;
10. no OpenID Foundation certification claim is made from local tests.

After this gate, the core protocol/authority semantics are stable enough for Plan 05 product surfaces and Plan 06 conformance/release work.