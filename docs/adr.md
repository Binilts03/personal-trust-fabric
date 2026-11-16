---
layout: default
title: Architecture Decision Records
nav_order: 8
permalink: /adr/
---

# Architecture Decision Records

All ADRs live in `docs/adr/` in the repository.

## Index

| ADR                                                     | Title                                                         | Status   |
| ------------------------------------------------------- | ------------------------------------------------------------- | -------- |
| [ADR-0001](0001-typescript-strict-zero-dep-core/)       | TypeScript strict, zero-dependency deterministic core         | Accepted |
| [ADR-0002](0002-policy-constrains-never-creates/)       | Policy constrains, never creates authority                    | Accepted |
| [ADR-0003](0003-ucan-biscuit-capability-model/)         | UCAN-style attenuation with cascade revocation (local-only)   | Accepted |
| [ADR-0004](0004-disclosure-intersection-binding/)       | Disclosure as intersection with holder binding                | Accepted |
| [ADR-0005](0005-external-protocols-as-evidence/)        | External protocols as evidence, never authority               | Accepted |
| [ADR-0006](0006-recipient-auth-before-execution/)       | Recipient authentication before protected execution           | Accepted |
| [ADR-0007](0007-mcp-server-official-sdk/)               | MCP server as the LLM-facing interface                        | Accepted |
| [ADR-0008](0008-file-cas-durable-challenges/)           | File-CAS durable challenges, SQLite deferred                  | Accepted |
| [ADR-0009](0009-authority-engine-over-standards/)       | Authority engine over open standards                          | Accepted |
| [ADR-0010](0010-domain-neutral-authority/)              | Domain-neutral authority with verified actor binding          | Accepted |
| [ADR-0011](0011-public-surface/)                        | Curated public surface, internal by packaging                 | Accepted |
| [ADR-0013](0013-trusted-ingress/)                       | Trusted identity ingress (VerifiedIdentity)                   | Accepted |
| [ADR-0014](0014-proposal-durability/)                   | Durable proposals via file CAS                                | Accepted |
| [ADR-0015](0015-store-integrity/)                       | Store integrity, freshness binding, failure-closed loading    | Accepted |
| [ADR-0016](0016-vault-encryption/)                      | Encrypted Personal State vault with key custody               | Accepted |
| [ADR-0017](0017-durable-proposals/)                     | Durable proposals via file CAS (amends 0014)                  | Accepted |
| [ADR-0018](0018-exact-operation-authorization/)         | Exact-operation authorization and consumption                 | Accepted |
| [ADR-0019](0019-production-architecture-v1/)            | PTF Production Architecture v1                                | Accepted |
| [ADR-0020](0020-p3p-evidence-adapter/)                  | P3P evidence-only adapter                                     | Accepted |
| [ADR-0021](0021-execution-journal/)                     | Durable execution journal                                     | Accepted |
| [ADR-0022](0022-sqlite-wal-decision/)                   | Transactional persistence: SQLite WAL                         | Accepted |
| [ADR-0023](0023-agent-ingress/)                         | Authenticated multi-agent ingress                             | Accepted |
| [ADR-0024](0024-privacy-enforcement-narrows-authority/) | Privacy enforcement narrows authority                         | Accepted |
| [ADR-0025](0025-privacy-enforcement-is-per-host/)       | Privacy enforcement is per-host and explicit                  | Accepted |
| [ADR-0026](0026-domain-neutral-effect-consolidation/)   | Domain-neutral protected-effect consolidation (PR #121)       | Accepted |
| [ADR-0027](0027-conformance-is-an-adoption-gate/)       | The host conformance suite is an adoption gate                | Accepted |
| [ADR-0028](0028-capability-subpath/)                    | The `./capabilities` subpath makes the payment path reachable | Accepted |

## Format

Each ADR follows:

- **Context** — what forces are at play
- **Decision** — what we decided
- **Consequences** — trade-offs, limits, follow-ups
- **Alternatives considered** — what we rejected and why

## Adding an ADR

1. Copy `docs/adr/template.md` (or latest ADR)
2. Number sequentially
3. Write in past tense ("We decided...")
4. Link from this index
5. Architecture changes require an ADR before merge
