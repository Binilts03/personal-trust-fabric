# Security properties ledger

Specification intent is not an implemented control. Every row is OPEN until named code, negative tests, observable surfaces, fresh results, and residual limitations exist.

| ID | Required seam | Required negative evidence | Status / unresolved point |
|---|---|---|---|
| S-01 / INV-02 / INV-03 | Protected Store, Agent Safe View, separate DTO families | Unique protected canaries absent from model/tool/browser/log/error surfaces under supported non-possession modes | OPEN; M0 canary/provider-output/HTTP/browser surfaces pass, production store/observability absent |
| S-02 | Capability Runtime and recipient authentication | Forwarded handle cannot redeem when independent recipient/holder proof is required | OPEN; M0 forwarded-reference negative test and two server-held synthetic sessions pass; production recipient profile undecided |
| S-03 / INV-06 | Policy, approval digest, capability execution | Recipient/purpose/action/scope/amount/currency/transaction/time/use mutations invalidate authority | OPEN; versioned canonical digest, amount/recipient mutation and single-use M0 tests pass; full constraint profile open |
| S-04 | Capability derivation | Property test proves every child dimension is equal-or-narrower and revoked parent cannot create/use child | OPEN |
| S-05 | Authoritative atomic state | Parallel redemption of one-use authority yields exactly one execution across supported failure/retry conditions | OPEN; in-process concurrent one-use M0 test passes; distributed topology/retry profile undecided |
| S-06 / INV-01 / INV-04 | Authenticated approval plus pure deterministic policy | Model/tool text and forged client state cannot create approval or change a deny | OPEN; M0 Human HttpOnly session/origin checks and agent-tool exclusion pass; trusted production ceremony undecided |
| S-07 / INV-09 | Rejecting audit/log/error DTOs | Canary scan covers declared logs, traces, audit, screenshots, crash/error, exports and telemetry | OPEN; M0 closed audit schema, provider/error sanitization and declared browser/HTTP scans pass; crash/telemetry surfaces open |
| S-08 / INV-07 / INV-08 | Persona trust-transition path separate from policy | Prompt injection, summaries, connectors and repeated success cannot directly promote trusted memory or authority | OPEN; M0 external/model promotion negatives and no-authority-API test pass; full connector/poisoning suite open |
| S-09 / INV-11 | Disclosure plan, UI, adapter assurance | Requested plaintext/legacy downgrade is denied or explicitly re-approved and labeled through receipt | OPEN; allowed downgrade policy requires Human decision |
| S-10 | Revocation and version/rollback semantics | Revoked capability/device/authority fails within documented propagation bounds, including stale sync/rollback | OPEN; propagation/recovery design undecided |
| INV-05 | Disclosure Planner | Minimality oracle rejects an allowed but unnecessarily revealing candidate | OPEN; ordered M0 candidate oracle passes for predicate/direct modes; broader representation sets open |
| INV-10 | Adapter boundary | Dependency/source lint proves adapters cannot own/bypass policy or leak protocol fields into core | OPEN; M0 source lint and negative fixture pass; additional adapters open |
| INV-12 | Claim-to-evidence process | Every release security claim names TCB, observed surfaces, fresh command/result, exceptions, reviewer | OPEN; M0 README/judge/review evidence is bounded; release claim table incomplete |

## Threat-driven test additions

The eventual test registry must explicitly include forged approval/model-text attempts, concurrent double-use, recipient registry/key poisoning, renderer/UI substitution, stale sync rollback, recovery takeover, rate/resource abuse, support/debug tooling leakage, and supply-chain compromise paths. Purpose declarations cannot be treated as proof that a recipient will honor purpose after legitimate plaintext receipt.
