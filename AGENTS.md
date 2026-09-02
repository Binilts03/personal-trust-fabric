# Personal Trust Fabric — Agent Notes

This is the public synthetic sandbox (Node 22, no dependencies). See `README.md` for usage.

## Commands
- `npm test` — full suite (core, http, leakage, WebMCP contract)
- `npm run dev` / `npm start` — local server (`127.0.0.1:3000` loopback by default; set `PUBLIC_ORIGIN` for non-loopback)
- `npm run lint:architecture` — architecture lint

Internal harness (`scripts/verify-harness.ps1`) is archived at `../handoff-archive-2026-09-02/` and not tracked on `main`.

Detailed flow is in `docs/judge-script.md`. Current WebMCP/ChatGPT source checks are in `docs/research/current-sources.md`.
