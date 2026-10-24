# Domain-neutral consolidation — implementation evidence and review handoff

**Date:** 2026-10-24  
**Base:** `cb687c685ba19627d4aa59c7e4375b18ded92c1f` on `main`  
**Implementation branch:** `feat/ptf-domain-neutral-consolidation-20261024`  
**PR:** [#121](https://github.com/Binilts03/personal-trust-fabric/pull/121) (draft; never merged or deployed)  
**Review state:** implementation and synthetic integration exercised; independent security/maintainability review still required for approval.

This report supersedes the *implementation-blocker conclusions* in the earlier
[2026-10-24 consolidation gate](2026-10-24-consolidation-gate.md), while
preserving its historical red-test and design evidence.

## Functional contract achieved

1. Canonical `createProtectedEffect` controls Authority preview/consume/persist,
   opt-in configured privacy preflight/evidence/fence, signed recipient proof,
   provider submission through the established execution journal, and sanitized
   receipts. Its `createEffectBoundary` compatibility wrapper keeps privacy
   mandatory and retains legacy `eventId`.
2. Read-only `inspectExecutionJournal` checks the provider namespace and all
   exact effect-bearing terms *before* new authority is consumed. A completed
   effect replays without new submit or re-grant; corrupt, mismatched, uncertain
   and unsubmitted records do not authorize a new effect. The payment replay
   adapter is now a projection of the same canonical inspector, not a second
   outcome classifier.
3. `createHostRedemptionChallenge` mints short-lived, one-use recipient-signed
   authorization inside the trusted host. Its return type exposes a challenge
   and a redemption method, not a raw capability or private key to the agent.
4. The reference MCP `ptf_request_action` + `ptf_redeem` path supports only
   **exact trusted-host-registered** actions in addition to existing payment
   operations. The registration owns provider, validator and privacy gate.
   Unregistered generic action proposals remain non-executable. The agent
   cannot choose the effect callback, processing mode or principal signing key.
5. A conclusive journal success with an unreconstructable Processing Event is
   identified as **executed** and annotated with `processingEvidence: "gap"`,
   recorded in the proposal receipt and audited as a privacy evidence gap.
   It is never re-submitted and cannot be quietly downgraded to a denial.
6. Existing payment, DPDP-informed privacy controls, disclosure presentation,
   operator CLI, and protocol adapters remain available. Core payment ceiling
   and currency checks remain intentionally in `Authority` and local
   capabilities: deleting them would weaken direct callers.

## Security/behavior tests — independently executable

- Documented payment/vault examples execute with real, exact-bound local
  recipient proof; their CI smoke gate checks exit code and secret sentinel.
- Synthetic `/email/send` through `./hostkit` succeeds using the shipped
  package from an isolated `npm pack` installation. No real email is sent.
- Generic MCP integration tests cover challenge/signature/redeem, receipt
  persistence, re-redeem idempotence, unknown-provider restart outcomes,
  agent A versus B grant separation, revocation/removal of A, malformed
  registrations, unexpected effect context, default unregistered denial,
  configured-privacy fail-closed, successful privacy evidence and withdrawal
  fences, and conclusive provider success with missing privacy evidence.
- Legacy MCP payment, crash/replay, DPDP privacy, Host Kit conformance,
  backup/restore, Authority and capability abuse tests remain in `npm test`
  and `npm run eval`. The packaging/CLI/tool-count regressions run in CI.
- The reference MCP tool registration count is unchanged: **10** on main
  and the consolidation branch. No new package dependencies or storage
  format migration were added.

## Structural review axis (Matt / Engineering Quality Toolkit)

- `src/mcp-server.ts`: 1,961 → 1,967 lines; it remains a substantial
  pre-existing orchestration file, but new registered action and replay logic
  are isolated under `src/mcp/` and `src/store/`.
- `src/hostkit/boundary.ts`: 491 → 497 lines; one canonical implementation
  retains the old boundary as a compatibility adapter rather than introducing
  parallel effect state machines.
- `src/privacy/payment-replay.ts`: 207 → 63 lines; duplicated journal
  classification is removed and payment-specific receipt semantics retained.
- New cohesive modules: `src/mcp/registered-execution.ts` (~251 lines),
  `src/mcp/registered-actions.ts` (~59),
  `src/store/execution-replay.ts` (~81), and the trusted-host proof helper.
  No new module crosses 1,000 lines; the existing MCP file does not materially
  expand; no `src/core` third-party dependency was added.
- **Residual maintainability debt:** the existing oversized MCP and CLI modules
  remain candidates for a separate, justified simplification. The direct
  `executeProtectedActionWithPrivacy` and other trusted host/library adapter
  call paths are not forcibly routed through reference MCP; their independent
  custody boundaries remain explicit. No empty packages or abstract plugin
  framework were created.

## Specification review axis

| Acceptance criterion | Result | Boundary |
| --- | --- | --- |
| Existing payment and DPDP retained | PASS | Synthetic/reference tests; no live certification |
| Canonical host effect and backwards API | PASS | Test suite and conformance |
| Non-payment SDK, clean npm consumer | PASS | Synthetic provider only |
| Generic registered MCP redemption, no extra tools | PASS | Trusted programmatic registration required |
| Default deny, agent interchangeability and removal | PASS | Fixed/registry localhost test harness |
| Journal-first replay, unknown isolation and evidence gaps | PASS | Single-writer file-journal reference; no distributed exactly-once claim |
| Private data excluded from protected-execution receipts | PASS within tested fixtures | Trusted host/provider egress is not externally audited |
| Live production security / legal compliance | INCONCLUSIVE | Outside the spec and not claimed |
| Independent external reviewer approval | PENDING | Do not merge solely on self-review and CI |

## Execution graph and trust ownership

```text
Agent -> MCP request (no identity claim) -> verified ingress
  -> registered-action allowlist + strict host validator
  -> Authority dry-run -> stored digest-bound proposal
  -> trusted host / recipient-signed challenge
  -> read-only exact-term journal replay (outcome first)
  -> HostKit createProtectedEffect:
        Authority preview
        optional privacy preflight/recheck
        durable privacy event prepare (when configured)
        Authority use consumption + durable CAS
        optional last-moment privacy fence
        executeWithJournal -> provider (idempotency/unknown handling)
        evidence finalization -> bounded receipt
  -> sanitized MCP result and audit
```

Payment retains its specialized capability and approval adapter but now
delegates effect execution to the same Host Kit. Disclosure presentation is a
deliberately disclosive, separately authorized path; this consolidation does
not turn `ptf_present_data` into private computation.

**Known ceilings:** single-operator stdio and local trusted launcher;
host-selected privacy applicability and input allowlist; keys remain in local
custody; external provider query/reconciliation required after ambiguity;
privacy fence and external action are not one distributed transaction;
no third-party auditing or real email/payment/clinic deployment.

## Reproducibility and merge gate

The existing CI `gate` exercises `npm ci`, `npm run check:brand`,
`npm run typecheck`, `npm test`, `npm run test:examples`,
`npm run eval`, `node scripts/check-seams.mjs` and
`npm run verify:package -- --install` (real fresh packed consumer).
The `docs` job builds Jekyll; `secrets` runs TruffleHog. This covers
the component commands inside `bash scripts/harness.sh` without running
the redundant aggregate shell command as a second separate CI stage.
Check the **exact PR head SHA** and latest Actions run before merging.

**Disposition:** all eight implementation work packages have code,
tests or documented preservation rulings. The work is **ready for an
independent PR/security review, not an approved release**. Do not mark
the ADR accepted or merge/publish until that review is completed.
