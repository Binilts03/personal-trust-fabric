# ADR-0006: Versioned approval-terms encoding and digest

**Date**: 2026-09-02
**Status**: proposed
**Deciders**: Controller after threat-driven tests; Human for approval-surface semantics
**Requirements**: P4, P5; INV-06; S-03, S-06

## Context

Approval must bind every semantically relevant term while handling irrelevant input representation predictably. Raw request JSON is unstable; a digest alone is not authority and does not define semantic equality.

## Proposed decision

Parse boundary input into a closed typed `ApprovalTermsV1` record with normalized identifiers, explicit optional/null semantics, monetary amounts in integer minor units plus uppercase ISO currency, UTC epoch times, sorted claim/scope sets, and a fixed field-order encoder. Store the encoded terms as authoritative approval evidence and compute SHA-256 only as a compact correlation/integrity digest. Execution reconstructs and compares typed encoded terms; it does not trust a caller-supplied digest.

## Alternatives considered

- Hash raw JSON: rejected because key order, number/text representation, and omitted/null differences are ambiguous.
- Generic JSON canonicalization such as JCS: established and useful for interoperable signed JSON, but the closed domain still needs semantic normalization and money/set rules.
- Deterministic CBOR: compact and standards-based, but adds encoding/conformance work without an M0 wire requirement.

## Security and trust effect

Material mutation invalidates approval and irrelevant transport formatting normalizes at the boundary. SHA-256 is an established hash, not a new authorization token or cryptographic construction.

## Operational effect

Every approval schema version needs migration/compatibility tests. Unknown fields fail validation rather than silently escaping the binding.

## Test obligations

Property/table tests for every relevant mutation, key/input ordering, set ordering, Unicode and identifier normalization policy, omitted/null, integer bounds, currency/amount, timestamp precision, unknown fields, and cross-runtime fixtures.

## Consequences and residual risks

Purpose truthfulness and recipient behavior after legitimate disclosure are not solved. Unicode/identifier normalization and supported money profiles require standards and security review before acceptance.

## Revisit trigger

Cross-implementation signing/proof requires an established canonical wire format or current tests expose ambiguity.
