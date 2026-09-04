# PTF v1 Plan Task-Quality Matrix — September 4, 2026

Status: **INITIAL C10 MECHANICAL PASS — ALL EXECUTABLE TASKS CURRENTLY FAIL READINESS**

This matrix applies Contract C10 and `2026-09-04-ptf-v1-plan-readiness-addendum.md` to every executable task unit in Plans 00–06, including the three Plan 01 tasks inserted by the September 4 corrections.

## Interpretation

Columns use:

- `P` — explicit enough in the task/binding correction to satisfy the dimension;
- `F` — confirmed missing or contradictory;
- `R` — requires task rewrite/recheck; not relied upon to establish readiness.

A row is `PASS` only when **all eight C10 dimensions are P**. One `F` is sufficient for `FAIL`.

The first mechanical pass establishes a universal defect: the original subsystem tasks end with commits but do not contain a task-scoped independent reviewer acceptance gate. The plans contain global statements about reviewable commits/completion review, but that is not the C10 requirement that a dependent task is released only after the current task has an explicit acceptance gate. Therefore every original task is `FAIL` until a binding per-task or universally inherited reviewer gate is added and the remaining `R` dimensions are rechecked.

The inserted Plan 01 corrections also currently lack complete commit/reviewer-gate structure and therefore fail.

| Plan | Task | exact-files | interfaces | red-test | red-command | implementation-shape | green-command | commit | reviewer-gate | status | notes |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 00 | T1 Bootstrap clean Python workspace | P | P | P | F | P | P | P | F | FAIL | Failing import is written but not executed before workspace/package creation; no task reviewer gate. |
| 00 | T2 Canonical immutable model + fingerprinting | P | P | P | P | P | P | P | F | FAIL | Reviewer gate missing. |
| 00 | T3 Personal State provenance + freshness | P | P | R | P | P | P | P | F | FAIL | Assertions described rather than complete test body for part of task; reviewer gate missing. |
| 00 | T4 Subjects/bindings/auth/trust | P | P | R | R | R | P | P | F | FAIL | Requires C10 rewrite/recheck; reviewer gate missing. |
| 00 | T5 Authority/containment/no-grant-union/CP1 | P | P | R | P | P | P | P | F | FAIL | Reviewer gate missing; several tests are described rather than fully materialized. |
| 00 | T6 DisclosurePlan/ExecutionPlan/EnforcementMap/Assurance | P | P | F | F | F | P | P | F | FAIL | Uses generic “write failing tests / implement models”; no concrete red command or minimal code shape. |
| 00 | T7 AuditEvent/PTFReceipt values | P | P | F | F | F | P | P | F | FAIL | Generic test/implementation instructions; no red command; reviewer gate missing. |
| 00 | T8 Foundation metamorphic oracles | P | P | R | R | R | P | P | F | FAIL | Fixture is concrete but test implementation remains descriptive; reviewer gate missing. |
| 01 | T1 Bootstrap runtime/PostgreSQL/API/executor packages | P | P | P | P | P | P | P | F | FAIL | Reviewer gate missing. |
| 01 | T2 Runtime lifecycle values + ports | P | P | P | P | P | P | P | F | FAIL | Contract C3 supersedes ApprovalEvidence shape; reviewer gate missing. |
| 01 | T3 Durable PostgreSQL schema | P | P | R | P | P | P | P | F | FAIL | Reviewer gate missing; recheck complete migration assertions. |
| 01 | T4 Trust Registry + actor authentication | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing; task requires C10 materialization. |
| 01 | T5 Hard Policy + Standing Grant lifecycle | P | P | R | R | R | P | P | F | FAIL | Contract C3 changes approval evidence; reviewer gate missing. |
| 01 | T6 CP2 atomic reservation + Execution Grant | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing; concurrency oracle needs exact red fixture/command. |
| 01 | T6A Personal State repository (inserted C5) | P | P | P | P | P | P | F | F | FAIL | Read methods/audit sequencing corrected by readiness addendum; task still needs commit + reviewer gate. |
| 01 | T6B Protected Resource Catalog (inserted C6) | P | P | P | P | P | P | F | F | FAIL | Repository interface corrected; executor negative test moved to executor task; commit + reviewer gate missing. |
| 01 | T6C Task-scoped Safe View runtime (inserted C4) | P | P | P | P | P | P | F | F | FAIL | Fixture/helper ambiguity corrected; commit + reviewer gate missing. |
| 01 | T7 ActionRuntime lifecycle + approval mutation | P | P | R | R | R | P | P | F | FAIL | Must consume C3/C4/C5/C6 signatures; reviewer gate missing. |
| 01 | T8 Synthetic Protected Executor + leak canary | P | P | R | R | R | P | P | F | FAIL | Must own RESOURCE-REF-NOT-AUTHORITY negative test after C6 correction; reviewer gate missing. |
| 01 | T9 AI0 audit chain + signed checkpoints | P | P | R | R | R | P | P | F | FAIL | Must absorb opaque Personal-State-erasure audit integration; reviewer gate missing. |
| 01 | T10 Agent/Principal FastAPI seams | P | P | R | R | R | P | P | F | FAIL | Must use POST task-scoped Safe View and corrected route allowlist; reviewer gate missing. |
| 02 | T1 Pin/verify x402 2.22.0 | P | P | P | F | P | P | P | F | FAIL | Import tests are written but no explicit red run before package creation; reviewer gate missing. |
| 02 | T2 Normalize x402 payment requirements | P | P | P | P | P | P | P | F | FAIL | Reviewer gate missing. |
| 02 | T3 x402 Enforcement Map | P | P | F | F | F | P | P | F | FAIL | “Implement and run” collapses red/green; no minimal implementation shape. |
| 02 | T4 Protected x402 wallet executor | P | P | R | F | P | R | P | F | FAIL | Negative tests described but red execution is not independently demonstrated; reviewer gate missing. |
| 02 | T5 Facilitator verification/settlement evidence | P | P | R | R | R | P | P | F | FAIL | Requires C10 materialization; reviewer gate missing. |
| 02 | T6 Concrete X402PaymentFlow | P | P | R | R | P | P | P | F | FAIL | Reviewer gate missing; recheck red-state command. |
| 02 | T7 Substitution/replay/indeterminate attacks | P | P | R | R | R | P | P | F | FAIL | Test-only task still needs explicit red expectation and reviewer gate. |
| 02 | T8 x402 acceptance evidence | P | P | R | R | R | P | R | F | FAIL | Acceptance task needs exact commit/reviewer gate and complete oracle fixture shape. |
| 03 | T1 AP2 dependency convergence verification | P | P | R | R | P | P | P | F | FAIL | Contract C2 makes this verification-only; reviewer gate missing. |
| 03 | T2 Add pinned AP2 packages | P | P | P | F | P | P | P | F | FAIL | Failing imports are not explicitly run before package creation; reviewer gate missing. |
| 03 | T3 Map PTF authority/plan to AP2 payloads | P | P | F | F | F | P | P | F | FAIL | Tests/rejections described, no red command, minimal mapping implementation not shown. |
| 03 | T4 AP2 Enforcement Map | P | P | F | F | F | P | P | F | FAIL | No red command/minimal implementation shape; reviewer gate missing. |
| 03 | T5 Protected AP2 signing/presentation | P | P | R | R | P | R | P | F | FAIL | Reviewer gate missing; recheck red/green separation. |
| 03 | T6 Delegated mandate flow | P | P | R | R | P | P | P | F | FAIL | Reviewer gate missing. |
| 03 | T7 AP2 receipts/reconciliation | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing; requires exact red fixture. |
| 03 | T8 AP2 invariant/attenuation attacks | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing. |
| 03 | T9 x402/AP2 seam review | P | P | R | R | R | R | R | F | FAIL | Review task intentionally conditional but still needs exact acceptance criteria/commit boundary and reviewer gate. |
| 04 | T1 Pin OpenID4VP Final profile/packages | P | P | P | F | P | P | P | F | FAIL | Import red state not run before creation; reviewer gate missing. |
| 04 | T2 Normalize/authenticate verifier request | P | P | F | F | P | P | P | F | FAIL | Tests are assertion lists; no red command; reviewer gate missing. |
| 04 | T3 DCQL minimization | P | P | F | F | P | P | P | F | FAIL | No red command before implementation; reviewer gate missing. |
| 04 | T4 OpenID4VP Enforcement Map | P | P | F | F | F | P | P | F | FAIL | No red command/minimal implementation shape; reviewer gate missing. |
| 04 | T5 Brokered wallet execution | P | P | R | R | P | R | P | F | FAIL | Reviewer gate missing; red/green split requires materialization. |
| 04 | T6 Direct-post response + single-use evidence | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing. |
| 04 | T7 Concrete OpenID4VP flow | P | P | R | R | P | P | P | F | FAIL | Reviewer gate missing. |
| 04 | T8 Acceptance + core-generality review | P | P | R | R | R | P | R | F | FAIL | Needs exact review acceptance/commit boundaries; reviewer gate missing. |
| 05 | T1 Bootstrap Node/TS workspace | P | P | F | F | P | P | P | F | FAIL | No failing test/red state at all before bootstrap; reviewer gate missing. |
| 05 | T2 Separate Agent/Principal OpenAPI | P | P | F | F | P | P | P | F | FAIL | Route assertions described, no red command; reviewer gate missing. |
| 05 | T3 Narrow TypeScript Agent SDK | P | P | P | F | P | P | P | F | FAIL | Public-surface test is concrete but never run red before implementation; C4 changes `getSafeView`; reviewer gate missing. |
| 05 | T4 Principal WebAuthn authorization | P | P | F | F | P | P | P | F | FAIL | Mutation tests described, no red command; must consume C3 target-generic evidence; reviewer gate missing. |
| 05 | T5 Pending Approval UX | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing; C3 canonical fingerprint alignment required. |
| 05 | T6 Standing Grant + Hard Policy workflows | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing. |
| 05 | T7 Personal State/resource/trust/activity views | P | P | R | R | R | P | P | F | FAIL | Contract C8 removes device backend/UI from this task; reviewer gate missing. |
| 05 | T8 Browser storage/route/accessibility isolation | P | P | R | R | R | P | R | F | FAIL | Test/review task lacks exact task reviewer gate and needs C4/C7/C8/C9 recheck. |
| 06 | T1 Conformance package/evidence format | P | P | R | P | P | P | P | F | FAIL | Reviewer gate missing; profile test body partly descriptive. |
| 06 | T2 Mandatory foundational oracles + locked corpus | P | P | F | F | F | R | P | F | FAIL | Large implementation task has assertion descriptions but no red command/minimal implementation code shape. |
| 06 | T3 Protocol-specific conformance packs | P | P | F | F | F | P | P | F | FAIL | Tests described at scenario level; no red command/minimal implementation shape. |
| 06 | T4 Portable State export/import | P | P | R | R | P | P | P | F | FAIL | Reviewer gate missing; recheck exact red fixture. |
| 06 | T5 Multi-device/revocation/recovery | P | P | R | R | P | P | P | F | FAIL | Must include Contract C8 device routes/backend sequencing; reviewer gate missing. |
| 06 | T6 AI1 external witness | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing. |
| 06 | T7 Trusted Surface portability/recovery/device journeys | P | P | R | R | R | P | P | F | FAIL | Contract C8 adds device routes/UI here; reviewer gate missing. |
| 06 | T8 Migration/self-improvement gates + threat model | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing. |
| 06 | T9 CI/dependency/secret/SBOM/release evidence | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing; exact release-block policy must be explicit. |
| 06 | T10 External interoperability + truthful release claims | P | P | R | R | R | P | P | F | FAIL | Reviewer gate missing; external evidence may truthfully remain not demonstrated. |

## Mechanical totals

```text
Original subsystem tasks: 61
Inserted Plan 01 correction tasks: 3
Total executable task units: 64
Current PASS: 0
Current FAIL: 64
```

This is not a statement that the architecture is wrong. It is a statement that the written executable plans do not yet satisfy the plan-quality contract they themselves impose.

## Required remediation order

1. Add one binding reviewer-gate protocol that is explicitly inherited by every task and prevents dependent-task release until both specification-compliance and implementation-quality review pass.
2. Rewrite every row with `F` in red-test, red-command, or implementation-shape so the missing content is in the task or an exact task-scoped correction.
3. Recheck every `R` cell against the final corrected task text and change it to P or F with a concrete note.
4. Apply Contract C2–C9/readiness-addendum signature changes to the affected original tasks rather than leaving contradictory examples in place.
5. Re-run the matrix. Readiness requires 64/64 PASS (or a reviewed task-count change with every remaining executable unit PASS).
6. Only then rerun the 28-gate coverage audit and verification-before-completion.
