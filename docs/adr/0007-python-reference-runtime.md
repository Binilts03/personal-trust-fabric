# ADR 0007 — Python-First Reference Runtime

Status: **Accepted for v1 reference implementation**

## Context
The first proving integrations are x402, AP2, and OpenID4VP. AP2's official SDK is Python-first and x402 provides a maintained Python v2 SDK. Reimplementing AP2 schemas in TypeScript before proving the core would add protocol-translation risk.

## Decision
Use Python 3.14.7 + uv for the PTF v1 reference runtime. Protocol-neutral semantics remain independent of Python. Node.js 24 LTS/TypeScript is reserved for the later reference Trusted Surface and TypeScript Agent SDK.

## Consequences
Protocol adapters can use official upstream Python implementations during falsification. The public protocol semantics remain language-neutral and a future runtime implementation may use another language if it passes the same conformance suite.
