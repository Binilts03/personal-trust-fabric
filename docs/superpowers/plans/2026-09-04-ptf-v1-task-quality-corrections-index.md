# PTF v1 Task-Quality Corrections Index — September 4, 2026

Status: **BINDING READING ORDER FOR DETAILED TASK REPAIRS**

The September 4 audit repaired the existing seven subsystem plans without modifying the approved specification blob. The repair documents are cumulative, but later documents supersede conflicting examples in earlier ones.

## Read in this exact order

1. `2026-09-04-ptf-v1-plan-readiness-addendum.md`
2. `2026-09-04-ptf-v1-task-review-protocol.md`
3. `2026-09-04-ptf-v1-final-interface-registry.md`
4. `2026-09-04-ptf-v1-task-quality-corrections.md`
5. `2026-09-04-ptf-v1-task-quality-corrections-2.md`
6. `2026-09-04-ptf-v1-task-quality-corrections-3.md`
7. `2026-09-04-ptf-v1-task-quality-corrections-4.md`
8. `2026-09-04-ptf-v1-task-quality-corrections-5.md`
9. `2026-09-04-ptf-v1-task-quality-corrections-6.md`
10. `2026-09-04-ptf-v1-task-quality-corrections-7.md`
11. `2026-09-04-ptf-v1-plan-set-contract.md` only for corrections not superseded above
12. the relevant original `2026-09-03-ptf-v1-*-plan.md`

## Precedence for implementation planning

```text
approved specification
> accepted ADRs
> readiness addendum
> final interface registry
> later-numbered task-quality correction
> earlier-numbered task-quality correction
> task-review protocol for reviewer gate mechanics
> older plan-set contract
> execution roadmap
> original subsystem plan
```

The task-review protocol is orthogonal to semantic precedence: every task inherits it even when a later semantic correction supersedes an older task example.

## Scope map

```text
corrections      -> initial C10 defects, Plan 01 C5/C6/C4 repair details, Plan 06 oracle sequencing
corrections-2    -> Plan 00 + Plan 01 second-pass repairs; correct 65-task count
corrections-3    -> Plan 02 x402
corrections-4    -> Plan 03 AP2 including plan-bound open mandate issuance
corrections-5    -> Plan 04 OpenID4VP including parser/Hard-Policy separation
corrections-6    -> Plan 05 product surface including trust/device split
corrections-7    -> Plan 06 portability/device/recovery/oracle/CI/release repairs
final registry   -> cross-plan public names/signatures; supersedes conflicting field/name examples everywhere
```

## Fail-closed rule

If two plan documents still appear to disagree after applying this order, do not choose whichever is convenient. Return that exact interface/task to planning and record the contradiction in the task-quality matrix.
