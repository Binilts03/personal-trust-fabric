# Personal Trust Fabric — v1 Architecture and Planning

This branch is the **documentation-only architecture/planning branch** for Personal Trust Fabric (PTF).

The PTF v1 formal specification has been explicitly human-approved. The reviewed specification file is intentionally preserved unchanged; `docs/spec/PTF-V1-APPROVAL.md` identifies the exact approved blob.

## Canonical sources

- `docs/spec/PTF-V1-APPROVAL.md` — approval/lifecycle record.
- `docs/spec/PTF-V1-PROPOSED.md` — exact reviewed specification blob approved by that record.
- `CONTEXT-MAP.md` — non-normative terminology glossary.
- `docs/adr/` — accepted architecture decisions.
- `docs/superpowers/plans/` — implementation roadmap and executable subplans once published.

## Current phase

**Implementation planning. No rewrite code has started.**

The synthetic WebMCP implementation is preserved on `legacy/webmcp-sandbox` at commit `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`. It is historical evidence, not the implementation baseline for PTF v1.

Before any rewrite of `main`, immutable tag `webmcp-sandbox-v0.1` must be created and verified at that same commit. The current ChatGPT GitHub connector cannot create Git tags, so the tag remains a hard execution-preflight gate.

The full PTF specification remains the product boundary; individual protocol integrations and milestones exist to prove or falsify it, not replace it.
