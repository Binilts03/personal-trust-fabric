# ADR 0002 — Plan-Bound Execution and Enforcement Map

Status: **Proposed**

## Context
Approval of an abstract action is insufficient when recipient, disclosure route, protocol, executor, or downgrade can change after approval.

## Decision
If approved, final Exact Human Approval binds the canonical selected ExecutionPlan fingerprint. Every authority-relevant constraint must have a total Enforcement Map assignment or an explicit unenforceable/downgrade outcome.

## Consequences
Material mutation requires re-resolution/reapproval. Protocol adapters cannot silently discard constraints. Conformance tests target the public planning/execution seams.

This ADR becomes Accepted only after explicit human approval of the proposed specification.