# PTF v1 Rewrite Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Personal Trust Fabric from the approved v1 specification as a protocol-neutral delegated-authority runtime, prove the core against x402, AP2, and OpenID4VP, then ship the reference product/conformance surfaces without inheriting the obsolete WebMCP sandbox architecture.

**Architecture:** Keep the approved semantic bounded contexts intact while implementing them in dependency order. The Python reference runtime owns deterministic Personal State, Identity/Trust, Authority, Planning, Protected Execution orchestration, Audit, and conformance semantics; external protocols remain concrete adapters. A TypeScript Trusted Surface/SDK is introduced only after the Agent Gateway is stable. Each milestone is a falsification/proof of the full PTF architecture, never a replacement product boundary.

**Tech Stack:** Python 3.14.7; uv workspace; Pydantic 2.x; FastAPI 0.141.x; PostgreSQL 18.x via psycopg 3.3.x; pytest + Hypothesis; Ruff + Pyright; official AP2 Python SDK/release pinned at execution; official x402 Python v2 SDK pinned at execution; Node.js 24 LTS + TypeScript for the later Trusted Surface/TS SDK.

**Spec:** `docs/spec/PTF-V1-PROPOSED.md`, approved by exact blob in `docs/spec/PTF-V1-APPROVAL.md`.

## Global Constraints

- The exact approved spec blob is `32fc9bb6119142e10b854b09a95544c4ec25d1cc`; implementation must trace behavior back to it.
- `legacy/webmcp-sandbox` must remain at pre-rewrite commit `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.
- Before any modification of `main`, immutable tag `webmcp-sandbox-v0.1` must exist and resolve to the same pre-rewrite commit.
- The old `src/`, `public/`, WebMCP tools, synthetic recipient proof, and module boundaries have no grandfathered implementation status.
- Personal State must never create or broaden Hard Policy, Standing Grants, Exact Human Approval, TrustRelations, IdentityBindings, or Execution Grants.
- Hard Policy constrains authority and never creates it.
- Final human approval binds the selected canonical ExecutionPlan fingerprint.
- Every authority-relevant constraint requires a total Enforcement Map entry or explicit policy-controlled `UNENFORCEABLE` downgrade.
- Aggregate authority uses CP1 or CP2; disconnected shared spending is forbidden without bounded pre-allocation.
- ProtectedResourceRef is never bearer authority.
- Every consequential execution produces an Assurance Manifest and privacy-minimized PTFReceipt.
- No protocol artifact becomes canonical PTF authority merely because it is valid in that protocol.
- Do not freeze a universal ProtocolAdapter programming interface before both x402 and AP2 implementations exist and are reviewed together.
- No `PTF Conformant` claim is permitted until the executable versioned conformance suite exists.
- No milestone may redefine PTF as payment-only, AP2-only, credential-only, WebMCP-only, or UI-only.
- Use TDD: failing behavioral test first, minimal implementation, passing test, refactor, then commit.
- Every task gets independent review before dependent tasks proceed.

---

## Approved implementation-stack decision

The reference runtime is Python-first for the first three proving integrations. This is an implementation decision, not a change to PTF semantics.

Reasons:

1. AP2's official SDK is Python-first; using it avoids copying or reinterpreting AP2 mandate schemas.
2. x402 ships a maintained Python v2 SDK, so the second proving adapter can use upstream protocol code in the same runtime.
3. OpenID4VP verification/presentation semantics are protocol-level; the third integration can use Python integration code and external conformance fixtures without making the PTF core dependent on a specific wallet implementation.
4. TypeScript remains appropriate for the browser Trusted Surface and external Agent SDK, but making it the initial runtime would require hand-porting AP2 semantics before the abstraction has been proven.

At Plan 00 execution, verify current upstream versions and pin exact dependency releases in `uv.lock`; do not float protocol dependencies from `main` branches.

---

## Target repository shape

```text
/
├── .python-version
├── pyproject.toml
├── uv.lock
├── AGENTS.md
├── CONTEXT-MAP.md
├── README.md
├── LICENSE
├── docs/
│   ├── spec/
│   ├── adr/
│   ├── research/
│   ├── threat-model/
│   ├── assurance/
│   └── superpowers/plans/
├── packages/
│   ├── ptf-core/
│   │   ├── pyproject.toml
│   │   └── src/ptf_core/
│   │       ├── personal_state/
│   │       ├── identity/
│   │       ├── authority/
│   │       ├── planning/
│   │       ├── protected_resources/
│   │       └── audit/
│   ├── ptf-runtime/
│   ├── ptf-postgres/
│   ├── ptf-api/
│   └── ptf-conformance/
├── adapters/
│   ├── x402/
│   ├── ap2/
│   └── openid4vp/
├── executors/
│   └── synthetic/
├── sdk/
│   └── typescript/
├── apps/
│   └── trusted-surface/
└── tests/
    ├── acceptance/
    ├── conformance/
    ├── integration/
    └── fixtures/
```

The plan intentionally avoids additional packages until a real seam requires them. A file/package that only forwards calls should be folded into the deeper owning module.

---

## Dependency graph

```text
Plan 00 Foundation
       │
       ▼
Plan 01 Runtime + persistence + public seams
       │
       ├──────────────► Plan 02 x402
       │                      │
       └──────────────► Plan 03 AP2
                               │
                  x402 + AP2 seam review
                               │
                               ▼
                       Plan 04 OpenID4VP
                               │
                    core-generalization gate
                               │
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
         Plan 05 Product Surface      Plan 06 Conformance/Ops
                 └─────────────┬─────────────┘
                               ▼
                         v1 release gate
```

Plan 02 and Plan 03 may be implemented in parallel only after Plan 01's stable public seams are accepted. Their code must remain concrete until the post-both seam review.

---

### Task 1: Execute the repository preservation preflight

**Files:**
- Verify: `docs/spec/PTF-V1-APPROVAL.md`
- Verify: `docs/adr/0006-preserve-repository-history-rewrite-implementation.md`
- Create at execution: Git tag `webmcp-sandbox-v0.1`
- Create at execution: branch `rewrite/ptf-v1`
- No source files modified in this task.

**Interfaces:**
- Consumes: approved spec blob `32fc9bb6119142e10b854b09a95544c4ec25d1cc`, legacy branch commit `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.
- Produces: verified immutable legacy tag and isolated rewrite branch/worktree.

- [ ] **Step 1: Verify preservation branch**

Run:
```bash
git fetch --all --tags --prune
git rev-parse origin/legacy/webmcp-sandbox
```
Expected: exactly `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.

- [ ] **Step 2: Check whether the required tag already exists**

Run:
```bash
git rev-parse -q --verify refs/tags/webmcp-sandbox-v0.1
```
Expected: either the exact legacy commit or non-zero because the tag does not exist. Any different existing target is a hard stop.

- [ ] **Step 3: Create and push the immutable preservation tag when absent**

Run only if Step 2 reports absence:
```bash
git tag -a webmcp-sandbox-v0.1 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9 -m "Preserve pre-rewrite WebMCP synthetic milestone"
git push origin refs/tags/webmcp-sandbox-v0.1
```
Expected: push succeeds without force.

- [ ] **Step 4: Verify branch and tag resolve identically**

Run:
```bash
test "$(git rev-parse origin/legacy/webmcp-sandbox)" = "$(git rev-list -n 1 webmcp-sandbox-v0.1)"
```
Expected: exit 0.

- [ ] **Step 5: Create the isolated rewrite branch/worktree using Superpowers `using-git-worktrees`**

Base the rewrite branch on the latest `architecture/ptf-v1-spec` documentation state, not on the legacy `main` tree:
```bash
git switch architecture/ptf-v1-spec
git pull --ff-only
git switch -c rewrite/ptf-v1
```
Then use the worktree skill to place implementation in an isolated worktree. Do not force-update `main`.

- [ ] **Step 6: Commit only if execution tooling adds a repository-local worktree bootstrap record**

No source commit is required merely for branch/tag creation. Do not create empty commits for ceremony.

**Stop condition:** Do not execute Plan 00 source tasks unless tag verification passes.

---

### Task 2: Execute Plan 00 — foundation

**Files:**
- Plan: `docs/superpowers/plans/2026-09-03-ptf-v1-foundation-plan.md`

**Interfaces:**
- Consumes: approved spec + preservation preflight.
- Produces: pure PTF domain core, canonical model behavior, metamorphic/oracle tests, no network/database/protocol dependencies.

- [ ] Execute every task in Plan 00 in order.
- [ ] Run Plan 00 full verification command.
- [ ] Request independent architecture/security review before Plan 01.
- [ ] Record any required semantic change as an ADR/spec amendment; do not hide it in code.

---

### Task 3: Execute Plan 01 — runtime and persistence

**Files:**
- Plan: `docs/superpowers/plans/2026-09-03-ptf-v1-runtime-plan.md`

**Interfaces:**
- Consumes: accepted Plan 00 public types and domain behavior.
- Produces: PostgreSQL CP2 authority coordination, deployment Trust Registry, planning/runtime orchestration, synthetic Protected Executor, AI0 audit/receipts, stable Agent/Trusted Surface/Principal seams.

- [ ] Execute every task in Plan 01.
- [ ] Prove concurrent reservations cannot oversubscribe authority.
- [ ] Prove exact approval-plan mutation invalidation.
- [ ] Prove protected values remain absent from Agent/receipt/log surfaces in the synthetic profile.
- [ ] Freeze only the public seams needed by Plans 02–04; keep protocol adapter API concrete.

---

### Task 4: Execute the first two concrete protocol proofs

**Files:**
- Plan: `docs/superpowers/plans/2026-09-03-ptf-v1-x402-plan.md`
- Plan: `docs/superpowers/plans/2026-09-03-ptf-v1-ap2-plan.md`

**Interfaces:**
- Consumes: Plan 01 stable public seams.
- Produces: one payment-focused and one delegation-rich concrete adapter, each with adversarial tests and Enforcement Maps.

- [ ] Execute x402 and AP2 plans, sequentially or on isolated parallel worktrees after Plan 01 acceptance.
- [ ] Keep each adapter's implementation concrete; do not introduce a common adapter base class/interface while only one exists.
- [ ] After both are complete, compare their call shapes, error semantics, capability discovery, evidence lifecycle, and enforcement reporting.
- [ ] Extract only the minimal shared protocol seam that both genuinely need; if no narrow common seam exists, document the decision and keep them separate.
- [ ] Run both protocol suites together with core/runtime tests before proceeding.

---

### Task 5: Execute Plan 04 — OpenID4VP cross-domain proof

**Files:**
- Plan: `docs/superpowers/plans/2026-09-03-ptf-v1-openid4vp-plan.md`

**Interfaces:**
- Consumes: core/runtime and post-x402/AP2 seam decision.
- Produces: credential-presentation path validating that PTF authority/disclosure semantics are not payment-specific.

- [ ] Execute Plan 04.
- [ ] Run the core-generalization review required by Plan 04.
- [ ] If OpenID4VP requires protocol concepts to leak into canonical authority types, stop and revise architecture rather than adding conditional flags to the core.

---

### Task 6: Execute Plan 05 — reference Trusted Surface and developer product

**Files:**
- Plan: `docs/superpowers/plans/2026-09-03-ptf-v1-product-surface-plan.md`

**Interfaces:**
- Consumes: stable Agent Gateway, approval lifecycle, receipts, Personal State, trust/resource status.
- Produces: Node 24 LTS TypeScript Trusted Surface, thin TS Agent SDK, simulator/debugger surfaces.

- [ ] Execute Plan 05 only after Plan 04 confirms stable cross-domain core semantics.
- [ ] Ensure UI renders canonical server-produced approval terms rather than Agent prose.
- [ ] Prove Approve Once / Create Standing Authority / Deny / Suspend / Revoke are distinct actions.

---

### Task 7: Execute Plan 06 — conformance, portability, recovery, and release security

**Files:**
- Plan: `docs/superpowers/plans/2026-09-03-ptf-v1-conformance-operations-plan.md`

**Interfaces:**
- Consumes: all accepted core, runtime, protocol, and product seams.
- Produces: executable conformance suite, portable state/recovery tests, AI1 optional audit profile, locked regression corpus, release provenance/security gates.

- [ ] Execute Plan 06.
- [ ] Run the complete mandatory attack-class matrix.
- [ ] Verify no `PTF Conformant` wording exists unless the release names specification version, suite version, and tested profile.
- [ ] Run release verification and independent security review.

---

## Deferred after foundational v1

Additional adapters—UCP, OAuth, MCP, WebMCP, A2A, Digital Credentials API integrations beyond OpenID4VP, and other commerce rails—are not part of the initial rewrite sequence. Add them only after the foundational release demonstrates the approved authority model across x402, AP2, and OpenID4VP. Each new adapter must pass the same Enforcement Map and conformance requirements.

---

## Whole-roadmap acceptance gate

The foundational v1 rewrite is complete only when all of the following are true:

1. Plans 00–06 are complete and independently reviewed.
2. The approved spec remains the product boundary.
3. Personal State cannot broaden authority under the locked metamorphic corpus.
4. CP2 concurrency tests prove no aggregate oversubscription.
5. x402, AP2, and OpenID4VP all work through the same canonical authority concepts without protocol leakage.
6. At least one Protected Executor keeps reusable secret/key material outside the Agent process.
7. PTFReceipts and Assurance Manifests truthfully report enforcement and custody properties.
8. Mandatory attack-class conformance tests pass for the declared profile.
9. Release artifacts include the security/provenance evidence required by Plan 06.
10. No documentation describes a proving milestone as the whole PTF product.
