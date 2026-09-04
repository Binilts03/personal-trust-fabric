# Personal Trust Fabric — Agent Instructions

Status: **PTF v1 specification approved; implementation planning in progress.**

## Source of truth

1. `docs/spec/PTF-V1-APPROVAL.md` — lifecycle approval record identifying the exact approved specification blob.
2. `docs/spec/PTF-V1-PROPOSED.md` — immutable reviewed specification whose exact blob is approved by the approval record.
3. `CONTEXT-MAP.md` — non-normative terminology/context glossary. If it conflicts with the approved specification, the approved specification wins.
4. `docs/adr/` — accepted hard-to-reverse architecture decisions.
5. `docs/superpowers/plans/` — implementation plans after they are written; plans may sequence the work but may not redefine the product boundary.

Do not infer PTF v1 architecture from conversational history or the synthetic WebMCP implementation.

## Repository safety

- The synthetic WebMCP milestone is preserved on `legacy/webmcp-sandbox` at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.
- Immutable tag `webmcp-sandbox-v0.1` is a mandatory pre-rewrite gate and must resolve to that same commit before any modification of `main`.
- The current ChatGPT GitHub connector cannot create the tag; an execution environment with Git push/tag capability must do and verify this first.
- Do not implement against the synthetic WebMCP source tree or inherit its module boundaries.
- This architecture/planning branch remains documentation-only.

## Process gate

The approved architecture permits implementation planning. Use Superpowers `writing-plans` to produce the complete rewrite roadmap and bounded subplans.

Do **not** begin implementation until the plan set is complete and an execution workflow is explicitly selected. During execution, use an isolated worktree and the applicable Superpowers/Matt skills for each task.

## Scope guardrail

The approved full PTF specification is the product boundary. AP2, x402, OpenID4VP, WebMCP/MCP/A2A, a payment flow, a credential flow, a Trusted Surface, or any demonstration is a proving milestone, not the PTF product.

## Agent skills

### Issue tracker

Use GitHub Issues for bounded execution tasks, defects, and review findings. Issues must reference the exact approved plan/task rather than restating requirements. See `docs/agents/issue-tracker.md`.

### Domain docs

Use the existing approved PTF domain sources; do not create duplicate `CONTEXT.md` or per-package domain models. See `docs/agents/domain.md`.
