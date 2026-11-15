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
| G4 | SQLite WAL execution-journal backend exists; cross-store atomicity unresolved | EXPERIMENT | ADR-0022 accepted an opt-in SQLite WAL execution repository, retaining the file backend; no atomic transaction joins Authority, journal, privacy evidence and external provider. |
| G5 | Local authenticated agent registry exists; remote ingress unproven | BLOCKS-V1 | Registry-bound authentication and actor rechecks exist; production network ingress, isolation and rate limits remain. |
| G6  | CLI-only approval; no trusted human surface                                                                          | BLOCKS-V1   | Needs a deterministic, LLM-free approval surface (review / grant / approve-once / deny / revoke / freeze / receipts / audit), untrusted content escaped, WebAuthn/passkey for high-risk approvals.                                                                 |
| G7 | Second reference domain implemented, live non-payment acceptance outstanding | BLOCKS-V1 | Synthetic email and opt-in GitHub Issues adapter use the shared protected-effect path; independent provider/host evidence is not available. |
| G8  | No normative spec                                                                                                    | BLOCKS-V1   | After G2 + G7: extract `docs/spec/` in RFC-2119 language (authority semantics only; no provider fields, schemas, or CLI/MCP naming).                                                                                                                               |
| G9  | No frozen conformance vectors + independent verifier                                                                 | BLOCKS-V1   | Portable JSON vectors (ALLOW + DENY) plus a second-language verifier proving spec-implementability, not just library correctness.                                                                                                                                  |
| G10 | File keystore is the only custody; no production `KeyProvider`                                                       | BLOCKS-V1   | Keep file keystore as reference; implement one real provider (OS keychain favored for the node), sign-inside-provider where possible, document what enters Node memory.                                                                                            |
| G11 | Replay/nonce state partly host-owned and in-memory                                                                   | BLOCKS-V1   | Persist used nonces, challenges, and idempotency keys where semantics require restart durability; `redeem → restart → replay → DENY` tested.                                                                                                                       |
| G12 | Audit is tamper-evident but locally anchored only; full rollback undetectable                                        | BLOCKS-V1   | Needs an optional `AuditWitness` interface (external checkpoint/verify) with at least one append-only/WORM/transparency implementation; core stays witness-agnostic.                                                                                               |
| G13 | PDP health and metrics exist; complete observability remains incomplete | BLOCKS-V1 | PDP exposes /healthz, /readyz and /metrics; host-wide tracing, reconciliation backlog, privacy-safe redaction and operational validation remain. |
| G14 | Local benchmark harness exists; production-host performance evidence incomplete | BLOCKS-V1 | scripts/bench.mjs supplies bounded reference measurements, not validated latency SLOs or realistic multi-actor deployment/concurrency benchmarks. |
| G15 | Failure-mode tests exist; deployment chaos and provider recovery unverified | BLOCKS-V1 | Test suites exercise selected crash, timeout, corruption and replay cases; independent host/provider outage drills and recovery procedures remain. |
| G16 | Adversarial tests, secret scan, Scorecard and release artifact workflow exist; assurance gaps remain | BLOCKS-V1 | Existing tests and CI cover some attacks; Scorecard and tagged-release SBOM/SLSA jobs are configured. They do not replace independent audit, full fuzzing coverage or verified published provenance. |
| G17 | Local installable tarball verified; registry/service distribution incomplete | BLOCKS-V1 | CI packs and installs the public interfaces; npm ownership, prerelease publication, operational installer and deployment proof remain. |
| G18 | npm release engineering incomplete | BLOCKS-V1 | Stage experimental version; recheck npm ownership, tarball, audit, version/tag history, first-publish bootstrap and provenance before owner-approved release. |
| G19 | No independent security review                                                                                       | BLOCKS-V1   | Reviewers get threat model, limits, ADRs, spec, vectors, deployment guide, residuals, reproductions. No open P0/P1 at v1; P2 fixed or accepted-risk.                                                                                                               |
| G20 | Single-writer concurrency ceiling remains despite journal idempotency | BLOCKS-V1 | The implemented journal prevents blind exact-term resubmission, not simultaneous unauthorized effects under all concurrency topologies; retain single-writer/one-use restrictions and verify cross-store synchronization. |
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
