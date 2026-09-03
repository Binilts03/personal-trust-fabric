# ADR 0002 — Plan-Bound Execution and Enforcement Map

Status: **Accepted**

## Context
Approval of an abstract action is insufficient when recipient, disclosure route, protocol, executor, or downgrade can change after approval.

## Decision
Final Exact Human Approval binds the canonical selected ExecutionPlan fingerprint. Every authority-relevant constraint must have a total Enforcement Map assignment or an explicit unenforceable/downgrade outcome.

## Consequences
Material mutation requires re-resolution/reapproval. Protocol adapters cannot silently discard constraints. Conformance tests target the public planning/execution seams. See `docs/spec/PTF-V1-APPROVAL.md` for the exact approved specification blob.
