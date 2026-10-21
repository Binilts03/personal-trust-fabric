# PR #104 — DPDP/privacy-enforcement implementation review gate

**Date:** 2026-10-20
**Base:** `7b52d61ea207d1d37d11a8c85f3253466b732537` (frozen pre-feature `main`)
**Branch:** `feature/dpdp-privacy-enforcement`
**Repair-batch head:** `4ba8fbafa7dc608ee95ed8b0c9e07a5913d96900` (journal-first payment recovery + the fallow repair batch; this document lands in the follow-up docs commit)
**Design:** [2026-10-18-dpdp-privacy-enforcement-design.md](../specs/2026-10-18-dpdp-privacy-enforcement-design.md)
**Plan:** [2026-10-18-dpdp-privacy-enforcement-master.md](../plans/2026-10-18-dpdp-privacy-enforcement-master.md)
**Disposition:** Draft PR; the P2 repair batch (including journal-first payment recovery) passed the full local gate and is awaiting a fresh independent Standards/Spec/Security re-review. No merge, publish or compliance assertion is authorised until that disposition is recorded as clean.

## Per-slice implementation heads / verification

These are historical slice checkpoints, **not** a claim that the individual SHA independently passed every later gate.

| Slice                     | Checkpoint SHA                             | Delivered seam / tests                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — vault foundation      | `822212e56b9314acdebb1542392c30e1acab060d` | Exact vault erasure, extracted store and persistence modules, existing vault regressions                                                                                                                                          |
| B — privacy model/storage | `2b411318d8b5513dae3056d1696bff4c75bf9e56` | Evidence model, DPDP profile, encrypted privacy state/event repositories, TDD suites                                                                                                                                              |
| C — runtime and rights    | `b10a1bcfb2584ad0328e562f632d89a767790874` | Authority-first privacy gate, evidence precommit, vault/provider wrappers and rights views                                                                                                                                        |
| D — host integration      | `578573a2f3bcf13cbafe01be3ace2175bde8edc3` | MCP protected disclosure and payment wrapper integration; evidence precedes authority consumption and journaled payment                                                                                                           |
| E — adversarial repairs   | `2c3af1d20896916402a3adc26b0f0a08e1e5d890` | Identifier denial, event state reconciliation, direct-identifier and traversal refusal, proof-of-attempt identity, bounded storage, backup manifest, offline operator recovery, diagnostics, curated exports, structural cleanups |

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

**Important:** verification of newer commits must be read from their own run. Do not apply these green counts to an unverified newer SHA. CI does not run the standalone harness or `npm pack --dry-run`; the local receipts below record those checks against the seam-parity commit.

## P2 repair batch — full local gate (2026-10-20)

Executed on Windows/PowerShell and Git Bash against `0d6c6f9781391c4a6e72640878a10c402dec00da`, Node 22.23.1:

- `npm run typecheck` — PASS
- `npm test` — **465 passed / 0 failed**; 84 suites
- `npm run eval` — **9 passed / 0 failed**
- `node scripts/check-seams.mjs` — PASS (`seam check: ok`, `zero-dep core: ok`)
- `bash scripts/harness.sh` via Git Bash — **PASS** (`OK: harness green`)
- `prettier --check` on every PR-changed file — PASS

The earlier 436-test receipt below is historical and must not be applied to this head.

### P2 review blockers and disposition

The fresh Standards/Spec/Security review of `b16358a` produced security CLEAN, plus these Standards/Spec blockers, all repaired in `0d6c6f9`:

1. **Post-effect failure was reported as a privacy denial.** Fixed. A payment or disclosure that may have crossed the effect boundary now raises typed outcome-unknown evidence; the MCP host returns sanitized `outcome_unknown` and does **not** transition the proposal to `denied`. Existing terminal/attempt evidence returns `evidence_conflict` instead of a denial. `executeWithJournal` also signals ambiguity for quarantined and submitted-unknown journal resumes so privacy evidence cannot be misclassified as a pre-effect failure.
2. **MCP critical-path structure.** Gate construction remains in `src/privacy/mcp.ts`; store/runtime wiring now lives in `src/privacy/mcp-host.ts`; `src/mcp-server.ts` retains only routing hooks and sanitized response mapping. This matches the updated design note in §7.6.
3. **Existing tool schemas were bounded.** Retained as deliberate hardening. The design and ADR now state explicitly that no agent-supplied legal-basis/controller/subject fields were added and that conservative length/format bounds may reject malformed or pathological values. Valid generated terms, digests, keys, and signatures are unchanged.
4. **Inverted erasure-subject documentation.** Corrected in `docs/audit/operations.md`; `--subject-ref` selects subject-bound records, holds match record IDs/categories, and legacy unbound records are reported `unscoped`.
5. **Formatting gate failures.** Prettier applied to every PR-changed file; check now passes.

Additional repair-batch hardening: runtime clock use for evidence finalization, authority-reference binding in disclosure/use wrappers, EEXIST idempotency re-check, and fail-closed seam scanning when a root has no TypeScript source.

## Journal-first payment recovery — full local gate (2026-10-20)

The next independent Standards/Spec re-review of `0d6c6f9` reported one shared
blocker on each axis: **a post-effect `/pay` retry was a dead end**. After the
effect the proposal stayed pending, so the retry re-entered the challenge-time
authority dry-run. A spent single-use grant denied there and misclassified the
attempt as a denial; a grant with uses left issued a second capability and then
hit `PrivacyEventConflictError` on the `OUTCOME_UNKNOWN`/`SUCCEEDED` event. The
`outcome_unknown` guidance already promised journal replay that did not exist.

Repaired in `4ef3026`:

- `src/privacy/payment-replay.ts` (new): read-only journal inspection keyed by
  `deriveIdempotencyKey(termsDigest, "payment")`. Every stored field (action,
  recipient, resource, purpose, amount, currency) must match the proposal
  exactly; drift, a corrupt scan, a live row, or a `RECONCILED` row are
  ambiguous, never a receipt. A `SUCCEEDED` row projects the same external
  receipt shape the live path returns.
- `src/mcp-server.ts`: the journal is consulted **before** the authority
  preview, the challenge, and any consumption. A conclusive success returns the
  receipt, finalizes the Processing Event idempotently, and repairs the
  proposal to `executed` (`recoverExecutedProposal` in
  `src/store/challenges.ts`, which can also undo an older misclassified
  denial). An unsettled journal returns `outcome_unknown` **before** a
  challenge is issued, so no authority use is burned. `ptf_check` and
  `ptf_get_receipt` are journal-aware.
- `src/privacy/runtime.ts`: `reconcileAttemptEvent` finalizes an existing
  `PREPARED`/`OUTCOME_UNKNOWN` event from journal evidence, reconstructs a
  missing event from the still-valid privacy decision, and reports a terminal
  event conflict instead of overwriting it. `FilePrivacyEventRepository`
  gained an optional `findByAttempt` lookup (`src/privacy/model.ts`).

Behaviour change (intentional, documented in the design §9.2.1/§14, ADR-0024,
the changelog, and `docs/audit/limits.md`): a `/pay` retry that finds a
journaled success returns the receipt directly, and an unsettled journal is
answered with `outcome_unknown` before any challenge. The crash matrix
(`tests/mcp-crash.test.ts`) was updated to assert the new contract - same
transaction, no second effect, no second authority use.

Local gate executed on Windows/PowerShell and Git Bash against
`4ef30266b4816d06c753ae2e92a5d09f05b9efa2`, Node 22.23.1:

- `npm run typecheck` — PASS
- `npm test` — **480 passed / 0 failed**; 86 suites
- `npm run eval` — **9 passed / 0 failed**
- `node scripts/check-seams.mjs` — PASS (`seam check: ok`, `zero-dep core: ok`)
- `bash scripts/harness.sh` via Git Bash — **PASS** (`OK: harness green`)
- `prettier --check` on every PR-changed file — PASS

The earlier 465-test receipt is historical and must not be applied to this head.

### Repair-batch gate (after the fallow review session)

The fallow repair batch (`4ba8fba`) re-ran the whole gate on the same
platform:

- `npm run typecheck` — PASS
- `npm test` — **484 passed / 0 failed**; 86 suites
- `npm run eval` — **9 passed / 0 failed**
- `node scripts/check-seams.mjs` — PASS (`seam check: ok`, `zero-dep core: ok`)
- `bash scripts/harness.sh` via Git Bash — **PASS** (`OK: harness green`)
- `prettier --check` on every PR-changed file — PASS
- GitHub Actions at `4ba8fba` — **green** (both required jobs)

### Re-review-fix gate (after the independent re-review of `4ba8fba`)

The re-review of `4ba8fba` returned **APPROVE** with six minor findings; all
six are repaired in `67d5501`:

1. `isSubset` had reached the curated `./privacy` surface without a
   public-surface decision (ADR-0011) — it is now an internal helper in
   `src/privacy/internal.ts`.
2. The read-only status tools reported a never-submitted journal row as a
   generic `outcome_unknown` — they now report `not_submitted`, like the
   redeem path.
3. The replay audit line's revision bindings had no regression test — two
   tests now assert the `authorityRev` / `registryRev` / privacy-revision
   bindings and the `privacy-evidence-gap` line.
4. The design, the ADR, and this document said "exactly two legacy-visible
   exceptions" while the changelog listed the `not_submitted` vocabulary as
   well — the vocabulary is now named inside the journal-first-recovery
   exception.
5. This document quoted stale line counts and an over-broad complexity claim
   — both are restated from the head, and the PR-introduced long bodies are
   listed as P4 candidates.
6. The "repair-batch head" in the header pointed at the pre-repair commit —
   it now names `4ba8fba`.

Local gate at `67d5501` (Windows/PowerShell and Git Bash, Node 22.23.1):

- `npm run typecheck` — PASS
- `npm test` — **486 passed / 0 failed**; 86 suites
- `npm run eval` — **9 passed / 0 failed**
- `node scripts/check-seams.mjs` — PASS (`seam check: ok`, `zero-dep core: ok`)
- `bash scripts/harness.sh` via Git Bash — **PASS** (`OK: harness green`)
- `prettier --check` on every PR-changed file — PASS

(The commit message of `67d5501` says "487 tests"; the accurate count at
that head is **486**. The receipt above is the one to trust.)

- `fallow audit --base 7b52d61` — dead-code findings for the changed set:
  **0**; duplication groups introduced by this PR: **0**. The remaining
  complexity findings are pre-existing legacy functions (see the fallow
  section above).

## Fallow codebase-intelligence review (2026-10-21)

`fallow` 3.34.1 (`npx fallow audit --base 7b52d61`) was run over the
base-to-head diff, and a repo-local `.fallowrc.json` was added so the tool
sees this repository's real entry points (`node --test` suites, the CLI/MCP
binaries, the example hosts) instead of guessing a bundler layout.

Findings the session introduced by this PR, and their disposition:

| Finding                                                                                                               | Disposition                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19 test files reported as unused (the tool did not know the test runner)                                              | Fixed by `.fallowrc.json` (entry points + `dist` ignore). Dead-code findings for the changed set: **0**.                                                                                                                                                                                                                               |
| `src/privacy/providers.ts` re-exported `PrivacyOutcomeUnknownError` with no consumer                                  | Removed (the curated `./privacy` surface already exports it).                                                                                                                                                                                                                                                                          |
| `ptf_check` and `ptf_get_receipt` carried identical 33-line handlers                                                  | Extracted one shared status payload (`proposalStatusPayload`/`proposalStatusResult`).                                                                                                                                                                                                                                                  |
| `transitionProposal` and `recoverExecutedProposal` duplicated the live-proposal prologue                              | Extracted `loadLiveProposal`.                                                                                                                                                                                                                                                                                                          |
| The new journal-replay helpers were complexity hotspots (cyclomatic 20-23)                                            | Split into single-purpose functions (`receiptFromRecord`, `sameTerms`, `classify`, `locateAttemptEvent`, `finalizeAttemptEvent`, `recoverJournaledPayment`, `issueRecipientChallenge`, `readPaymentDemand`); the highest new function is now cyclomatic 13.                                                                            |
| Duplication inside the PR's own new modules (the DEK/envelope guards, the privacy CLI switch, the vault record types) | The JSON-envelope guard and the vault record types are shared now; `src/cli/privacy.ts` is split into `privacy.ts` (router), `privacy-evidence.ts`, `privacy-rights.ts`, `privacy-shared.ts`; the vault's protected-use surface moved to `vault-protected-use.ts` + `vault-types.ts`. Duplication groups introduced by this PR: **0**. |

The remaining fallow complexity findings are pre-existing legacy functions
(`src/cli.ts` `run`, `src/core/execute.ts`, `src/store/backup.ts`,
`src/adapters/providers.ts` `executeWithJournal`, `src/store/vault-store.ts`
`disclose`/`useSecret`) that this PR only touched at the edges, plus a few
PR-introduced bodies that are long but flat (`src/cli/privacy-rights.ts`
`privacyCorrection`, `src/privacy/dpdp.ts` `validateConsent`,
`src/privacy/engine.ts` `evaluateProcessing`,
`src/privacy/mcp.ts` `resolveMcpPrivacyConfig`). Those are tracked as P4
refactoring candidates, not as merge blockers; the journal-replay helpers
this PR added are the smallest functions in the change
(`readPaymentDemand` is the largest, at cyclomatic 13).

The design's §18.3 file-size ceiling is honoured by the new privacy modules:
at the repair-batch head `src/cli/privacy.ts` is 176 lines (evidence 136,
rights 439, shared 193) and `src/store/vault-store.ts` is 590 lines (the
protected use and the shared types moved out), each within the ~500-600 line
ceiling. Re-measure before quoting these counts at a later head.

## Independent review round (2026-10-21) and disposition

Three independent reviews ran against `bb2d13f`:

- **Standards**: REQUEST CHANGES - one MAJOR (the changelog claimed
  "backward-compatible, additive only" while shipping documented behaviour
  changes, and the MCP input bounds had no changelog entry) and five MINOR
  findings. All are repaired: the changelog now enumerates the real
  exceptions (MCP input bounds, journal-first replay, the `--path` CLI
  guard); the review-gate seam-exemption claim is corrected; the duplicated
  `stateRevisions` validation in `src/core/execute.ts` is shared; the
  `ptf privacy --path` flag override (a validation bypass) is closed with a
  regression test; the journal-expectation duplication and a double
  `load()` in `ptf_request_data` are gone; and the two files above the
  design's size ceiling are split.
- **Spec**: APPROVE - no BLOCKER, no MAJOR. Its MINOR findings are
  addressed: the journal replay moved into `src/privacy/mcp-host.ts`
  (§7.6 separation), a conclusive journal success is never downgraded
  because the _evidence_ could not be repaired (the gap is recorded for the
  operator instead), §5.18/§14/ADR-0024 now carve out the two documented
  legacy-visible exceptions, the CLI help names the consent id, and the
  split closes the §18.3 file-size finding.
- **Security**: APPROVE - no BLOCKER, no MAJOR. Its MINOR findings are
  addressed: the read-only status tools skip the journal scan for a
  terminal proposal, the replay audit line now carries the same
  authority/registry/privacy revision bindings as a normal redeem (so the
  rollback detector keeps its witness in the crash window), and a
  never-submitted journal row is reported as `not_submitted` instead of a
  generic "unsettled" answer - on the `ptf_redeem` path and in the read-only
  status tools alike. The O(n) journal/event scan cost and the
  stranded never-submitted attempt are disclosed in `docs/audit/limits.md`.

## Historical local full-gate receipts (2026-10-20)

Executed on Windows/Git Bash against `7de4ea55415421e01a60d7e4ed326e6b14e6552f` after `npm ci`, Node 22.23.1:

- `npm run check:brand` — PASS
- `npm run typecheck` — PASS
- `npm test` — **436 passed / 0 failed**
- `npm run eval` — **9 passed / 0 failed**
- `bash scripts/harness.sh` — **PASS** (`OK: harness green`), including the shared public-seam and zero-dep-core guards
- `npm pack --dry-run` — **PASS**: 125 files, package 216.0 kB, unpacked 820.8 kB
- `node scripts/check-seams.mjs` — PASS on the repo; RED (exit 1 with file:line evidence) on a fixture importing `../src/store/vault.js`, `../src/privacy/dpdp.js`, and `node:fs` / `some-package` from core

Cause of the earlier harness gap: CI carried two narrow privacy-persistence seam exemptions that `scripts/harness.sh` lacked. Both gates now call `scripts/check-seams.mjs`, so the exemption list has one reviewed source and cannot drift. The exemption list is file-scoped and exact: six test files may reach three internal specifiers - `../src/store/privacy.js` and `../src/store/privacy-events.js` (repo-owned persistence suites) and `../src/privacy/payment-replay.js` (the journal-replay unit suite). All other tests must use the public barrel or a bin entry point.

## Verify-this acceptance matrix

Scoped verification; "VERIFIED" means only the claim and test boundary shown, not statutory legal sufficiency.

| Claim                                                                   | Status                                 | Evidence / limitation                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authority denial prevents privacy-state reads                           | **VERIFIED**                           | `tests/privacy-runtime.test.ts`: zero privacy reads after non-consuming authority denial                                                                                                                                                |
| Privacy basis cannot grant Authority                                    | **VERIFIED**                           | `tests/privacy-runtime.test.ts`, `tests/privacy-engine.test.ts`: deny cannot become allow                                                                                                                                               |
| Inactive/withdrawn basis denies future privacy-wrapped processing       | **VERIFIED**                           | DPDP, runtime and MCP stdio tests; a withdrawal concurrent with post-recheck execution is a documented residual                                                                                                                         |
| Data Principal/controller/basis are not selected by MCP agent arguments | **VERIFIED for reference host**        | `tests/privacy-mcp.test.ts`; trusted operator JSON and encrypted store determine the context                                                                                                                                            |
| Actual MCP data presentation is privacy-gated                           | **VERIFIED for opt-in stdio host**     | `tests/privacy-mcp-stdio.test.ts`: active allow, inactive deny, legacy disabled case                                                                                                                                                    |
| Actual MCP payment/protected journal path is privacy-gated              | **VERIFIED for opt-in stdio host**     | `tests/privacy-mcp-stdio.test.ts` payment proof, receipt and encrypted Processing Event; missing `actionCategories` denies                                                                                                              |
| Extra requested data categories / recipient are denied                  | **VERIFIED**                           | `tests/privacy-engine.test.ts`, `tests/privacy-vault.test.ts`                                                                                                                                                                           |
| Direct subject identifiers are rejected                                 | **VERIFIED for configured inputs**     | `tests/privacy-engine.test.ts`, `tests/privacy-events.test.ts`, `tests/privacy-store.test.ts`; syntax does not prove pseudonymity                                                                                                       |
| Secret record existence is not inspected prior to denied Authority      | **VERIFIED**                           | `tests/privacy-vault.test.ts` traced Vault; zero metadata and privacy reads for unauthorized use                                                                                                                                        |
| Event precommit/UNKNOWN and terminal reconciliation                     | **VERIFIED for tested state machine**  | `tests/privacy-events.test.ts`, `tests/privacy-cli.test.ts`; physical power-loss survival on all filesystems unproven                                                                                                                   |
| Post-effect/ambiguous failure is not reported as a denial               | **VERIFIED for wrapper/MCP mapping**   | `tests/privacy-providers.test.ts`; MCP returns sanitized `outcome_unknown`/`evidence_conflict`; payment journal remains the oracle, disclosure requires operator/recipient check                                                        |
| Journal replay returns the same receipt and fills missing evidence      | **VERIFIED for reference `/pay` host** | `tests/privacy-payment-replay.test.ts`, `tests/privacy-mcp-stdio.test.ts`, `tests/mcp-crash.test.ts`; spent single-use grant is not consumed again, event is finalized or reconstructed, drift/corrupt/live rows stay `outcome_unknown` |
| Existing terminal/attempt evidence is never reused for a new effect     | **VERIFIED**                           | `tests/privacy-providers.test.ts`; typed conflict before the provider callback                                                                                                                                                          |
| Correction passes DPDP checks and proves one revision                   | **VERIFIED for tested CLI path**       | `tests/privacy-cli.test.ts`; `/correct` activity, subject/controller/basis, opaque request ref and `previousVersion + 1` proof                                                                                                          |
| Deleted encrypted event in backup is detected                           | **VERIFIED**                           | `tests/backup.test.ts`: manifest regression. Manifest has no independent external witness                                                                                                                                               |
| Record erasure and operator holds                                       | **VERIFIED for exact PTF-managed IDs** | `tests/privacy-rights.test.ts` and existing vault erasure tests; subject-to-record mapping belongs to operator                                                                                                                          |
| Legacy MCP and broad existing suite remain unaffected when disabled     | **VERIFIED by CI tests**               | Existing suites and opt-in-disabled stdio test                                                                                                                                                                                          |
| Model/Authority boundary preserved                                      | **VERIFIED by code inspection**        | Privacy lives in `src/privacy/` and store modules, not Authority grant creation                                                                                                                                                         |
| Privacy package does not expose file-backed repositories                | **VERIFIED by source/test**            | `src/privacy/api.ts`, `src/index.ts`, `tests/privacy-public-api.test.ts`; CI permits only the three explicitly named internal specifiers, each scoped to named repo-owned test files (`scripts/check-seams.mjs`)                        |
| Every possible external processing path is privacy enforced             | **NOT VERIFIED**                       | Deliberately out of scope: general actions, custom providers and unrelated operator CLI flows must compose PrivacyRuntime themselves                                                                                                    |
| Consent-withdrawal/effect ordering is globally atomic                   | **NOT VERIFIED**                       | Last recheck → authority CAS → external effect is not one atomic transaction; see audit limits                                                                                                                                          |
| Statutory DPDP Act compliance / Consent Manager registration            | **NOT VERIFIED / not claimed**         | The code validates operator evidence; it does not decide lawfulness, register as Consent Manager or provide full DSAR/breach handling                                                                                                   |

## Standards axis — structural review

- The pre-feature `src/store/vault.ts` large implementation was decomposed behind a thin facade without removing its required behavior; vault suites remain in CI.
- No new non-core runtime dependency was introduced for DPDP privacy. The generic Authority engine still owns the power and privacy remains a narrowing gate.
- Gate construction lives in `src/privacy/mcp.ts`; store/runtime wiring lives in `src/privacy/mcp-host.ts`; `src/mcp-server.ts` retains routing hooks and agent-facing response mapping only. No agent-authored DPDP basis/controller/subject schema was added.
- `src/mcp-server.ts` is **already a large pre-existing module** and remains so after the integration. Its remaining privacy conditionals are routing/hooks, not policy decisions or store construction; a general host decomposition remains a follow-on architecture item.
- Existing MCP string inputs gained conservative length/format bounds. This is documented as intentional hardening in the design/ADR; it adds no semantic field or new authority input.
- The privacy event store has an explicit 5,000-record ceiling, O(n) encrypted scans, and filename metadata leakage, all documented in `docs/audit/limits.md`.
- The internal persistence implementations are not re-exported through the public privacy package/root index; repository-only tests explicitly target them and the CI guard documents the narrow exception.

## Spec axis — coverage and remaining limits

The five planned slices are implemented with explicit non-goals: no compliance certificate, no automatic legal-basis determination, no statutory Consent Manager, no general multi-tenant/remote provider deployment, no enterprise-wide data erasure, no external process attestation.

**Known deferred engineering issues:** configuration validation still uses some TypeScript assertions at the operator JSON edge; privacy holds govern erasure planning but do not directly deny runtime processing; the file event store has no CAS and keeps a 5,000-record ceiling (its lookups are now indexed - see the P4 batch below); a hard crash can leave a Processing Event `PREPARED` until a retry or operator reconciliation. Journal-first recovery is implemented for the reference host's `/pay` route only - other hosts must compose the same order themselves. None should be silently presented as solved.

**Since this gate was written, the P4 hardening batch landed** (each item as
its own pull request, all with a green gate and CI):

| PR   | Item | What it changed                                                                                             |
| ---- | ---- | ----------------------------------------------------------------------------------------------------------- |
| #105 | P4-1 | The withdrawal fence: privacy state re-evaluated at the effect boundary, after the burn, before the effect. |
| #106 | P4-4 | ADR-0025 - the per-host enforcement boundary (a library, not an interceptor).                               |
| #107 | P4-2 | One DEK resolution rule and one revision rule for every store.                                              |
| #108 | P4-3 | The indexed event store (`findByKey` direct, `findByAttempt` via a sealed attempt cache).                   |

## Gate / release decision

**Merged.** The independent Standards / Spec / Security reviews are all
clean at this head: Standards REQUEST CHANGES (one MAJOR) after the first
repair batch, then APPROVE after the fallow repair batch; Spec APPROVE; and
Security APPROVE. The Standards MAJOR and every minor finding from all three
axes are repaired, and the last re-review (of `4ba8fba`) returned APPROVE
with six minor findings, all closed in `67d5501`. The full local gate is
green at that head and CI is green. PR #104 was merged as `9c94ae3` on
2026-10-21. No claim here substitutes for the organisation's legal
review under Indian DPDP Act/Rules or other jurisdictions.
