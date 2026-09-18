# ADR-0017: Durable proposals via file CAS (amends ADR-0014)

**Date**: 2026-09-18
**Status**: accepted (amends ADR-0014; the in-memory rule below is superseded,
the fail-closed principle stands)
**Deciders**: PTF maintainer + independent review (P1: proposal/challenge
state lost on restart)

## Context

ADR-0014 kept MCP proposals and pending challenges in memory with short
TTLs, lost on restart (fail-closed: check → unknown, redeem → propose
again), with `src/store/challenges.ts` as an unwired reference. The
independent review found this is safe but not production-grade: human
approvals disappear, in-flight requests cannot resume, and receipt lookup
loses state. Meanwhile the agent loop grew a real delivery path
(`ptf_present_data`, ADR-0016 era), making proposal loss a usability
blocker rather than a theoretical one.

## Decision

Proposals persist as one file per termsDigest under `<storeDir>/proposals`
via the existing `store/challenges.ts` (O_EXCL create, TTL GC) — no new
storage dependency. Transitions are last-writer-wins under the
single-writer topology; the spend backstop is the authority revision CAS
plus single-use capabilities, not the proposal file:

- The termsDigest is the idempotency key: re-proposing live terms returns
  the stored record instead of minting a duplicate.
- `executed` is immutable history: re-propose or re-redeem returns the
  stored receipt instead of executing twice.
- `pending` stays in flight while live; `denied` re-opens to pending when
  live authority now allows (authority may have changed since the denial).
- Every propose/redeem still re-evaluates live authority; redeem still
  consumes/persists standing uses before executing (ticket 05 ordering) —
  durability never substitutes for a fresh decision. Present is a read and
  consumes nothing, by design.
- Concurrent same-digest redeems under unlimited-use grants can both pass
  the spend checks and execute before either transition lands — the
  proposal file does not gate spending. Mitigations, in order:
  single-writer topology (one MCP server per store), maxUses-bounded
  grants / one-time approvals for value movement, single-use redeem
  capabilities (every redeem mints `maxUses: 1`, so a second concurrent
  phase-2 on the same challenge fails closed at authorize). Residual
  documented in `docs/audit/limits.md`.
- Pending recipient challenges (phase-1 capabilities) stay in-memory with
  short TTLs: they carry live key material that must never touch disk, and
  losing them only costs one extra redeem call.
- Demands that do not survive JSON round-trip fail closed at propose time.

Multi-writer clustering stays out: concurrent writers share the
revision-CAS backstop on authority state. `saveAuthority` fails concurrent
redeems closed before any receipt only while uses remain to burn through —
under unlimited-use grants the file transition is the loser-detector, not
the spend gate (see above). SQLite remains deferred with
the ADR-0008 criteria.

## Consequences

- Restart now preserves pending/denied/executed proposals (check/receipt
  work across restarts); challenges do not (redeem phase 1 again).
- `proposals/` joins the backup unit; restored proposals re-evaluate live
  authority at use time, so stale demands fail closed rather than resurrect.
- Tests asserting restart-forget were rewritten to restart-remember
  (`tests/agent-contract.test.ts`, `tests/present-path.test.ts`).
