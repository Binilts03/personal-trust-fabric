# ADR-0015: Store integrity via revision CAS + audit freshness binding

**Date**: 2026-09-14
**Status**: accepted
**Deciders**: PTF maintainer + prod-ready loop (tickets 02–03)

## Context

The v0.1 file stores (`src/store/files.ts`) were last-write-wins: two
concurrent writers silently clobbered each other's grants, revocations,
and use-counters, and restoring yesterday's `authority.json` resurrected
revoked grants undetectably. Lockfiles were considered and rejected — a
crashed holder leaves a stale lock that either blocks service or demands
an unsafe steal protocol, and locks add a new failure mode without
removing the old one.

## Decision

Optimistic revision compare-and-swap plus an audit freshness binding:

- `AuthoritySnapshot` / `RegistrySnapshot` carry a `revision`, bumped
  atomically with the data on each durable write. A save whose instance
  revision no longer matches the file fails closed ("changed under us —
  reload and retry"). Fresh instances may create a missing store only;
  never overwrite one they never loaded, never resurrect a deleted one.
  Pre-revision files upgrade on first write.
- Every audit entry commits to the post-save store revisions
  (`authorityRev` / `registryRev`, optional — old lines stay valid).
  Authority mutations (grant, pay, disclose, revoke, register) are all
  audit-appended after persisting, so `loadAuthority` / `loadRegistry`
  can prove the files were not rolled back past recorded history and
  fail closed otherwise. Full-directory rollback (all files consistently
  old) remains undetectable here — that needs the external anchor
  (`store/anchor.ts` checkpoints, ticket-12 runbook).
- In-memory `Authority.restore` of a stale copy still decides from its
  copy (freshness of _decisions_ needs the live store) but can never
  persist over newer state (the CAS refuses). Crash order is
  save-before-audit everywhere (consumed-without-receipt beats
  receipt-without-consume).

## Consequences

- Double-spend via concurrent redeem is now a loud client error, not a
  silent fork. Callers retry on a fresh handle (MCP/CLI already reload
  per call).
- `loadAuthority` / `loadRegistry` scan `audit.jsonl` per load — O(n),
  operator-scale by design; high-throughput PDP hosts pin snapshots.
- Rollback detection is only as complete as the audit trail: every
  authority/registry mutation must stay audit-appended (enforced by
  convention + the rollback regression tests, not by the type system).
