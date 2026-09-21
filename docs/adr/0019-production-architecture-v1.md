# ADR-0019: PTF Production Architecture v1 (Personal Authority Node)

**Date**: 2026-09-21
**Status**: accepted
**Deciders**: PTF maintainer

## Context

PTF is a tested reference implementation (297 unit tests, 9 evals, all
green on `main`) with a strong local authority engine, an encrypted vault,
durable proposals, and evidence-only protocol adapters. The gap assessment
(`docs/roadmap/production-v1.md`) shows the blockers for consequential
real-world action are architectural, not algorithmic: no live execution
with reconciliation, single fixed MCP identity, CLI-only approval, file
keystore as the only custody, and locally-anchored audit.

The first production target must be scoped before building: a generic
multi-tenant SaaS forces tenant isolation, per-tenant rate limiting, and
remote-identity federation into every component now. A **Personal Authority
Node** — one user-controlled instance serving multiple authenticated agents
for one authority owner — needs none of that, and it is the deployment that
directly expresses the product claim (one user, interchangeable agents, no
secret possession).

## Decision

V1 architecture is nine components with a single allowed dependency
direction:

```text
agents
  │
  ▼
authenticated ingress            INGRESS AUTHENTICATION
  │                              (verified transport identity → PTF actor)
  ▼
canonical operation              PROTOCOL ADAPTERS (normalize evidence →
  │                              AuthorityOperation; never mint authority)
  ▼
authority engine                 AUTHORITY ENGINE (src/core: grants,
  │                              approvals, policy-narrowing, CHECK/REDEEM)
  ▼
redeem
  │
  ▼
protected execution boundary     EXECUTION ORCHESTRATOR (journal +
  │                              idempotency + reconcile; owns the
  │                              consume-before-effect ordering)
  ├────────┬────────┐
  ▼        ▼        ▼
P3P       AP2     provider APIs   PROTOCOL ADAPTERS + PROVIDER CONNECTORS
                                 (edge translators; host-owned rails)
```

Supporting planes (no effect path bypasses the engine):

- **PROTECTED STATE** (`src/store/vault.ts` + `src/store/keystore.ts`
  behind a `KeyProvider` seam): purpose/agent/expiry-scoped records,
  receipt-only secret use. Raw secrets cross no other boundary.
- **AUDIT / RECEIPTS** (`src/core/execute.ts` receipts,
  `src/store/anchor.ts`, `audit.jsonl` chain): every consequential action
  carries authority citation, execution identity, external evidence
  reference, secret-free receipt, and chain entry; optional external
  `AuditWitness` for rollback detection beyond the local anchor.
- **KEY PROVIDER**: file keystore retained as reference; production uses
  one real provider (OS keychain favored for the node). Sign inside the
  provider where possible; document what enters Node memory.
- **TRUSTED HUMAN SURFACE**: deterministic, LLM-free approval UI (review /
  grant / approve-once / deny / revoke / freeze / receipts / audit).
  No agent-supplied HTML; untrusted content escaped.

Component-to-code mapping today vs v1:

| Component              | Today                                               | v1 delta                                                                           |
| ---------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Authority engine       | `src/core/` (zero-dep, enforced by CI)              | Unchanged semantics; storage-independent repositories for the persistence decision |
| Protected state        | vault envelope + file keystore                      | `KeyProvider` with one real backend                                                |
| Ingress authentication | fixed stdio identity (ADR-0013)                     | `AgentAuthenticator`: verified transport identity → actor; multi-agent registry    |
| Execution orchestrator | burn-before-effect, no journal                      | durable journal + idempotency + reconcile-on-restart                               |
| Protocol adapters      | x402/AP2/OAuth/OID4VP/MCP/A2A/AuthZEN evidence-only | + thin P3P adapter; same evidence-only contract                                    |
| Provider connectors    | `FakePaymentExecutor` / fakes                       | P3P sandbox connector, one non-payment connector; rails stay host-owned            |
| Audit/receipts         | hash chain + local anchor                           | + optional witness interface                                                       |
| Key provider           | file keystore only                                  | + OS keychain (node target)                                                        |
| Trusted human surface  | CLI approval                                        | minimal deterministic surface + WebAuthn for high-risk                             |

## Constraints (non-negotiable)

1. **Core ignorance**: `src/core/` never names provider fields (no Pine
   Labs / Visa / x402 / P3P concepts). Adapters translate external
   protocols into/from the canonical operation model. Enforced by the
   existing CI zero-dependency check; protocol-shaped data enters core
   only as opaque `context` covered by the terms digest.
2. **Evidence-only edge**: no adapter output mints authority (ADR-0005).
   P3P challenges, Grantex tokens, mandates, and receipts are requests or
   evidence; only `Authority.evaluate` + `redeem()` authorize effects.
3. **Ingress binding**: actor identity comes from verified transport, never
   `request.actor` (extends ADR-0013 to multiple agents).
4. **Journal before rail**: durable consumption + execution record persist
   before any external call; `SUBMITTED_UNKNOWN` reconciles, never blindly
   retries.
5. **SaaS deferral**: no tenant model, no per-tenant quotas, no remote
   federation in v1 components. The PDP bin's per-key scopes + single
   replica posture is the reference, not the target.

## Alternatives Considered

### SaaS-first architecture

- **Pros**: one deployment serves everyone.
- **Cons**: forces tenant isolation, noisy-neighbor limits, and federated
  identity into the authority engine now; the engine would learn
  tenancy it must never need.
- **Why not**: the product claim is user-owned authority, not hosted
  authority. Multi-tenant is a separate deployment profile later.

### Monolithic server (ingress + engine + executors in one process)

- **Pros**: fewer moving parts initially.
- **Cons**: a provider-connector fault or credential handling bug shares
  fate with the authority plane; the protected-use boundary becomes
  conventional rather than structural.
- **Why not**: the boundary between redeem and execution is the security
  property. Structure must show it.

### Protocol-aware core (provider fields in Authority bounds)

- **Pros**: shorter adapter code for the first integration.
- **Cons**: every new protocol re-opens the authority engine; the second
  execution domain (roadmap G7) would require core surgery, disproving
  generality.
- **Why not**: directly contradicts ADR-0009/ADR-0010 and the generality
  test. Adapters stay thin at the edge.

## Consequences

- Work proceeds per `docs/roadmap/production-v1.md` G2–G19; each phase PR
  cites this ADR and the invariant it preserves.
- ADR-0008 (SQLite deferred) is revisited by the persistence decision
  (G4) without touching engine semantics.
- `docs/audit/limits.md` gains one line per residual introduced; the
  roadmap gap table is updated as items resolve.
- Branding/docs-structure freeze (roadmap) holds: this ADR is the last
  structural docs change until G2/G3 land.
