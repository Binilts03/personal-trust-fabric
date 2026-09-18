# ADR-0014: Proposal durability: in-memory fail-closed (supersedes 0008)

> AMENDED by ADR-0017 (2026-09-18): proposals are now durable (one file per
> termsDigest via `store/challenges.ts`); only recipient challenges stay
> in-memory. The fail-closed principle below stands.

**Date**: 2026-09-13
**Status**: accepted
**Deciders**: PTF maintainer + ticket 17

## Context

ADR-0008 chose file-CAS per digest (`proposals/<digest>.json`, `O_EXCL` create,
write→fsync→rename→fsync-dir) and `src/store/challenges.ts` implements it
(create/load/transition/GC, covered by `tests/challenges.test.ts`). The MCP
server (`src/mcp-server.ts`) never wired it: proposals + pending challenges
live in `Map`s with short TTLs (≈600s), lost on restart, fail-closed
(`check` → `unknown`, `redeem` → `propose again`), single-writer ceiling
documented in the module header.

## Decision

SUPPRESSION: in-memory fail-closed proposals stand. Short TTL, lost on
restart, single-writer per store. Durable CAS rejected as unneeded complexity
for a single-operator, low-throughput reference host — receipts already
survive restarts in `audit.jsonl`; proposal status does not need to.
`src/store/challenges.ts` remains as an unwired reference implementation,
not consumed by MCP/CLI.

## Consequences

- No MCP/CLI behavior change; restart loss stays fail-closed, never fail-open.
- Graduate only if concurrent redeems must not lost-update or restart
  persistence becomes operator-required (revisit ADR-0008 criteria).
- ADR-0008 is superseded (see supersede note appended there).
