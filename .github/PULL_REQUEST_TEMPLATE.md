## What / why

<!-- Link the issue or ADR. One concern per PR. -->

## Gate proof (paste, don't describe)

```text
typecheck:
unit (tests/pass/fail):
eval:
```

Verifier summary (paste the relevant output + abuse case; do not commit generated logs):

```text

```

## Checklist

- [ ] No secrets in code, fixtures, logs, or screenshots (synthetic sentinels only)
- [ ] `CONTEXT.md` terms used; ADR conflicts flagged or N/A
- [ ] ADR added/updated if architectural; `docs/audit/limits.md` updated if any residual
- [ ] `CHANGELOG.md` entry under `[Unreleased]`
- [ ] Tests at public seams only (`src/index.ts`; bins exempt)
