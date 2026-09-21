# Production v1 — readiness plan

Target: a **Personal Authority Node** — one user-controlled PTF instance
serving multiple authenticated agents for one authority owner. Not a
multi-tenant SaaS; that is a separate deployment profile and MUST NOT shape
v1 architecture.

> User-owned authority and protected use for interchangeable AI agents.

## 1. Gap report (against current `main`)

Every row of `docs/audit/limits.md` and the `THREATMODEL.md` non-goals is
classified for the Personal Node target:

- **BLOCKS-NODE** — must be resolved before v1.
- **BLOCKS-HOSTED** — only blocks a future hosted/SaaS profile; node v1
  holds the documented topology instead.
- **RESIDUAL** — acceptable as documented residual for v1 (runbook duty).
- **RESOLVED** — already implemented and tested.
- **EXPERIMENT** — needs a real experiment before the decision can be made.

### Authority / execution

| Limit | Class | Notes |
|---|---|---|
| Reference executors move no money | BLOCKS-NODE | Real connectors behind the provider seam (P3P sandbox first) |
| Crash between consume and effect burns a use, outcome unknown | BLOCKS-NODE | Durable execution journal + idempotency + reconciliation |
| Torn-write window (`atomicWrite` best-effort) | BLOCKS-NODE | Resolved via journal + transactional backend decision |
| Secret-freedom of `detail`/context/log telemetry | BLOCKS-NODE | Structured redacted observability + property tests |
| Exact-operation binding, CHECK≠REDEEM≠EXECUTE, global ids, approval bindings, `/pay` ceiling guard, attenuation strictness | RESOLVED | Tested; conformance pins them |
| Single-writer CAS; unlimited-use racers can both execute | RESIDUAL / BLOCKS-HOSTED | Node topology is owner duty; bounded grants are the control |
| Durable proposals + in-memory challenges (restart → phase 1 again) | RESIDUAL | Fail-closed by design; challenges carry live key material |
| Audit tamper-evident, locally anchored only | RESIDUAL | Local anchor + backup discipline; external witness is Phase 12 (optional for node) |
| Rotation hard cutover | RESIDUAL | Runbook duty |
| Travel exact-date only | RESIDUAL | Documented; windows are provider-side evidence |

### Adapters (evidence-only subsets hold)

| Limit | Class | Notes |
|---|---|---|
| P3P spike: no sandbox capture, no retry benchmark | EXPERIMENT | Sandbox-first integration with denial matrix |
| x402 / AP2 shapes, OID4VP cuts, WebMCP hint trust, A2A key duties, URL pinning, JWS strictness | RESOLVED | Subsets implemented + tested |
| Egress proxy, per-client OAuth duties, nonce replay store, key expiry/revocation fetch | BLOCKS-HOSTED | Host duties outside the single-operator node profile |
| Rail-settlement verification before trusting value movement | BLOCKS-NODE | Part of the P3P/AP2 sandbox experiments |

### Vault / contract / providers / platform

| Limit | Class | Notes |
|---|---|---|
| File keystore as sole custody | BLOCKS-NODE | At least one real `KeyProvider` (OS keychain first) |
| Nonce/replay state host-owned, restart resets it | BLOCKS-NODE | Durable replay state with restart tests |
| Backup holds ciphertext + DEK together | RESIDUAL | Media protection + rotation-on-exposure runbook |
| Short-scalar receipt residual, heap unzeroed, `metadata` effectfulness by review | RESIDUAL | Explicit reviewer checklist; never claimed otherwise |
| MCP fixed-identity stdio (no multi-agent auth) | BLOCKS-NODE | Authenticated agent ingress; A-removal/B-onboarding proof |
| CLI-only approval surface | BLOCKS-NODE | Minimal deterministic trusted surface |
| `scryptSync` blocks loop per open | RESIDUAL | Operator scale; benchmark validates |
| Second domain proved with fake provider only | EXPERIMENT | Real provider/sandbox before freezing the spec |

### Explicitly out of v1 scope

Multi-tenant service, HSM-at-scale, external audit witnessing (optional),
x509/DID/attestation crypto, mdoc, full AP2 human-not-present flows, live
mainnet funds, universal DID resolution, GNAP server. Each stays in
`THREATMODEL.md` non-goals; none may silently re-enter via an adapter.

## 2. Phase plan

Derived from the classification above (detail: mission brief; sequencing
detail stays out of this file):

```text
0  stabilize docs CI + freeze branding/docs churn          (process gate)
1  production architecture ADR (node profile)              (BLOCKS-NODE)
2  P3P sandbox interoperability + denial matrix           (BLOCKS-NODE)
3  execution journal + idempotency + reconciliation        (BLOCKS-NODE)
4  transactional backend decision (+ migration path)       (BLOCKS-NODE)
5  authenticated multi-agent ingress                       (BLOCKS-NODE)
6  trusted human approval surface                          (BLOCKS-NODE)
7  real second-domain execution (provider/sandbox)         (EXPERIMENT)
8  normative spec revision after 2+7                       (BLOCKS-NODE)
9  frozen vectors + independent verifier                   (BLOCKS-NODE)
10 production KeyProvider (OS keychain first)              (BLOCKS-NODE)
11 durable replay state                                    (BLOCKS-NODE)
12 external audit witness (optional for node)              (RESIDUAL+)
13 redacted observability                                  (BLOCKS-NODE)
14 benchmark (authority cost off the critical path)        (BLOCKS-NODE)
15 chaos + security testing expansion                      (BLOCKS-NODE)
16 packaging / release hardening                           (BLOCKS-NODE)
17 independent security review (no open P0/P1)             (BLOCKS-NODE)
18 release candidate → v1                                  (gate below)
```

`docs/spec/` and `tests/conformance.test.ts` exist as **drafts**: they
decouple the normative semantics from this implementation early, but the
spec MUST be revised after the P3P and second-domain experiments (phase 8)
before it can be called final. Nothing here standardizes Pine Labs, Visa,
x402, SQLite, CLI, or MCP naming.

## 3. Go-live gate (v1)

All mission §20 checks must be IMPLEMENTED + TESTED or explicitly
de-scoped with rationale, threat analysis, deployment restriction, and
documented residual risk. The final product test (one node, Agent A →
Agent B handoff, P3P sandbox payment, one non-payment action, replay /
mutation / crash / revocation / restart / backup-restore proofs,
independent-vector agreement) is the acceptance demo. Until it passes,
this remains a tested reference implementation.
