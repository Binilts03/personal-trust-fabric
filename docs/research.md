---
layout: default
title: Research
nav_order: 7
permalink: /research/
---

# Research & Protocol Deep Dives

Standards analysis, interop research, and protocol mappings that inform PTF's adapter layer.

## Papers

| Title                                                                         | Focus                                          | Status   |
| ----------------------------------------------------------------------------- | ---------------------------------------------- | -------- |
| [Agentic Commerce Protocols](2026-09-08-agentic-commerce-protocols/)          | x402, AP2, MCP, A2A, AuthZEN landscape         | Complete |
| [Deep Delegation Policy](2026-09-09-deep-delegation-policy/)                  | OAuth 2.0 Rich Authz Requests, RAR, GNAP       | Complete |
| [Deep Identity (OpenID4VP/SD-JWT)](2026-09-09-deep-identity-openid4vp-sdjwt/) | Verifiable presentations, selective disclosure | Complete |
| [Deep Interop (MCP/WebMCP/A2A)](2026-09-09-deep-interop-mcp-webmcp-a2a/)      | Agent-to-agent, tool transport, card specs     | Complete |
| [Deep Payments (x402/AP2)](2026-09-09-deep-payments-x402-ap2/)                | 402 Payment Required, payment authorization    | Complete |
| [AuthZEN PDP Transport](2026-09-13-authzen-pdp-transport/)                    | Policy decision point integration patterns     | Complete |
| [Cross-Vendor Proof](2026-09-13-cross-vendor-proof/)                          | Interop verification across implementations    | Complete |

## Adapter Coverage

| Adapter                       | Protocol                     | PTF Role                                        |
| ----------------------------- | ---------------------------- | ----------------------------------------------- |
| `src/adapters/x402.ts`        | x402 (402 Payment Required)  | Evidence translator → local execution           |
| `src/adapters/ap2.ts`         | AP2 (Agent Payment Protocol) | Evidence translator → local execution           |
| `src/adapters/oauth-agent.ts` | OAuth 2.0 + RAR for agents   | Token exchange evidence                         |
| `src/adapters/openid4vp.ts`   | OpenID4VP / SD-JWT VC        | Presentation verification                       |
| `src/adapters/mcp.ts`         | MCP / WebMCP                 | Tool transport (server speaks for one identity) |
| `src/adapters/a2a.ts`         | A2A (Agent-to-Agent)         | Card/task/push validation                       |
| `src/adapters/authzen.ts`     | AuthZEN PDP                  | Policy decision evidence                        |

## Key Principle

> **External messages are evidence, never authority.**

Every adapter re-validates locally. No external protocol mints PTF authority.
