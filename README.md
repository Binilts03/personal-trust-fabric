# Personal Trust Fabric — v1 Architecture and Implementation Planning

This branch is the **documentation-only PTF v1 planning branch**.

The PTF v1 formal specification has been explicitly human-approved. The approved specification file is intentionally preserved unchanged; `docs/spec/PTF-V1-APPROVAL.md` identifies the exact approved blob.

## Current state

```text
SPECIFICATION:                    APPROVED
IMPLEMENTATION PLANNING:          VERIFIED
C10 TASK QUALITY:                 65/65 PASS
CROSS-PLAN CONSISTENCY:           PASS
FOUNDATIONAL GATE COVERAGE:       28/28 PASS AT PLANNING LEVEL
REPOSITORY PRESERVATION DECISION: HUMAN DECISION PENDING
webmcp-sandbox-v0.1:              ABSENT UNTIL PRESERVATION CHOICE
SOURCE IMPLEMENTATION:            NOT AUTHORIZED
```

Planning verification does **not** mean implementation exists or runtime/conformance tests have passed. It means the written source plan is complete enough to execute without inventing missing security semantics once the separate preservation gate is closed.

## Canonical reading order

Read these first:

1. `docs/spec/PTF-V1-APPROVAL.md` — approval/lifecycle record.
2. `docs/spec/PTF-V1-PROPOSED.md` — immutable approved specification blob.
3. accepted `docs/adr/`.
4. `docs/superpowers/plans/2026-09-04-ptf-v1-plan-readiness-addendum.md` — current readiness state and the sole open preservation decision.
5. `docs/superpowers/plans/2026-09-04-ptf-v1-task-quality-corrections-index.md` — authoritative precedence/read order through correction 11 and final strict fixture closure.
6. `docs/superpowers/plans/2026-09-04-ptf-v1-final-interface-registry.md` + interface-registry addendum — public name/signature oracle.
7. `docs/superpowers/plans/2026-09-04-ptf-v1-task-review-protocol.md` — inherited two-stage reviewer gate.
8. `docs/review/2026-09-04-plan-task-quality-matrix.md` — final 65-task C10 matrix.
9. `docs/review/2026-09-04-final-cross-plan-consistency.md` — final standards/interface review.
10. `docs/review/2026-09-04-final-28-gate-audit.md` — final approved-spec gate map.
11. `docs/superpowers/plans/2026-09-04-ptf-v1-execution-roadmap.md` — dependency order only.
12. the relevant original 2026-09-03 subsystem plan, read subject to all binding documents above.

`CONTEXT-MAP.md` is non-normative. The 2026-09-03 rewrite roadmap and earlier review reports are historical planning evidence, not current execution authority.

## Remaining hard gate

The current lifecycle record preserves:

```text
legacy/webmcp-sandbox -> 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9
```

A later synthetic submission state is separately frozen at:

```text
webmcp-submit-freeze -> f94a7bd3a59c440bddded8d6cab2956e595132e3
```

The required `webmcp-sandbox-v0.1` tag is absent. Before source work, the human must explicitly select **PRESERVE-A** (keep `2ed4020c...` as the approved preservation baseline) or **PRESERVE-B** (formally rebaseline preservation to `f94a7bd3...`, including the required lifecycle-record amendment). See the readiness addendum for exact consequences and Git preflight commands.

## Product boundary

The full approved PTF specification is the product boundary. x402, AP2, OpenID4VP, WebMCP/MCP/A2A, a payment flow, credential presentation, Trusted Surface, conformance fixture, or demonstration exists to prove or falsify PTF—not to redefine it.

No Personal State, learned preference, model confidence, protocol validity, payment success, repeated approval, display label, or protocol artifact may silently create or broaden authority or trust.