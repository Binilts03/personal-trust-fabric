# Contributing to Personal Trust Fabric

PTF is heading for peer review as user-owned authority and protected-use
infrastructure for agentic systems. The bar is: every change proves itself,
documents its boundaries, and never leaks secrets. Humans and coding agents
follow the same rules.

## The one gate (no exceptions)

```sh
npm run check:brand && npm run typecheck && npm test && npm run eval
```

Plus the repo harness (`scripts/harness.sh` where it runs, else its steps):
public-seam imports only (`src/index.ts`; bins `cli`/`mcp-server`/`pdp-server`
exempt), `src/core/` zero-dependency (`node:crypto` only, never imports
`adapters/`), strict TypeScript. **No proof, no merge** (see
`.claude/skills/verify/SKILL.md`): drive the changed seam from `src/index.ts`
with a fresh verifier, include one abuse case, save output to
`evidence/` (gitignored), paste the tail + test summary into the PR.

## How to propose a change

1. Branch from `main` (`topic/short-name`). `main` is PR-gated: strict
   `gate` + `secrets` checks, linear history, no bypass — not even for
   maintainers. Never push to `main` directly.
2. Open a PR with: what changed, why (link the ADR or issue), the gate
   output, and the verifier evidence. Fill in `.github/PULL_REQUEST_TEMPLATE.md`.
3. One concern per PR. Small diffs review faster and revert cleaner.

## Rules that bite

- **Authority is never invented.** Policy constrains, never creates
  (ADR-0002). Personal State never equals Authority State. If your change
  mints power from learning, defaults, or convenience — it will be rejected.
- **Use without possession.** No raw secret crosses to agent view, receipt,
  log, or audit (ADR-0006). Tests use synthetic sentinels only
  (e.g. `PAN-SECRET-4111-never-leaves-host`); real credentials, tokens, and
  keys must never appear in code, fixtures, logs, or screenshots. Secret
  scanning + push protection are enforced on the repo.
- **Ubiquitous language.** Use `CONTEXT.md` terms exactly; flag ADR
  conflicts explicitly instead of silently overriding (`docs/agents/domain.md`).
- **Decisions need ADRs.** Architecture changes add a record under
  `docs/adr/` (copy `template.md`, append a row to `README.md`).
- **Residuals need limits.** Every honest ceiling goes in
  `docs/audit/limits.md` with file:line proof — reviewers trust stated
  limits more than claimed perfection.
- **Changelog entries.** Land user-visible changes under `## [Unreleased]`
  in `CHANGELOG.md` (Keep-a-Changelog flow).
- **Tests at public seams only.** Agree the seam before writing code; see
  `docs/audit/tests.md` for the suite index.
- **Brand is a protected seam too.** Unrelated changes must not modify
  `assets/brand/` or the README region between `PTF-BRAND:START` and
  `PTF-BRAND:END`. Intentional brand work follows `docs/brand/BRAND.md` and
  must pass `npm run check:brand`.

## For agent contributors

State your model + harness in the PR body, keep tool output out of the
diff (use `evidence/`), and never work around a failing gate — fix the
cause. If a skill or doc misled you, say so: that is a docs bug worth its
own PR.

## Reporting vulnerabilities

Do NOT open a public issue. See `SECURITY.md` for private reporting.
