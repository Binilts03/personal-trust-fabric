# PTF v1 Final 28-Gate Implementation and Evidence Audit — September 4, 2026

Status: **28/28 COVERED IN FINAL PLANNING CHAIN — SOURCE EXECUTION STILL BLOCKED BY PRESERVATION GATE**

Review source: approved specification blob identified by `docs/spec/PTF-V1-APPROVAL.md`, accepted ADRs, final interface registry/addendum, semantic corrections through correction 11, strict C10 supplements 00–06, final fixture/helper closure, and the 65-task C10 matrix.

A gate is `PASS` here only if the plan identifies both:

1. a concrete task/module that implements the required behavior; and
2. a later public-seam, adversarial, conformance, acceptance, or release oracle that can falsify the claim.

A unit test alone is not used as the sole final evidence for a foundational gate.

| Gate | Approved requirement | Concrete implementation owner | Later black-box / release evidence | Status |
|---:|---|---|---|:---:|
| 1 | Personal State and authority structurally separated | Plan 00 T3 Context/Personal State values; T5 authority resolver; Plan 01 T6C Safe View | Plan 00 T8 metamorphic lock; Plan 06 `AUTH-PERSONAL-STATE-NO-BROADEN` | PASS |
| 2 | executable Personal-State-no-broaden oracle | Plan 00 T3/T5/T6C make ContextView and AuthorityView independently derived | Plan 06 mandatory foundation oracle `AUTH-PERSONAL-STATE-NO-BROADEN` | PASS |
| 3 | Standing Grant and Exact Human Approval remain distinct authority forms | Plan 00 T5 authority basis; Plan 01 T5/T7; target-generic ApprovalEvidence | Plan 01 T11 acceptance; Plan 05 approval/grant E2E; Plan 06 authority corpus/oracles | PASS |
| 4 | Standing Grant creation/activation requires canonical authenticated Principal authorization | Plan 01 T5; Plan 05 T4 `PrincipalAuthorizationService` + correction 11 challenge seam; T6 grant workflow | Plan 05 grant E2E replay/mutation/AA tests; Plan 06 authority/oracle corpus | PASS |
| 5 | Hard Policy mutation is authenticated and outside Agent trust level | Plan 01 policy persistence/routes; Plan 05 T6 Trusted Surface policy workflow | Agent OpenAPI/SDK exclusion tests; Plan 05 T8 product boundary lock; Plan 06 release/conformance scans | PASS |
| 6 | Execution Grants are exact-plan-bound; mutation after approval invalidates authority | Plan 00 T6 fingerprint; Plan 01 T6/T7 ExecutionGrant lifecycle | Plan 01 T11 mutation acceptance; Plan 05 approval mutation E2E; protocol substitution tests | PASS |
| 7 | separate Standing Grants are never unioned to manufacture authority | Plan 00 T5 resolver/containment logic | Plan 00 T8 locked attack; Plan 06 `AUTH-NO-GRANT-UNION` | PASS |
| 8 | CP1/CP2 prevent aggregate-limit race/budget overspend | Plan 00 T5 CP1; Plan 01 T6 serializable reservation/issuance | Plan 01 concurrency integration; Plan 06 `COORD-AGGREGATE-RACE` | PASS |
| 9 | real authenticated recipient/endpoint binding, not labels | Plan 00 T4 bindings/trust; Plan 01 T4 Trust Registry/authentication; protocol binding normalizers | x402 recipient-substitution, AP2 merchant/audience, OpenID4VP verifier/response-URI attacks; Plan 06 identity oracles | PASS |
| 10 | ProtectedResourceRef alone cannot exercise a resource | Plan 01 T6B metadata-only catalog; Plan 01 T8 and protocol executors require ExecutionGrant+Plan | synthetic/x402/OpenID4VP structural negative tests; Plan 06 `RESOURCE-REF-NOT-AUTHORITY` | PASS |
| 11 | at least one protected executor keeps reusable secret/key outside Agent/control API | Plan 01 synthetic executor; x402 wallet executor; AP2 signing executor; OpenID4VP wallet executor | leak-canary integration suites + Plan 06 leakage conformance; safe Agent/API/receipt scans | PASS |
| 12 | Assurance Manifest truthfully describes TCB/custody/visibility | Plan 00 T6 `AssuranceManifest`; each executor/plan binds manifest | protocol acceptance suites; Plan 06 recovery/TCB oracle, conformance evidence and release claim guard | PASS |
| 13 | complete Enforcement Map; no mandatory semantic dimension silently lost | Plan 00 T6 validation; Plan 02/03/04 enforcement builders | Plan 00 T8 semantic-loss lock; protocol enforcement attacks; Plan 06 `PLAN-SEMANTIC-LOSS` | PASS |
| 14 | unsupported mandatory constraint fails closed unless explicit approved downgrade | Plan 00 T6 validator/downgrade rules; protocol enforcement builders | protocol unsupported-constraint tests; Plan 06 `PLAN-DOWNGRADE-POLICY` | PASS |
| 15 | x402 and AP2 concrete implementations precede any common protocol abstraction | Plan 02 then Plan 03; Plan 03 T9 is post-implementation seam review | T9 deletion/depth review; final registry explicitly forbids universal ProtocolAdapter before accepted evidence/ADR | PASS |
| 16 | materially distinct credential-presentation proof exists | Plan 04 OpenID4VP T1–T7; correction 11 keeps credential/VP/direct-post inside protected wallet executor | Plan 04 T8 acceptance/core-generality review; Plan 06 OpenID4VP conformance profile | PASS |
| 17 | protocol Evidence Artifacts never become canonical PTF authority | Plan 02/03/04 evidence/flow modules; canonical AuthorityBasis remains PTF-only | protocol-valid-but-PTF-denied conformance tests; receipt/evidence safe-reference tests | PASS |
| 18 | `INDETERMINATE` cannot trigger blind retry/reuse | Plan 01 T7 reconciliation; x402/AP2/OpenID4VP evidence classifiers | x402 timeout/replay attacks; OpenID4VP correction-11 safe evidence test; Plan 06 `EXEC-INDETERMINATE-NO-BLIND-RETRY` | PASS |
| 19 | PTFReceipt is privacy-safe and explanatory | Plan 00 T7 exact receipt model; Plan 01 T9 audit/reconciliation | Plan 01/02/03/04 leak canaries; Plan 06 `LEAK-LOG-RECEIPT-ERROR-TELEMETRY` and release evidence scans | PASS |
| 20 | memory/source laundering cannot create authority or trust | Plan 00 T3 provenance/source classes; T5 authority separation; Plan 01 Safe View | Plan 00 T8 source-laundering cases; Plan 06 `MEMORY-SOURCE-LAUNDERING` | PASS |
| 21 | policy/grant/trust/resource state is revalidated immediately before consequential use | Plan 01 T7 `revalidate_execution`; protected executors validate plan/resource/bindings | revocation integrations; protocol precommit/substitution tests; Plan 06 `AUTH-REVOCATION-RECHECK` | PASS |
| 22 | Freshness Policy is executable, not decorative metadata | Plan 00 T3 `FreshnessPolicy/evaluate_freshness`; OpenID4VP credential status/minimization path | Plan 00 boundary tests; OpenID4VP stale/unknown/revoked presentation tests; foundation acceptance | PASS |
| 23 | Trust Registry epoch/staleness invalidates stale security decisions | Plan 01 T4 transactionally incremented registry epoch; plan/revalidation records epoch | Plan 01 revocation/stale-epoch integration; Plan 06 device revocation and identity/trust conformance | PASS |
| 24 | portable-state import cannot self-declare trust/authority | Plan 06 T4 `PortabilityService` inspect/commit and `0003_portability.sql` | `PORTABILITY-IMPORT-NO-TRUST-ESCALATION` black-box oracle + digest-change/import attacks | PASS |
| 25 | recovery cannot silently broaden the TCB/Assurance Manifest | Plan 06 T5 recovery/device module and `0004_recovery_devices.sql` | `RECOVERY-TCB-NO-BROADENING` oracle; recovery Trusted Surface journey | PASS |
| 26 | leak-canary coverage exists for every declared negative visibility boundary | Plan 01 protected executor/API; Plan 02/03/04 protected executors; Plan 05 browser storage | protocol/runtime leak suites + Plan 06 `LEAK-AGENT-SURFACES` and `LEAK-LOG-RECEIPT-ERROR-TELEMETRY`; CI secret scan | PASS |
| 27 | mandatory conformance must execute before a conformance/release claim | Plan 06 T1 runner/evidence, T2/T3 profiles, T4/T5/T8 deferred-oracle owners, T9/T10 release gates | foundation profile refuses PASS while any mandatory oracle pending; release-claim registry blocks unsupported claims | PASS |
| 28 | approved spec remains self-contained source of truth; milestones/protocol demos cannot redefine product scope | approval record + immutable spec + ADRs + final precedence index/AGENTS guardrails | Plan 06 release-copy/claim tests; final cross-plan consistency review; product boundary docs | PASS |

## Coverage totals

```text
foundational gates:                         28
with concrete implementation owner:         28
with later black-box/release falsifier:     28
unmapped gates:                              0
```

## Important final-seam updates included in this audit

### Gate 4 — Principal authorization

Correction 11 removes the undefined `CanonicalAuthorizationTarget` shortcut. Human action/grant authorization is bound through:

```text
CanonicalApprovalView
-> PrincipalAuthorizationChallenge persisted server-side
-> verified WebAuthn ceremony
-> target-generic ApprovalEvidence
```

The browser cannot choose the canonical fingerprint, target kind, RP ID, origin, or assurance requirement.

### Gates 11, 16, 18, 19, 26 — OpenID4VP custody

Correction 11 moves raw credential loading, VP-token construction, and direct-post network submission into `OpenID4VPWalletExecutor.present_and_deliver(...)`. Control-plane code receives only `OID4VPDeliveryEvidence`, which is classified into canonical execution outcomes. This strengthens rather than weakens the approved protected-execution/leakage gates.

### Gates 24–27 — Plan 06 sequencing

The foundational conformance profile cannot PASS early. Portability, recovery, and migration/self-improvement oracle IDs are registered as mandatory but non-PASS until their owning Tasks 4, 5, and 8 implement the real black-box oracle. Release claims remain gated after those tasks.

## Result

**Foundational planning coverage: 28/28 PASS.**

This result is planning coverage only. It does not assert that runtime behavior passes before implementation exists. Source implementation remains blocked until final Git/readiness verification and the human repository-preservation decision/tag gate are closed.