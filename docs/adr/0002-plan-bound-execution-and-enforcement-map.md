# ADR 0002 — Plan-Bound Execution and Enforcement Map

Status: Accepted  
Date: 2026-09-03

## Context

A consequential action can be authorized correctly at a high level and still become unsafe during protocol translation. Recipient, amount, disclosure mode, executor, transaction, or assurance may change after the user thinks they have approved the action. External protocols also express different subsets of PTF's constraints, creating a risk that adapters silently drop semantics they cannot represent.

Approving only an abstract Action Request is therefore insufficient when the actual route may introduce additional disclosure, weaker custody, a different recipient endpoint, or another protocol-specific limitation.

## Decision

PTF performs candidate execution/disclosure planning before final Exact Human Approval where approval is required.

Final approval binds the exact selected **ExecutionPlan fingerprint**.

Every authority-relevant constraint MUST appear in an **Enforcement Map** that states whether the constraint is enforced by PTF, the protocol, the Protected Executor, the recipient, a composite of those parties, or is unenforceable.

An authority-relevant constraint may not silently disappear. A mandatory unenforceable constraint causes denial unless an explicitly permitted downgrade is surfaced and approved according to Hard Policy.

Material mutation of recipient, amount, protected resource, requested disclosure, protocol, executor, purpose, transaction, assurance, or downgrade state invalidates the previous approval/Execution Grant.

## Consequences

- Approval UI must render canonical plan terms, not merely Agent-authored prose.
- Protocol adapters must report their real enforcement capabilities and limitations.
- Conformance tests can attack semantic loss directly.
- PTF can interoperate with protocols that do not encode every PTF constraint by retaining some enforcement locally, provided no required constraint disappears.
- "Supports protocol X" is not sufficient evidence of preserved authority semantics.
