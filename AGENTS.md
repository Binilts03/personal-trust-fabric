# Personal Trust Fabric — Agent Notes

This is the public synthetic sandbox (Node 22, no dependencies). See `README.md` for usage.

## Commands
- `npm test` — full suite (58 tests: core, http, leakage, WebMCP contract, conformance)
- `npm run dev` / `npm start` — local server (`127.0.0.1:3000` loopback by default; set `PUBLIC_ORIGIN` for non-loopback)
- `npm run lint:architecture` — architecture lint
- `npm run verify:harness` — harness verification (`pwsh scripts/verify-harness.ps1`; fallback `powershell -File scripts/verify-harness.ps1` on Windows PowerShell 5.1)
- `node scripts/verify-conformance.mjs` — security canary + policy conformance (23 tests)

Harness status is at `docs/program/harness-status.md`. Verify with `npm run verify:harness` (or `powershell -NoProfile -File scripts/verify-harness.ps1` if `pwsh` is unavailable). Legacy handoff ledgers (`docs/program/requirements-ledger.md`, `capability-ledger.md`, `security-properties-ledger.md`, `skill-registry.json`, `VALIDATION_REPORT.md`, `docs/validation/reviews/*`) are optional in this public HEAD and warn if missing; full archived handoff is retained in git history and at `../handoff-archive-2026-09-02/` (outside repo, not in fresh clone) or `docs/program/archived/` if present. CI gates are defined in `.github/workflows/ci.yml`.

Detailed flow is in `docs/judge-script.md`. Current WebMCP/ChatGPT source checks are in `docs/research/current-sources.md`.
