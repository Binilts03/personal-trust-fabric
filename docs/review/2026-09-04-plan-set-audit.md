# PTF v1 Implementation Plan-Set Audit — 2026-09-04

Status: **Verified planning review; implementation has not started.**

## Review target

- Repository: `Binilts03/personal-trust-fabric`
- Approved specification path: `docs/spec/PTF-V1-PROPOSED.md`
- Exact approved specification blob: `32fc9bb6119142e10b854b09a95544c4ec25d1cc`
- Human approval record: `docs/spec/PTF-V1-APPROVAL.md`
- Remediated specification commit used as the fixed architecture baseline: `ce2934f984609cc74ff86443e077fe354ba4d8da`
- Original completed plan-set head reviewed: `e4752c599ff8abb690f654915e9b696e9c2b4bb4`
- Verified planning branch: `planning/ptf-v1-verified`
- Binding remediation contract: `docs/superpowers/plans/2026-09-04-ptf-v1-plan-set-contract.md`
- Corrected execution roadmap: `docs/superpowers/plans/2026-09-04-ptf-v1-execution-roadmap.md`

The review used two independent axes: plan/engineering standards and approved-spec fidelity. The approved specification remained immutable; all corrections in this review are implementation-plan corrections, not product-semantic changes.

---

## Standards axis

### Fixed point and repository state

The original planning branch was reviewed relative to the remediated specification commit. The planning history was ahead-only; no implementation source was intended in the planning phase. The planning branch root contained only repository/documentation material and no synthetic `src/`, `public/`, or `output/` tree.

### Writing-plans structure

The plan set contains:

1. rewrite roadmap;
2. Plan 00 Foundation;
3. Plan 01 Runtime/Persistence;
4. Plan 02 x402;
5. Plan 03 AP2;
6. Plan 04 OpenID4VP;
7. Plan 05 Trusted Surface/Developer Product;
8. Plan 06 Conformance/Portability/Recovery/Operations.

Literal scans of the plan resources found no `TODO`, `TBD`, or `implement later` placeholders. Plans generally name exact target files, public interfaces, test commands, expected results, and commit boundaries.

### Standards findings and remediation

#### S1 — inconsistent dependency sequence

The original roadmap allowed x402 and AP2 to run in parallel while AP2 Task 1 mutated shared workspace dependencies and required the complete Plan 00–02 regression suite. Parallel execution would race on shared `uv.lock` and contradict the dependency gate.

**Resolution:** Contract C1 and the verified execution roadmap make Plans 02 and 03 sequential. AP2 begins only after x402 acceptance.

#### S2 — avoidable mid-project dependency downgrade

The original Plan 00 used Pydantic `>=2.13`; Plan 01 used cryptography `>=50`; pinned AP2 requires Pydantic `2.12.5` and cryptography `46.0.5` exactly. x402 2.22.0 permits Pydantic `>=2.0.0`.

**Resolution:** Contract C2 pins the AP2-compatible versions from Plan 00/01 bootstrap. AP2 Task 1 becomes a verification/regression gate rather than a dependency downgrade.

#### S3 — over-specialized approval evidence type

`ApprovalEvidence.plan_fingerprint` was reused for Standing Grant activation, creating a misleading and error-prone cross-domain type.

**Resolution:** Contract C3 introduces `AuthorizationTargetKind` plus generic `canonical_fingerprint`. ExecutionGrant remains plan-specific through `plan_fingerprint`.

#### S4 — target tree contained unowned files

Plan 01's file map contained `personal_state_repository.py` and `resource_repository.py`, but no task actually created/verified either module.

**Resolution:** Contract C5 and C6 add executable persistence tasks with exact interfaces and security tests.

### Standards conclusion

After the contract corrections, no remaining known plan-standard defect requires changing the approved architecture. The execution coordinator must still apply Contract C10 before dispatching each task: a task lacking exact files/interfaces/red test/red command/implementation shape/green command/commit/review gate returns to planning.

---

## Specification-fidelity axis

### Findings and remediation

#### F1 — Safe View had regressed toward a generic profile dump

The approved specification requires an ephemeral, task-specific Safe View with independently derived ContextView and AuthorityView. The original Plan 01 exposed parameterless `GET /v1/agent/safe-view`; Plan 05 exposed parameterless `getSafeView()`; no plan defined the runtime AuthorityView composition.

**Resolution:** Contract C4 defines `SafeViewRequest`, `RequestableActionView`, `AuthorityView`, `SafeView`, and `ActionRuntime.get_safe_view(...)`. The Agent route becomes `POST /v1/agent/safe-view` with task/context/requested-key input. Personal State mutations are explicitly metamorphically tested not to broaden AuthorityView.

#### F2 — Personal State persistence was absent

Without a real repository, provenance, correction, supersession, erasure, freshness, and later Trusted Surface operations would have been forced into ad-hoc storage.

**Resolution:** Contract C5 adds a provenance-preserving `PersonalStateRepository` and erasure tests that remove personal content without putting erased content into audit.

#### F3 — Protected Resource Catalog was absent

Protocol flows and Principal resource status depended on a file listed but never implemented, risking raw provider data or protocol-specific resource state leaking into unrelated modules.

**Resolution:** Contract C6 defines a metadata-only `ProtectedResourceRecord`/repository and tests that resource references cannot exercise a resource without Execution Grant + Plan.

#### F4 — trust management was read-only in the reference product

The approved product includes trust management; Plan 05 only exposed a read surface.

**Resolution:** Contract C7 adds structured TrustRelation creation/revocation against already validated bindings. Labels/display names cannot create trust.

#### F5 — device product surfaced before its backend existed

Plan 05 listed device views before Plan 06 created the device enrollment/revocation/recovery state.

**Resolution:** Contract C8 removes device administration from Plan 05 and completes backend + Principal routes + UI in Plan 06.

#### F6 — route/SDK trust-level partition required correction

The unscoped Safe View route propagated into the Agent OpenAPI/SDK contract.

**Resolution:** Contract C9 freezes the corrected five-route Agent allowlist and keeps all Principal/admin schemas physically absent from the Agent document/SDK.

### Spec conclusion

The remediated plan set preserves the approved authority, Personal State, identity/trust, planning, protected execution, protocol, audit, portability, product, and conformance semantics. No review finding required changing the exact approved specification blob.

---

## Foundational acceptance-gate coverage

Each approved gate has at least one concrete implementation task and a later black-box/release verification point.

| Gate | Approved requirement | Primary implementation/evidence |
|---:|---|---|
| 1 | Personal State / Authority structural separation | Plan 00 Tasks 3,5,8; Contract C4; Plan 06 `AUTH-PERSONAL-STATE-NO-BROADEN` |
| 2 | executable Personal-State-no-broaden oracle | Plan 00 Task 8; Plan 06 mandatory oracle suite |
| 3 | distinct Standing Grant / Exact Human Approval | Plan 01 Tasks 5,7; Contract C3; Plan 05 Tasks 4–6 |
| 4 | canonical authenticated Standing Grant creation | Plan 01 Task 5; Contract C3; Plan 05 WebAuthn/grant authorization |
| 5 | authenticated Hard Policy mutation outside Agent | Plan 01 Tasks 5,10; Plan 05 Plan/Policy UI; Agent OpenAPI exclusion tests |
| 6 | plan-bound Execution Grants / mutation rejection | Plan 00 Task 6; Plan 01 Tasks 6–7; Plan 05 approval mutation tests |
| 7 | no grant unioning | Plan 00 Task 5 + Task 8; Plan 06 `AUTH-NO-GRANT-UNION` |
| 8 | CP1/CP2 aggregate-race safety | Plan 00 Task 5; Plan 01 Task 6; Plan 06 `COORD-AGGREGATE-RACE` |
| 9 | real recipient-binding evidence | Plan 01 Task 4; x402 Task 2; AP2/OID4VP binding tests; Plan 06 identity oracles |
| 10 | ProtectedResourceRef alone cannot exercise resource | Contract C6; Plan 01 synthetic executor; protocol executor negative tests; Plan 06 oracle |
| 11 | at least one executor keeps reusable secret/key outside Agent | Plan 01 Task 8; x402 Task 4; AP2 Task 5; OID4VP Task 5 |
| 12 | Assurance Manifest | Plan 00 Task 6; executors/protocol plans; Plan 06 receipt/conformance evidence |
| 13 | complete Enforcement Map / no semantic loss | Plan 00 Task 6/8; x402/AP2/OID4VP enforcement tasks; Plan 06 oracle |
| 14 | unsupported mandatory constraints fail closed | Plan 00 Tasks 5–6; protocol enforcement tasks; Plan 06 `PLAN-DOWNGRADE-POLICY` |
| 15 | x402 + AP2 before common adapter API | Plans 02–03; AP2 Task 9; Contract C1; explicit no-base-interface gate |
| 16 | materially distinct credential-presentation proof | Plan 04 OpenID4VP Tasks 1–8 |
| 17 | protocol Evidence Artifacts separate from PTF authority | Plans 02–04 flow/evidence tasks; protocol-valid-but-PTF-denied conformance tests |
| 18 | `INDETERMINATE` cannot blind retry | Plan 01 Task 7; x402 Task 7; Plan 06 `EXEC-INDETERMINATE-NO-BLIND-RETRY` |
| 19 | privacy-safe PTFReceipt | Plan 00 Task 7; Plan 01 AI0/ActionRuntime; Plan 06 leakage suite |
| 20 | memory/source laundering cannot create authority/trust | Plan 00 Tasks 3/8; Contract C4; Plan 06 `MEMORY-SOURCE-LAUNDERING` |
| 21 | execution-time policy/grant/trust/resource revalidation | Plan 01 Task 7; protocol executor precommit checks; Plan 06 `AUTH-REVOCATION-RECHECK` |
| 22 | Freshness Policy exercised | Plan 00 Task 3; OpenID4VP Task 3; Safe View repository/runtime path |
| 23 | Trust Registry epoch/staleness rules | Plan 01 Task 4; Plan 06 multi-device/revocation/conformance |
| 24 | portability import cannot self-declare trust | Plan 06 Task 4 + `PORTABILITY-IMPORT-NO-TRUST-ESCALATION` |
| 25 | recovery does not broaden TCB | Plan 06 Task 5 + `RECOVERY-TCB-NO-BROADENING` |
| 26 | leak-canary coverage for declared negative visibility | Plan 01 Task 8/10; Plans 02–04 leak tests; Plan 05 storage tests; Plan 06 leakage oracles |
| 27 | executable mandatory conformance before claim | Plan 06 Tasks 1–3,9–10; corrected roadmap final verification |
| 28 | self-contained source of truth; milestones cannot redefine scope | AGENTS/approved spec/ADRs; verified contract/roadmap; release-copy acceptance test |

---

## Product-contract coverage beyond the 28 foundational gates

The plan set also covers:

- Personal State correction and erasure: Contract C5 + Plan 05;
- Protected Resource safe metadata/status: Contract C6 + Plan 05;
- Principal trust management: Contract C7 + Plan 05;
- multi-device management: Plan 06 Tasks 5/7 via Contract C8;
- versioned portability and safe import: Plan 06 Task 4;
- recovery: Plan 06 Task 5;
- Trusted Surface approval: Plan 05;
- narrow Agent SDK: Plan 05;
- audit AI0/AI1: Plan 01 Task 9, Plan 06 Task 6;
- threat model, CI, SBOM, dependency/secret scanning, truthful release claims: Plan 06 Tasks 8–10.

---

## Remaining execution blocker

The immutable Git tag `webmcp-sandbox-v0.1` has not been created by the planning connector. It remains a deliberate hard execution preflight. Before source code work:

```bash
git rev-parse origin/legacy/webmcp-sandbox
# must equal 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9

git rev-list -n 1 webmcp-sandbox-v0.1
# must resolve to the same commit
```

If the tag is absent or resolves elsewhere, source implementation stops.

---

## Planning acceptance statement

The verified execution source is the combination of:

1. the exact approved specification + approval record;
2. accepted ADRs;
3. `2026-09-04-ptf-v1-plan-set-contract.md`;
4. `2026-09-04-ptf-v1-execution-roadmap.md`;
5. the seven detailed 2026-09-03 subsystem plans.

The old roadmap remains historical planning evidence but is superseded for execution order by the September 4 roadmap. The old subsystem plans remain executable detail only subject to the September 4 contract.

No implementation source code was added by this audit.