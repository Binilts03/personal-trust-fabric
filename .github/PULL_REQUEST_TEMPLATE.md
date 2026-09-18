## What / why

<!-- Link the issue or ADR. One concern per PR. -->

## Gate proof (paste, don't describe)

```text
typecheck:
unit (tests/pass/fail):
eval:
```

Verifier evidence (`evidence/<date>-<slug>.log`, gitignored — paste the 5-line tail + abuse case):

```text

```

## Checklist

- [ ] No secrets in code, fixtures, logs, or screenshots (synthetic sentinels only)
- [ ] `CONTEXT.md` terms used; ADR conflicts flagged or N/A
- [ ] ADR added/updated if architectural; `docs/audit/limits.md` updated if any residual
- [ ] `CHANGELOG.md` entry under `[Unreleased]`
- [ ] Tests at public seams only (`src/index.ts`; bins exempt)
