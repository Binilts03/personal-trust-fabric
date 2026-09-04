# PTF v1 Verified Execution Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this roadmap task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the full approved PTF v1 rewrite in a dependency-safe order using the verified September 4 plan set, while preserving the repository history and preventing any proving protocol or product surface from redefining PTF.

**Architecture:** The approved specification is implemented through seven subsystem plans. `2026-09-04-ptf-v1-plan-set-contract.md` supplies the binding cross-plan corrections discovered during verification. Protocol proofs are deliberately sequential through the x402/AP2 seam review; OpenID4VP is the third generality proof; product and release/conformance work follow only after the core survives all three.

**Tech Stack:** Python reference runtime with uv/Pydantic/FastAPI/PostgreSQL; concrete x402/AP2/OpenID4VP integrations; Node/TypeScript reference Trusted Surface and Agent SDK. Exact pins are defined by the subsystem plans plus the plan-set contract.

**Spec:** `docs/spec/PTF-V1-PROPOSED.md`, exact approved blob `32fc9bb6119142e10b854b09a95544c4ec25d1cc`, approval record `docs/spec/PTF-V1-APPROVAL.md`.

## Global Constraints

- Read `docs/superpowers/plans/2026-09-04-ptf-v1-plan-set-contract.md` before every subsystem plan.
- The plan-set contract supersedes contradictory implementation details in the 2026-09-03 plans but never the approved spec.
- `legacy/webmcp-sandbox` remains fixed at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.
- Immutable tag `webmcp-sandbox-v0.1` must resolve to that commit before any source rewrite or modification of `main`.
- Use an isolated rewrite branch/worktree created through Superpowers `using-git-worktrees`.
- No old synthetic WebMCP source/module boundary receives grandfathered status.
- No `ProtocolAdapter` base class exists before the completed x402/AP2 seam review.
- Personal State never creates or broadens authority, trust, identity binding, or policy.
- Every consequential path uses plan-bound authority, total Enforcement Map, truthful Assurance Manifest, protected execution, revalidation, reconciliation, and privacy-safe receipt.
- Every task is TDD-first and independently reviewed before a dependent task proceeds.
- A semantic conflict with the approved spec stops execution and requires a reviewed spec/ADR amendment.

---

## Correct dependency graph

```text
Repository preservation/tag gate
        |
        v
Plan 00 Foundation
        |
        v
Plan 01 Runtime + durable state
        |
        v
Plan 02 x402
        |
        v
Plan 03 AP2
        |
        v
mandatory x402/AP2 seam review
        |
        v
Plan 04 OpenID4VP
        |
        v
core-generality review
        |
        v
Plan 05 Trusted Surface + Agent SDK
        |
        v
Plan 06 Conformance + portability + recovery + release
        |
        v
foundational v1 release gate
```

The default is sequential. An execution coordinator may parallelize individually independent Plan 05/06 tasks only after proving disjoint files/dependencies and maintaining the same review gates.

---

### Task 1: Preserve the legacy milestone immutably

**Files:**
- Verify: `docs/spec/PTF-V1-APPROVAL.md`
- Verify: `docs/adr/0006-preserve-repository-history-rewrite-implementation.md`
- Git refs only: `legacy/webmcp-sandbox`, `webmcp-sandbox-v0.1`

**Interfaces:**
- Consumes pre-rewrite commit `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.
- Produces an immutable preservation tag and verified legacy branch.

- [ ] **Step 1: Verify legacy branch**

```bash
git fetch --all --tags --prune
test "$(git rev-parse origin/legacy/webmcp-sandbox)" = "2ed4020c2f0ef91da1a5ee0e74e083539fed98b9"
```

Expected: exit 0.

- [ ] **Step 2: Create the missing tag only when absent**

```bash
if ! git rev-parse -q --verify refs/tags/webmcp-sandbox-v0.1 >/dev/null; then
  git tag -a webmcp-sandbox-v0.1 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9 \
    -m "Preserve pre-rewrite WebMCP synthetic milestone"
  git push origin refs/tags/webmcp-sandbox-v0.1
fi
```

Expected: no force push.

- [ ] **Step 3: Prove tag/branch identity**

```bash
test "$(git rev-parse origin/legacy/webmcp-sandbox)" = "$(git rev-list -n 1 webmcp-sandbox-v0.1)"
```

Expected: exit 0. Any failure is a hard stop.

---

### Task 2: Create the isolated rewrite worktree

**Files:** Git/worktree state only.

**Interfaces:**
- Consumes: verified preservation gate and `planning/ptf-v1-verified` documentation state.
- Produces: `rewrite/ptf-v1` isolated worktree.

- [ ] **Step 1: Invoke Superpowers `using-git-worktrees`**

Base the implementation branch on the verified planning branch, not the synthetic `main` tree:

```bash
git fetch origin planning/ptf-v1-verified
git switch -c rewrite/ptf-v1 origin/planning/ptf-v1-verified
```

Then create/verify the isolated worktree using the skill's prescribed location and safety checks.

- [ ] **Step 2: Verify source tree starts documentation-only**

```bash
test ! -d src
test ! -d public
test ! -d output
```

Expected: exit 0.

---

### Task 3: Execute Plan 00 — Foundation

**Plan:** `docs/superpowers/plans/2026-09-03-ptf-v1-foundation-plan.md`

**Mandatory corrections:** Contract C2 applies from the first `pyproject.toml`: use `pydantic==2.12.5`. Contract C10 is the task-quality gate.

- [ ] Execute every Plan 00 task in order through TDD.
- [ ] Run the complete foundation verification command.
- [ ] Independently review Personal State/Authority separation, grant-union resistance, plan fingerprinting, Enforcement Map totality, freshness semantics, receipt privacy, and CP1 claim boundaries.
- [ ] Do not proceed if any protocol/database/web dependency enters `ptf-core`.

---

### Task 4: Execute Plan 01 — Runtime and durable state

**Plan:** `docs/superpowers/plans/2026-09-03-ptf-v1-runtime-plan.md`

**Mandatory corrections:** Contract C2–C9 apply. In particular:

- use `cryptography==46.0.5` from package bootstrap;
- use target-generic `ApprovalEvidence`;
- implement task-scoped `SafeViewRequest`/`AuthorityView`/`SafeView` and `ActionRuntime.get_safe_view`;
- implement `PersonalStateRepository`;
- implement `ResourceCatalogRepository`;
- expose `POST /v1/agent/safe-view`, not unscoped GET;
- keep device administration out of Plan 01/05 until Plan 06.

- [ ] Execute original Plan 01 Tasks 1–6 with contract corrections.
- [ ] Insert the Personal State repository task from Contract C5.
- [ ] Insert the Protected Resource Catalog task from Contract C6.
- [ ] Insert the Safe View runtime task from Contract C4 before Agent API exposure.
- [ ] Execute original ActionRuntime, synthetic executor, AI0 audit, and API tasks.
- [ ] Run CP2 concurrent oversubscription tests repeatedly.
- [ ] Run Safe View task-minimization and Personal-State-no-authority tests.
- [ ] Run leak-canary checks over API/errors/receipts/logs.
- [ ] Independent review must accept the stable runtime/public seams before Plan 02.

---

### Task 5: Execute Plan 02 — x402

**Plan:** `docs/superpowers/plans/2026-09-03-ptf-v1-x402-plan.md`

- [ ] Verify x402 2.22.0 artifact/provenance exactly as the plan specifies.
- [ ] Execute requirement interpretation, validated payee binding, x402-specific Enforcement Map, protected wallet executor, evidence normalization, concrete flow, adversarial tests, and acceptance evidence.
- [ ] Use the corrected `ActionRuntime` and Safe View/approval types; do not copy superseded signatures.
- [ ] Run all Plan 00–02 suites together.
- [ ] Independent review confirms x402 remains a concrete adapter/evidence path and does not create authority.

---

### Task 6: Execute Plan 03 — AP2 after x402 acceptance

**Plan:** `docs/superpowers/plans/2026-09-03-ptf-v1-ap2-plan.md`

**Mandatory correction:** Contract C2 supersedes the dependency-mutation portion of AP2 Task 1.

- [ ] Verify AP2 pinned commit/dependencies match the already-selected workspace pins.
- [ ] Run the complete accepted Plan 00–02 suite before adding AP2 code.
- [ ] Execute AP2 concrete package, mapping, Enforcement Map, protected signing, delegation flow, receipt, and attack tests.
- [ ] Run AP2-valid-but-PTF-denied tests.
- [ ] Complete `docs/review/ap2-x402-seam-review.md` only after both concrete adapters pass.
- [ ] Extract a shared protocol seam only if deletion/locality evidence justifies it; `no shared base interface` is a valid outcome.

---

### Task 7: Execute Plan 04 — OpenID4VP

**Plan:** `docs/superpowers/plans/2026-09-03-ptf-v1-openid4vp-plan.md`

- [ ] Execute verifier-binding, DCQL minimization, Enforcement Map, brokered credential executor, nonce/direct-post, flow, leak, replay, and acceptance tasks.
- [ ] Verify raw credential, disclosures, holder key, and VP token never appear on Agent/generic PTF surfaces.
- [ ] Complete `docs/review/openid4vp-core-generality-review.md`.
- [ ] Stop if payment/AP2-specific concepts must be added to canonical PTF types; architecture review is required instead.

---

### Task 8: Execute Plan 05 — Trusted Surface and developer product

**Plan:** `docs/superpowers/plans/2026-09-03-ptf-v1-product-surface-plan.md`

**Mandatory corrections:** Contract C3, C4, C7, C8, C9.

- [ ] Generate separate Agent and Principal OpenAPI surfaces.
- [ ] Generate Agent SDK with `getSafeView(input: SafeViewRequest)` and no generic request escape hatch.
- [ ] Implement WebAuthn AA1/AA2 reference approval using `ApprovalEvidence.target_kind` + `canonical_fingerprint`.
- [ ] Implement canonical exact-action and Standing Grant approval screens.
- [ ] Implement grant/policy controls.
- [ ] Implement Personal State correction/erasure, resource status, TrustRelation inspection/create/revoke, and activity views against real backend repositories.
- [ ] Do not expose device-management routes/UI yet.
- [ ] Prove browser storage, route partition, accessibility, and Agent/Principal isolation.

---

### Task 9: Execute Plan 06 — Conformance, portability, recovery, release

**Plan:** `docs/superpowers/plans/2026-09-03-ptf-v1-conformance-operations-plan.md`

**Mandatory correction:** Device backend and UI are completed here per Contract C8.

- [ ] Build the black-box versioned conformance runner and all mandatory oracle IDs.
- [ ] Add protocol-specific conformance packs.
- [ ] Implement Portable State Package and trust-safe import.
- [ ] Implement multi-device enrollment/revocation and non-broadening recovery.
- [ ] Add AI1 optional external witnessing.
- [ ] Add device, portability, and recovery Principal routes/Trusted Surface.
- [ ] Build migration/self-improvement, threat-model, CI, dependency, secret-scan, SBOM, and release-evidence gates.
- [ ] Record external protocol interoperability evidence truthfully; OIDF external conformance may be `not demonstrated` without turning local tests into certification.
- [ ] Run the full foundational profile and independent security/release review.

---

### Task 10: Final foundational v1 verification

**Files:** generated evidence + docs only; no new behavior is introduced in this task.

**Interfaces:**
- Consumes all accepted implementation tasks.
- Produces the evidence basis for a foundational-v1 claim.

- [ ] **Step 1: Run all language/runtime tests**

```bash
uv run pytest -q
uv run ruff check .
uv run pyright
npm ci
npm run typecheck
npm run test:js
npm run build:js
```

Expected: all exit 0.

- [ ] **Step 2: Run mandatory conformance**

```bash
PTF_TEST_DATABASE_URL="$PTF_TEST_DATABASE_URL" \
  uv run ptf-conformance run \
  --profile tests/conformance/fixtures/profile-foundation-v1.json \
  --output artifacts/conformance/foundation.json
```

Expected: `overall_status == PASS` and every required oracle is PASS.

- [ ] **Step 3: Run release security evidence**

```bash
pip-audit
npm audit --audit-level=high
gitleaks detect --source . --redact --no-banner
syft dir:. -o cyclonedx-json=artifacts/sbom.cdx.json
```

Expected: no release-blocking result according to the accepted release policy.

- [ ] **Step 4: Re-check all 28 approved foundational acceptance gates**

Reviewer maps each gate to executable evidence. A missing gate is a release blocker.

- [ ] **Step 5: Verify product-boundary language**

Search README/docs/release copy and fail review if PTF is described as only x402/AP2/OpenID4VP/payment/credential/WebMCP/Trusted Surface.

- [ ] **Step 6: Use Superpowers `verification-before-completion`**

No completion/release claim is made until fresh command output has been read and verified.

---

## Execution handoff

After this verified plan set is accepted, the default implementation workflow is **Subagent-Driven Development**: fresh task worker, specification review, implementation review, then the next dependency. Inline execution remains possible if explicitly chosen.