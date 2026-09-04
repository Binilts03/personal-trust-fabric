# PTF v1 Strict C10 Code Supplement — Plan 05 Product Surface

Status: **BINDING TEST/IMPLEMENTATION SUPPLEMENT FOR SUPERPOWERS PLAN QUALITY**

This supplement turns Plan 05's remaining prose-only product tests into executable public-surface fixtures. It preserves Contracts C3/C4/C7/C8/C9, the final interface registry, and correction 6: Plan 05 has trust administration but **no device backend/UI**.

---

## T1 — Node/TypeScript workspace bootstrap

This is configuration/bootstrap work. Use the correction-1 precondition:

```bash
test ! -f package.json
```

Expected: exit 0 on the clean rewrite branch. Create the exact pinned workspace files from original T1. Green:

```bash
npm ci
npm run typecheck
```

The candidate commit remains the original T1 commit boundary and inherits the reviewer gate.

---

## T2 — physically separate Agent and Principal OpenAPI documents

Create `packages/ptf-api/tests/test_openapi_surfaces.py` before `openapi.py`:

```python
from ptf_api.openapi import agent_openapi_schema, principal_openapi_schema

AGENT_PATHS = {
    "/v1/agent/safe-view",
    "/v1/agent/actions",
    "/v1/agent/actions/{action_id}/plan",
    "/v1/agent/actions/{action_id}",
    "/v1/agent/actions/{action_id}/receipt",
}


def test_agent_schema_contains_only_agent_trust_level(app) -> None:
    schema = agent_openapi_schema(app)
    assert set(schema["paths"]) == AGENT_PATHS
    serialized = repr(schema).lower()
    for forbidden in (
        "/v1/principal/",
        "approve",
        "trust_admin",
        "device_admin",
        "recovery",
        "resource_admin",
    ):
        assert forbidden not in serialized


def test_principal_schema_contains_no_agent_paths(app) -> None:
    schema = principal_openapi_schema(app)
    assert all(not path.startswith("/v1/agent/") for path in schema["paths"])
```

Add a test that component schemas are pruned to the transitive set referenced by retained paths; an intentionally Principal-only schema name must not remain in Agent components.

Red:

```bash
uv run pytest packages/ptf-api/tests/test_openapi_surfaces.py -q
```

Expected: import failure before `openapi.py` exists.

Implementation seams remain:

```python
def agent_openapi_schema(app) -> dict[str, object]: ...
def principal_openapi_schema(app) -> dict[str, object]: ...
```

Green is the original test + deterministic export commands.

---

## T3 — five-method Agent SDK

After generating types from Agent OpenAPI, create `sdk/typescript/test/client.test.ts` before `client.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { PtfClient } from '../src/client';

describe('Agent SDK public surface', () => {
  it('exports exactly five fixed Agent methods', () => {
    expect(Object.getOwnPropertyNames(PtfClient.prototype).sort()).toEqual([
      'constructor',
      'getAction',
      'getReceipt',
      'getSafeView',
      'requestAction',
      'selectPlan',
    ]);
  });

  it('has no generic path escape hatch', () => {
    const names = Object.getOwnPropertyNames(PtfClient.prototype);
    expect(names).not.toContain('request');
    expect(names).not.toContain('fetch');
  });
});
```

Type contract is exactly:

```typescript
export interface PtfAgentClient {
  getSafeView(input: SafeViewRequest): Promise<SafeViewResponse>;
  requestAction(input: AgentActionRequest): Promise<PreparedActionResponse>;
  selectPlan(actionId: string, input: AgentPlanSelection): Promise<PreparedActionResponse>;
  getAction(actionId: string): Promise<PreparedActionResponse>;
  getReceipt(actionId: string): Promise<PtfReceiptResponse>;
}
```

`SafeViewRequest` includes `principal_id` from the final interface registry.

Red:

```bash
npm --workspace sdk/typescript test
```

Expected: non-zero before `PtfClient` exists. Green is test + typecheck. A source scan rejects `/v1/principal/` literals in SDK source.

---

## T4 — server-side Principal authorization with target-generic evidence

Create `packages/ptf-api/tests/test_principal_authorization.py` before `principal_authorization.py`.

Required test fixture:

```python
PLAN_TARGET = CanonicalAuthorizationTarget(
    target_kind=AuthorizationTargetKind.EXECUTION_PLAN,
    canonical_fingerprint="a" * 64,
    required_assurance="AA2",
)
```

At minimum:

```python
def test_verified_action_approval_returns_execution_plan_target_evidence(service, verified_webauthn) -> None:
    challenge = service.begin(target=PLAN_TARGET, principal=PRINCIPAL, now=NOW)
    evidence = service.verify(
        principal=PRINCIPAL,
        challenge_id=challenge.challenge_id,
        credential_response=verified_webauthn,
        now=NOW,
    )
    assert evidence.target_kind is AuthorizationTargetKind.EXECUTION_PLAN
    assert evidence.canonical_fingerprint == "a" * 64
    assert evidence.principal_id == "P1"


def test_mutated_canonical_terms_invalidate_challenge(service, verified_webauthn) -> None:
    challenge = service.begin(target=PLAN_TARGET, principal=PRINCIPAL, now=NOW)
    service.replace_target_for_test(challenge.challenge_id, fingerprint="b" * 64)
    with pytest.raises(Exception):
        service.verify(
            principal=PRINCIPAL,
            challenge_id=challenge.challenge_id,
            credential_response=verified_webauthn,
            now=NOW,
        )
```

Add replayed challenge, wrong origin, wrong RP ID, AA2 `user_verified=False`, and Standing Grant target-kind tests.

Red:

```bash
uv run pytest packages/ptf-api/tests/test_principal_authorization.py -q
```

Implementation must use pinned `webauthn==3.0.0`, server-held challenge/fingerprint/RP/origin/expiry, and Contract C3 `ApprovalEvidence`:

```python
class ApprovalEvidence(FrozenModel):
    principal_id: str
    target_kind: AuthorizationTargetKind
    canonical_fingerprint: str
    assurance_profile: str
    challenge_id: str
    authenticated_at: datetime
    expires_at: datetime
```

No superseded `plan_fingerprint` field exists on ApprovalEvidence. Green is original Principal authorization/API suite.

---

## T5 — canonical approval UX

Create `tests/e2e/trusted-surface-approval.spec.ts` before the page/components.

Minimum Playwright assertions:

```typescript
test('renders server canonical terms and refuses changed terms', async ({ page }) => {
  await page.goto('/approvals/action-1');
  await expect(page.getByText('Merchant One')).toBeVisible();
  await expect(page.getByText('purchase')).toBeVisible();
  await expect(page.getByText('payment.authorize')).toBeVisible();
  await expect(page.getByText('AA2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve once' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deny' })).toBeVisible();

  await mutateServerPlan('action-1', { amount_minor: 2501 });
  await page.getByRole('button', { name: 'Approve once' }).click();
  await expect(page.getByText(/terms changed/i)).toBeVisible();
  expect(await executionGrantCount('action-1')).toBe(0);
});
```

A second test asserts Agent-authored prose is rendered in a visually/semantically separate non-authoritative region and never substituted for canonical terms.

Red:

```bash
npx playwright test tests/e2e/trusted-surface-approval.spec.ts
```

Implementation files are exactly correction 6/original T5; browser posts only credential response + challenge ID and never decides approval validity. Green is build + Playwright.

---

## T6 — Standing Grant and Hard Policy workflows

Create `tests/e2e/trusted-surface-grants.spec.ts` and API tests before pages/routes.

Required assertions:

```python
def test_proposed_grant_has_no_active_authority(client) -> None:
    created = client.post("/v1/principal/grants", json=GRANT_PROPOSAL).json()
    assert created["status"] == "PROPOSED"
    assert created["grant_id"] not in active_grant_ids()


def test_broadening_creates_new_version_not_history_mutation(client) -> None:
    active = activate_fixture_grant(max_amount_minor=500)
    proposal = propose_broadening(active, max_amount_minor=501)
    assert proposal["version"] == active["version"] + 1
    assert load_grant(active["grant_id"], active["version"])["scope"]["amount_limits"] != proposal["scope"]["amount_limits"]
```

E2E separately proves activate/suspend/resume/revoke are distinct controls and policy relaxation does not broaden an existing grant; policy tightening blocks a not-yet-committed execution on revalidation.

Red:

```bash
uv run pytest packages/ptf-api/tests/test_principal_product_routes.py -q
npx playwright test tests/e2e/trusted-surface-grants.spec.ts
```

Expected: at least one non-zero before T6 implementation. Grant form uses structured deterministic scope fields only. Green is the same pair of commands.

---

## T7 — Personal State, resources, TrustRelations, activity; no devices

Plan 05 exact routes are correction 6's:

```text
GET    /v1/principal/personal-state
POST   /v1/principal/personal-state/{item_id}/correct
DELETE /v1/principal/personal-state/{item_id}
GET    /v1/principal/resources
GET    /v1/principal/trust
POST   /v1/principal/trust/relations
DELETE /v1/principal/trust/relations/{relation_id}
GET    /v1/principal/activity
```

Create route tests:

```python
def test_label_only_trust_relation_is_rejected(client) -> None:
    response = client.post(
        "/v1/principal/trust/relations",
        json={
            "subject_id": "merchant-x",
            "binding_ids": [],
            "role": "recipient",
            "purpose": "purchase",
            "functions": ["receive_payment"],
        },
    )
    assert response.status_code == 422


def test_personal_state_erasure_does_not_mutate_authority(client) -> None:
    before = snapshot_authority_state()
    assert client.delete("/v1/principal/personal-state/claim-1").status_code == 204
    assert snapshot_authority_state() == before


def test_resource_response_is_metadata_only(client) -> None:
    text = client.get("/v1/principal/resources").text.lower()
    for forbidden in ("private_key", "passport_number", "raw_credential", "refresh_token"):
        assert forbidden not in text


def test_device_route_is_absent_in_plan05(client) -> None:
    assert client.get("/v1/principal/devices").status_code == 404
```

Routes call `PersonalStateService` and `TrustAdministrationService`; FastAPI handlers do not construct security state directly. Authenticated Principal supplies `principal_id`; body cannot override it.

Red:

```bash
uv run pytest packages/ptf-api/tests/test_principal_product_routes.py -q
npx playwright test tests/e2e/trusted-surface-admin.spec.ts
```

Expected: at least one non-zero before T7 implementation. Green is same.

---

## T8 — product security-boundary lock

`verification_only: true`.

Precondition:

```bash
test ! -f tests/e2e/trusted-surface-storage.spec.ts && \
test ! -f docs/developer/agent-sdk.md && \
test ! -f docs/product/trusted-surface.md
```

Storage test registers controlled canaries and inspects localStorage, sessionStorage and IndexedDB after approval/grant/Personal-State/resource/activity journeys. It also verifies keyboard accessibility and the five-method SDK surface. Documentation states AA1/AA2 reference semantics only and explicitly says device/recovery/export are deferred to Plan 06.

Green is the original complete Python/JS/build/Playwright suite and inherited independent review.

---

## C10 disposition

All Plan 05 behavioral tasks now have concrete red fixtures/commands and exact public implementation seams; T1/T8 have explicit configuration/verification predicates. Existing green commands/commit boundaries and the inherited task-review protocol complete their C10 shape.