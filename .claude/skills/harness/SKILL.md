---
name: harness
description: Run the PTF codebase harness. Triggers: harness, full gate, seam check, zero-dep check.
---

# harness

Codebase harness (extends dev-local).

## Commands

- `bash scripts/harness.sh` — typecheck + build + unit + eval + seam check + zero-dep check + evidence check.

## Rules

- Tests import only from `src/index.ts` (public seam; bin entries `src/cli.ts` + `src/mcp-server.ts` + `src/pdp-server.ts` exempt).
- `src/core/` imports only `node:crypto` + relative paths.
- Every resolved `.scratch/*/issues/*.md` has `## Answer`.
- No proof, no merge (see verify skill).
