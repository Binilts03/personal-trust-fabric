---
layout: default
title: Architecture Decision Records
nav_order: 8
permalink: /adr/
---

# Architecture Decision Records

All ADRs live in `docs/adr/` in the repository.

## Index

| ADR                   | Title                                        | Status   |
| --------------------- | -------------------------------------------- | -------- |
| [ADR-0001](adr-0001/) | Record architecture decisions                | Accepted |
| [ADR-0002](adr-0002/) | Zero-dependency authority core               | Accepted |
| [ADR-0003](adr-0003/) | Personal State ≠ Authority State             | Accepted |
| [ADR-0004](adr-0004/) | Use without possession                       | Accepted |
| [ADR-0005](adr-0005/) | Capability attenuation only                  | Accepted |
| [ADR-0006](adr-0006/) | Disclosure = requested ∩ available ∩ allowed | Accepted |
| [ADR-0007](adr-0007/) | External protocols = evidence                | Accepted |
| [ADR-0008](adr-0008/) | CHECK ≠ REDEEM ≠ EXECUTE                     | Accepted |
| [ADR-0009](adr-0009/) | Authority engine over open standards         | Accepted |
| [ADR-0010](adr-0010/) | Exact-operation authorization                | Accepted |
| [ADR-0011](adr-0011/) | Public surface: execute.ts + adapters        | Accepted |
| [ADR-0012](adr-0012/) | Durable proposals via file CAS               | Accepted |
| [ADR-0013](adr-0013/) | Encrypted vault with freshness binding       | Accepted |
| [ADR-0014](adr-0014/) | Hash-chained audit log                       | Accepted |
| [ADR-0015](adr-0015/) | MCP server: one identity pinned              | Accepted |
| [ADR-0016](adr-0016/) | No approve tool in MCP                       | Accepted |
| [ADR-0017](adr-0017/) | Brand: Authority Manifest v1                 | Accepted |
| [ADR-0018](adr-0018/) | Exact-operation authorization (revised)      | Accepted |

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
