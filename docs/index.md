# PTF v1 Documentation

Status: **Specification approved; implementation planning verification in progress.**

## Approved specification

- `spec/PTF-V1-APPROVAL.md` — exact approval/lifecycle record.
- `spec/PTF-V1-PROPOSED.md` — immutable reviewed specification blob identified by the approval record.

## Non-normative terminology

- `../CONTEXT-MAP.md`

## Accepted ADRs

- `adr/0001-dual-source-authority-and-personal-state-separation.md`
- `adr/0002-plan-bound-execution-and-enforcement-map.md`
- `adr/0003-local-subjects-and-validated-identity-bindings.md`
- `adr/0004-plural-custody-and-protected-executors.md`
- `adr/0005-external-protocols-are-adapters-not-authority.md`
- `adr/0006-preserve-repository-history-rewrite-implementation.md`

## Implementation planning

Read `superpowers/plans/2026-09-04-ptf-v1-plan-set-amendments.md` before any roadmap/subplan. It is the normative correction sheet for plan execution.

- `superpowers/plans/2026-09-03-ptf-v1-rewrite-roadmap.md` — master sequencing roadmap.
- `superpowers/plans/2026-09-03-ptf-v1-foundation-plan.md` — Plan 00: pure domain foundation.
- `superpowers/plans/2026-09-03-ptf-v1-runtime-plan.md` — Plan 01: durable runtime, trust, CP2, audit, APIs.
- `superpowers/plans/2026-09-03-ptf-v1-x402-plan.md` — Plan 02: x402 concrete proving integration.
- `superpowers/plans/2026-09-03-ptf-v1-ap2-plan.md` — Plan 03: AP2 concrete proving integration + seam review.
- `superpowers/plans/2026-09-03-ptf-v1-openid4vp-plan.md` — Plan 04: OpenID4VP cross-domain proving integration.
- `superpowers/plans/2026-09-03-ptf-v1-product-surface-plan.md` — Plan 05: Trusted Surface + Agent SDK.
- `superpowers/plans/2026-09-04-ptf-v1-developer-integration-plan.md` — Plan 05B: direct delivery + simulator/inspectors + recipient/verifier integration.
- `superpowers/plans/2026-09-03-ptf-v1-conformance-operations-plan.md` — Plan 06: conformance, portability, recovery, device/trust closure, release operations.
- `superpowers/plans/2026-09-04-ptf-v1-plan-set-amendments.md` — cross-plan corrections and mandatory additions.

## Review history

- `review/2026-09-03-critical-review-remediation.md`
- `review/2026-09-04-plan-set-verification.md` — created when the final planning audit is completed.

## Preservation

The synthetic WebMCP milestone is preserved on `legacy/webmcp-sandbox` at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.

Immutable tag `webmcp-sandbox-v0.1` is still required at that same commit before any rewrite of `main`. This remains an execution-preflight blocker until verified.
