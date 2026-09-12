---
name: dev-local
description: Run the PTF local loop. Triggers: dev-local, run locally, typecheck, run tests, local status.
---

# dev-local

One-command local loop for this library repo (no servers, no infra).

## Services

None — pure TypeScript library. `node >=22`, `npm >=10` required.

## Commands

- `scripts/dev-local.sh up` — install (if needed) + typecheck + full test suite
- `scripts/dev-local.sh status` — deps/build presence
- `scripts/dev-local.sh typecheck` — `tsc --noEmit` only
- `scripts/dev-local.sh test` — build + `node --test dist/tests/`

## Troubleshooting

- `node_modules` missing → `up` installs automatically.
- Port-in-use → n/a (no servers).
- Stale `dist/` → `npm run build` regenerates; `dist/` is gitignored.
