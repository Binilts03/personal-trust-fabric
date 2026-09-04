# PTF v1 Trusted Surface and Developer Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reference Trusted Surface and a deliberately narrow TypeScript Agent SDK so humans can review canonical PTF terms, authorize exact actions and standing grants with real user-verification ceremonies, manage policy/personal state/resources/trust, and inspect receipts without exposing Principal/admin authority through Agent tooling.

**Architecture:** FastAPI remains the authoritative server boundary. It emits separate Agent and Principal OpenAPI documents; the Agent SDK is generated/wrapped only from the Agent document. The Trusted Surface is a React application that renders server-produced canonical approval view models and uses WebAuthn/passkeys for AA1/AA2 reference ceremonies. The browser never constructs authoritative approval terms from Agent prose; it submits a WebAuthn response bound to a server-stored challenge and canonical fingerprint.

**Tech Stack:** Python 3.14.7; FastAPI; `webauthn==3.0.0`; Node.js `24.20.0` LTS; npm workspaces; TypeScript `7.0.2`; React/ReactDOM `19.2.8`; Vite `8.2.2`; `@vitejs/plugin-react==6.1.1`; `@simplewebauthn/browser==14.0.0`; `openapi-typescript==7.13.0`; Vitest `5.0.0`; Playwright `1.62.1`.

**Spec:** `docs/spec/PTF-V1-PROPOSED.md`, exact approved blob recorded by `docs/spec/PTF-V1-APPROVAL.md`. Primary sections: 8–10, 17–18, 21–24, 28.

## Global Constraints

- Execute after Plan 04 core-generality acceptance. Plan 06 later adds portability/recovery and final conformance/release surfaces; this plan must not fake those capabilities before their backend exists.
- Trusted Surface is not an Agent surface. It requires independently authenticated Principal context.
- Approval UI must render canonical structured terms from the server, including plan/grant fingerprint, recipient, purpose, operation, amount where relevant, resource, disclosure, route/protocol, downgrade/residual risk, expiry/use count, and required assurance.
- Agent-authored prose may be shown only as non-authoritative context and must be visually/semantically separated from canonical approval terms.
- Mutation of any canonical approval-relevant term after challenge creation invalidates the challenge/approval.
- AA0, AA1, AA2, AA3 remain semantic profiles. The reference product implements AA1/AA2 with WebAuthn; AA3 remains a policy profile requiring an externally configured stronger provider/attestation and must not be mislabeled as implemented by ordinary WebAuthn.
- Agent SDK exports no Principal approval, policy, grant, trust, device, personal-state mutation, protected-resource admin, or recovery method.
- Separate OpenAPI documents are generated from route tags/allowlists and diff-tested in CI.
- Browser localStorage/sessionStorage/indexedDB must not contain protected raw resources, WebAuthn private material, VP tokens, payment artifacts, or server-side authority secrets.
- UI status/explanations are derived from structured runtime evidence, not generated LLM rationale.
- Deny once, approve once, create Standing Grant, suspend, resume, revoke, and policy mutation are separate operations with distinct confirmations.
- All state-changing requests use CSRF/origin protections in addition to Principal authentication where browser cookies are used.
- Every task follows failing tests first and ends with a reviewable commit.

---

## File map

```text
package.json
.nvmrc
sdk/typescript/
├── package.json
├── tsconfig.json
├── src/
│   ├── generated/agent-api.d.ts
│   ├── client.ts
│   ├── errors.ts
│   └── index.ts
└── test/client.test.ts
apps/trusted-surface/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── playwright.config.ts
├── index.html
└── src/
    ├── main.tsx
    ├── app.tsx
    ├── api/principal-client.ts
    ├── auth/webauthn.ts
    ├── components/CanonicalTerms.tsx
    ├── components/AssuranceSummary.tsx
    ├── pages/PendingApprovals.tsx
    ├── pages/Grants.tsx
    ├── pages/Policy.tsx
    ├── pages/PersonalState.tsx
    ├── pages/Resources.tsx
    ├── pages/TrustAndDevices.tsx
    └── pages/Activity.tsx
packages/ptf-api/src/ptf_api/
├── openapi.py
├── principal_authorization.py
└── routes/principal.py            # extended
packages/ptf-api/tests/
├── test_openapi_surfaces.py
├── test_principal_authorization.py
└── test_principal_product_routes.py
tests/e2e/
├── trusted-surface-approval.spec.ts
├── trusted-surface-grants.spec.ts
├── trusted-surface-admin.spec.ts
└── trusted-surface-storage.spec.ts
docs/developer/agent-sdk.md
docs/product/trusted-surface.md
```

---

### Task 1: Bootstrap the Node/TypeScript workspace with exact product pins

**Files:**
- Create: `.nvmrc`
- Create: `package.json`
- Create: `sdk/typescript/package.json`
- Create: `sdk/typescript/tsconfig.json`
- Create: `apps/trusted-surface/package.json`
- Create: `apps/trusted-surface/tsconfig.json`
- Create: `apps/trusted-surface/vite.config.ts`

**Interfaces:**
- Produces reproducible frontend/SDK build/test commands without changing Python runtime semantics.

- [ ] **Step 1: Verify Node and package versions**

```bash
node --version
npm --version
npm view react version
npm view vite version
npm view typescript version
npm view @simplewebauthn/browser version
npm view openapi-typescript version
npm view @playwright/test version
```
Expected Node: `v24.20.0`. Expected package versions used below: React `19.2.8`, Vite `8.2.2`, TypeScript `7.0.2`, SimpleWebAuthn browser `14.0.0`, openapi-typescript `7.13.0`, Playwright `1.62.1`. If a registry result differs, keep these reviewed pins unless a security advisory or incompatibility requires a reviewed plan amendment.

- [ ] **Step 2: Create `.nvmrc` and root npm workspace**

`.nvmrc`:
```text
24.20.0
```

`package.json`:
```json
{
  "name": "personal-trust-fabric-js",
  "private": true,
  "workspaces": ["sdk/typescript", "apps/trusted-surface"],
  "engines": {"node": "24.20.x"},
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test:js": "npm run test --workspaces --if-present",
    "build:js": "npm run build --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  }
}
```

- [ ] **Step 3: Create exact SDK/app package metadata**

SDK dev dependencies: `openapi-typescript@7.13.0`, `vitest@5.0.0`, `typescript@7.0.2`. Trusted Surface dependencies: `react@19.2.8`, `react-dom@19.2.8`, `@simplewebauthn/browser@14.0.0`; dev dependencies: `vite@8.2.2`, `@vitejs/plugin-react@6.1.1`, `typescript@7.0.2`, `vitest@5.0.0`, `@playwright/test@1.62.1`.

- [ ] **Step 4: Install and lock**

```bash
npm install
npm ci
npm run typecheck
```
Expected: lockfile created and typecheck baseline exits 0.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc package.json package-lock.json sdk/typescript apps/trusted-surface
git commit -m "build(product): bootstrap Trusted Surface workspace"
```

---

### Task 2: Generate physically separate Agent and Principal OpenAPI surfaces

**Files:**
- Create: `packages/ptf-api/src/ptf_api/openapi.py`
- Create: `packages/ptf-api/tests/test_openapi_surfaces.py`
- Create generated-at-build: `artifacts/openapi/agent.json`
- Create generated-at-build: `artifacts/openapi/principal.json`

**Interfaces:**
- Produces `agent_openapi_schema(app) -> dict` and `principal_openapi_schema(app) -> dict`.
- Agent document is the only schema input to the Agent SDK.

- [ ] **Step 1: Write route partition tests**

Agent schema must include exactly the Plan 01 Agent routes. Principal schema contains Principal routes and excludes `/v1/agent/*`. Assert no Agent operation ID or schema name includes mutating concepts `approve`, `policy`, `grant`, `trust_admin`, `device_admin`, `personal_state_mutation`, `resource_admin`, or `recovery`.

- [ ] **Step 2: Implement tag/allowlist filtering**

Use FastAPI’s generated OpenAPI document, then copy only paths whose route object has the required internal route tag (`agent` or `principal`). Filter component schemas to the transitive set referenced by retained paths; do not merely leave all Principal schemas in the Agent document.

- [ ] **Step 3: Add deterministic export command**

`python -m ptf_api.openapi --surface agent --output artifacts/openapi/agent.json` and corresponding principal command write sorted JSON and fail if a path falls into neither/both trust-level allowlists.

- [ ] **Step 4: Run**

```bash
uv run pytest packages/ptf-api/tests/test_openapi_surfaces.py -q
uv run python -m ptf_api.openapi --surface agent --output artifacts/openapi/agent.json
uv run python -m ptf_api.openapi --surface principal --output artifacts/openapi/principal.json
```
Expected: PASS and deterministic documents.

- [ ] **Step 5: Commit**

```bash
git add packages/ptf-api/src/ptf_api/openapi.py packages/ptf-api/tests/test_openapi_surfaces.py artifacts/openapi
git commit -m "feat(api): separate Agent and Principal schemas"
```

---

### Task 3: Build the narrow TypeScript Agent SDK from the Agent-only schema

**Files:**
- Create: `sdk/typescript/src/generated/agent-api.d.ts`
- Create: `sdk/typescript/src/errors.ts`
- Create: `sdk/typescript/src/client.ts`
- Create: `sdk/typescript/src/index.ts`
- Create: `sdk/typescript/test/client.test.ts`

**Interfaces:**
- Produces only:
```typescript
export interface PtfAgentClient {
  getSafeView(): Promise<SafeViewResponse>;
  requestAction(input: AgentActionRequest): Promise<PreparedActionResponse>;
  selectPlan(actionId: string, input: AgentPlanSelection): Promise<PreparedActionResponse>;
  getAction(actionId: string): Promise<PreparedActionResponse>;
  getReceipt(actionId: string): Promise<PtfReceiptResponse>;
}
```

- [ ] **Step 1: Generate the types from Agent OpenAPI**

```bash
npx openapi-typescript@7.13.0 artifacts/openapi/agent.json -o sdk/typescript/src/generated/agent-api.d.ts
```
Expected: generated file with Agent paths only.

- [ ] **Step 2: Write a public-surface failure test**

```typescript
import { describe, expect, it } from 'vitest';
import { PtfClient } from '../src/client';

describe('Agent SDK public surface', () => {
  it('contains no principal/admin methods', () => {
    const names = Object.getOwnPropertyNames(PtfClient.prototype).sort();
    expect(names).toEqual([
      'constructor',
      'getAction',
      'getReceipt',
      'getSafeView',
      'requestAction',
      'selectPlan'
    ]);
  });
});
```

- [ ] **Step 3: Implement the client**

Client constructor accepts only `baseUrl` and an injected authenticated `fetch` implementation. It cannot accept Principal credentials or generic `request(path)` escape hatches. Each method calls a fixed Agent path.

- [ ] **Step 4: Add a source scan preventing admin-route literals**

Test all files under `sdk/typescript/src` and fail if they contain `/v1/principal/` or admin route fragments.

- [ ] **Step 5: Run**

```bash
npm --workspace sdk/typescript test
npm --workspace sdk/typescript run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add sdk/typescript
git commit -m "feat(sdk): expose Agent-safe TypeScript client"
```

---

### Task 4: Implement server-side Principal WebAuthn authorization bound to canonical fingerprints

**Files:**
- Modify: `packages/ptf-api/pyproject.toml`
- Create: `packages/ptf-api/src/ptf_api/principal_authorization.py`
- Modify: `packages/ptf-api/src/ptf_api/routes/principal.py`
- Create: `packages/ptf-api/tests/test_principal_authorization.py`

**Interfaces:**
- Produces:
```python
class CanonicalApprovalView(FrozenModel):
    authorization_kind: str
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

class PrincipalAuthorizationService:
    def begin(...)->PrincipalAuthorizationChallenge: ...
    def verify(...)->ApprovalEvidence: ...
```

- [ ] **Step 1: Pin the server WebAuthn dependency**

Add `"webauthn==3.0.0"` to `ptf-api`. Re-lock and run all Python tests before code changes.

- [ ] **Step 2: Write challenge/fingerprint mutation tests**

`begin` stores challenge ID, Principal, canonical fingerprint, required profile, origin/RP ID, expiry, and one-use state. `verify` must fail if recipient, amount, disclosure, resource, protocol route, downgrade, expiry/use count, or any other approval-relevant term changed after challenge creation.

- [ ] **Step 3: Implement AA1/AA2 reference semantics**

Use `generate_authentication_options()` and `verify_authentication_response()` from `webauthn==3.0.0`. AA1 requires fresh WebAuthn user presence; AA2 requires verified `user_verified=True` from the authenticator result and policy-configured authenticator registration. Bind the challenge record to `canonical_fingerprint` server-side; do not place trust in a fingerprint supplied only by browser JavaScript.

- [ ] **Step 4: Extend Principal routes**

Add:
```text
POST /v1/principal/actions/{action_id}/authorization-options
POST /v1/principal/actions/{action_id}/approve
POST /v1/principal/grants/{grant_id}/authorization-options
```
`/approve` accepts a WebAuthn credential response + challenge ID, verifies it server-side, creates `ApprovalEvidence`, then calls `ActionRuntime.record_exact_approval`. Existing Principal grant activation uses the same authorization service.

- [ ] **Step 5: Run**

```bash
uv run pytest packages/ptf-api/tests/test_principal_authorization.py packages/ptf-api/tests/test_principal_routes.py -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-api pyproject.toml uv.lock
git commit -m "feat(product): bind Principal WebAuthn to canonical terms"
```

---

### Task 5: Build canonical Pending Approval UX with mutation-safe WebAuthn confirmation

**Files:**
- Create: `apps/trusted-surface/src/api/principal-client.ts`
- Create: `apps/trusted-surface/src/auth/webauthn.ts`
- Create: `apps/trusted-surface/src/components/CanonicalTerms.tsx`
- Create: `apps/trusted-surface/src/components/AssuranceSummary.tsx`
- Create: `apps/trusted-surface/src/pages/PendingApprovals.tsx`
- Create: `apps/trusted-surface/src/app.tsx`
- Create: `apps/trusted-surface/src/main.tsx`
- Create: `tests/e2e/trusted-surface-approval.spec.ts`

**Interfaces:**
- Principal browser client is internal to Trusted Surface and not exported from Agent SDK package.

- [ ] **Step 1: Write E2E test for canonical rendering**

Fixture action requires approval. Browser page must display canonical recipient, purpose, operation, resource, amount/disclosure, route, downgrade/residual risk, expiry/use count, assurance profile, and a shortened fingerprint. The canonical values come from `/authorization-options` response, not query parameters or Agent text.

- [ ] **Step 2: Write term-mutation test**

After rendering, mutate the server-side selected plan amount/recipient in the test fixture before submitting WebAuthn. Approval must fail with `terms_changed` and the UI must refetch/re-render canonical terms; no execution grant is issued.

- [ ] **Step 3: Implement WebAuthn browser call**

Use `startAuthentication()` from `@simplewebauthn/browser@14.0.0` on server-provided public-key options. Post only credential response + challenge ID. Do not compute authoritative approval validity in JavaScript.

- [ ] **Step 4: Distinguish action choices**

UI buttons are separate: `Approve once`, `Deny`. “Create standing grant” is not an alternate label on the same operation; it routes to the grant workflow with its own canonical terms and authorization challenge.

- [ ] **Step 5: Run**

```bash
npm --workspace apps/trusted-surface run build
npx playwright test tests/e2e/trusted-surface-approval.spec.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/trusted-surface tests/e2e/trusted-surface-approval.spec.ts
git commit -m "feat(product): add canonical Trusted Surface approval"
```

---

### Task 6: Add distinct Standing Grant and Hard Policy management workflows

**Files:**
- Create: `apps/trusted-surface/src/pages/Grants.tsx`
- Create: `apps/trusted-surface/src/pages/Policy.tsx`
- Create: `packages/ptf-api/tests/test_principal_product_routes.py`
- Create: `tests/e2e/trusted-surface-grants.spec.ts`

**Interfaces:**
- Consumes Principal grant/policy routes from Plans 01/05.
- Produces distinct UI actions for propose/activate/suspend/resume/revoke and policy mutation.

- [ ] **Step 1: Write grant lifecycle E2E**

Test proposed grant has no authority, activation requires its own canonical terms + WebAuthn challenge, active grant can be suspended/resumed/revoked, and broadening terms creates a new proposal/version rather than mutating historical active terms.

- [ ] **Step 2: Write policy-ceiling test**

Relaxing policy in UI must not broaden existing grant. Tightening policy immediately causes not-yet-committed matching execution to fail runtime revalidation.

- [ ] **Step 3: Implement pages using structured terms**

Grant form fields map to deterministic domain constraints only: operation, resource, recipient set, purpose, amount/currency where applicable, validity, use count, disclosure allowance, delegation setting, minimum assurance. Do not accept natural-language text as authoritative grant scope.

- [ ] **Step 4: Run**

```bash
uv run pytest packages/ptf-api/tests/test_principal_product_routes.py -q
npx playwright test tests/e2e/trusted-surface-grants.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/trusted-surface/src/pages/Grants.tsx apps/trusted-surface/src/pages/Policy.tsx packages/ptf-api/tests/test_principal_product_routes.py tests/e2e/trusted-surface-grants.spec.ts
git commit -m "feat(product): manage grants and policy separately"
```

---

### Task 7: Add Personal State, resource, trust/device, and activity product views

**Files:**
- Create: `apps/trusted-surface/src/pages/PersonalState.tsx`
- Create: `apps/trusted-surface/src/pages/Resources.tsx`
- Create: `apps/trusted-surface/src/pages/TrustAndDevices.tsx`
- Create: `apps/trusted-surface/src/pages/Activity.tsx`
- Extend: `packages/ptf-api/src/ptf_api/routes/principal.py`
- Extend: `packages/ptf-api/tests/test_principal_product_routes.py`
- Create: `tests/e2e/trusted-surface-admin.spec.ts`

**Interfaces:**
- Adds Principal-only read/manage routes for safe metadata and Personal State correction/erasure.

- [ ] **Step 1: Define exact Principal routes**

```text
GET    /v1/principal/personal-state
POST   /v1/principal/personal-state/{item_id}/correct
DELETE /v1/principal/personal-state/{item_id}
GET    /v1/principal/resources
GET    /v1/principal/trust
GET    /v1/principal/devices
GET    /v1/principal/activity
```
Trust/device mutations that could create security authority remain authenticated admin operations and are not added merely for UI completeness unless already backed by validated enrollment semantics.

- [ ] **Step 2: Test correction vs erasure distinction**

Correction creates supersession/provenance history; erasure follows the configured privacy deletion path. Neither operation may create/update Standing Grants, TrustRelations, Hard Policy, or Exact Approvals.

- [ ] **Step 3: Keep resource views metadata-only**

Display resource type/profile/provider/status/custody/exportability/recovery metadata from Protected Resource Catalog. Never render secret values, private keys, card numbers, credential payloads, or reusable tokens.

- [ ] **Step 4: Activity page uses PTFReceipt/audit safe fields**

Show operation, recipient, purpose, plan fingerprint, authority basis, protocol, outcome, assurance profile, downgrade/residual risk, timestamps, and safe evidence refs. Do not display raw protocol artifacts.

- [ ] **Step 5: Run**

```bash
uv run pytest packages/ptf-api/tests/test_principal_product_routes.py -q
npx playwright test tests/e2e/trusted-surface-admin.spec.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/trusted-surface/src/pages packages/ptf-api/src/ptf_api/routes/principal.py packages/ptf-api/tests/test_principal_product_routes.py tests/e2e/trusted-surface-admin.spec.ts
git commit -m "feat(product): add Principal state and activity controls"
```

---

### Task 8: Prove browser storage, route, accessibility, and Agent/Principal separation

**Files:**
- Create: `tests/e2e/trusted-surface-storage.spec.ts`
- Create: `docs/developer/agent-sdk.md`
- Create: `docs/product/trusted-surface.md`

**Interfaces:**
- Produces product-surface acceptance evidence for Plan 06.

- [ ] **Step 1: Scan browser storage after all critical journeys**

After approval, grant activation, Personal State correction, resource view, and activity view, inspect localStorage/sessionStorage/indexedDB and assert no values match controlled canaries for payment key, credential payload, AP2 token, x402 artifact, raw Personal State protected values, or WebAuthn credential private material.

- [ ] **Step 2: Verify Agent SDK cannot reach Principal routes**

Use TypeScript compile-time/public-surface tests plus an HTTP fixture that records calls. There must be no generic raw-path method enabling callers to bypass fixed Agent methods.

- [ ] **Step 3: Add accessibility smoke assertions**

Every canonical approval control must be keyboard reachable; canonical terms use semantic labels/table/list relationships; risk/downgrade text is not color-only; focus returns to the changed terms after a mutation rejection.

- [ ] **Step 4: Document truthful product boundaries**

`docs/product/trusted-surface.md` states AA1/AA2 reference WebAuthn implementation, AA3 not automatically satisfied, Agent prose non-authoritative, and export/recovery UI is intentionally completed in Plan 06 when the backend exists. `docs/developer/agent-sdk.md` lists exactly five public Agent methods and explains why admin methods are absent.

- [ ] **Step 5: Run complete product verification**

```bash
PTF_TEST_DATABASE_URL=postgresql://ptf:ptf@localhost:5432/ptf_test uv run pytest -q
npm ci
npm run typecheck
npm run test:js
npm run build:js
npx playwright test
```
Expected: all exit 0.

- [ ] **Step 6: Independent review gate**

Reviewer verifies approval is server-fingerprint-bound, Agent SDK has no admin escape hatch, browser storage is clean, grant/policy operations are not conflated, and UI copy does not overstate assurance/custody.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/trusted-surface-storage.spec.ts docs/developer/agent-sdk.md docs/product/trusted-surface.md
git commit -m "test(product): lock Trusted Surface security boundaries"
```

---

## Plan 05 completion gate

Plan 05 is accepted only when:

1. Agent and Principal OpenAPI schemas are physically separated and diff-tested;
2. Agent SDK exposes only the five approved Agent operations and no raw-path escape hatch;
3. Trusted Surface renders canonical server-produced terms rather than trusting Agent prose;
4. WebAuthn AA1/AA2 ceremonies are server-verified and bound to canonical fingerprints;
5. plan/grant mutation after challenge invalidates authorization;
6. approve-once, Standing Grant creation/activation, deny, suspend, resume, revoke, and policy mutation are distinct workflows;
7. Personal State correction/erasure cannot create authority;
8. resource/activity views expose safe metadata/evidence only;
9. browser storage leak tests are clean;
10. UI/SDK docs state actual assurance limitations;
11. portability/recovery is not faked before Plan 06 supplies its backend and final UI integration.