---
layout: default
title: Research
nav_order: 7
permalink: /research/
---

# Research & Protocol Deep Dives

Protocol mappings that inform PTF's adapter layer. The long-form research
notebooks were deliberately removed from the public repository
(public-surface minimization); nothing below links to them.

## Adapter Coverage

| Adapter                       | Protocol                     | PTF Role                                        |
| ----------------------------- | ---------------------------- | ----------------------------------------------- |
| `src/adapters/x402.ts`        | x402 (402 Payment Required)  | Evidence translator → local execution           |
| `src/adapters/ap2.ts`         | AP2 (Agent Payment Protocol) | Evidence translator → local execution           |
| `src/adapters/p3p.ts`         | P3P (Pine Labs protocol)     | Evidence translator → local execution (spike)   |
| `src/adapters/oauth-agent.ts` | OAuth 2.0 + RAR for agents   | Token exchange evidence                         |
| `src/adapters/openid4vp.ts`   | OpenID4VP / SD-JWT VC        | Presentation verification                       |
| `src/adapters/mcp.ts`         | MCP / WebMCP                 | Tool transport (server speaks for one identity) |
| `src/adapters/a2a.ts`         | A2A (Agent-to-Agent)         | Card/task/push validation                       |
| `src/adapters/authzen.ts`     | AuthZEN PDP                  | Policy decision evidence                        |

## Key Principle

> **External messages are evidence, never authority.**

Every adapter re-validates locally. No external protocol mints PTF authority.
