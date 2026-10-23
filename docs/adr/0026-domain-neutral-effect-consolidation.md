# ADR-0026: Domain-neutral protected-effect consolidation

**Date:** 2026-10-24  
**Status:** proposed (implementation and compatibility gates pending)  
**Scope:** Host Kit, trusted host operation registration, payment and privacy composition

## Context

PTF already has generic Authority requests, protected provider execution, optional privacy narrowing, and a Host Kit, but execution entry points do not share one host-owned ordering contract. The reference MCP host redeems and executes payments; generic action requests only dry-run. The Host Kit currently requires DPDP-backed privacy context even when the use case does not process personal data. `/pay` safeguards also exist inside Authority and local capability validation.

## Decision

Choose **C: one canonical protected-effect implementation with a compatibility adapter**. Reject **A**, silently making existing privacy parameters optional, because this could downgrade enforcement. Reject **B**, a parallel generic engine, because divergent authority consumption, crash recovery, and privacy evidence are unsafe.

* An explicit trusted-host `processing` discriminator chooses `enforced` (runtime and trusted gate) or `not-enforced` (bounded reason, permitted only where the host has no applicable privacy policy). Agent JSON cannot select this mode.
* Preserve `createEffectBoundary` and its required privacy `eventId`; route its implementation through the canonical path only after parity tests prove all nine ordering steps, failure windows and receipts. Do **not** invent an event ID when there is no privacy processing.
* Authorized terms must match the effect-bearing request exactly; recipient signature proof, live Authority, durable consumption, and journaled idempotency remain mandatory. Check-only results never execute.
* Keep the payment ceiling/currency safety checks in Authority and local capabilities until equivalent direct-call and restore tests prove a safe relocation. Maintain `paymentBounds`, AP2, x402 and payment entry points.
* DPDP is a jurisdiction profile of a host-owned optional processing gate; its configured presence never grants authority. `ptf_present_data` remains an intentional selective-disclosure route and is not a no-disclosure API.
* Generic MCP action execution, if introduced, requires a host-registered exact action, trusted provider and input schema, verified ingress, recipient proof, and privacy enforcement if configured; unknown actions deny.

## Compatibility / evidence contract

Existing package subpaths, store formats, public payment semantics, backup/restore, provider receipts, and privacy Processing Event ordering are frozen. Reference synthetic payment, DPDP disclosure and an independent non-payment provider must work without non-public package imports. A successful test run is evidence only for tested surfaces, never a production or legal-compliance certification.

## Residual risks and stop conditions

Reference stdio identity still depends on the launcher, file/CAS storage is not a distributed transaction system, and trusted host callbacks can leak material unless controlled by the host. Unknown external outcomes require reconciliation; never blindly retry. Stop the migration on any privacy downgrade, missing journal replay, incorrect actor binding, double effect, payment-guard regression, broken store compatibility or unverified secret exposure.

Implements/extends ADR-0010 (domain-neutral Authority), ADR-0018 (exact operation), ADR-0024 (privacy narrows), and ADR-0025 (per-host effect enforcement). This ADR becomes accepted only after verified implementation and independent review.
