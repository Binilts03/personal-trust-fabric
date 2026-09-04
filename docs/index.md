# PTF v1 Documentation

Status: **Specification approved; verified implementation plan set ready for execution-workflow selection.**

## Approved specification

- `spec/PTF-V1-APPROVAL.md` — exact approval/lifecycle record.
- `spec/PTF-V1-PROPOSED.md` — immutable reviewed specification blob identified by the approval record. Its historical `PROPOSED` text is superseded only by the external approval record; the blob itself remains unchanged.

## Accepted ADRs

- `adr/0001-dual-source-authority-and-personal-state-separation.md`
- `adr/0002-plan-bound-execution-and-enforcement-map.md`
- `adr/0003-local-subjects-and-validated-identity-bindings.md`
- `adr/0004-plural-custody-and-protected-executors.md`
- `adr/0005-external-protocols-are-adapters-not-authority.md`
- `adr/0006-preserve-repository-history-rewrite-implementation.md`

## Verified execution planning

Read in this order:

1. `superpowers/plans/2026-09-04-ptf-v1-plan-set-contract.md` — binding cross-plan corrections and frozen execution contract.
2. `superpowers/plans/2026-09-04-ptf-v1-execution-roadmap.md` — current dependency order and final verification gates.
3. `superpowers/plans/2026-09-03-ptf-v1-foundation-plan.md` — Plan 00 pure domain foundation, subject to the September 4 contract.
4. `superpowers/plans/2026-09-03-ptf-v1-runtime-plan.md` — Plan 01 durable runtime, subject to the September 4 contract.
5. `superpowers/plans/2026-09-03-ptf-v1-x402-plan.md` — Plan 02 concrete x402 proof.
6. `superpowers/plans/2026-09-03-ptf-v1-ap2-plan.md` — Plan 03 concrete AP2 proof, executed after x402.
7. `superpowers/plans/2026-09-03-ptf-v1-openid4vp-plan.md` — Plan 04 credential/disclosure generality proof.
8. `superpowers/plans/2026-09-03-ptf-v1-product-surface-plan.md` — Plan 05 Trusted Surface and Agent SDK, subject to the September 4 contract.
9. `superpowers/plans/2026-09-03-ptf-v1-conformance-operations-plan.md` — Plan 06 conformance, portability, recovery, device management, and release operations.

`superpowers/plans/2026-09-03-ptf-v1-rewrite-roadmap.md` is retained as historical planning evidence but is **superseded for execution ordering** by the September 4 roadmap.

## Review history

- `review/2026-09-03-critical-review-remediation.md` — specification remediation.
- `review/2026-09-04-plan-set-audit.md` — two-axis plan review, corrections, and 28-gate coverage map.

## Non-normative terminology

- `../CONTEXT-MAP.md` — glossary only; never overrides the approved specification.

## Engineering workflow

- `agents/issue-tracker.md` — GitHub Issues convention for bounded execution/review work.
- `agents/domain.md` — domain-source routing; prevents duplicate domain documents.

Do not publish a full implementation ticket DAG until the human granularity review required by Matt Skills Curated `to-tickets` has occurred.

## Preservation and execution blocker

The synthetic WebMCP milestone is preserved on `legacy/webmcp-sandbox` at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.

Immutable tag `webmcp-sandbox-v0.1` must exist at that same commit before source implementation or any rewrite of `main`. Planning tooling has not created the tag. The verified execution roadmap makes tag creation/verification Task 1 and treats absence/mismatch as a hard stop.

## Current process gate

No implementation starts from this documentation branch. The next human decision is execution workflow selection: Superpowers Subagent-Driven Development or Inline Execution. After selection, implementation begins only after the preservation tag gate and isolated-worktree setup succeed.