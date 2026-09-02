# ADR-0003: Closed typed policy evaluator for the first profile

**Date**: 2026-09-02
**Status**: accepted
**Deciders**: Controller
**Requirements**: U-04, U-17, U-20; P4; INV-01, INV-04, INV-07

## Context

The first release needs deterministic recipient/purpose/action/resource/transaction/use/approval constraints. There is no current requirement for arbitrary user-authored policy code, federation with an existing policy estate, or a general query language. Adding a policy engine dependency would enlarge the TCB and challenge schedule without reducing the closed domain logic.

## Decision

Implement a closed, versioned, typed in-process policy model with a pure `Evaluate` interface, explicit deny/approval/allow results, schema validation at input boundaries, and safe structured explanations. Policy documents are data conforming to the closed schema; model-generated code or expressions are never executed.

## Alternatives considered

- Cedar: strong typed authorization candidate; deferred until entity-scale/federation or policy-authoring requirements justify the dependency and conformance work.
- OPA/Rego: mature general policy platform; deferred because a general language and sidecar/bundle lifecycle are unnecessary for the first closed profile.
- Prompt/model policy: rejected by product invariant.

## Security and trust effect

The evaluator stays deterministic, inspectable, and small. Closed schema validation prevents arbitrary expression execution, but implementation bugs remain part of the trusted core.

## Operational effect

No policy service or runtime dependency is required. The interface remains replaceable if a later profile needs an external engine.

## Test obligations

Table/property tests for every supported constraint, explicit deny precedence, version/explanation behavior, invalid schema, and proof that representation choice cannot change deny to allow.

## Consequences and residual risks

Complex policy composition and large-scale administration are deliberately unsupported until required. The supported-profile matrix must prevent “as applicable” from hiding missing constraints.

## Revisit trigger

Human-readable policy authoring, third-party policy interoperability, large entity graphs, or independently audited policy-engine requirements materially exceed the closed evaluator.
