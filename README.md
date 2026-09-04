# Personal Trust Fabric — v1 Architecture and Planning Review

This branch is the **documentation-only PTF v1 planning branch**.

The PTF v1 formal specification has been explicitly human-approved. The reviewed specification file is intentionally preserved unchanged; `docs/spec/PTF-V1-APPROVAL.md` identifies the exact approved blob.

## Canonical sources

Read in this order:

1. `docs/spec/PTF-V1-APPROVAL.md` — exact approval/lifecycle record.
2. `docs/spec/PTF-V1-PROPOSED.md` — immutable reviewed specification blob approved by that record.
3. `docs/adr/` — accepted architecture decisions.
4. `docs/superpowers/plans/2026-09-04-ptf-v1-plan-readiness-addendum.md` — current planning-readiness blockers and binding task corrections.
5. `docs/superpowers/plans/2026-09-04-ptf-v1-task-review-protocol.md` — inherited two-stage reviewer acceptance gate for every executable task.
6. `docs/review/2026-09-04-plan-task-quality-matrix.md` — mechanical C10 status for all executable task units.
7. `docs/superpowers/plans/2026-09-04-ptf-v1-plan-set-contract.md` — earlier cross-plan execution corrections, subject to the readiness addendum.
8. `docs/superpowers/plans/2026-09-04-ptf-v1-execution-roadmap.md` — intended dependency order; source execution remains blocked until the readiness addendum is closed.
9. The seven detailed 2026-09-03 subsystem plans, subject to the September 4 corrections.
10. `CONTEXT-MAP.md` — non-normative terminology glossary.
11. `docs/review/2026-09-04-plan-set-audit.md` — earlier audit and 28-gate coverage map; its execution-ready conclusion is superseded by the readiness addendum and current task-quality matrix.

The earlier `2026-09-03-ptf-v1-rewrite-roadmap.md` remains historical planning evidence and is superseded for execution order.

## Current phase

**Specification approved. Implementation planning reopened. No rewrite code has started. Source implementation is not authorized yet.**

The September 4 follow-up verification found two blocking issues: repository-preservation state advanced after the recorded preservation baseline, and the detailed task set does not yet uniformly satisfy its own Contract C10 task-quality standard. The readiness addendum defines the exact closure conditions.

## Preservation gate

The approval record names `legacy/webmcp-sandbox` at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`. After that record was written, the synthetic sandbox advanced to `f94a7bd3a59c440bddded8d6cab2956e595132e3`, now protected by annotated tag `webmcp-submit-freeze`.

The required `webmcp-sandbox-v0.1` tag is still absent. Planning must not guess whether the formal preservation target remains the approved baseline or is rebaselined to the later submission freeze. The human preservation decision described in the readiness addendum is required before source work.

## Task-quality gate

The initial mechanical C10 matrix covers 64 executable task units: 61 original subsystem tasks plus three inserted Plan 01 corrections. The current matrix is deliberately fail-closed. A task becomes execution-ready only after every C10 dimension is explicit and the inherited review protocol can release it after green evidence.

## Product boundary

The full approved PTF specification remains the product boundary. x402, AP2, OpenID4VP, WebMCP/MCP/A2A, a payment flow, credential presentation, Trusted Surface, or conformance fixture exists to prove or falsify PTF—not to redefine the product.