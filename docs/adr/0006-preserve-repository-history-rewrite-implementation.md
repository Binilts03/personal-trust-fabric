# ADR 0006 — Preserve Repository History, Rewrite the Implementation

Status: Accepted  
Date: 2026-09-03

## Context

The current repository contains a coherent synthetic WebMCP sandbox, but it embodies a milestone architecture rather than the approved full PTF architecture. Extending it incrementally would bias future work toward its existing assumptions: in-memory capability runtime, synthetic recipient proof, provider injection, WebMCP-centered Agent surface, and demo-oriented documentation. Creating a completely unrelated repository, however, would discard useful public provenance and the historical record of how PTF evolved.

## Decision

Keep the existing `Binilts03/personal-trust-fabric` repository as the canonical project repository, but treat the next implementation as a clean rewrite from the approved PTF specification.

Before replacing `main`, preserve the pre-rewrite synthetic milestone using an immutable tag and/or dedicated legacy branch.

Reuse project concepts or code only when they are independently justified by the new specification and pass the new architecture/conformance tests. Existing source layout and module interfaces have no grandfathered status.

The architecture specification, context map, ADRs, threat model, and conformance requirements become the source of truth for the rewrite.

## Consequences

- Public project history and genuine authorship/provenance remain continuous.
- Future implementation agents are not forced to retrofit production semantics into demo module boundaries.
- Existing useful experiments such as safe-view filtering, transaction-term hashing, provenance, leakage canaries, recipient-redirection denial, and one-use testing may inform the rewrite but must be revalidated.
- `main` will eventually cease describing the WebMCP sandbox and become the architecture-led PTF reference implementation.
- The legacy milestone remains accessible for historical comparison without constraining the new codebase.
