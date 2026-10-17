# DPDP Slice E — Adversarial Review and Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Independently review the complete DPDP implementation for structural/spec defects, fix evidenced blockers, and produce reproducible verification for every acceptance claim before any merge decision.

**Architecture:** No new feature scope. Review the fixed base-to-head diff on two axes (repository standards and approved DPDP spec), apply Thermo-Nuclear structural criteria, then run claim-level baseline/treatment verification and the full project gate.

**Tech Stack:** Git/GitHub diff, existing test/build/harness commands, engineering-quality-toolkit verify-this, Matt code-review, Thermo-Nuclear structural review.

**Spec:** `docs/superpowers/specs/2026-10-18-dpdp-privacy-enforcement-design.md`

## Global Constraints

- Fixed comparison base is the frozen pre-feature main SHA `7b52d61ea207d1d37d11a8c85f3253466b732537`.
- No review finding is fixed blindly; reproduce/verify before change.
- No merge/publish as part of this plan unless the human explicitly chooses that in finishing-development-branch.
- A green test suite does not override structural BLOCKER/MAJOR findings.
- A clean structural review does not substitute for behavioral verification.

## Review Focus

1. Privacy/DPDP logic leaked into Authority/core or god files.
2. Any path where privacy state can grant authority or agent input can select legal basis.
3. Any crash/replay path that loses/duplicates processing evidence.
4. Any personal value/direct subject identifier in output/log/audit/event/error paths.
5. Any legacy behavior or package/export regression hidden by new tests.

---

### Task E1: Pin exact diff and run two-axis code review

**Files:** review only initially.

- [ ] **Step 1: Pin refs**

Run:
```sh
git rev-parse 7b52d61ea207d1d37d11a8c85f3253466b732537
git rev-parse HEAD
git diff --stat 7b52d61ea207d1d37d11a8c85f3253466b732537...HEAD
```

- [ ] **Step 2: Run Matt code-review standards axis**

Check AGENTS.md, ADR boundaries, public surface, dependency allowlist, file cohesion, backwards compatibility.

- [ ] **Step 3: Run Matt code-review spec axis**

Map every spec section/acceptance criterion to concrete code/tests; identify omissions and scope creep.

- [ ] **Step 4: Produce side-by-side findings**

Every BLOCKER/MAJOR includes exact path/evidence and remediation. Cosmetic/lint nits are excluded.

---

### Task E2: Run Thermo-Nuclear/engineering structural review

**Files:** full base-to-head diff + affected call sites.

- [ ] **Step 1: Measure before/after file sizes**

Especially `authority.ts`, `vault.ts`, `providers.ts`, `cli.ts`, `mcp-server.ts`, and every new privacy file. Confirm no unjustified >1k crossing and `vault.ts` shrank materially.

- [ ] **Step 2: Apply code-judo review**

Look for:
- repeated DPDP if/else branches;
- copied encryption/CAS;
- duplicate state machines;
- thin pass-through privacy wrappers;
- casts/optional fields hiding invariants;
- CLI/MCP business logic leakage;
- privacy store + event store coupling that can be deleted/simplified.

- [ ] **Step 3: Verdict**

Required result before release: `APPROVE`. Any `REQUEST CHANGES` finding is fixed in its own commit and review rerun.

---

### Task E3: Verify acceptance claims with baseline/treatment evidence

**Files:** no product change unless a claim fails.

For each claim below, use the engineering-quality-toolkit `verify-this` workflow and record exact target SHA/command/evidence:

- [ ] Authority grant alone cannot pass privacy mode without basis/activity.
- [ ] Privacy allow cannot override Authority deny.
- [ ] Consent withdrawal between proposal and processing blocks effect.
- [ ] Unauthorized actor gets no privacy-state oracle.
- [ ] Crash at processing boundary leaves OUTCOME_UNKNOWN/recoverable evidence.
- [ ] Extra claim/recipient is denied.
- [ ] MCP agent cannot choose/mutate legal basis/controller/subject.
- [ ] Sentinel personal values/direct subject identifiers never appear in event/audit/CLI/MCP output.
- [ ] Exact erasure works; retention hold blocks erasure but never grants use.
- [ ] Privacy config/events are encrypted and coherent under backup/restore.
- [ ] Legacy non-privacy behavior stays green.
- [ ] No DPDP logic in Authority core.
- [ ] Vault facade is materially smaller.
- [ ] CLI/MCP stay thin.
- [ ] Public claims avoid compliance guarantees.
- [ ] Known residuals are documented.

Each gets `VERIFIED`, `NOT VERIFIED`, or `INCONCLUSIVE`; release requires VERIFIED for behavior claims and direct code/doc evidence for structural/documentation claims.

---

### Task E4: Run final complete gate

- [ ] **Step 1: Clean-tree verification**

```sh
git status --short
npm ci
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
npm pack --dry-run
(cd docs && bundle install && bundle exec jekyll build --destination _site)
```

Expected: clean intended tree and every command PASS.

- [ ] **Step 2: Inspect package contents and generated declarations**

Verify `./privacy` resolves after pack/build and persistence internals are not public.

- [ ] **Step 3: Scan for forbidden claims and secret terms**

Search docs/source for `compliant=true`, “guarantees compliance”, agent-facing `basisId` schema fields, raw sentinel test values, and accidental key/secret fixtures.

- [ ] **Step 4: Record final head SHA and evidence summary**

No assertion such as “all tests pass” without the exact command result from this head.

---

### Task E5: Finish development branch

- [ ] **Step 1: Invoke `superpowers:finishing-a-development-branch`**

Present merge/PR/keep-branch options to the human.

- [ ] **Step 2: Do not merge/publish without explicit selection**

The successful feature branch + evidence is the terminal deliverable of this implementation mission.
