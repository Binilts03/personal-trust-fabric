---
layout: default
title: Production v1 roadmap
nav_order: 8
permalink: /roadmap/production-v1/
---

# Production v1 roadmap

The first production target is a **Personal Authority Node**: a
user-controlled PTF instance serving multiple authenticated agents for one
authority owner or tightly controlled authority domain. A future
hosted/multi-tenant service is a separate deployment profile and does not
drive v1 scope.

PTF v1 may be called production-ready only when every item below is
**implemented + tested**, or explicitly **de-scoped** with rationale, threat
analysis, deployment restriction, and documented residual risk. Until then,
`main` remains a tested reference implementation — see
[docs/audit/limits.md](../audit/limits) for the honest ceilings.

Non-negotiable invariants (never traded for convenience): policy constrains
but never creates authority; Personal State is not Authority State;
CHECK ≠ REDEEM ≠ EXECUTE; use without possession (raw secrets never reach
agents, receipts, logs, or audit); authority attenuates only; external
messages are evidence, never authority.

## Reference integration checkpoint — 2026-11-15

The original Phase 0 backlog predates the merged Host Kit/MCP consolidation. The repository now implements deterministic Authority, a protected local vault, a durable execution journal, local authenticated agent registry, registered non-payment MCP effects, synthetic email and GitHub Issues REST request handling exercised with controlled HTTP responses.

This is **reference-level test evidence, not independent deployment proof**. Remaining production gates include authorized live-provider UAT, independent host adoption, authenticated remote ingress and custody, crash/reconciliation exercises, a normative spec and portable conformance vectors, and external security review. An npm developer prerelease is not production v1.

## Gap assessment (updated from Phase 0)

Classification per ceiling:

- **BLOCKS-V1** — must be resolved before any consequential deployment.
- **HOSTED-ONLY** — blocks a future multi-tenant service, not the node.
- **RESIDUAL** — acceptable documented residual for v1.
- **RESOLVED** — already implemented and tested on `main`.
- **EXPERIMENT** — needs a bounded experiment before the decision.

| #   | Gap / ceiling                                                                                                        | Class       | Notes                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1 | Documentation build stability | RESOLVED | Required CI documentation build passed on the PR #121 merge; keep it a gate. |
| G2 | Live external provider acceptance absent | BLOCKS-V1 | GitHub Issues adapter implements REST request/response checks; tests use injected HTTP and do not create a live issue. |
| G3 | Journal implemented, independently tested recovery still incomplete | BLOCKS-V1 | Journal-first replay and outcome-unknown quarantine are implemented; external reconciliation and atomicity across privacy/Authority/provider require host proof. |
| G4  | File/CAS backend unproven for atomic authority + journal + replay state                                              | EXPERIMENT  | ADR must compare file/CAS vs SQLite WAL (likely for the node) vs alternatives; authority engine stays storage-independent behind repositories; file backend retained as reference.                                                                                 |
| G5 | Local authenticated agent registry exists; remote ingress unproven | BLOCKS-V1 | Registry-bound authentication and actor rechecks exist; production network ingress, isolation and rate limits remain. |
| G6  | CLI-only approval; no trusted human surface                                                                          | BLOCKS-V1   | Needs a deterministic, LLM-free approval surface (review / grant / approve-once / deny / revoke / freeze / receipts / audit), untrusted content escaped, WebAuthn/passkey for high-risk approvals.                                                                 |
| G7 | Second reference domain implemented, live non-payment acceptance outstanding | BLOCKS-V1 | Synthetic email and opt-in GitHub Issues adapter use the shared protected-effect path; independent provider/host evidence is not available. |
| G8  | No normative spec                                                                                                    | BLOCKS-V1   | After G2 + G7: extract `docs/spec/` in RFC-2119 language (authority semantics only; no provider fields, schemas, or CLI/MCP naming).                                                                                                                               |
| G9  | No frozen conformance vectors + independent verifier                                                                 | BLOCKS-V1   | Portable JSON vectors (ALLOW + DENY) plus a second-language verifier proving spec-implementability, not just library correctness.                                                                                                                                  |
| G10 | File keystore is the only custody; no production `KeyProvider`                                                       | BLOCKS-V1   | Keep file keystore as reference; implement one real provider (OS keychain favored for the node), sign-inside-provider where possible, document what enters Node memory.                                                                                            |
| G11 | Replay/nonce state partly host-owned and in-memory                                                                   | BLOCKS-V1   | Persist used nonces, challenges, and idempotency keys where semantics require restart durability; `redeem → restart → replay → DENY` tested.                                                                                                                       |
| G12 | Audit is tamper-evident but locally anchored only; full rollback undetectable                                        | BLOCKS-V1   | Needs an optional `AuditWitness` interface (external checkpoint/verify) with at least one append-only/WORM/transparency implementation; core stays witness-agnostic.                                                                                               |
| G13 | No structured observability; redaction is convention                                                                 | BLOCKS-V1   | Health/readiness, auth counts, deny categories, execution states, reconciliation backlog; stable opaque IDs; OpenTelemetry if fitting; log-redaction property tests. Never emit credentials, bearer values, Personal State, or card/grant secrets.                 |
| G14 | No execution benchmark                                                                                               | BLOCKS-V1   | Harness measuring normalize / CHECK / REDEEM / consume / credential-create / provider round-trip / verify / persist (p50/p95/p99, realistic concurrency). No marketing claims without empirical support.                                                           |
| G15 | No chaos/failure-injection coverage                                                                                  | BLOCKS-V1   | Crash points, disk-full, corrupt store/DB, clock changes, provider 500/timeout, duplicate webhooks/receipts, revocation mid-execution — each with safe state + recovery procedure.                                                                                 |
| G16 | Adversarial coverage + supply-chain gaps                                                                             | BLOCKS-V1   | Parser/JWS fuzzing, canonicalization collisions, Unicode, prototype pollution, SSRF/redirect/DNS-rebinding, exhaustion, audit/receipt/log injection, identity spoofing, concurrent redeem; CodeQL, secret scanning, Scorecard, SBOM, provenance, artifact signing. |
| G17 | Local installable tarball verified; registry/service distribution incomplete | BLOCKS-V1 | CI packs and installs the public interfaces; npm ownership, prerelease publication, operational installer and deployment proof remain. |
| G18 | npm release engineering incomplete | BLOCKS-V1 | Stage experimental version; recheck npm ownership, tarball, audit, version/tag history, first-publish bootstrap and provenance before owner-approved release. |
| G19 | No independent security review                                                                                       | BLOCKS-V1   | Reviewers get threat model, limits, ADRs, spec, vectors, deployment guide, residuals, reproductions. No open P0/P1 at v1; P2 fixed or accepted-risk.                                                                                                               |
| G20 | Concurrent unlimited-use redeem can double-execute (CAS is a backstop, single-writer is the topology)                | BLOCKS-V1   | Mitigation order stands: single-writer topology, maxUses-bounded grants / one-time approvals, single-use redeem capabilities. G3's journal + idempotency is the durable fix.                                                                                       |
| G21 | Audit/detail secret-freedom is host-enforced convention                                                              | RESIDUAL    | Core never emits secrets; sentinel tests cover exercised paths. G13 redaction tests shrink the convention surface. Host `detail`/context discipline remains operator duty.                                                                                         |
| G22 | Metadata-bag effectfulness is unenforced convention                                                                  | RESIDUAL    | `metadata` is never compared or receipted; hosts must ensure it cannot alter external effects. Documented in threat model and limits.                                                                                                                              |
| G23 | Short-scalar secrets (PINs) indistinguishable in string receipt fields                                               | RESIDUAL    | Keep short scalars out of string-typed receipt fields. Documented accepted risk.                                                                                                                                                                                   |
| G24 | JS heap erasure best-effort; GC/immutable strings                                                                    | RESIDUAL    | Treat heap as sensitive. Cannot be fixed in JavaScript; documented.                                                                                                                                                                                                |
| G25 | Backup unit holds ciphertext + DEK together                                                                          | RESIDUAL    | Protect backup media; rotate on exposure; `KeyProvider` separation (G10) is the structural fix. Documented runbook duty.                                                                                                                                           |
| G26 | MCP per-client OAuth duties (consent/PKCE/state/cookies/scopes)                                                      | HOSTED-ONLY | Outside single-operator v1; host duties documented.                                                                                                                                                                                                                |
| G27 | Multi-tenant isolation, per-tenant rate limiting                                                                     | HOSTED-ONLY | Separate deployment profile; PDP per-key buckets + single-replica rule are the reference posture.                                                                                                                                                                  |
| G28 | Exact-operation binding (ADR-0018), global immutable authority ids, external-binding approvals, bounded-grant guards | RESOLVED    | Implemented and tested; mutation matrices green.                                                                                                                                                                                                                   |
| G29 | Vault encryption at rest, durable proposals, backup/anchor runbook, x402/AP2 evidence-only subsets, URL pinning      | RESOLVED    | Implemented and tested within documented subsets; interop re-verified against current specs at go-live.                                                                                                                                                            |
| G30 | Windows rename not atomic; scrypt blocks event loop per open                                                         | RESIDUAL    | Best-effort fsync + backups; no decrypted-key cache (confidentiality over latency). Documented.                                                                                                                                                                    |

## Execution order

Next: authorized live-provider UAT plus independent host acceptance → normative spec and conformance vectors → production custody/ingress and reliable reconciliation → external audit → narrowly scoped production v1. Exercise rather than rebuild the existing journal, registry and second reference-domain integration.

Depth over breadth: one user, one authority model, multiple agents,
multiple domains, multiple protocols, no secret possession by agents. No
new protocols, dashboards, or SaaS administration until the failure modes
above are removed or explicitly bounded.

## Docs/brand freeze

Preserve the locked README brand region. Update evolving installation, interface and status documentation when verified behavior changes; do not present historical gap lists as present-day implementation facts.
