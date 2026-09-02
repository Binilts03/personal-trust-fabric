# Harness status

Status date: 2026-09-02.

## Repository reality

- The supplied package contained 26 Markdown specification/audit files and no source code, build configuration, tests, CI, or Git metadata.
- A new local Git repository was initialized on branch `main`; there is no prior history to inspect.
- Node 22 native ESM is selected only for the synthetic M0 sandbox. No production custody stack is selected.

## Harness acceptance

| Capability | Status | Evidence / gap |
|---|---|---|
| Thin entrypoint | Available | `AGENTS.md` maps to authoritative sources without duplicating them |
| Repository map | Available for M0 | `docs/index.md`, README and judge script; production contexts remain OPEN |
| Domain context | Available for M0 | Root contracts plus generic `src/core` implementation |
| Command registry | Available for M0 | `docs/commands.md`; production/release commands remain OPEN |
| Deterministic verification | Available for M0 | `npm test`, architecture lint and harness verifier |
| Architecture lints | Available for M0 | Core scenario/adapter dependency scan plus negative fixture |
| Synthetic fixtures | Available | Two recipient/operation classes, deterministic reset and canaries |
| Execution ledger | Available | `docs/program/execution-ledger.md` |
| Isolated work | Process established | Read-only reviews are parallel; future overlapping edits require worktrees |
| Sanitized observability | Available for M0 | Closed audit schema, process-local chain, safe UI activity; production telemetry OPEN |
| Review packages | Process established | `docs/validation/reviews/` |
| Context audit | Partial | Initial handoff audit exists; recurring executable audit is OPEN |
| Skill registry | Available | Generated registry plus active-catalog limitation note |

This harness supports the bounded synthetic M0 profile. Fresh-clone CI, real WebMCP-host evaluation, protocol conformance, production custody, and release verification remain OPEN.
