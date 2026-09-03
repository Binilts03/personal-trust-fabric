# ADR 0005 — External Protocols Are Adapters, Not Canonical Authority

Status: **Accepted**

## Context
PTF must interoperate with AP2, x402, OpenID4VP, UCP, OAuth, MCP/WebMCP/A2A, and future protocols without allowing one protocol to define the core domain.

## Decision
External protocols remain integration/evidence mechanisms. Protocol Adapters interpret requirements, report native enforcement properties, translate already-authorized ExecutionPlans, and verify results; they do not create authority or trust.

## Consequences
AP2 and x402 must be implemented concretely before a universal adapter API is frozen, with OpenID4VP as the third materially different proving integration. See `docs/spec/PTF-V1-APPROVAL.md` for the exact approved specification blob.
