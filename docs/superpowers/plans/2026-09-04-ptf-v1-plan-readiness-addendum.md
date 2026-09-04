# PTF v1 Plan Readiness Addendum — Final Planning State, September 4, 2026

Status: **IMPLEMENTATION PLANNING VERIFIED — SOURCE EXECUTION BLOCKED ONLY BY HUMAN PRESERVATION DECISION/TAG PREFLIGHT**

> This document is a lifecycle gate. It does not change the approved PTF v1 specification or ADR semantics. No source rewrite begins until the repository-preservation decision below is explicitly made by the human and the resulting Git refs are mechanically verified.

## Approved specification fixed point

```text
spec path:  docs/spec/PTF-V1-PROPOSED.md
blob SHA:   32fc9bb6119142e10b854b09a95544c4ec25d1cc
approval:   docs/spec/PTF-V1-APPROVAL.md
ADRs:       0001–0006 accepted by the approval record
```

The approved specification blob remains immutable. Its historical internal `PROPOSED` wording is not edited; lifecycle approval is represented by the approval record.

---

# Closed planning gates

The September 4 planning-repair cycle is complete for machine-verifiable planning quality.

## R2 — Contract C10: CLOSED

Final authoritative matrix:

```text
docs/review/2026-09-04-plan-task-quality-matrix.md
```

Result:

```text
62 original subsystem tasks
+ 3 inserted Plan 01 task units
= 65 executable task units
65 C10 PASS
0 C10 FAIL
```

The matrix was reverified after correction 11 and `strict-c10-final-fixture-closure.md`. Every task has exact files, interfaces/verification scope, red fixture or allowed verification-only predicate, red/precondition command, minimal implementation/configuration shape, green command, commit boundary, and inherited reviewer gate.

## Cross-plan name/interface consistency: CLOSED

Final review:

```text
docs/review/2026-09-04-final-cross-plan-consistency.md
```

Effective planning precedence is:

```text
docs/superpowers/plans/2026-09-04-ptf-v1-task-quality-corrections-index.md
```

The index includes semantic corrections through correction 11 and the final strict fixture/helper closure. Known stale examples in older plans are explicitly superseded; no implementer may choose them over the effective interface chain.

## 28 foundational acceptance gates: CLOSED AT PLANNING LEVEL

Final map:

```text
docs/review/2026-09-04-final-28-gate-audit.md
```

Result:

```text
28/28 gates have a concrete implementation owner
28/28 gates have a later black-box/adversarial/conformance/release falsifier
0 unmapped gates
```

This is planning coverage, not a claim that unimplemented runtime behavior already passes.

## Final interface and fixture ownership: CLOSED

The public name/signature oracle is:

```text
2026-09-04-ptf-v1-final-interface-registry.md
2026-09-04-ptf-v1-interface-registry-addendum.md
```

Final task mechanics include:

```text
corrections 1–11
strict C10 supplements Plans 00–06
strict-c10-final-fixture-closure.md
task-review-protocol.md
```

The final chain explicitly closes previously ambiguous seams including Personal State services, Trust administration, Plan-bound AP2 issuance, OpenID4VP protected direct-post custody, Principal WebAuthn authorization challenges, device-registration ownership, Plan 06 oracle sequencing, and reviewed release-toolchain pins.

---

# R1 — repository-preservation baseline: OPEN, HUMAN DECISION REQUIRED

The approval/lifecycle record names:

```text
legacy/webmcp-sandbox -> 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9
webmcp-sandbox-v0.1   -> same commit (required by that record)
```

After that record was written, the synthetic sandbox advanced and an annotated submission-freeze tag was created:

```text
webmcp-submit-freeze -> f94a7bd3a59c440bddded8d6cab2956e595132e3
```

Therefore a human must explicitly approve exactly one interpretation before source work.

## PRESERVE-A — keep the approved preservation baseline

Choose this if `2ed4020c...` remains the architecture/rewrite preservation milestone named by the approved lifecycle record.

Required state:

```text
legacy/webmcp-sandbox -> 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9
webmcp-sandbox-v0.1   -> 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9
webmcp-submit-freeze  -> f94a7bd3a59c440bddded8d6cab2956e595132e3
```

Documentation describes `2ed4020c...` as the **approved preservation baseline**, not the chronologically final synthetic commit. The later Devpost/submission state remains separately frozen by `webmcp-submit-freeze`.

## PRESERVE-B — rebaseline preservation to the later submission freeze

Choose this only if the later `f94a7bd3...` state is intended to become the formal rewrite-preservation milestone.

Required consequences:

```text
legacy/webmcp-sandbox -> f94a7bd3a59c440bddded8d6cab2956e595132e3
webmcp-sandbox-v0.1   -> f94a7bd3a59c440bddded8d6cab2956e595132e3
```

The lifecycle/approval preservation record must be explicitly amended through human approval because the current approval record names `2ed4020c...` exactly.

Planning tooling and source implementers MUST NOT select A or B implicitly.

---

# Mechanical preservation preflight

For PRESERVE-A:

```bash
test "$(git rev-parse origin/legacy/webmcp-sandbox)" = "2ed4020c2f0ef91da1a5ee0e74e083539fed98b9"
test "$(git rev-list -n 1 webmcp-sandbox-v0.1)" = "2ed4020c2f0ef91da1a5ee0e74e083539fed98b9"
test "$(git rev-list -n 1 webmcp-submit-freeze)" = "f94a7bd3a59c440bddded8d6cab2956e595132e3"
```

For PRESERVE-B, the equivalent checks must resolve both the legacy branch and `webmcp-sandbox-v0.1` to `f94a7bd3...`, and the explicitly amended lifecycle record must be present on the execution base.

A missing/wrong ref is a hard stop.

---

# Source execution transition after R1 closes

Only after the human preservation choice and tag/ref preflight pass:

1. select/confirm the execution workflow;
2. use Superpowers `using-git-worktrees` before product source work;
3. start from the approved rewrite execution base, not the synthetic WebMCP source tree;
4. execute the verified Plan 00→06 dependency order;
5. read the authoritative corrections/index before each task;
6. use red-first TDD for behavioral tasks and the explicit verification-only path for review/configuration tasks;
7. produce a candidate commit for each task;
8. run both task reviews from `2026-09-04-ptf-v1-task-review-protocol.md` against the same candidate SHA before releasing dependent work;
9. run verification-before-completion before milestone, conformance, or release claims.

## Current lifecycle state

```text
SPECIFICATION:                    APPROVED
IMPLEMENTATION PLANNING:          VERIFIED
C10 TASK QUALITY:                 65/65 PASS
CROSS-PLAN CONSISTENCY:           PASS
FOUNDATIONAL GATE COVERAGE:       28/28 PASS AT PLANNING LEVEL
REPOSITORY PRESERVATION DECISION: HUMAN DECISION PENDING
webmcp-sandbox-v0.1:              ABSENT UNTIL PRESERVATION CHOICE
SOURCE IMPLEMENTATION:            NOT AUTHORIZED
```
