# Personal Trust Fabric — Agent Instructions

Status: **PTF v1 specification approved; implementation planning reopened; source execution not authorized.**

## Source of truth

Read these in order:

1. `docs/spec/PTF-V1-APPROVAL.md` — lifecycle approval record identifying the exact approved specification blob.
2. `docs/spec/PTF-V1-PROPOSED.md` — immutable reviewed specification whose exact blob is approved by the approval record; despite the historical filename/status text inside that immutable blob, it is approved only by reference through the approval record.
3. `docs/adr/` — accepted hard-to-reverse architecture decisions.
4. `docs/superpowers/plans/2026-09-04-ptf-v1-plan-readiness-addendum.md` — current binding planning-readiness blockers and corrections.
5. `docs/superpowers/plans/2026-09-04-ptf-v1-task-review-protocol.md` — inherited two-stage reviewer acceptance gate for every executable task.
6. `docs/review/2026-09-04-plan-task-quality-matrix.md` — current C10 readiness state for every executable task unit.
7. `docs/superpowers/plans/2026-09-04-ptf-v1-plan-set-contract.md` — earlier cross-plan corrections, subject to the readiness addendum.
8. `docs/superpowers/plans/2026-09-04-ptf-v1-execution-roadmap.md` — intended execution order, not authorization to start while readiness is open.
9. The seven detailed 2026-09-03 subsystem plans under `docs/superpowers/plans/`, read subject to all September 4 corrections.
10. `CONTEXT-MAP.md` — non-normative terminology/context glossary. If it conflicts with the approved specification, the approved specification wins.
11. `docs/review/2026-09-04-plan-set-audit.md` — earlier verification findings and 28-gate coverage. Its readiness conclusion is superseded by the readiness addendum and current matrix.

The 2026-09-03 rewrite roadmap is historical planning evidence only.

Do not infer PTF v1 architecture from conversational history or the synthetic WebMCP implementation.

## Repository safety

- The approval/lifecycle record names `legacy/webmcp-sandbox` at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9` as the preservation baseline.
- The synthetic sandbox later advanced to `f94a7bd3a59c440bddded8d6cab2956e595132e3`, which is protected by annotated tag `webmcp-submit-freeze`.
- Required tag `webmcp-sandbox-v0.1` is currently absent.
- Do not create that tag, move `legacy/webmcp-sandbox`, rewrite `main`, or start implementation until the human explicitly approves PRESERVE-A or PRESERVE-B in the readiness addendum.
- Do not implement against the synthetic WebMCP source tree or inherit its module boundaries.
- `architecture/ptf-v1-spec` and this planning branch remain documentation/planning branches. No product source belongs here.

## Process gate

The written plan set is **not currently execution-ready**. Do not begin implementation merely because an execution workflow is selected.

Planning must first close every readiness condition in `2026-09-04-ptf-v1-plan-readiness-addendum.md`, including:

1. explicit human preservation-baseline decision;
2. consistent repository-preservation records and required immutable tag;
3. a task-quality matrix covering every executable task in Plans 00–06;
4. rewrite/correction of every task that fails Contract C10;
5. fresh cross-plan name/signature verification;
6. fresh mapping of all 28 foundational acceptance gates to implementation and black-box evidence;
7. verification-before-completion over the actual final plan files and Git refs.

Every executable task inherits `2026-09-04-ptf-v1-task-review-protocol.md`. A candidate task commit is not accepted until both its specification/plan review and implementation/test-quality review pass against the same commit SHA.

Only after all readiness conditions pass may the human select/confirm an execution workflow. At that point:

1. use Superpowers `using-git-worktrees` before source work;
2. perform the approved preservation/tag gate;
3. execute the verified roadmap in dependency order;
4. read all binding plan corrections before each subsystem plan;
5. use TDD and the applicable narrow Matt/Superpowers skill for each task;
6. independently review each task before releasing a dependent task;
7. use Superpowers `verification-before-completion` before any completion/release claim.

A task that does not satisfy Contract C10 returns to planning. The implementer is not allowed to invent missing security semantics.

## Scope guardrail

The approved full PTF specification is the product boundary. AP2, x402, OpenID4VP, WebMCP/MCP/A2A, a payment flow, a credential flow, a Trusted Surface, a conformance fixture, or any demonstration is a proving milestone, not the PTF product.

No Personal State, learned preference, model confidence, protocol validity, payment success, or repeated approval can silently create or broaden authority or trust.

## Agent skills

### Issue tracker

Use GitHub Issues for bounded execution tasks, defects, and review findings. Issues must reference the exact approved plan/task rather than restating requirements. See `docs/agents/issue-tracker.md`.

Do not publish a large execution-ticket DAG without the human granularity review required by Matt Skills Curated `to-tickets`.

### Domain docs

Use the existing approved PTF domain sources; do not create duplicate `CONTEXT.md` or per-package domain models. See `docs/agents/domain.md`.