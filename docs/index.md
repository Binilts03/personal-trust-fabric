# PTF v1 Documentation

Status: **Specification approved; implementation planning verified; source execution blocked by human preservation decision/tag preflight.**

## Approved specification

- `spec/PTF-V1-APPROVAL.md` — exact approval/lifecycle record.
- `spec/PTF-V1-PROPOSED.md` — immutable approved specification blob identified by that record. Its historical internal `PROPOSED` wording remains unchanged.

## Accepted ADRs

- `adr/0001-dual-source-authority-and-personal-state-separation.md`
- `adr/0002-plan-bound-execution-and-enforcement-map.md`
- `adr/0003-local-subjects-and-validated-identity-bindings.md`
- `adr/0004-plural-custody-and-protected-executors.md`
- `adr/0005-external-protocols-are-adapters-not-authority.md`
- `adr/0006-preserve-repository-history-rewrite-implementation.md`

## Authoritative implementation planning

Read in this order:

1. `superpowers/plans/2026-09-04-ptf-v1-plan-readiness-addendum.md` — final planning/readiness state and open preservation decision.
2. `superpowers/plans/2026-09-04-ptf-v1-task-quality-corrections-index.md` — binding precedence/read order through correction 11 and the final fixture/helper closure.
3. `superpowers/plans/2026-09-04-ptf-v1-final-interface-registry.md` + `2026-09-04-ptf-v1-interface-registry-addendum.md` — public cross-plan name/signature oracle.
4. `superpowers/plans/2026-09-04-ptf-v1-task-review-protocol.md` — inherited two-stage task acceptance gate.
5. `review/2026-09-04-plan-task-quality-matrix.md` — 65/65 final written-task C10 verification.
6. `review/2026-09-04-final-cross-plan-consistency.md` — final standards/interface consistency review.
7. `review/2026-09-04-final-28-gate-audit.md` — 28/28 approved-spec foundational planning coverage.
8. `superpowers/plans/2026-09-04-ptf-v1-execution-roadmap.md` — dependency order only.
9. the relevant original 2026-09-03 subsystem plan, read subject to every binding item above.

The seven original subsystem plans are:

- `superpowers/plans/2026-09-03-ptf-v1-foundation-plan.md` — Plan 00.
- `superpowers/plans/2026-09-03-ptf-v1-runtime-plan.md` — Plan 01.
- `superpowers/plans/2026-09-03-ptf-v1-x402-plan.md` — Plan 02.
- `superpowers/plans/2026-09-03-ptf-v1-ap2-plan.md` — Plan 03.
- `superpowers/plans/2026-09-03-ptf-v1-openid4vp-plan.md` — Plan 04.
- `superpowers/plans/2026-09-03-ptf-v1-product-surface-plan.md` — Plan 05.
- `superpowers/plans/2026-09-03-ptf-v1-conformance-operations-plan.md` — Plan 06.

`superpowers/plans/2026-09-03-ptf-v1-rewrite-roadmap.md` is historical evidence and is not an execution authority.

## Planning verification results

```text
C10 written-task quality:           65/65 PASS
cross-plan effective consistency:   PASS
foundational planning coverage:     28/28 PASS
product source added on this branch: NO
```

These are planning results, not runtime/conformance execution results.

## Research records

- `research/2026-09-04-x402-2.22.0-api-verification.md` — verified x402 upstream source/API profile.
- `research/2026-09-04-ap2-pinned-api-verification.md` — pinned AP2 upstream API verification.
- `research/2026-09-04-release-toolchain-profile.md` — reviewed release tool/action provenance.

## Review history

- `review/2026-09-03-critical-review-remediation.md` — specification remediation.
- `review/2026-09-04-plan-set-audit.md` — earlier plan review; historical where superseded.
- `review/2026-09-04-plan-task-quality-matrix.md` — current final task-quality record.
- `review/2026-09-04-final-cross-plan-consistency.md` — current interface/standards record.
- `review/2026-09-04-final-28-gate-audit.md` — current spec-fidelity gate record.

## Non-normative terminology

- `../CONTEXT-MAP.md` — glossary only; never overrides the approved specification.

## Engineering workflow

- `agents/issue-tracker.md` — GitHub Issues convention for bounded execution/review work.
- `agents/domain.md` — domain-source routing; prevents duplicate domain authorities.

Do not publish a full implementation-ticket DAG until the required human granularity review has occurred.

## Sole open execution gate

Current verified repository state is:

```text
legacy/webmcp-sandbox -> 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9
webmcp-submit-freeze  -> f94a7bd3a59c440bddded8d6cab2956e595132e3
webmcp-sandbox-v0.1   -> absent
```

Before source implementation the human must explicitly choose:

- **PRESERVE-A:** keep `2ed4020c...` as the approved preservation baseline and create `webmcp-sandbox-v0.1` there; or
- **PRESERVE-B:** rebaseline preservation to `f94a7bd3...`, update the lifecycle record through explicit human approval, and align the legacy branch/tag accordingly.

No agent or implementer may make that choice implicitly.

## After preservation closes

Only after the selected ref/tag preflight succeeds may an execution workflow be selected/confirmed and a source worktree be created. Source tasks then follow the verified Plan 00→06 order, task-local TDD/verification-only rules, and the two-stage reviewer gate before dependent-task release.