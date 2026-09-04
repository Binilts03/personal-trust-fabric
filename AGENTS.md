# Personal Trust Fabric — Agent Instructions

Status: **PTF v1 specification approved; implementation planning verification in progress.**

## Source of truth

1. `docs/spec/PTF-V1-APPROVAL.md` — lifecycle approval record identifying the exact approved specification blob.
2. `docs/spec/PTF-V1-PROPOSED.md` — immutable reviewed specification whose exact blob is approved by the approval record.
3. `CONTEXT-MAP.md` — non-normative terminology/context glossary. If it conflicts with the approved specification, the approved specification wins.
4. `docs/adr/` — accepted hard-to-reverse architecture decisions.
5. `docs/superpowers/plans/2026-09-04-ptf-v1-plan-set-amendments.md` — normative corrections to the implementation plan set. Where it conflicts with the roadmap or Plans 00–06, the amendment wins.
6. `docs/superpowers/plans/` — master rewrite roadmap and bounded executable plans; plans may sequence work but may not redefine the product boundary.

Do not infer PTF v1 architecture from conversational history or the synthetic WebMCP implementation.

## Repository safety

- The synthetic WebMCP milestone is preserved on `legacy/webmcp-sandbox` at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.
- Immutable tag `webmcp-sandbox-v0.1` is a mandatory pre-rewrite gate and must resolve to that same commit before any modification of `main`.
- Do not implement against the synthetic WebMCP source tree or inherit its module boundaries.
- This architecture/planning branch remains documentation-only.

## Process gate

The approved architecture permits implementation planning. Use Superpowers `writing-plans` to produce and verify the complete rewrite roadmap and bounded subplans.

Do **not** begin implementation until:

1. the plan-set verification report passes;
2. the repository preservation tag gate passes;
3. an execution workflow is explicitly selected.

During execution, use an isolated worktree and the applicable Superpowers/Matt skills for each task.

Before executing any implementation plan, read:

1. the approved spec/approval record;
2. `2026-09-04-ptf-v1-plan-set-amendments.md`;
3. the roadmap;
4. the specific plan being executed.

## Scope guardrail

The approved full PTF specification is the product boundary. AP2, x402, OpenID4VP, WebMCP/MCP/A2A, a payment flow, a credential flow, a Trusted Surface, direct delivery, a developer simulator, or any demonstration is a proving/product surface, not the whole PTF product.

## Required plan order

Unless a later reviewed amendment says otherwise:

```text
Plan 00 Foundation
-> Plan 01 Runtime
-> Plan 02 x402
-> Plan 03 AP2 + seam review
-> Plan 04 OpenID4VP
-> Plan 05 Product Surface + Plan 05B Developer/Integration Closure
-> Plan 06 Conformance/Portability/Recovery/Release
```

Plan 05 and Plan 05B may execute in isolated parallel worktrees after Plan 04 acceptance. Plan 06 release closure depends on both.

## Agent skills

### Issue tracker

Use GitHub Issues for bounded execution tasks, defects, and review findings. Issues must reference the exact approved plan/task rather than restating requirements. See `docs/agents/issue-tracker.md`.

### Domain docs

Use the existing approved PTF domain sources; do not create duplicate `CONTEXT.md` or per-package domain models. See `docs/agents/domain.md`.
