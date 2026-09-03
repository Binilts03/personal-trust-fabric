# ADR 0005 — External Protocols Are Adapters, Not Canonical Authority

Status: **Proposed**

## Context
PTF must interoperate with AP2, x402, OpenID4VP, UCP, OAuth, MCP/WebMCP/A2A, and future protocols without allowing one protocol to define the core domain.

## Decision
If approved, external protocols remain integration/evidence mechanisms. Protocol Adapters interpret requirements, report native enforcement properties, translate already-authorized ExecutionPlans, and verify results; they do not create authority or trust.

## Consequences
AP2 and x402 must be implemented concretely before a universal adapter API is frozen, with OpenID4VP as the third materially different proving integration.

This ADR becomes Accepted only after explicit human approval of the proposed specification.