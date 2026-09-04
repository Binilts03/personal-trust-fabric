# Personal Trust Fabric — Agent Instructions

Status: **PTF v1 specification approved; implementation planning verified; source execution blocked by repository-preservation decision/tag preflight.**

## Source of truth

Read in this order:

1. `docs/spec/PTF-V1-APPROVAL.md` — exact lifecycle approval record.
2. `docs/spec/PTF-V1-PROPOSED.md` — immutable approved specification blob identified by that record.
3. accepted `docs/adr/`.
4. `docs/superpowers/plans/2026-09-04-ptf-v1-plan-readiness-addendum.md` — current lifecycle/readiness gate.
5. `docs/superpowers/plans/2026-09-04-ptf-v1-task-quality-corrections-index.md` — authoritative planning precedence through correction 11 + final strict fixture closure.
6. `docs/superpowers/plans/2026-09-04-ptf-v1-final-interface-registry.md` and `2026-09-04-ptf-v1-interface-registry-addendum.md` — public name/signature oracle.
7. `docs/superpowers/plans/2026-09-04-ptf-v1-task-review-protocol.md` — inherited task acceptance mechanics.
8. `docs/review/2026-09-04-plan-task-quality-matrix.md` — final 65-task C10 plan-quality matrix.
9. `docs/review/2026-09-04-final-cross-plan-consistency.md` — final cross-plan standards/interface review.
10. `docs/review/2026-09-04-final-28-gate-audit.md` — approved-spec foundational gate coverage.
11. `docs/superpowers/plans/2026-09-04-ptf-v1-execution-roadmap.md` — dependency order only.
12. the relevant original 2026-09-03 subsystem plan, read subject to every binding document above.
13. `CONTEXT-MAP.md` as non-normative terminology/context only.

Do not infer v1 architecture from conversational history, the synthetic WebMCP implementation, or an older plan snippet that is superseded by the authoritative index.

## Verified planning state

```text
65/65 executable task units satisfy Contract C10 at written-plan level
cross-plan effective interface consistency PASS
28/28 foundational gates mapped to implementation + later falsifier
```

These are planning results only. They do not mean source code exists or runtime tests have passed.

## Repository-preservation hard stop

Current verified refs:

```text
legacy/webmcp-sandbox -> 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9
webmcp-submit-freeze  -> f94a7bd3a59c440bddded8d6cab2956e595132e3
webmcp-sandbox-v0.1   -> ABSENT
```

Do not create/move preservation refs, rewrite `main`, create a product worktree, or start a source task until the human explicitly selects **PRESERVE-A** or **PRESERVE-B** in accordance with the readiness addendum.

- PRESERVE-A keeps `2ed4020c...` as the approved rewrite-preservation baseline and creates `webmcp-sandbox-v0.1` there.
- PRESERVE-B rebaselines preservation to `f94a7bd3...` and requires explicit lifecycle-record amendment before source work.

An implementer/agent MUST NOT choose between them.

## Execution process after preservation closes

Only after the human decision and exact Git preflight succeed:

1. use Superpowers `using-git-worktrees` before product source work;
2. start from the approved rewrite execution base, not the synthetic WebMCP source tree;
3. execute the verified Plan 00→06 dependency order;
4. for every task, read the authoritative index plus the task's applicable corrections/strict supplement before editing;
5. use red-first TDD for behavioral source tasks; use the explicit verification-only path only where the plan marks it;
6. do not invent missing security semantics, aliases, helper interfaces, protocol fallbacks, or broader abstractions;
7. create the candidate task commit only after the task's green command passes;
8. run Review A (spec/plan compliance) and Review B (implementation/test quality) from `2026-09-04-ptf-v1-task-review-protocol.md` against the same candidate commit SHA;
9. do not release a dependent task until both reviews PASS;
10. use Superpowers `verification-before-completion` before milestone, conformance, release, merge, or completion claims.

## Scope and trust guardrails

The approved full PTF specification is the product boundary. AP2, x402, OpenID4VP, WebMCP/MCP/A2A, a payment flow, a credential flow, Trusted Surface, conformance fixture, or demonstration is a proving milestone, not the product definition.

No Personal State, learned preference, model confidence, protocol validity, protocol artifact, payment success, repeated approval, or display label can silently create or broaden authority or trust.

Use only the final cross-plan interfaces. In particular:

```text
resource_ref, not resource_id
source_constraint_ids, not object-valued source_constraints
ApprovalEvidence.target_kind + canonical_fingerprint, not ApprovalEvidence.plan_fingerprint
POST task-scoped /v1/agent/safe-view, not unscoped GET
getSafeView(input), not parameterless getSafeView()
TrustAdministrationService for trust mutation
PersonalStateService for Personal State mutation
OpenID4VPWalletExecutor.present_and_deliver for raw credential/VP/direct-post custody
classify_direct_post_evidence for safe OpenID4VP outcome classification
```

## Issue tracker

Use GitHub Issues for bounded execution tasks, defects, and review findings. Issues reference the exact approved plan/task and do not restate or mutate requirements.

Do not publish a large execution-ticket DAG without the human granularity review required by the applicable Matt Skills Curated ticketing workflow.

## Domain documentation

Use the approved PTF specification, ADRs, interface registry, corrections, and existing domain sources. Do not create duplicate per-package domain authorities that can drift from the approved model.