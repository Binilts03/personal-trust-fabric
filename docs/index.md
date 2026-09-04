# Documentation

Public docs for the synthetic sandbox and core product:

| Doc | Purpose |
|---|---|
| `judge-script.md` | Judge/evaluator flow and WebMCP tool prompts |
| `research/current-sources.md` | Current ChatGPT/Chrome WebMCP evidence |
| `commands.md` | Command registry — sandbox (`npm test` 58, `npm run verify:harness`, conformance) + core (`cargo metadata --no-deps`, `buf lint`) + HTTP API |
| `program/harness-status.md` | Harness status — restored with CI gates active |
| `program/archived/README.md` | Archived handoff location |
| `index.md` | This map |

## Core product (repo root `../` when run from sandbox)

Harness verifies W1 core (when present) plus mandatory sandbox docs:

- `Cargo.toml` — workspace with 50+ members (`cargo metadata --no-deps`); harness skips with warning on sandbox-only clone
- `contracts/ptf-contracts/proto/ptf/contracts/v1/*.proto` + `json-schema` peers (`buf lint` 0)
- `crates/ptf-domain/src/{identifiers,classifications,constraints,freshness,state_machines}.rs`
- `crates/ptf-serialization/src/{agent,human,recipient,audit,sync,migrations}.rs`
- `crates/ptf-vault/src/{lib,zeroizing_buffer,platform_controls}.rs`
- `crates/ptf-policy` and `crates/ptf-approval` (`get_proposal`) + `crates/ptf-runtime` principal binding
- Sandbox mandatory: `AGENTS.md`, `docs/{index.md,commands.md,judge-script.md,research/current-sources.md,program/harness-status.md}` — CI must pass
- Legacy program/validation ledgers (`docs/program/requirements-ledger.md`, `capability-ledger.md`, `security-properties-ledger.md`, `skill-registry.json`, `VALIDATION_REPORT.md`, `docs/validation/reviews/*`) are optional and warn if missing; minimal placeholders tracked on `main`

## CI

`.github/workflows/ci.yml` runs on `push`/`pull_request` to `main`: `test` (Node 22 `npm test`), `lint` (`npm run lint:architecture`), `verify-harness` (`pwsh scripts/verify-harness.ps1`), `security-canary` (`node scripts/verify-conformance.mjs`), `buf-lint` (if `buf` available). Protect `main` with required status checks.

Internal handoff specification (product contract, domain model, full program ledgers, ADRs, validation reviews) is archived at `../handoff-archive-2026-09-02/` and summarized at `docs/program/archived/README.md`. History retains prior versions; harness no longer requires full archive for fresh clone.
