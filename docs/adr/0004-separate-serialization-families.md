# ADR-0004: Separate allowlisted serialization families

**Date**: 2026-09-02
**Status**: accepted
**Deciders**: Controller
**Requirements**: U-04, U-05, U-19, U-23; P2, P10, P13; S-01, S-07

## Context

Reusing canonical records for agents, UI, recipients, errors, logs, audit, or sync makes one accidental field addition an exfiltration path. The specification already identifies model-facing serialization as a security boundary.

## Decision

Maintain distinct, versioned DTO/schema constructors for canonical trusted records, agent-safe views, user UI, recipient requests/results, audit/receipts, and sync envelopes. Every outward DTO is constructed from an explicit allowlist; generic serialization of canonical records is forbidden at those boundaries.

## Alternatives considered

- One record type with omit/redaction helpers: rejected because denylist omissions fail open as schemas evolve.
- Runtime reflection/annotations: rejected for the first profile because it hides security-relevant field flow behind generic machinery.

## Security and trust effect

New canonical fields do not automatically become model/log visible. Separate schemas also make canary and property tests observable.

## Operational effect

There is intentional mapping code and schema-version work. This duplication is a security boundary, not accidental boilerplate.

## Test obligations

- Property/canary tests for every outward family, including error/debug paths.
- Architecture lint forbids direct canonical-record serialization/imports in adapters/UI/logging.
- Schema migration and compatibility fixtures.

## Consequences and residual risks

Incorrect allowlists can still leak or omit data; tests cover only instrumented surfaces and cannot claim visibility into undocumented provider internals.

## Revisit trigger

A typed code generator can produce equally explicit allowlists and improves audited traceability without weakening the boundary.
