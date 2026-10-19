# PR #104 — DPDP/privacy-enforcement implementation review gate

**Date:** 2026-10-19
**Base:** `7b52d61ea207d1d37d11a8c85f3253466b732537` (frozen pre-feature `main`)
**Branch:** `feature/dpdp-privacy-enforcement`
**Design:** [2026-10-18-dpdp-privacy-enforcement-design.md](../specs/2026-10-18-dpdp-privacy-enforcement-design.md)
**Plan:** [2026-10-18-dpdp-privacy-enforcement-master.md](../plans/2026-10-18-dpdp-privacy-enforcement-master.md)
**Disposition:** Draft PR for final independent review; no merge, publish or compliance assertion authorised.

## Per-slice implementation heads / verification

These are historical slice checkpoints, **not** a claim that the individual SHA independently passed every later gate.

| Slice | Checkpoint SHA | Delivered seam / tests |
|---|---|---|
| A — vault foundation | `822212e56b9314acdebb1542392c30e1acab060d` | Exact vault erasure, extracted store and persistence modules, existing vault regressions |
| B — privacy model/storage | `2b411318d8b5513dae3056d1696bff4c75bf9e56` | Evidence model, DPDP profile, encrypted privacy state/event repositories, TDD suites |
| C — runtime and rights | `b10a1bcfb2584ad0328e562f632d89a767790874` | Authority-first privacy gate, evidence precommit, vault/provider wrappers and rights views |
| D — host integration | `578573a2f3bcf13cbafe01be3ace2175bde8edc3` | MCP protected disclosure and payment wrapper integration; evidence precedes authority consumption and journaled payment |
| E — adversarial repairs | `2c3af1d20896916402a3adc26b0f0a08e1e5d890` | Identifier denial, event state reconciliation, direct-identifier and traversal refusal, proof-of-attempt identity, bounded storage, backup manifest, offline operator recovery, diagnostics, curated exports, structural cleanups |

Slices were implemented incrementally as separate commits. The exact checkpoint CI receipts were:

- A — [39063887108](https://github.com/Binilts03/personal-trust-fabric/actions/runs/39063887108): **COMPLETED/SUCCESS** at `822212e5`.
- B — [39064539814](https://github.com/Binilts03/personal-trust-fabric/actions/runs/39064539814): **COMPLETED/SUCCESS** at `2b411318`.
- C — [39065178747](https://github.com/Binilts03/personal-trust-fabric/actions/runs/39065178747): **COMPLETED/SUCCESS** at `b10a1bcf`.
- D — [39300196081](https://github.com/Binilts03/personal-trust-fabric/actions/runs/39300196081): **COMPLETED/FAILURE** at `578573a2`; this is an **intermediate RED** caused by the payment wrapper's out-of-scope authority citation, addressed by subsequent `71cdae2a` and later fixes. Do not label the D checkpoint green.
- E — [39302542942](https://github.com/Binilts03/personal-trust-fabric/actions/runs/39302542942): **COMPLETED/SUCCESS** at `2c3af1d2`.

The precise tests and output for each run remain in GitHub Actions. Intermediate RED runs are preserved as failure evidence and are not represented as passing. The complete final-branch green gates supersede the D intermediate run only for the later head, not retroactively at the failing SHA.

## Automated verification evidence

The last completed full gate at the time of this report is [GitHub Actions 39302314056](https://github.com/Binilts03/personal-trust-fabric/actions/runs/39302314056) for commit `2a975ba4193f92c8787ce2c067b81531e52a0299`. The earlier [39302128891](https://github.com/Binilts03/personal-trust-fabric/actions/runs/39302128891) run at `517c765acc2448b0e146bdaa65eab8d2430b1def` reported:

- `npm ci`, `npm run check:brand`, `npm run typecheck` — PASS.
- `npm test` — **436 passed / 0 failed**; 82 suites.
- `npm run eval` — **9 passed / 0 failed**.
- CI seam guard and core zero-dependency guard — PASS.
- Jekyll docs build and verified-secret scan — PASS.

**Important:** verification of newer commits must be read from their own run. Do not apply these green counts to an unverified newer SHA. `npm pack --dry-run` and the complete standalone harness script are **not evidenced by these CI jobs** and are not asserted PASS.

## Verify-this acceptance matrix

Scoped verification; "VERIFIED" means only the claim and test boundary shown, not statutory legal sufficiency.

| Claim | Status | Evidence / limitation |
|---|---|---|
| Authority denial prevents privacy-state reads | **VERIFIED** | `tests/privacy-runtime.test.ts`: zero privacy reads after non-consuming authority denial |
| Privacy basis cannot grant Authority | **VERIFIED** | `tests/privacy-runtime.test.ts`, `tests/privacy-engine.test.ts`: deny cannot become allow |
| Inactive/withdrawn basis denies future privacy-wrapped processing | **VERIFIED** | DPDP, runtime and MCP stdio tests; a withdrawal concurrent with post-recheck execution is a documented residual |
| Data Principal/controller/basis are not selected by MCP agent arguments | **VERIFIED for reference host** | `tests/privacy-mcp.test.ts`; trusted operator JSON and encrypted store determine the context |
| Actual MCP data presentation is privacy-gated | **VERIFIED for opt-in stdio host** | `tests/privacy-mcp-stdio.test.ts`: active allow, inactive deny, legacy disabled case |
| Actual MCP payment/protected journal path is privacy-gated | **VERIFIED for opt-in stdio host** | `tests/privacy-mcp-stdio.test.ts` payment proof, receipt and encrypted Processing Event; missing `actionCategories` denies |
| Extra requested data categories / recipient are denied | **VERIFIED** | `tests/privacy-engine.test.ts`, `tests/privacy-vault.test.ts` |
| Direct subject identifiers are rejected | **VERIFIED for configured inputs** | `tests/privacy-engine.test.ts`, `tests/privacy-events.test.ts`, `tests/privacy-store.test.ts`; syntax does not prove pseudonymity |
| Secret record existence is not inspected prior to denied Authority | **VERIFIED** | `tests/privacy-vault.test.ts` traced Vault; zero metadata and privacy reads for unauthorized use |
| Event precommit/UNKNOWN and terminal reconciliation | **VERIFIED for tested state machine** | `tests/privacy-events.test.ts`, `tests/privacy-cli.test.ts`; physical power-loss survival on all filesystems unproven |
| Deleted encrypted event in backup is detected | **VERIFIED** | `tests/backup.test.ts`: manifest regression. Manifest has no independent external witness |
| Record erasure and operator holds | **VERIFIED for exact PTF-managed IDs** | `tests/privacy-rights.test.ts` and existing vault erasure tests; subject-to-record mapping belongs to operator |
| Legacy MCP and broad existing suite remain unaffected when disabled | **VERIFIED by CI tests** | Existing suites and opt-in-disabled stdio test |
| Model/Authority boundary preserved | **VERIFIED by code inspection** | Privacy lives in `src/privacy/` and store modules, not Authority grant creation |
| Privacy package does not expose file-backed repositories | **VERIFIED by source/test** | `src/privacy/api.ts`, `src/index.ts`, `tests/privacy-public-api.test.ts`; CI permits only two explicitly named internal store imports in repo-owned persistence tests |
| Every possible external processing path is privacy enforced | **NOT VERIFIED** | Deliberately out of scope: general actions, custom providers and unrelated operator CLI flows must compose PrivacyRuntime themselves |
| Consent-withdrawal/effect ordering is globally atomic | **NOT VERIFIED** | Last recheck → authority CAS → external effect is not one atomic transaction; see audit limits |
| Statutory DPDP Act compliance / Consent Manager registration | **NOT VERIFIED / not claimed** | The code validates operator evidence; it does not decide lawfulness, register as Consent Manager or provide full DSAR/breach handling |

## Standards axis — structural review

- The pre-feature `src/store/vault.ts` large implementation was decomposed behind a thin facade without removing its required behavior; vault suites remain in CI.
- No new non-core runtime dependency was introduced for DPDP privacy. The generic Authority engine still owns the power and privacy remains a narrowing gate.
- The two MCP runtime builders were collapsed to one focused operation dispatcher; no agent-authored DPDP basis/controller/subject schema was added.
- `src/mcp-server.ts` is **already a large pre-existing module** and remains so after the integration. A general host decomposition is a follow-on architecture item, not an excuse to insert new DPDP conditionals into generic Authority.
- The privacy event store has an explicit 5,000-record ceiling, O(n) encrypted scans, and filename metadata leakage, all documented in `docs/audit/limits.md`.
- The internal persistence implementations are not re-exported through the public privacy package/root index; repository-only tests explicitly target them and the CI guard documents the narrow exception.

## Spec axis — coverage and remaining limits

The five planned slices are implemented with explicit non-goals: no compliance certificate, no automatic legal-basis determination, no statutory Consent Manager, no general multi-tenant/remote provider deployment, no enterprise-wide data erasure, no external process attestation.

**Known deferred engineering issues:** configuration validation still uses some TypeScript assertions at the operator JSON edge; privacy holds govern erasure planning but do not directly deny runtime processing; long-lived provider connectors need host-owned fencing against consent-withdrawal races; separate DEK rotation/JSON snapshot helpers merit further consolidation only with behavior-preserving tests. None should be silently presented as solved.

## Gate / release decision

**Do not merge yet.** The author performed this consolidated self-review; a fresh independent reviewer has **not** reviewed every change added after the earlier multi-stream audit. Re-check exact HEAD CI and the user-controlled merge decision before changing PR draft status. No claim here substitutes for the organisation's legal review under Indian DPDP Act/Rules or other jurisdictions.
