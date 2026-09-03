# ADR 0005 — External Protocols Are Adapters, Not the PTF Authority Model

Status: Accepted  
Date: 2026-09-03

## Context

PTF must interoperate with AP2, x402, OpenID4VP, UCP, MCP, WebMCP, A2A, OAuth, Digital Credentials, and future protocols. Earlier work allowed WebMCP to become the practical implementation target, narrowing the product around a challenge adapter. A second risk is the opposite: inventing a universal PTF protocol or compiler that duplicates emerging standards and freezes abstractions before real integrations prove them.

## Decision

External protocols remain adapters and evidence/execution mechanisms around the PTF core.

Canonical authority is expressed through PTF domain semantics such as Hard Policy, Standing Grant, Action Request, Execution Plan, Execution Grant, and Enforcement Map. Protocol-specific mandates, tokens, presentations, payment payloads, and signed artifacts are **Evidence Artifacts**, not canonical PTF authority objects.

Adapters may interpret external requirements, report native enforcement properties, translate already-authorized Execution Plans, and verify protocol results. They may not create authority, create trust from labels, change Hard Policy, broaden scope, or silently discard constraints.

PTF will implement AP2 and x402 concretely before freezing a shared adapter programming interface. OpenID4VP will serve as a third materially different proving integration.

## Consequences

- PTF remains compatible with whichever external standards win without making one protocol the product boundary.
- The project can contribute interoperability/security improvements upstream instead of replacing existing standards.
- A common adapter seam must be earned from at least two concrete implementations.
- Protocol-native security is reused where available and represented in the Enforcement Map.
- Unknown authority-affecting extension semantics fail closed.
- WebMCP remains an Agent transport adapter rather than an architectural security authority.
