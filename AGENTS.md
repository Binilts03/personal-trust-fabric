# Personal Trust Fabric — Agent Instructions

Status: **PTF v1 specification approved; verified implementation plan set ready for execution-workflow selection.**

## Source of truth

Read these in order:

1. `docs/spec/PTF-V1-APPROVAL.md` — lifecycle approval record identifying the exact approved specification blob.
2. `docs/spec/PTF-V1-PROPOSED.md` — immutable reviewed specification whose exact blob is approved by the approval record; despite the historical filename/status text inside that immutable blob, it is approved only by reference through the approval record.
3. `docs/adr/` — accepted hard-to-reverse architecture decisions.
4. `docs/superpowers/plans/2026-09-04-ptf-v1-plan-set-contract.md` — binding execution corrections discovered by cross-plan verification.
5. `docs/superpowers/plans/2026-09-04-ptf-v1-execution-roadmap.md` — current execution order and gates.
6. The seven detailed 2026-09-03 subsystem plans under `docs/superpowers/plans/`, read subject to the September 4 contract.
7. `CONTEXT-MAP.md` — non-normative terminology/context glossary. If it conflicts with the approved specification, the approved specification wins.
8. `docs/review/2026-09-04-plan-set-audit.md` — verification findings and 28-gate coverage map.

The 2026-09-03 rewrite roadmap is superseded for execution ordering by the September 4 roadmap. It remains historical planning evidence only.

Do not infer PTF v1 architecture from conversational history or the synthetic WebMCP implementation.

## Repository safety

- The synthetic WebMCP milestone is preserved on `legacy/webmcp-sandbox` at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.
- Immutable tag `webmcp-sandbox-v0.1` is a mandatory source-rewrite gate and must resolve to that same commit before any implementation source work or modification of `main`.
- Planning tooling in this workspace has not created that tag. An execution environment with Git push/tag capability must create and verify it first.
- Do not implement against the synthetic WebMCP source tree or inherit its module boundaries.
- `architecture/ptf-v1-spec` and `planning/ptf-v1-verified` remain documentation/planning branches; implementation starts on a new isolated rewrite branch/worktree after the preservation gate.

## Process gate

The written plan set has completed cross-plan review. **Do not begin implementation until the human explicitly selects an execution workflow.**

After selection:

1. use Superpowers `using-git-worktrees` before source work;
2. perform the preservation/tag gate in the verified execution roadmap;
3. execute the September 4 roadmap in dependency order;
4. read the plan-set contract before every subsystem plan;
5. use TDD and the applicable narrow Matt/Superpowers skill for each task;
6. independently review each task before releasing a dependent task;
7. use Superpowers `verification-before-completion` before any completion/release claim.

A task that does not satisfy Contract C10's plan-quality gate returns to planning rather than allowing the implementer to invent missing security semantics.

## Scope guardrail

The approved full PTF specification is the product boundary. AP2, x402, OpenID4VP, WebMCP/MCP/A2A, a payment flow, a credential flow, a Trusted Surface, a conformance fixture, or any demonstration is a proving milestone, not the PTF product.

No Personal State, learned preference, model confidence, protocol validity, payment success, or repeated approval can silently create or broaden authority or trust.

## Agent skills

### Issue tracker

Use GitHub Issues for bounded execution tasks, defects, and review findings. Issues must reference the exact approved plan/task rather than restating requirements. See `docs/agents/issue-tracker.md`.

Do not publish a large execution-ticket DAG without the human granularity review required by Matt Skills Curated `to-tickets`.

### Domain docs

Use the existing approved PTF domain sources; do not create duplicate `CONTEXT.md` or per-package domain models. See `docs/agents/domain.md`.