# PTF audit pack — start here

This directory contains the public material needed to review PTF without relying on internal development notes.

## What PTF is

- **Authority plane** (`src/core/`): default-deny grants/approvals/policy evaluation, attenuated local capabilities, explicit CHECK → REDEEM → EXECUTE separation, and secret-free receipts.
- **Edge adapters** (`src/adapters/`): standards/evidence translators. External messages are evidence or requests, never authority.
- **Protected state** (`src/store/`): local durable authority state, encrypted Personal State, keystore, proposals, backups, and audit support.
- **Operator surfaces**: CLI, MCP stdio server, and reference PDP.

The durable product language is in `CONTEXT.md`; architecture decisions are in `docs/adr/`.

## Review map

| Question | File |
| --- | --- |
| How is it built? | `architecture.md` |
| What can go wrong? | `../../THREATMODEL.md`, `threats.md` |
| What is tested? | `tests.md` |
| What is explicitly not claimed? | `limits.md` |
| How do I reproduce the gate? | `verify.md` |
| How do I operate the reference implementation? | `operations.md` |
| How do I report a vulnerability? | `../../SECURITY.md` |

## Verification shortcut

```sh
npm ci
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
npm pack --dry-run
```

CI is the source of truth for suite counts and release gating. Local verification artifacts, stores, logs, credentials, and operator evidence are intentionally not tracked in the repository.
