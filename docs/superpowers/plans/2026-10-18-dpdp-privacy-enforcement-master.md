# DPDP Privacy Enforcement Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a jurisdiction-neutral privacy-enforcement and evidence subsystem to PTF, with an India DPDP 2025 profile, without weakening the existing authority/protected-use invariants or breaking non-privacy behavior.

**Architecture:** Privacy is a second narrowing gate adjacent to PTF Authority. The implementation is split into five plans: structural foundation/vault erasure; privacy model and encrypted stores; runtime enforcement/evidence; operator/MCP/public integration; whole-branch adversarial review and verification.

**Tech Stack:** TypeScript 7, Node 22+, node:crypto/fs/path only in trust-path modules, existing MCP SDK/Zod dependencies, node:test, existing file-CAS/audit/journal conventions.

**Spec:** `docs/superpowers/specs/2026-10-18-dpdp-privacy-enforcement-design.md`

## Global Constraints

- Frozen implementation base before work: `main@7b52d61ea207d1d37d11a8c85f3253466b732537`; carry the approved spec/plan commits onto the implementation branch.
- Preserve all AGENTS.md invariants, especially Personal State ≠ Authority State, policy constrains/never creates, use-without-possession, CHECK ≠ REDEEM ≠ EXECUTE, and exact authorized-operation binding.
- Add the new invariant: Personal State ≠ Authority State ≠ Processing Basis Evidence; PTF Principal ≠ Privacy Data Principal Reference.
- Privacy may deny; privacy may never create authority.
- No DPDP/privacy special cases in `src/core/authority.ts`.
- No legal-basis/controller/subject-classification field may be agent supplied.
- Non-privacy behavior is unchanged unless privacy mode is explicitly enabled.
- No new runtime dependency without a separate ADR and allowlist update.
- Preserve the `./vault` public surface and current import compatibility.
- `src/store/vault.ts` must end materially smaller than the frozen-base ~1,048 lines.
- Do not grow privacy business logic inside `src/cli.ts`, `src/mcp-server.ts`, or `src/adapters/providers.ts`.
- Processing records contain identifiers/metadata only; never raw personal values, direct subject identifiers, credentials, notice bodies, consent bodies, or model reasoning.
- Current legal profile source is the DPDP Act 2023 plus notified DPDP Rules 2025 and published corrigendum; the profile does not make legal-sufficiency conclusions.
- Every slice must leave `npm run check:brand && npm run typecheck && npm test && npm run eval && bash scripts/harness.sh` green before the next slice starts.

## Review Focus

1. **Unauthorized-oracle input:** an actor without PTF authority must not learn whether a consent/basis/subject record exists; pin with authority-denied privacy-runtime tests in Slice C.
2. **Crash at disclosure/effect boundary:** a processing attempt must leave PREPARED/OUTCOME_UNKNOWN evidence rather than disappear; pin in event-repository and runtime crash tests in Slices B/C.
3. **Secret/direct-identifier sentinel:** personal values and direct subject identifiers must never enter events/audit/CLI/MCP errors; pin leak tests in Slices B–D.
4. **Consent withdrawal race:** withdrawal after proposal/preflight but before actual disclosure/use must deny on live re-check; pin in Slice C.
5. **Legacy deployment:** a store without privacy state and an MCP server with privacy mode disabled must behave exactly as frozen-base behavior; pin regression tests in Slices A/D.

---

## Execution Order

- [ ] **Plan A — Foundation and vault decomposition:** `docs/superpowers/plans/2026-10-18-dpdp-slice-a-foundation-vault.md`
- [ ] **Plan B — Privacy model, DPDP profile, encrypted stores:** `docs/superpowers/plans/2026-10-18-dpdp-slice-b-model-store.md`
- [ ] **Plan C — Runtime enforcement, processing evidence, rights support:** `docs/superpowers/plans/2026-10-18-dpdp-slice-c-runtime-evidence.md`
- [ ] **Plan D — Operator, MCP, public API and documentation integration:** `docs/superpowers/plans/2026-10-18-dpdp-slice-d-integration.md`
- [ ] **Plan E — Thermo-nuclear review, verify-this evidence, release gate:** `docs/superpowers/plans/2026-10-18-dpdp-slice-e-review-release.md`

## Branch Discipline

- [ ] At execution start, create an isolated worktree/branch using `superpowers:using-git-worktrees`; do not modify `main` directly.
- [ ] Use one implementation branch, recommended `feature/dpdp-privacy-enforcement`, based on the approved design/plan branch head.
- [ ] Keep commits task-scoped and reversible; do not squash until final review is complete.
- [ ] After each slice, record the exact head SHA and verification commands/results in the implementation log or PR description.
- [ ] Do not merge or publish automatically; finishing/merge choice happens only after Plan E passes.

## Completion Definition

The mission is complete only when all five plans are checked, all section-22 spec acceptance criteria have direct evidence, the whole-branch structural review returns APPROVE, and the final verification matrix is green.
