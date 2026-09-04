# Personal Trust Fabric — v1 Architecture and Verified Planning

This branch is the **documentation-only verified planning branch** for Personal Trust Fabric (PTF).

The PTF v1 formal specification has been explicitly human-approved. The reviewed specification file is intentionally preserved unchanged; `docs/spec/PTF-V1-APPROVAL.md` identifies the exact approved blob.

## Canonical sources

Read in this order:

1. `docs/spec/PTF-V1-APPROVAL.md` — exact approval/lifecycle record.
2. `docs/spec/PTF-V1-PROPOSED.md` — immutable reviewed specification blob approved by that record.
3. `docs/adr/` — accepted architecture decisions.
4. `docs/superpowers/plans/2026-09-04-ptf-v1-plan-set-contract.md` — binding cross-plan execution corrections.
5. `docs/superpowers/plans/2026-09-04-ptf-v1-execution-roadmap.md` — current dependency order and execution gates.
6. The seven detailed 2026-09-03 subsystem plans, subject to the September 4 contract.
7. `CONTEXT-MAP.md` — non-normative terminology glossary.
8. `docs/review/2026-09-04-plan-set-audit.md` — plan verification and acceptance-gate coverage.

The earlier `2026-09-03-ptf-v1-rewrite-roadmap.md` is historical planning evidence and is superseded for execution order.

## Current phase

**Specification approved. Verified implementation plan set complete. No rewrite code has started.**

The next human decision is which Superpowers execution workflow to use. Source implementation may begin only after that selection, creation/verification of the preservation tag, and isolated-worktree setup.

## Preservation gate

The synthetic WebMCP implementation is preserved on `legacy/webmcp-sandbox` at commit `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`. It is historical evidence, not the implementation baseline for PTF v1.

Before source implementation or any rewrite of `main`, immutable tag `webmcp-sandbox-v0.1` must exist and resolve to that same commit. Planning tooling has not created the tag; the verified execution roadmap makes this the first hard execution preflight.

## Product boundary

The full approved PTF specification remains the product boundary. x402, AP2, OpenID4VP, WebMCP/MCP/A2A, a payment flow, credential presentation, Trusted Surface, or conformance fixture exists to prove or falsify PTF—not to redefine the product.