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

## Gap assessment (against `main` at Phase 0)

Classification per ceiling:

- **BLOCKS-V1** — must be resolved before any consequential deployment.
- **HOSTED-ONLY** — blocks a future multi-tenant service, not the node.
- **RESIDUAL** — acceptable documented residual for v1.
- **RESOLVED** — already implemented and tested on `main`.
- **EXPERIMENT** — needs a bounded experiment before the decision.

| #   | Gap / ceiling                                                                                                        | Class       | Notes                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Docs build stability + required docs CI                                                                              | BLOCKS-V1   | Resolved by Phase 0 (this track): single theme-gem config, no custom SCSS, required `docs` CI job.                                                                                                                                                                 |
| G2  | No live execution (reference providers move nothing)                                                                 | BLOCKS-V1   | Needs P3P sandbox interop: thin evidence-only adapter, protected-use credential handling, sandbox receipt verification, full denial matrix.                                                                                                                        |
| G3  | Crash between authority persistence and external effect burns a use with no receipt and no reconciliation            | BLOCKS-V1   | Needs a durable execution journal (`PREPARED → AUTHORIZED → SUBMITTING → SUBMITTED_UNKNOWN → SUCCEEDED / FAILED_FINAL / RECONCILED`), stable `executionId` + provider idempotency keys, and reconcile-on-restart. No blind retry after ambiguous effects.          |
| G4  | File/CAS backend unproven for atomic authority + journal + replay state                                              | EXPERIMENT  | ADR must compare file/CAS vs SQLite WAL (likely for the node) vs alternatives; authority engine stays storage-independent behind repositories; file backend retained as reference.                                                                                 |
| G5  | MCP binds one fixed identity; no authenticated multi-agent ingress                                                   | BLOCKS-V1   | Needs `AgentAuthenticator`: verified transport identity → PTF actor (never `request.actor`). Must prove agent replaceability: Agent B inherits applicable bounds after Agent A is removed, with no authority copied into agent platforms.                          |
| G6  | CLI-only approval; no trusted human surface                                                                          | BLOCKS-V1   | Needs a deterministic, LLM-free approval surface (review / grant / approve-once / deny / revoke / freeze / receipts / audit), untrusted content escaped, WebAuthn/passkey for high-risk approvals.                                                                 |
| G7  | Only payment-flavored execution demonstrated                                                                         | BLOCKS-V1   | Needs one real non-payment domain (e.g. email via a legitimate provider/sandbox) through the unchanged core authority model. Payment-specific logic in core stops the effort.                                                                                      |
| G8  | No normative spec                                                                                                    | BLOCKS-V1   | After G2 + G7: extract `docs/spec/` in RFC-2119 language (authority semantics only; no provider fields, schemas, or CLI/MCP naming).                                                                                                                               |
| G9  | No frozen conformance vectors + independent verifier                                                                 | BLOCKS-V1   | Portable JSON vectors (ALLOW + DENY) plus a second-language verifier proving spec-implementability, not just library correctness.                                                                                                                                  |
| G10 | File keystore is the only custody; no production `KeyProvider`                                                       | BLOCKS-V1   | Keep file keystore as reference; implement one real provider (OS keychain favored for the node), sign-inside-provider where possible, document what enters Node memory.                                                                                            |
| G11 | Replay/nonce state partly host-owned and in-memory                                                                   | BLOCKS-V1   | Persist used nonces, challenges, and idempotency keys where semantics require restart durability; `redeem → restart → replay → DENY` tested.                                                                                                                       |
| G12 | Audit is tamper-evident but locally anchored only; full rollback undetectable                                        | BLOCKS-V1   | Needs an optional `AuditWitness` interface (external checkpoint/verify) with at least one append-only/WORM/transparency implementation; core stays witness-agnostic.                                                                                               |
| G13 | No structured observability; redaction is convention                                                                 | BLOCKS-V1   | Health/readiness, auth counts, deny categories, execution states, reconciliation backlog; stable opaque IDs; OpenTelemetry if fitting; log-redaction property tests. Never emit credentials, bearer values, Personal State, or card/grant secrets.                 |
| G14 | No execution benchmark                                                                                               | BLOCKS-V1   | Harness measuring normalize / CHECK / REDEEM / consume / credential-create / provider round-trip / verify / persist (p50/p95/p99, realistic concurrency). No marketing claims without empirical support.                                                           |
| G15 | No chaos/failure-injection coverage                                                                                  | BLOCKS-V1   | Crash points, disk-full, corrupt store/DB, clock changes, provider 500/timeout, duplicate webhooks/receipts, revocation mid-execution — each with safe state + recovery procedure.                                                                                 |
| G16 | Adversarial coverage + supply-chain gaps                                                                             | BLOCKS-V1   | Parser/JWS fuzzing, canonicalization collisions, Unicode, prototype pollution, SSRF/redirect/DNS-rebinding, exhaustion, audit/receipt/log injection, identity spoofing, concurrent redeem; CodeQL, secret scanning, Scorecard, SBOM, provenance, artifact signing. |
| G17 | No supported install story                                                                                           | BLOCKS-V1   | npm package + container image (+ service install for the node): version/config-validation/migration/backup/restore/rotation/healthcheck/graceful-shutdown; non-root, read-only FS, pinned base, SBOM, signed provenance; never bake provider credentials.          |
| G18 | Release engineering incomplete                                                                                       | BLOCKS-V1   | `npm pack --dry-run` allow-list audit, Trusted Publishing/provenance, `v1.0.0-rc.1` before stable.                                                                                                                                                                 |
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

Approximately: docs stabilization → production architecture ADR →
P3P sandbox interop → execution journal + reconciliation → persistence
decision → authenticated multi-agent ingress → trusted human surface →
second execution domain → normative spec → conformance + verifier →
`KeyProvider` → durable replay → audit witness → observability →
benchmark → chaos → packaging → security review → release candidate → v1.

Depth over breadth: one user, one authority model, multiple agents,
multiple domains, multiple protocols, no secret possession by agents. No
new protocols, dashboards, or SaaS administration until the failure modes
above are removed or explicitly bounded.

## Docs/brand freeze

After Phase 0, branding and documentation-structure work is frozen until
product capability advances (G2/G3). Docs changes are limited to what
each phase requires (ADRs, limits updates, changelogs, spec text).
