# Contributing to Personal Trust Fabric

PTF is user-owned authority and protected-use infrastructure for agentic systems. Changes must preserve the authority boundary, document residual risk, and never leak secrets.

## Required gate

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
```

For behavior changes, also exercise the changed public seam in a clean process and include at least one abuse case. Put the relevant verification summary in the PR body; do not commit local logs, stores, credentials, screenshots containing secrets, or generated evidence.

## How to propose a change

1. Branch from `main`.
2. Open a PR describing what changed, why, the relevant ADR/issue, and verification performed.
3. Keep one concern per PR.

## Rules that bite

- **Authority is never invented.** Policy constrains, never creates. Personal State never equals Authority State.
- **Use without possession.** No raw credential, key, token, payment instrument, or secret crosses into agent-visible output, receipts, logs, audit, fixtures, or screenshots. Test fixtures must be synthetic and explicitly marked.
- **Use project language.** `CONTEXT.md` defines the domain vocabulary.
- **Decisions need ADRs.** Architecture changes add or amend a record under `docs/adr/`.
- **Residuals need limits.** Honest ceilings belong in `docs/audit/limits.md`.
- **Tests at public seams.** Prefer `src/index.ts`; bin tests may exercise their entry points.
- **Changelog entries.** Put user-visible changes under `## [Unreleased]`.
- **Brand is protected.** Intentional brand work follows `docs/brand/BRAND.md`.

## Reporting vulnerabilities

Do not open a public issue for a vulnerability. Follow `SECURITY.md`.
