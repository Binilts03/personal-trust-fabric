# ADR-0021: PTF Production Architecture v1 (Personal Authority Node)

**Date**: 2026-09-21
**Status**: accepted
**Deciders**: PTF maintainer

## Context

The reference implementation proves authority semantics but cannot safely
perform consequential actions: crash leaves execution outcome unknown
(burned authority, ambiguous effect), replay state is host-memory only,
agent ingress is one fixed stdio identity, and custody is a file keystore.
The Personal Authority Node profile (one user-controlled instance, multiple
authenticated agents) needs named components with enforced dependency
direction before any of those get built.

## Decision

Nine components; dependencies flow strictly downward. Nothing above the
authority engine mints authority; nothing below it leaks protocol concepts
upward:

```text
agents → authenticated ingress → canonical operation → authority engine
  → redeem → protected execution boundary → adapters → provider connectors
  → rails. Audit/receipts observe every layer; key provider backs custody;
  trusted human surface drives grants/approvals/revoke/freeze.
```

- **Authority engine** (`src/core/`): unchanged semantics, storage-independent.
  Never imports adapters, providers, or stores (lint-enforced).
- **Protected state** (`src/store/vault.ts` + `KeyProvider` seam): records and
  receipt-only secret use. File keystore stays the reference; production
  custody arrives via `KeyProvider` without changing call sites.
- **Ingress authentication** (`AgentAuthenticator` interface, new): verified
  transport identity → PTF `VerifiedIdentity`. Request-carried identity is
  never trusted. Fixed stdio identity stays as the local reference.
- **Execution orchestrator** (`src/store/execution.ts`, new): durable journal
  `PREPARED → AUTHORIZED → SUBMITTING → SUBMITTED_UNKNOWN → SUCCEEDED |
  FAILED_FINAL | RECONCILED`, stable `executionId` + provider idempotency
  key, reconcile-on-restart (never blind retry).
- **Protocol adapters** (`src/adapters/`): evidence-only translators into the
  canonical operation. Core knows no Pine Labs / Visa / x402 fields.
- **Provider connectors** (host-side `ProtectedProvider` implementations):
  own credentials, network, settlement checks. PTF verifies receipts.
- **Audit/receipts**: hash-chained log + optional `AuditWitness` seam;
  receipts stay secret-free by construction plus canary tests.
- **Key provider**: `KeyProvider` seam (sign-inside-provider preferred);
  file backend retained as reference.
- **Trusted human surface**: deterministic render of exact terms; no LLM, no
  agent HTML; WebAuthn for high-risk approvals.

Repository interfaces (`AuthorityRepository`, `ExecutionRepository`,
`ReplayRepository`, `AuditRepository`) keep `core/` storage-independent;
the file/CAS backend stays the reference and migration source.

## Alternatives Considered

### Alternative 1: Layer the node onto the current file stores directly

- **Pros**: No new abstractions; fastest.
- **Cons**: Journal, replay, and multi-agent state entangle with file/CAS
  specifics; the SQLite decision becomes a rewrite instead of a backend swap.
- **Why not**: Rejected — the repository interfaces are cheap and preserve
  the storage-independent engine invariant.

### Alternative 2: Multi-tenant service architecture first

- **Pros**: One architecture for both profiles.
- **Cons**: Forces tenant isolation, quota, and remote-auth complexity into
  the first viable product; SaaS requirements distort node design.
- **Why not**: Rejected — node first per product direction; hosted is a
  separate profile later.

## Consequences

### Positive

- Every BLOCKS-NODE gap in `docs/roadmap/production-v1.md` has a named home
  with a dependency direction that preserves all twelve product invariants.
- Adapters and connectors stay out of `core/` by construction, so P3P/AP2/
  x402 work cannot leak protocol fields into authority semantics.

### Negative

- More seams to maintain (repository interfaces + three new seams:
  execution journal store, `KeyProvider`, `AuditWitness`).
- File backend must be kept working as reference during any SQLite migration
  (double implementation cost until cutover).

### Risks

- Seams without implementations are promises: each must land with abuse
  tests and limits updates (execution journal first — it is the top
  production blocker).
