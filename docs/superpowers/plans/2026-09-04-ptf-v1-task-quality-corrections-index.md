# PTF v1 Planning Corrections and Strict-C10 Index — September 4, 2026

Status: **BINDING READING ORDER FOR IMPLEMENTATION PLANNING**

The September 4 audit repaired the seven original subsystem plans without modifying the approved specification blob. Later documents supersede only conflicting examples/names in earlier documents. This index is the authoritative read order; an implementer must not select whichever older example is convenient.

## Read in this exact order

### Normative/lifecycle

1. `docs/spec/PTF-V1-APPROVAL.md`
2. `docs/spec/PTF-V1-PROPOSED.md` — exact immutable blob approved by the approval record
3. accepted `docs/adr/`
4. `2026-09-04-ptf-v1-plan-readiness-addendum.md`

### Cross-plan interfaces and task mechanics

5. `2026-09-04-ptf-v1-final-interface-registry.md`
6. `2026-09-04-ptf-v1-interface-registry-addendum.md`
7. `2026-09-04-ptf-v1-task-review-protocol.md`

### Semantic/task corrections — cumulative, later wins on conflict

8. `2026-09-04-ptf-v1-task-quality-corrections.md`
9. `2026-09-04-ptf-v1-task-quality-corrections-2.md`
10. `2026-09-04-ptf-v1-task-quality-corrections-3.md`
11. `2026-09-04-ptf-v1-task-quality-corrections-4.md`
12. `2026-09-04-ptf-v1-task-quality-corrections-5.md`
13. `2026-09-04-ptf-v1-task-quality-corrections-6.md`
14. `2026-09-04-ptf-v1-task-quality-corrections-7.md`
15. `2026-09-04-ptf-v1-task-quality-corrections-8.md`
16. `2026-09-04-ptf-v1-task-quality-corrections-9.md`
17. `2026-09-04-ptf-v1-task-quality-corrections-10.md`

Correction 9 is a Plan 02 upstream-API correction and supersedes conflicting x402 SDK examples regardless of its numeric placement relative to Plan 03–06 corrections. Correction 10 supersedes only the conflicting Plan 06 T7 device-registration and T9 supply-chain details in correction 7.

### Strict C10 executable supplements

18. `2026-09-04-ptf-v1-strict-c10-plan00.md`
19. `2026-09-04-ptf-v1-strict-c10-plan01.md`
20. `2026-09-04-ptf-v1-strict-c10-plan01-fixes.md`
21. `2026-09-04-ptf-v1-strict-c10-plan02.md`
22. `2026-09-04-ptf-v1-strict-c10-plan03.md`
23. `2026-09-04-ptf-v1-strict-c10-plan04.md`
24. `2026-09-04-ptf-v1-strict-c10-plan05.md`
25. `2026-09-04-ptf-v1-strict-c10-plan06.md`

Strict supplements supply concrete executable fixtures/code where an older task used prose or shorthand. They do **not** override the final interface registry or a later semantic correction. If a strict snippet conflicts with the registry/corrections above, planning is not ready and that exact task returns to review.

### Older contracts/plans

26. `2026-09-04-ptf-v1-plan-set-contract.md` only for content not superseded above
27. `2026-09-04-ptf-v1-execution-roadmap.md` for dependency order only
28. the relevant original `2026-09-03-ptf-v1-*-plan.md`
29. `CONTEXT-MAP.md` as non-normative terminology/context only

The historical `2026-09-03-ptf-v1-rewrite-roadmap.md` is not an execution authority.

---

## Precedence rule

```text
approved spec blob + approval record
> accepted ADRs
> readiness/lifecycle addendum
> final interface registry + registry addendum
> later applicable semantic correction
> earlier applicable semantic correction
> strict-C10 executable supplement (within the interfaces/semantics above)
> task-review protocol for acceptance mechanics
> older plan-set contract
> execution roadmap dependency order
> original subsystem plan
> non-normative context
```

The task-review protocol is orthogonal: every executable task inherits its two-stage reviewer acceptance gate regardless of which semantic correction applies.

---

## Scope map

```text
corrections      -> initial C10 defects; inserted Plan 01 C5/C6/C4; Plan 06 oracle sequencing
corrections-2    -> Plan 00 + Plan 01 second pass; correct 65-unit task count
corrections-3    -> Plan 02 x402 task-quality repairs
corrections-4    -> Plan 03 AP2; plan-bound open mandate issuance
corrections-5    -> Plan 04 OpenID4VP; parser/Hard-Policy separation
corrections-6    -> Plan 05; TrustRelation administration and device deferral
corrections-7    -> Plan 06 portability/device/recovery/oracle/CI/release structure
corrections-8    -> final cross-plan interface ownership and corrected canonical names
corrections-9    -> verified x402 2.22.0 source/API; forbids guessed fallback SDK calls
corrections-10   -> exact Plan 06 WebAuthn device-registration owner + reviewed release toolchain pins
registry         -> single public name/signature oracle
registry addendum-> complete Personal State/Audit constructors used by strict tests
strict 00–06     -> executable tests/red commands/minimal code shapes for every plan
```

Primary-source protocol/tool research used by strict tasks includes:

```text
docs/research/2026-09-04-x402-2.22.0-api-verification.md
docs/research/2026-09-04-ap2-pinned-api-verification.md
docs/research/2026-09-04-release-toolchain-profile.md
```

---

## Task universe

```text
Plan 00:  8 original tasks
Plan 01: 11 original tasks + 3 inserted units (T6A/T6B/T6C)
Plan 02:  8 original tasks
Plan 03:  9 original tasks
Plan 04:  8 original tasks
Plan 05:  8 original tasks
Plan 06: 10 original tasks
--------------------------------
Total executable task units: 65
```

Any document still stating 61 original / 64 total is historical and must not be used for readiness accounting.

---

## Fail-closed rule

If two documents still appear to disagree after applying this order, do not resolve the ambiguity during coding. Record the exact contradiction in the task-quality matrix and return the task to planning.

No source implementation begins until the final matrix and 28-gate audit pass and the separate repository-preservation decision/tag gate in the readiness addendum is resolved.