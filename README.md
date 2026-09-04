# Personal Trust Fabric — v1 Architecture and Planning

This branch is the **documentation-only architecture/planning branch** for Personal Trust Fabric (PTF).

The PTF v1 formal specification has been explicitly human-approved. The reviewed specification file is intentionally preserved unchanged; `docs/spec/PTF-V1-APPROVAL.md` identifies the exact approved blob.

## Canonical sources

- `docs/spec/PTF-V1-APPROVAL.md` — approval/lifecycle record.
- `docs/spec/PTF-V1-PROPOSED.md` — exact reviewed specification blob approved by that record.
- `CONTEXT-MAP.md` — non-normative terminology glossary.
- `docs/adr/` — accepted architecture decisions.
- `docs/superpowers/plans/2026-09-04-ptf-v1-plan-set-amendments.md` — normative plan corrections.
- `docs/superpowers/plans/` — verified implementation roadmap and executable subplans.
- `docs/review/2026-09-04-plan-set-verification.md` — plan-set verification and traceability report.

## Current phase

**Implementation planning is complete. No rewrite code has started.**

The synthetic WebMCP implementation is preserved on `legacy/webmcp-sandbox` at commit `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`. It is historical evidence, not the implementation baseline for PTF v1.

Before any implementation/rewrite of `main`, immutable tag `webmcp-sandbox-v0.1` must be created and verified at that same commit. The tag is currently absent, so implementation remains blocked until that preflight succeeds.

The next workflow decision is execution mode: Superpowers subagent-driven development is preferred for the multi-plan rewrite; Superpowers executing-plans is the sequential alternative. Either path must use an isolated `rewrite/ptf-v1` worktree and the review gates in the verified plans.

The full PTF specification remains the product boundary; individual protocol integrations and milestones exist to prove or falsify it, not replace it.
