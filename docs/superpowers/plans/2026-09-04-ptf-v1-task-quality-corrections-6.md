# PTF v1 Task-Quality Corrections 6 — Plan 05 Product Surface

Status: **BINDING PLANNING CORRECTIONS; APPROVED SPEC UNCHANGED**

This document resolves the second-pass C10 findings and applies Contracts C3/C4/C7/C8/C9 consistently to Plan 05.

---

## 05/T1 — Node/TypeScript bootstrap

The first task-quality corrections document supplies the exact clean-worktree precondition/red evidence. Existing exact dependency pins, install/typecheck green command, and commit remain binding.

## 05/T2 — separate OpenAPI surfaces

The first corrections document supplies the red command. The Agent schema route allowlist is Contract C9, including task-scoped:

```text
POST /v1/agent/safe-view
```

and not the superseded GET route. Existing schema filtering/export shape remains binding.

## 05/T3 — narrow Agent SDK

The first corrections document supplies the red command and supersedes the parameterless Safe View method with:

```typescript
getSafeView(input: SafeViewRequest): Promise<SafeViewResponse>;
```

The SDK still has exactly five public Agent methods and no raw-path escape hatch.

## 05/T4 — Principal WebAuthn authorization

The first corrections document supplies the red command. `PrincipalAuthorizationService.verify(...)` returns Contract C3 target-generic `ApprovalEvidence`; action approval uses target kind `EXECUTION_PLAN`, and Standing Grant activation uses `STANDING_GRANT`.

No further correction is required.

---

## 05/T5 — canonical Pending Approval UX red state

After writing `tests/e2e/trusted-surface-approval.spec.ts` and before creating the Trusted Surface page/components, run:

```bash
npx playwright test tests/e2e/trusted-surface-approval.spec.ts
```

Expected: non-zero because the application/approval UI is absent.

The original E2E fixture is binding: canonical recipient, purpose, operation, resource, amount/disclosure, route, downgrade/residual risk, expiry/use count, assurance, and fingerprint are server-produced terms; mutation after rendering must return `terms_changed` and issue no execution grant.

The implementation shape is the exact named Trusted Surface components plus server-bound `startAuthentication()` flow; JavaScript never decides authorization validity.

Green remains:

```bash
npm --workspace apps/trusted-surface run build
npx playwright test tests/e2e/trusted-surface-approval.spec.ts
```

## 05/T6 — Standing Grant and Hard Policy workflow red state

Before implementing `Grants.tsx`/`Policy.tsx` and their product routes, write the original grant lifecycle and policy-ceiling fixtures, then run:

```bash
uv run pytest packages/ptf-api/tests/test_principal_product_routes.py -q
npx playwright test tests/e2e/trusted-surface-grants.spec.ts
```

Expected: at least one command is non-zero because the new Principal product routes/pages are absent.

The original deterministic grant form dimensions and lifecycle semantics are the minimal implementation contract. Natural-language text cannot become authoritative grant scope.

Green is the same pair of commands with both exiting 0.

---

## 05/T7 — Personal State, resources, trust, and activity only; devices remain Plan 06

### File correction

Plan 05 Task 7 uses:

```text
apps/trusted-surface/src/pages/PersonalState.tsx
apps/trusted-surface/src/pages/Resources.tsx
apps/trusted-surface/src/pages/Trust.tsx
apps/trusted-surface/src/pages/Activity.tsx
packages/ptf-api/src/ptf_api/routes/principal.py
packages/ptf-api/tests/test_principal_product_routes.py
tests/e2e/trusted-surface-admin.spec.ts
```

Do not create `TrustAndDevices.tsx` in Plan 05. Device UI is added only after the Plan 06 device backend exists.

### Exact Principal routes in Plan 05

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

There is **no** `/v1/principal/devices` route in Plan 05.

Trust creation uses Contract C7 `CreateTrustRelationRequest` and succeeds only against already validated active binding IDs. A label-only/empty-binding request must return 422. Trust revocation is independently authenticated and audit-recorded.

### Red state

Before implementing the routes/pages, write the Personal State correction/erasure, metadata-only resource, TrustRelation binding, and activity-safe-field tests, then run:

```bash
uv run pytest packages/ptf-api/tests/test_principal_product_routes.py -q
npx playwright test tests/e2e/trusted-surface-admin.spec.ts
```

Expected: at least one command is non-zero because the Task 7 routes/pages do not yet exist.

### Required negative assertions

```text
Personal State correction/erasure does not mutate grants/policy/trust/approvals
resource response contains safe catalog metadata only
trust relation cannot be created from subject/display label without validated binding IDs
activity response contains safe receipt/audit fields and no raw protocol artifact
GET /v1/principal/devices is absent in Plan 05
```

Green is the same pair of commands with both exiting 0.

Commit stages `Trust.tsx`, not the superseded `TrustAndDevices.tsx`.

---

## 05/T8 — product security-boundary lock is verification-only

This task adds product acceptance evidence/docs over completed Plan 05 behavior and already contains an independent review step. Mark:

```text
verification_only: true
```

Precondition:

```bash
test ! -f tests/e2e/trusted-surface-storage.spec.ts && \
test ! -f docs/developer/agent-sdk.md && \
test ! -f docs/product/trusted-surface.md
```

The browser-storage scan, Agent-SDK reachability assertion, accessibility smoke checks, truthful product-boundary documentation, complete Python/JS/Playwright verification, and independent review remain binding.

Documentation must state:

```text
five Agent methods, including task-scoped getSafeView(input)
AA1/AA2 reference WebAuthn semantics only
AA3 not implied
Agent prose non-authoritative
no device/recovery/export product claim until Plan 06 backend/UI is complete
```

---

## Plan 05 disposition

After applying this document and earlier corrections, all eight Plan 05 tasks have an explicit C10 path. Device management is no longer faked or prematurely exposed, while validated TrustRelation administration is present as required. Final PASS status is assigned only by the regenerated matrix.