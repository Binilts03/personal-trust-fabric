---
layout: default
title: Architecture
nav_order: 2
permalink: /architecture/
---

# Architecture

PTF separates **who may do what** from **who possesses the secret needed to do it**. Four core planes, each with a single responsibility. Optional host-integrated privacy controls can further narrow decisions for a particular use case without redefining Authority.

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

| Path                          | Responsibility                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/core/authority.ts`       | Grant store, evaluation, attenuation, citations                                                                 |
| `src/core/capability.ts`      | Capability derivation, attenuation, redemption                                                                  |
| `src/core/execute.ts`         | Protected execution, provider orchestration                                                                     |
| `src/core/signing.ts`         | JWS/ED25519, receipt signing                                                                                    |
| `src/core/types.ts`           | Core types, no deps                                                                                             |
| `src/adapters/`               | Protocol translators (evidence → local types)                                                                   |
| `src/store/vault.ts`          | Encrypted records, purpose-scoped access                                                                        |
| `src/store/keystore.ts`       | Key management, DEK rotation                                                                                    |
| `src/store/proposals.ts`      | Durable proposals via file CAS                                                                                  |
| `src/store/audit.ts`          | Hash-chained audit log                                                                                          |
| `src/profiles/payment.ts`     | Payment-specific bounds, recipients                                                                             |
| `src/profiles/data.ts`        | Data disclosure profiles                                                                                        |
| `src/privacy/`                | Optional privacy-control/evidence extension; initial DPDP-informed profile (`mcp.ts` policy, `mcp-host.ts` reference wiring) |
| `src/hostkit/`                | Reusable host effect boundary and its conformance suite (see `docs/host-kit.md`)                                |
| `src/store/privacy.ts`        | Encrypted privacy configuration (DEK-sealed)                                                                    |
| `src/store/privacy-events.ts` | Encrypted Processing Event repository                                                                           |
| `src/cli/privacy*.ts`         | Privacy operator CLI (router, evidence, rights)                                                                 |

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


## Reusable protected-effect seam (proposed consolidation)

`src/hostkit/boundary.ts` now exports one
`createProtectedEffect` ordering implementation plus the compatibility
`createEffectBoundary` adapter. The trusted host chooses a concrete
provider or trusted callback, supplies verified actor identity and
exact effect context, and explicitly selects whether configured privacy
narrowing is enforced. The `./hostkit` public subpath also offers
`createHostRedemptionChallenge` for recipient-signed generic operations;
it wraps the **existing internal** capability format without exposing
sealed capabilities on the wire.

This is an SDK-level consolidation, not proof that all product entry
points already use the same orchestrator. MCP payment and trusted-host registered generic effects now share the
Host Kit protected-effect execution path; payment still has its specialized
approval and presentation adapter. Disclosure, CLI protected-secret use
and independently invoked adapters remain separate surfaces, so this
is not universal interception or enforcement.
See ADR-0026 and the limits register. DPDP remains an optional
`PrivacyProfile` and may only narrow already verified Authority.
