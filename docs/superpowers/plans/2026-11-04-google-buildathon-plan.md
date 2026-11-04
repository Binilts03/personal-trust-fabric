# Google Buildathon Demonstration Implementation Plan

> For agentic workers: use test-driven development and independent review. This plan is executed on an isolated dependent branch.

**Goal:** Produce a reproducible Gemini-proposal-to-PTF protected-effect demonstration and truthful Buildathon application package.

**Architecture:** A small Gemini REST client returns only two bounded synthetic handles; a host validates a PTF operation against pre-existing authority and recipient proof; PTF invokes only its fake email provider. An optional authenticated Cloud Run endpoint wraps the same demonstration.

**Tech stack:** Node.js 22, existing PTF public package exports, Gemini GenerateContent function-calling, Cloud Run/Cloud Build optional operator workflow.

**Spec:** `docs/superpowers/specs/2026-11-04-google-buildathon-design.md`

**Global constraints:** Main untouched; PR #121 remains a prerequisite. No secret or personal data sent to Gemini. No real provider actions. No new production dependency. Full repo checks required before readiness claims.

**Review focus:** reject unknown function fields; reject unauthorized actor; reject modified recipient; no second effect on replay; Cloud service rejects user-supplied body.

### Task 1: Gemini proposal boundary
- [x] Add failing parsing, extra-field, malformed and API-transport tests (`examples/buildathon/gemini.test.mjs`).
- [x] Add narrow `parseGeminiProposal` and `proposeWithGemini` (`examples/buildathon/gemini.mjs`).
- [ ] Final-head test: `node --test examples/buildathon/gemini.test.mjs`.

### Task 2: PTF protected action demo
- [x] Add integration assertions on PTF public seams (`tests/buildathon-demo.test.ts`).
- [x] Add `runScenario` and terminal modes (`examples/buildathon/demo.mjs`).
- [ ] Final-head test: `npm test`; check one fake provider effect and changed-input denial.

### Task 3: Cloud presentation wrapper
- [x] Add server body/method/configuration tests.
- [x] Add isolated synthetic-only HTTP server, Dockerfile and Cloud Build config.
- [ ] Final-head test: `node --test examples/buildathon/server.test.mjs`.
- [ ] Operator-only deploy: configured project, IAM, key secret, budget and exact image digest.

### Task 4: Application/evidence package
- [x] Document A2A/AP2 complementarity, market hypothesis, founder fit, proof boundaries and dates.
- [ ] Review citations, source-of-truth status, and final green CI receipts.
- [ ] Independent integrator, security and judge feedback remain external qualification gates.

**Dependency:** No merge-to-main or production designation while PR #121 is unmerged and external gates are missing.
