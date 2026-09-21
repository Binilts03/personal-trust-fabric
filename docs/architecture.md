---
layout: default
title: Architecture
nav_order: 2
permalink: /architecture/
---

# Architecture

PTF separates **who may do what** from **who possesses the secret needed to do it**. Four planes, each with a single responsibility.

## Four Planes

```text
┌─────────────────────────────────────────────────────────────────┐
│                     PROTOCOL EDGE                               │
│  AP2 • x402 • OAuth-agent • OpenID4VP/SD-JWT • MCP/WebMCP      │
│  A2A • AuthZEN PDP                                              │
│  External messages = evidence, never authority                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ validated, re-checked locally
┌──────────────────────────▼──────────────────────────────────────┐
│                   PROTECTED EXECUTION                           │
│  src/core/execute.ts  •  src/adapters/providers.ts             │
│  Credentials & instruments used INSIDE PTF                      │
│  Outward: sanitized instructions + secret-free receipts         │
└──────────────────────────┬──────────────────────────────────────┘
                           │ authorized ops only
┌──────────────────────────▼──────────────────────────────────────┐
│                      AUTHORITY PLANE                            │
│  src/core/ — zero deps (node:crypto only)                       │
│  Standing grants + digest-bound one-time approvals              │
│  Policies narrow only; attenuation: child ≤ parent              │
│  Recipient auth before execution                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ constrained reads
┌──────────────────────────▼──────────────────────────────────────┐
│                   PERSONAL STATE PLANE                          │
│  src/store/vault.ts — AES-256-GCM under keystore DEK            │
│  Purpose/agent/expiry/sensitivity scoped                        │
│  No generic read: every access = constrained, audited request   │
└─────────────────────────────────────────────────────────────────┘
```

## Three Flows Cover Everything

| Flow         | Agent Asks                         | PTF Returns                                              |
| ------------ | ---------------------------------- | -------------------------------------------------------- |
| **Disclose** | "Give me claim X"                  | Minimal approved claim (holder-bound, nonce, single-use) |
| **Execute**  | "Do action Y"                      | Internal execution → secret-free receipt                 |
| **Approve**  | "May I do Z on these exact terms?" | Person approves/denies; any change = new approval        |

## Non-Negotiable Invariants

1. **Policy constrains; never creates authority**
2. **Personal State ≠ Authority State**
3. **Use without possession** — raw secrets never cross to agent, receipt, log, audit
4. **Authority attenuates only** — child ≤ parent, exact recipient/terms binding, bounded expiry/uses
5. **Disclosure = requested ∩ available ∩ allowed**
6. **External protocols = evidence or requests, never authority**
7. **CHECK ≠ REDEEM ≠ EXECUTE** — dry-run values not executable
8. **Effect-bearing provider context = authorized operation exactly**
9. **Durable authority consumption before external effect**
10. **Honest limits in `docs/audit/limits.md` — do not hide them**

## Module Map

| Path                      | Responsibility                                  |
| ------------------------- | ----------------------------------------------- |
| `src/core/authority.ts`   | Grant store, evaluation, attenuation, citations |
| `src/core/capability.ts`  | Capability derivation, attenuation, redemption  |
| `src/core/execute.ts`     | Protected execution, provider orchestration     |
| `src/core/signing.ts`     | JWS/ED25519, receipt signing                    |
| `src/core/types.ts`       | Core types, no deps                             |
| `src/adapters/`           | Protocol translators (evidence → local types)   |
| `src/store/vault.ts`      | Encrypted records, purpose-scoped access        |
| `src/store/keystore.ts`   | Key management, DEK rotation                    |
| `src/store/proposals.ts`  | Durable proposals via file CAS                  |
| `src/store/audit.ts`      | Hash-chained audit log                          |
| `src/profiles/payment.ts` | Payment-specific bounds, recipients             |
| `src/profiles/travel.ts`  | Travel booking bounds (`/travel/book` conventions, M7) |
| `src/adapters/p3p.ts`     | P3P challenge → `/pay` demand, receipt check (spike, M5A) |
| `src/profiles/data.ts`    | Data disclosure profiles                        |

## Public Seam

All external consumption goes through `src/index.ts` — tests import only from there. Internal modules are not part of the public API.

## Verification

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
```

Architecture changes require an ADR in `docs/adr/`.
