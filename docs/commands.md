# Command registry

## Synthetic sandbox (Node 22, no dependencies)

| Purpose | Command | Expected |
|---|---|---|
| Run full automated suite | `npm test` | 58 tests passing (core, http, leakage, WebMCP, conformance) |
| Run local synthetic product | `npm run dev` — loopback `127.0.0.1:3000` by default | Page says “Hosted synthetic profile — no real credentials” |
| Run hosted process | `npm start` — requires exact HTTPS `PUBLIC_ORIGIN` when `HOST` is non-loopback | Hosted cookies marked `Secure` |
| Architecture lint | `npm run lint:architecture` | `Architecture verification passed.` |
| Harness verification | `npm run verify:harness` or `pwsh -NoProfile -File scripts/verify-harness.ps1` (`powershell` fallback on WinPS 5.1) | `W1 harness verification passed` (warnings if optional legacy files missing) |
| Security canary + conformance | `node scripts/verify-conformance.mjs` | 23 checks: serialization, policy-intersect, canary-leak, tenant-isolation |
| Core unit tests | `npm run test:core` | Policy, disclosure, persona, protected-store, verifier |
| Integration and WebMCP contract tests | `npm run test:integration` | HTTP, trust-runtime, WebMCP adapter (6 tools) |
| Architecture tests | `npm run test:architecture` | Core has no scenario/DOM leakage |
| Rendered browser flow | See `docs/judge-script.md` | Manual WebMCP journey check |

## Core product (Rust workspace + contracts — at `../` when sandboxed)

| Purpose | Command | Expected |
|---|---|---|
| Verify workspace members | `cargo metadata --no-deps --format-version 1` (from repo root) | lists 50+ members (currently 54) |
| Contract lint | `buf lint` (from `contracts/ptf-contracts`) | 0 errors, uses `buf.yaml` v2; CI runs if `buf` present |
| Domain tests (logic) | `cargo test -p ptf-domain` | tests pass |
| Harness (W1) | `pwsh scripts/verify-harness.ps1` (from `personal-trust-fabric-codex-handoff`) | `W1 harness verification passed` without `../handoff-archive` |
| Sandbox suite | `npm test` (from `personal-trust-fabric-codex-handoff`) | 58 tests passing |

## HTTP API (sandbox — all `/api/*` require `ptf_human_session` cookie; mutations require same-origin)

| Method & Path | Purpose | Notes |
|---|---|---|
| `GET /api/session` | Bootstrap Human session, set `ptf_human_session` | Idempotent; creates per-browser sandbox |
| `GET /api/state` | Full sandbox state (assurance + safeView + policies + capabilities + audit) | Browser session required |
| `GET /api/agent-view` | Agent-safe view only | Allowlisted DTO, no protected values |
| `POST /api/reset` | Reset sandbox to deterministic fixtures | Human same-origin only |
| `POST /api/operations/request` | Request operation (`scenario`, `amountMinor`, `recipientId`, etc.) | Creates pending approval/capability |
| `POST /api/approvals/:id` | Decide approval (`{decision:"approve"|"deny"}`) | Human same-origin only |
| `GET /api/approvals/:id` / `:id/status` | Poll approval status | No protected values |
| `GET /api/capabilities` | List active capabilities | Sweeps expired before return |
| `GET /api/capabilities/:ref` / `:ref/status` | Poll capability status | Safe receipt only |
| `POST /api/capabilities/:ref/redeem` | Redeem with `{recipientId, recipientAuthToken}` | HMAC verified, single-use |
| `POST /api/capabilities/:ref/revoke` | Revoke active capability | Human same-origin only |
| `POST /api/operations/status` | Unified status by `operationReference` | Tries capability then approval |
| `POST /api/persona/:id/correct` | Human persona correction | Supersedes prior claim |
| `GET /api/audit` | Audit records (`?correlationId=` optional) + `integrity` | Closed schema, hash chain |
| `GET /api/export` | Versioned export archive | `tenantId` composite key |
| `POST /api/import` | Import archive (`version:1`) | Tenant enforcement |
| `GET /api/policies` | List policies | |
| `POST /api/policies/simulate` | Dry-run policy evaluation | Strict allowlist |

Harness `scripts/verify-harness.ps1` checks **mandatory** sandbox files `AGENTS.md`, `docs/{index.md,commands.md,judge-script.md,research/current-sources.md,program/harness-status.md}` plus **W1 core** (`Cargo.toml` 50+ members, `contracts/ptf-contracts/proto/ptf/contracts/v1/*.proto` + `json-schema` peers, `crates/ptf-domain/src/{identifiers,classifications,constraints,freshness,state_machines}.rs`, `crates/ptf-serialization/src/{agent,human,recipient,audit,sync,migrations}.rs`, `crates/ptf-vault/src/{lib,zeroizing_buffer,platform_controls}.rs`, `crates/ptf-policy`, `crates/ptf-approval` with `get_proposal`, `crates/ptf-runtime` principal binding). Legacy program/validation ledgers (`docs/program/requirements-ledger.md`, `capability-ledger.md`, `security-properties-ledger.md`, `build-plan.md`, `execution-ledger.md`, `skill-registry.json`, `VALIDATION_REPORT.md`, `docs/validation/reviews/*`) are **optional** and warn if missing; archived at `../handoff-archive-2026-09-02/` and `docs/program/archived/`. Core checks are skipped with warning on sandbox-only clone (no `Cargo.toml`).

CI is at `.github/workflows/ci.yml`: `test` (Node 22, `npm test`), `lint` (`npm run lint:architecture`), `verify-harness` (`pwsh scripts/verify-harness.ps1`), `security-canary` (`node scripts/verify-conformance.mjs`), `buf-lint` (if `buf` available). No app installs. Internal handoff history remains in git log and local `../handoff-archive-2026-09-02/` for reference only.
