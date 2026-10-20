# DPDP Slice D — Operator, MCP, Public API, and Documentation Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose privacy enforcement safely to operators and the Personal Authority Node reference host without allowing agents to choose privacy/legal facts, and publish the curated library surface/documentation.

**Architecture:** Add a dedicated CLI privacy command module; add opt-in MCP host configuration that supplies trusted privacy context outside tool schemas; expose a curated `./privacy` package subpath. Existing bins remain backward-compatible when privacy mode is off.

**Tech Stack:** Existing CLI/MCP patterns, Zod only where already used, privacy runtime/store APIs from Slices B/C.

**Spec:** `docs/superpowers/specs/2026-10-18-dpdp-privacy-enforcement-design.md`

## Global Constraints

- Agent tool schemas gain no `basisId`, controller, subject ref, age/classification, or retention fields.
- Privacy configuration mutations are operator-only.
- MCP privacy mode is opt-in; disabled mode must match frozen behavior.
- Personal Authority Node reference mode may use a fixed trusted subject/controller binding; dynamic enterprise hosts use the library runtime/resolver seam outside MCP request data.
- CLI output contains metadata only.
- Public docs never claim guaranteed compliance.

## Review Focus

1. Prompt/tool input cannot override trusted privacy context.
2. Privacy mode off has no behavioral/tool-schema changes.
3. Operator commands never print evidence bodies or raw vault values.
4. Malformed privacy config fails closed rather than silently disabling privacy.
5. Package exports remain curated and do not expose persistence internals.

---

### Task D1: Publish curated privacy library surface

**Files:**

- Create: `src/privacy/api.ts`
- Modify: `package.json`
- Modify: `src/api.ts` only if top-level additive exports are explicitly justified; prefer subpath.
- Modify: `tests/hygiene.test.ts`
- Create: `tests/privacy-public-api.test.ts`
- Modify: `docs/adr/0011-public-surface.md` or append an ADR-0024 consequence note.

**Interfaces:**

- Package export: `./privacy` -> `dist/src/privacy/api.js`.
- Optional `./privacy/dpdp` only if the profile exports materially improve host ergonomics without exposing store internals.

Curated `./privacy` exports:

- stable model types, including `PrivacySnapshot` and the `PrivacyEventRepository` port;
- `PrivacyRuntime`;
- DPDP profile constant/profile object;
- privacy-wrapped vault/provider helpers;
- processing summary/erasure-plan types/functions.
  Do not export `PrivacyStore` or `FilePrivacyEventRepository` through the public package subpath.

- [ ] **Step 1: Write failing package surface tests**

Assert `package.json` export exists; internal store symbols are absent from `src/privacy/api.ts`; npm pack contains built privacy API.

- [ ] **Step 2: Implement subpath/export changes**

- [ ] **Step 3: Run type/package tests**

```sh
npm run typecheck
npm test
npm pack --dry-run
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add src/privacy/api.ts package.json tests/hygiene.test.ts tests/privacy-public-api.test.ts docs/adr/0011-public-surface.md
git commit -m "feat: publish curated privacy API"
```

---

### Task D2: Add dedicated operator privacy CLI module

**Files:**

- Create: `src/cli/privacy.ts`
- Modify: `src/cli.ts` routing/help only
- Create: `tests/privacy-cli.test.ts`

**Interfaces:**

- Top-level command: `ptf privacy <subcommand>`.
- Required subcommands:
  - `init`
  - `notice add|list`
  - `basis add|list|withdraw-consent`
  - `activity add|list`
  - `hold add|release|list`
  - `check`
  - `summary`
  - `erase plan|apply`
  - `verify`
  - `rekey`

Exact argument parsing lives in `src/cli/privacy.ts`; `src/cli.ts` dispatches after shared `--dir`/passphrase resolution.

- [ ] **Step 1: Write failing CLI tests**

Use temp stores and injected IO:

- add/list prints ids/scope metadata only;
- consent withdrawal takes effect;
- summary never prints sentinel values;
- erase plan distinguishes held/eligible;
- erase apply requires explicit exact ids/confirmation path;
- malformed input returns non-zero with no secret echo;
- privacy rekey round-trip works.

- [ ] **Step 2: Implement command module**

Reuse PrivacyStore/runtime/rights APIs. Do not duplicate domain validation.

- [ ] **Step 3: Keep `cli.ts` change thin**

Only help/dispatch/plumbing. If privacy code starts accumulating there, stop and move it.

- [ ] **Step 4: Run focused/full tests**

```sh
npm run build && node --test dist/tests/privacy-cli.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add src/cli/privacy.ts src/cli.ts tests/privacy-cli.test.ts
git commit -m "feat: add privacy operator CLI"
```

---

### Task D3: Add opt-in MCP privacy enforcement without schema authority leakage

**Files:**

- Create: `src/privacy/mcp.ts`
- Modify: `src/mcp-server.ts` thin hooks/config only
- Modify: `docs/mcp-contract.md`
- Create: `tests/privacy-mcp.test.ts`
- Modify: existing MCP regression tests as needed only for additive mode.

**Interfaces:**

- Host seam:

```ts
export interface PrivacyContextResolver {
  resolve(input: {
    readonly ingress: VerifiedIdentity;
    readonly operation: AuthorityOperation;
  }): TrustedProcessingContext | null;
}
```

Reference MCP mode:

- privacy disabled by default;
- enabling privacy requires valid privacy store/profile plus trusted resolver configuration;
- Personal Authority Node reference resolver may bind a fixed controller + opaque subject ref from operator-owned environment/config;
- if enabled and context cannot be resolved, personal-data-enabled tool path denies; it never silently falls back to non-privacy.

- [ ] **Step 1: Snapshot current MCP tool schemas**

Add regression assertion that existing schemas do not contain strings/fields matching `basisId`, `controllerId`, `dataPrincipalRef`, `subjectClassification`, `dpdpPurpose`.

- [ ] **Step 2: Write failing privacy-mode MCP tests**

- disabled mode reproduces existing success/deny behavior;
- enabled mode valid authority+privacy passes;
- missing basis denies;
- agent-supplied extra JSON field cannot override resolver context/schema rejects or ignores according to existing strict schema behavior;
- unauthorized actor cannot distinguish missing basis vs unknown subject;
- withdraw consent after proposal before present/redeem denies;
- tool output/errors contain no sentinel personal value/direct subject id.

- [ ] **Step 3: Implement `src/privacy/mcp.ts` host adapter**

It translates stored proposal/demand + verified ingress into runtime calls. Do not put DPDP conditionals in `mcp-server.ts`.

- [ ] **Step 4: Add thin server wiring**

Privacy config is resolved at startup/fixed mode; corrupt/partial config fails closed when privacy is explicitly enabled.

- [ ] **Step 5: Run focused/full tests**

```sh
npm run build && node --test dist/tests/privacy-mcp.test.js dist/tests/mcp*.test.js
npm test
npm run eval
bash scripts/harness.sh
```

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add src/privacy/mcp.ts src/mcp-server.ts docs/mcp-contract.md tests/privacy-mcp.test.ts
git commit -m "feat: enforce privacy mode at MCP boundary"
```

---

### Task D4: Update backup/operator documentation, product claims, and limits

**Files:**

- Modify: `README.md` outside protected brand region only if necessary
- Modify: `docs/audit/README.md`
- Modify: `docs/audit/limits.md`
- Modify: `docs/audit/operations.md`
- Modify: `docs/audit/verify.md`
- Modify: `CHANGELOG.md`
- Create: `docs/privacy/dpdp.md`
- Test: docs build + brand check

**Interfaces:**

- Documentation claim: “helps enforce/support DPDP controls” / “privacy-enforcement and evidence layer.”
- Explicitly forbidden claim: “guarantees DPDP compliance”, “compliant=true”, “registered Consent Manager”.

- [ ] **Step 1: Write DPDP usage/boundary documentation**

Cover what is enforced, what is operator evidence, what is out of scope, phased commencement, profile revision, rights limits, backup retention limits, and statutory Consent Manager distinction.

Cite primary Government sources only.

- [ ] **Step 2: Update operations/verify docs**

Add privacy init/rekey/backup/summary/erasure verification commands and recovery guidance for OUTCOME_UNKNOWN events.

- [ ] **Step 3: Update limits**

Record host bypass risk, external-copy erasure limits, legal-basis correctness, dynamic enterprise resolver gap, breach/processor-contract/DPIA/Consent-Manager non-goals.

- [ ] **Step 4: Run docs/package/full gate**

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
npm pack --dry-run
(cd docs && bundle install && bundle exec jekyll build --destination _site)
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add README.md docs CHANGELOG.md
git commit -m "docs: document DPDP privacy enforcement"
```
