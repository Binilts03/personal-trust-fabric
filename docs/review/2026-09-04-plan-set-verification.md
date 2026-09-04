# PTF v1 Implementation Plan-Set Verification

Date: 2026-09-04
Scope: approved PTF v1 specification -> rewrite roadmap + Plans 00–06 + Plan 05B + normative plan-set amendments

## Result

**Planning-content review: PASS after remediation.**

**Implementation remains blocked** until the repository preservation preflight creates and verifies immutable tag `webmcp-sandbox-v0.1` at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`, and an execution workflow is explicitly selected.

No implementation code is part of this planning review.

## Fixed point

Review base: `ce2934f984609cc74ff86443e077fe354ba4d8da` — remediated proposed-spec state before approval/planning.

The planning branch remains `architecture/ptf-v1-spec` and is documentation-only. The reviewed specification blob remains immutable at `32fc9bb6119142e10b854b09a95544c4ec25d1cc`; approval is recorded separately in `docs/spec/PTF-V1-APPROVAL.md`.

## Review axes

### Standards / plan quality

Verified:

- source-of-truth precedence is explicit in `AGENTS.md`;
- the plan amendment sheet is normative over stale/conflicting detailed-plan wording;
- repository planning changes are documentation/instruction artifacts only;
- literal `TODO`/`TBD`/`implement later` placeholder scans performed during review found no executable-plan placeholders;
- every substantive task specifies intended paths, behavior/tests, verification commands, and stop/review gates;
- protocol adapters remain concrete through x402/AP2 and OpenID4VP; no universal ProtocolAdapter is mandated;
- x402/AP2 dependency conflict is handled by a tested convergence gate rather than an override;
- the duplicate authorization corpus paths are superseded by one canonical path;
- the approval-evidence type is corrected to a target-generic canonical fingerprint;
- Plan 01 cannot counterfeit AA1/AA2/AA3 before the real Trusted Surface exists;
- Plan 05B closes developer/direct-delivery omissions rather than stretching unrelated modules.

### Specification fidelity

Verified after amendments:

- all 28 foundational acceptance gates have an implementation/test owner;
- all 60 approved user stories have a planned implementation/test path or an explicitly optional profile treatment permitted by the specification;
- proving integrations remain x402, AP2, and OpenID4VP and do not redefine the product boundary;
- Personal State, Identity/Trust, Authority, Planning, Protected Execution, Protocol Integration, and Audit/Conformance remain separate bounded contexts;
- direct delivery, developer tooling, recipient/verifier integration, and identity/device/trust lifecycle are included rather than dropped because they are absent from the minimum 28 gates;
- conformance/release wording remains prohibited until executable evidence passes.

---

## Foundational acceptance-gate traceability

| Gate | Primary implementation / evidence |
| --- | --- |
| 1 Personal State/Authority separation | Plan 00 Personal State + Authority modules; foundation import/dependency and metamorphic tests |
| 2 AUTH-PERSONAL-STATE-NO-BROADEN | Plan 00 canonical corpus/metamorphic test; Plan 06 mandatory oracle |
| 3 Standing Grant vs Exact Approval | Plan 01 lifecycle; Plan 05 separate UX; amendment A2 target kinds |
| 4 authenticated Standing Grant creation | Plan 01 grant lifecycle + AA0 restriction; Plan 05 AA1/AA2 canonical grant authorization |
| 5 Hard Policy mutation outside Agent | Plan 01 Principal routes/repository tests; Plan 05 product workflow |
| 6 plan-bound Execution Grants | Plan 00 fingerprints; Plan 01 runtime/CP2; Plan 05 mutation challenge tests |
| 7 no grant union | Plan 00 resolver/corpus; Plan 01 persistence acceptance; Plan 06 oracle |
| 8 CP1/CP2 aggregate race safety | Plan 00 CP1 reference; Plan 01 CP2 transactional race tests; Plan 06 oracle |
| 9 real recipient binding | Plan 01 Trust Registry/auth; Plans 02–04 substitution tests; Plan 05B direct delivery |
| 10 ResourceRef not authority | Plan 01 synthetic executor; Plans 02–05B executor rejection tests; Plan 06 oracle |
| 11 reusable secret outside Agent | Plan 01 synthetic executor; x402/AP2/OpenID wallets/signing; Plan 05B direct delivery |
| 12 Assurance Manifest | Plan 00 model; Plan 01/protocol/Plan 05B concrete profiles; receipts/conformance |
| 13 complete Enforcement Map | Plan 00 total validation; Plans 02–04/05B route-specific mappings; Plan 06 oracle |
| 14 unsupported mandatory constraint fails | Plan 00 validator; protocol plans negative tests; Plan 06 oracle |
| 15 AP2+x402 before common API | Plan 02 then Plan 03 + mandatory seam review; amendment A1 |
| 16 OpenID4VP distinct credential path | Plan 04 |
| 17 Evidence Artifact != authority | Plans 02–04; Plan 05B recipient examples; protocol conformance |
| 18 INDETERMINATE no blind retry | Plan 01 runtime; x402 external ambiguity; Plan 06 oracle |
| 19 privacy-safe PTFReceipt | Plan 00 model; Plan 01 audit; protocol receipts; leak tests |
| 20 memory/source laundering no authority/trust | Plan 00 + amendment A5; Plan 06 memory oracle |
| 21 execution-time revalidation | Plan 01 `revalidate_execution`; protocol/executor commit paths; Plan 06 oracle |
| 22 Freshness Policy consequential use | Plan 00 freshness; Plan 04 credential status; Plan 06 profile/oracles |
| 23 Trust Registry epoch/staleness | Plan 01 authoritative registry; amendment A6; Plan 06 stale binding/device tests |
| 24 portability import no self-trust | Plan 06 export/import and oracle |
| 25 recovery respects TCB | Plan 06 recovery and oracle |
| 26 leak-canary negative visibility | Plans 01–05B; Plan 06 foundational leakage oracles |
| 27 executable conformance before claim | Plan 06 versioned suite/evidence/claim test |
| 28 self-contained source/scope | approved docs branch + preservation gate + roadmap/AGENTS scope guardrails |

---

## User-story traceability

Abbreviations: P00 Foundation; P01 Runtime; P02 x402; P03 AP2; P04 OpenID4VP; P05 Product Surface; P05B Developer/Integration; P06 Conformance/Ops; AM plan-set amendments.

| Story | Planned owner |
| ---: | --- |
| 1 exact one-off approval | P01, P05 |
| 2 scoped Standing Grant | P01, P05 |
| 3 approve-once vs standing authority | P05, AM A2 |
| 4 deny once | P01/P05 action lifecycle |
| 5 suspend/resume/revoke | P01, P05 |
| 6 grant broadening reauthorization | P01, P05 |
| 7 exception no grant mutation | P00/P01, P06 oracle |
| 8 committed/reserved/available visibility | P01 ledger, P05 UI, AM A11 |
| 9 external-artifact revocation honesty | P02–P04, P06, AM A11 |
| 10 canonical grant terms before activation | P05 |
| 11 Hard Policy unavailable to Agent | P01, P05 SDK/schema tests |
| 12 minimized Safe View | P00, P01 |
| 13 concrete Action Request | P00/P01 Agent Gateway |
| 14 deterministic safe status/result | P01/P05 SDK |
| 15 resource/operation availability not values | P00/P01 protected resource catalog/Safe View |
| 16 inferred vs explicit preference | P00, P05 |
| 17 material plan mutation re-resolution | P00/P01/P05 |
| 18 Observation/Claim/Preference distinct | P00 |
| 19 correction preserves history | P00/P05 |
| 20 contradiction without model guess | AM A5 executed in P00 |
| 21 context/freshness semantics | P00, P04, P06 |
| 22 erasure distinct from correction | P05 + durable state behavior |
| 23 compaction preserves lineage | AM A5 executed in P00; P06 laundering oracle |
| 24 low-risk inference useful/no authority | P00 Safe View/metamorphic tests |
| 25 authenticate real actors/recipients/executors | P00/P01, P02–P05B |
| 26 multiple bindings per Subject | P00/P01, AM A6 |
| 27 scoped TrustRelations | P00/P01, P06/AM A8 |
| 28 rotation continuity evidence | AM A6; P06/AM A8 controls |
| 29 logical Agent vs model/provider change | AM A5/A6 executed in P00/P01 |
| 30 high-value fresh verification without legal ID | P05 AA2 + pseudonymous Principal semantics |
| 31 recipient-bound evidence | P02–P04; P05B recipient examples/direct delivery |
| 32 least-disclosing enforceable route | P00 planner, P04 minimum disclosure |
| 33 actual route/downgrade shown | P05 canonical approval UI |
| 34 every constraint mapped | P00 + protocol plans + conformance |
| 35 mandatory unenforceable route rejected | P00/protocol negative tests |
| 36 external wallet/provider custody | P02 x402, P03 signing, P04 wallet |
| 37 truthful custody profiles | P00 Assurance Manifest; concrete profiles P01–P05B; P06 profile matrix; optional attested profile not falsely claimed |
| 38 bounded protected operations | P01 executors; P02–P05B concrete executors |
| 39 direct protected delivery | P05B |
| 40 browser/page plaintext weaker assurance | P05B + AM A11 |
| 41 ambiguous effects reconciled before retry | P01, P02, P06 |
| 42 concurrency-safe aggregate authority | P01 CP2, P06 oracle |
| 43 explanatory PTFReceipt | P00/P01/protocol/P05 activity |
| 44 privacy-safe forensic linkage | P01 AI0, P06 AI1/verification/threat model |
| 45 versioned export | P06 |
| 46 imported trust revalidated | P06 |
| 47 non-exportable resource re-enrolment | P06 |
| 48 recovery respects custody | P06 |
| 49 narrow Agent Gateway | P01/P05 |
| 50 focused recipient/verifier integration | P05B protocol-specific examples |
| 51 adapter translates, never authorizes | P02–P04 + conformance |
| 52 synthetic resources/local simulator | P05B |
| 53 plan/grant/policy/Safe View/Enforcement inspectors | P05B |
| 54 executable versioned adversarial conformance | P06 |
| 55 AP2+x402 before common adapter | P02/P03 + seam review, AM A1 |
| 56 OpenID4VP generality proof | P04 |
| 57 specification separate from implementation | repository/spec/approval/ADR structure |
| 58 telemetry/leaks/supply-chain/threat model | P06 |
| 59 unknown security extensions/migrations fail closed | AM A5 in P00; P06 migration oracle |
| 60 self-improving changes cannot broaden authority | P00 corpus + P06 locked migration/strategy gate |

---

## Cross-plan defects found and disposition

1. **Plan 02/03 parallelism contradicted Plan 03 convergence test.** Fixed by AM A1: sequential through AP2.
2. **`ApprovalEvidence.plan_fingerprint` was incorrectly reused for Standing Grant activation.** Fixed by AM A2: target kind + canonical target fingerprint.
3. **Plan 01 could otherwise appear to implement high assurance before Trusted Surface exists.** Fixed by AM A3: AA0 only until Plan 05.
4. **Two authorization regression corpus paths could diverge.** Fixed by AM A4: one canonical file created in Plan 00 and reused in Plan 06.
5. **Contradiction/compaction/model-provider/extension semantics were insufficiently explicit.** Fixed by AM A5.
6. **Rotation continuity and logical-Agent binding were insufficiently explicit.** Fixed by AM A6.
7. **Direct delivery, simulator/inspectors, and recipient/verifier developer integration were missing.** Fixed by mandatory Plan 05B / AM A7.
8. **Reference identity/device/trust lifecycle was read-heavy/incomplete.** Fixed by AM A8 in Plan 06.
9. **Aggregate usage visibility, external-artifact revocation truthfulness, and custody-profile claim status were implicit.** Fixed by AM A11.

## Deferred choices that remain legitimately deferred

These remain implementation/deployment choices because the approved specification fixed their decision shape rather than a single technology:

- exact database/coordinator internals beyond CP2 properties;
- AA3 provider/profile;
- AI1 witness provider;
- concrete customer-VPC/device/TEE deployment infrastructure when not part of the declared reference profile;
- universal protocol-adapter API unless the concrete seam review proves one;
- additional UCP/MCP/WebMCP/A2A/OAuth/etc. adapters after the initial proving programme.

Deferral does not permit false support/assurance claims.

## Execution blockers

- `legacy/webmcp-sandbox` is verified at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.
- immutable tag `webmcp-sandbox-v0.1` is currently **absent** and must be created/verified before rewrite work begins.
- no execution workflow has yet been selected.

## Planning handoff

Once repository-level verification confirms this report and plan artifacts are present, planning may close. The next workflow selection is:

- **Superpowers subagent-driven development** for the multi-plan rewrite (preferred), or
- **Superpowers executing-plans** for sequential execution with review checkpoints.

Implementation must begin in an isolated `rewrite/ptf-v1` worktree only after the tag preflight passes.
