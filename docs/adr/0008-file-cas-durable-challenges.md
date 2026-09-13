# File-CAS durable challenges, SQLite deferred

Durable MCP proposals/challenges must survive restarts and concurrent redeems without adding a database dependency to a zero-dep trust layer (ADR-0001). Workload is single-operator, low-throughput, small JSON with TTLs; existing stores (`authority.json`, `registry.json`, `audit.jsonl`) already use tmp-file atomic writes.

## Considered Options

- **File CAS per digest (chosen)**: one JSON file per proposal/challenge (`proposals/<digest>.json`), created with `O_EXCL`, updated via write → fsync(file) → rename → fsync(dir) per Borrill arXiv:2603.01384 (rename is atomic namespace, not persistence) and Pillai et al. OSDI'14 (ALICE crash-consistency). Stale tmp cleanup + TTL GC on open. Zero new deps, matches existing `atomicWrite`, auditable in ~100 lines. Cost: no indexed queries, last-write-wins unless caller holds the CAS token; directory fsync best-effort on Windows.
- **SQLite via `node:sqlite` (stdlib, deferred)**: atomic commit + WAL give multi-statement transactions and crash-tested recovery (SQLite Atomic Commit docs; WAL mode). Rejected now: WAL needs same-machine shared memory (fails on network FS), checkpointing/migrations/schema ops, and a second storage paradigm for a few KB of TTL state. Graduate when: >1 concurrent writer must not lost-update, or throughput >~10 redeems/s, or indexed queries needed.
- **External lockfile only, state stays in-memory**: fixes lost-update but not restart loss. Rejected: restart fail-closed-to-`unknown` is already the complaint.

## Consequences

`src/store/challenges.ts` owns the file-CAS module behind the `src/index.ts` seam; MCP server and CLI consume it, never raw `fs`. Crash test (kill -9 mid-redeem) must show exactly-one receipt. References: SQLite Atomic Commit / WAL docs; Borrill 2026 FITO impossibility (no syscall alone defines a commit boundary — hence file+dir fsync protocol); Crosby–Wallach history-tree lineage for the audit side (see T5 anchor work, Yağız et al. arXiv:2605.00065).
