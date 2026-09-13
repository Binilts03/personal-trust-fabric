# PTF audit pack — start here

Zero-archaeology entry for an external reviewer. PTF v0.1 is a user-owned
trust layer: agents propose, the deterministic core disposes.

## What PTF is (60 seconds)

- **Authority plane** (`src/core/`, zero-dep, `node:crypto` only): standing
  grants + one-time approvals → `Authority.evaluate` (allow-with-citation or
  deny) → short-lived attenuated capabilities (`ptf/cap@0.1` local-only `@internal` per ADR-0009 — never wire; interop uses the standards edge, Ed25519,
  child ≤ parent, recipient + termsDigest fixed, expiry + maxUses) →
  recipient-authenticated redemption → protected execution → secret-free
  receipt + hash-chained audit.
- **Edge adapters** (`src/adapters/`): x402 v2, AP2, OpenID4VP, MCP/WebMCP,
  A2A, JWS, URLs. Evidence in, never authority out (ADR-0005). Every adapter
  fails closed; subset limits are documented, not silent.
- **Operator surface** (`src/store/`, `src/cli.ts`, `src/mcp-server.ts`):
  JSON file stores (atomic writes, single-writer ceiling), scrypt+AES-GCM
  keystore (passphrase from env only), `ptf` CLI (human approval), MCP stdio
  server (`ptf_propose` / `ptf_check` / `ptf_redeem`, no approve tool).

Golden rules: `AGENTS.md`. Language: `CONTEXT.md`. Decisions: `docs/adr/`.
Protocols: `docs/research/2026-09-09-deep-*.md`.

## Map

| Question                                | File                                                       |
| --------------------------------------- | ---------------------------------------------------------- |
| How is it built?                        | `architecture.md`                                          |
| What can go wrong?                      | `../..//THREATMODEL.md`, `../../SECURITY.md`, `threats.md` |
| What is tested, and where is the proof? | `tests.md`                                                 |
| What is explicitly NOT claimed?         | `limits.md`                                                |
| How do I re-verify from scratch?        | `verify.md`                                                |
| How do we go public / publish?          | `public-flip.md`                                           |

## Verdict shortcut

```sh
npm run typecheck && npm test && npm run eval
npm pack --dry-run
```

Expected: typecheck clean, 95+ unit green, 9 eval green, tarball lists
`dist/` + `LICENSE` + `README.md` only (+ `package.json` always).
Evidence sample: `evidence/2026-09-12-security-fixes.log` (gitignored live
runs; committed fixtures in `tests/`).
