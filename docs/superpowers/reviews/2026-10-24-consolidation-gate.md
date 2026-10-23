# Architectural consolidation implementation gate — 2026-10-24

**Branch:** `feat/ptf-domain-neutral-consolidation-20261024`  
**Baseline:** `main@cb687c685ba19627d4aa59c7e4375b18ded92c1f`  
**State:** **PARTIAL — not merge-ready as the entire 8-task mission.**

## Verified slices

1. Historical payment and vault examples now use actual exact-term signed redemptions; a Node child-process smoke test executes examples. CI added `test:examples`. The initial failing behavior was observed in GitHub Actions.
2. The `./hostkit` exported `createProtectedEffect` implements one trusted-host boundary with an explicit processing mode; the legacy privacy-required `createEffectBoundary` maps to it and preserves historical `eventId` and current conformance tests.
3. The `./hostkit` exported `createHostRedemptionChallenge` uses genuine signed local capabilities with one-use proof and an exact recipient; missing or invalid proof denies.
4. An independent synthetic `/email/send` SDK example uses only packaged public entry points. `scripts/verify-package.mjs --install` copies and executes that example from a clean npm tarball consumer directory.
5. A non-payment synthetic `PrivacyRuntime` test verifies Authority-first denial, privacy event precommit, late basis withdrawal fence and finalization. Callback receipt resource/purpose/digest substitution is rejected; a test-first failing CI run demonstrated the original vulnerability.

**Latest reviewed CI head:** see the GitHub Actions `ci` workflow for the branch; verify the specific head SHA again before any merge. Evidence covers unit/evaluation/build/seams, packed install, docs and secret scanning; no local live integration tests ran.

## Architectural findings that prevent marking the mission complete

### BLOCKER 1 — Generic MCP execution remains proposal-only

`src/mcp-server.ts` only performs `/pay` redemption with `ptf_redeem`; `ptf_request_action` is a generic dry-run and refuses privacy-enabled routing. It would be unsafe to add a separate `/email/send` redeem handler without first reconciling the reference MCP payment loop's journal-first recovery, stored proposal identity, proof challenge, Authority consumption and privacy evidence. No registered-action MCP handler is shipped on this branch. Adding one independent path would violate the plan's canonical-state-machine contract. Do not claim multi-domain MCP execution.

### BLOCKER 2 — HostKit SDK cannot yet certify journal-first recovery

The generic provider path uses `executeWithJournal`, which deduplicates by terms digest and provider namespace, but `createProtectedEffect` currently performs a live Authority preview/consume before calling it. A retry with already-spent authority is refused rather than reconstructing a prior receipt from the journal. The payment MCP path does journal-first replay, but is not yet delegated to `createProtectedEffect`. Do not claim exactly-once or complete host-side crash/restart recovery from the new SDK.

### BLOCKER 3 — Package and host trust boundaries remain deliberate

The reference example demonstrates an honest fake email, not a real email provider; the new `processing.kind="not-enforced"` is an operator assertion, not a legal classification; host callbacks are trusted code and cannot be cryptographically prevented from leaking data. The example's persistence marker is synthetic: production hosts must use durable CAS and protect issuer private keys and provider egress.

## Minimal unblock sequence

1. Pin exact payment journal replay parity and unknown-result classification as a single reusable **read-only** journal inspection contract; preserve event reconciliation without inspecting Authority after an already effected transaction. Add red tests for complete/mismatched/corrupt/PREPARED/SUBMITTING states and actor-scoped stored proposals.
2. Make HostKit's canonical provider effect run journal inspection first for previously completed or ambiguous exact operations, without minting authority or re-submitting the provider. Apply the same behavior in the historical MCP payment path through a compatibility shim only after parity gates. No silent duplicate use or privacy evidence creation.
3. Only after parity, add exact host-side registered actions and route existing MCP `ptf_request_action` + `ptf_redeem` through the canonical boundary. Agent inputs may never choose processing mode or provider implementation; unregistered action and missing privacy binder must deny. Test cross-actor replay, revoked registration and restart unknown outcomes.
4. Re-run frozen payment and DPDP denial tests, Host Kit nine-step conformance, packed example, `npm test`, `npm run eval`, package install, docs build and secrets scan. Require separate maintainability and security review before accepting ADR-0026 or merging.

## Decision

Under the approved implementation plan's explicit stop condition, **do not ship a parallel generic MCP state machine and do not remove /pay core safeguards**. Freeze at the verified library consolidation, keep this PR as a draft and leave `main` unchanged.
