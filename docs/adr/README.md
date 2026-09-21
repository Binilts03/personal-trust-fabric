# Architecture Decision Records

| ADR                                             | Title                                                                                                          | Status   | Date       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-typescript-strict-zero-dep-core.md) | TypeScript strict, zero-dependency deterministic core                                                          | accepted | 2026-09-08 |
| [0002](0002-policy-constrains-never-creates.md) | Policy constrains, never creates authority                                                                     | accepted | 2026-09-08 |
| [0003](0003-ucan-biscuit-capability-model.md)   | UCAN-style attenuation with Biscuit-style cascade revocation over Ed25519 (local-only; wire internal per 0009) | accepted | 2026-09-08 |
| [0004](0004-disclosure-intersection-binding.md) | Disclosure as intersection with holder binding                                                                 | accepted | 2026-09-08 |
| [0005](0005-external-protocols-as-evidence.md)  | External protocols as evidence, never authority                                                                | accepted | 2026-09-08 |
| [0006](0006-recipient-auth-before-execution.md) | Recipient authentication before protected execution, audit without secrets                                     | accepted | 2026-09-08 |
| [0007](0007-mcp-server-official-sdk.md)         | MCP server as the LLM-facing interface, official SDK as its transport                                          | accepted | 2026-09-12 |
| [0008](0008-file-cas-durable-challenges.md)     | File-CAS durable challenges, SQLite deferred                                                                   | accepted | 2026-09-13 |
| [0009](0009-authority-engine-over-standards.md) | Authority engine over open standards, proprietary wire internal                                                | accepted | 2026-09-13 |
| [0010](0010-domain-neutral-authority.md)        | Domain-neutral authority with verified actor binding and derived digests                                       | accepted | 2026-09-13 |
| [0011](0011-public-surface.md)                  | Curated public surface, internal by packaging                                                                  | accepted | 2026-09-13 |
| [0013](0013-trusted-ingress.md)                 | Trusted identity ingress (VerifiedIdentity; rooted removed; digest by construction)                            | accepted | 2026-09-13 |
| [0014](0014-proposal-durability.md)             | Proposal durability: in-memory fail-closed (supersedes 0008)                                                   | accepted | 2026-09-13 |
| [0015](0015-store-integrity.md)                 | Store integrity via revision CAS + audit freshness binding                                                     | accepted | 2026-09-14 |
| [0016](0016-vault-encryption.md)                | Vault encryption at rest (DEK in keystore, AEAD envelope, plaintext refused)                                   | accepted | 2026-09-17 |
| [0017](0017-durable-proposals.md)               | Durable proposals via file CAS, challenges stay in-memory (amends 0014)                                        | accepted | 2026-09-18 |
| [0018](0018-exact-operation-authorization.md)   | Exact-operation authorization, consume semantics, generic receipt; payment as profile                          | accepted | 2026-09-18 |
| [0019](0019-p3p-interop-spike.md)                 | P3P interop as thin evidence adapter (M5A spike)                                                               | accepted | 2026-09-21 |
| [0020](0020-travel-domain-profile.md)             | Travel as a second domain profile (M7)                                                                         | accepted | 2026-09-21 |
