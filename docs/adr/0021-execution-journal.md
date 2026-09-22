# ADR-0021: Durable execution journal with idempotency and reconciliation

**Date**: 2026-09-22
**Status**: accepted
**Deciders**: PTF maintainer

## Context

PTF persists authority consumption _before_ the external effect
(ADR-0018, `executeProtectedAction`): a crash or failing rail between
persist and execute burns a use without a receipt. That is the safe
direction against double-spending, but for consequential actions it
leaves the outcome unknown — the operator cannot tell "no effect" from
"effect without receipt", and a naive retry risks duplicating the
external effect. Roadmap G3 requires a durable execution journal with
provider idempotency and reconcile-on-restart instead of blind retry.
Exactly-once distributed execution is not assumed.

## Decision

`src/store/execution.ts` implements a file-backed journal; the provider
seam gains a journaled orchestrator. Authority accounting is unchanged
(consumption still persists before effect); the journal adds
unknown-outcome safety around it.

States and allowed transitions (anything else throws, fail-closed):

```text
PREPARED ──→ AUTHORIZED ──→ SUBMITTING ──┬──→ SUCCEEDED
    │              │              │       ├──→ FAILED_FINAL
    │              │              │       └──→ SUBMITTED_UNKNOWN ──┬──→ SUCCEEDED
    │              │              │                               ├──→ SUBMITTING (retry)
    │              │              │                               └──→ RECONCILED
    └──→ FAILED_FINAL            │
(AUTHORIZED ← PREPARED only after a consumed, proof-verified redemption
is validated; SUBMITTING persists BEFORE the provider call.)
```

- **Identity**: every effectful run gets `executionId` (`randomHex(16)`,
  32 hex chars, one file `executions/<id>.json`) plus a deterministic
  `providerIdempotencyKey` derived from the FULL `(termsDigest,
capabilityId)` — never caller-supplied, so one terms set cannot fork two
  keys. Stable across retries of the same authorized terms.
- **Submit path**: `AUTHORIZED → SUBMITTING` (attempts+1, durable) →
  provider call carrying the idempotency key in the non-effectful
  `metadata` bag → provider `verify` → `SUCCEEDED` (external ref +
  receipt fields persisted), or `SUBMITTED_UNKNOWN` on throw/timeout AND
  on attestation failure: a failed `verify` is not proof of no-effect
  (the rail may have executed with only the confirmation bad), so it
  reconciles rather than hiding behind a terminal state. `FAILED_FINAL`
  is reserved for explicit host abort (freeze/cancel of pending records).
  No receipt exists unless `SUCCEEDED` persisted.
- **Restart path**: leftover `SUBMITTING` records are crash evidence, so
  recovery marks them `SUBMITTED_UNKNOWN` first. Reconcile queries the
  provider by idempotency key: effect confirmed → `SUCCEEDED`; absent →
  back to `SUBMITTING` for exactly one safe retry with the SAME key
  (attempt budget fixed at create — resume cannot re-arm it — then
  `RECONCILED`); unknowable → `RECONCILED` quarantine for manual
  reconciliation. **Never blind-retry**: resume without a query result
  throws `reconcile required`.
- **Idempotent replay**: re-running identical terms returns the stored
  `SUCCEEDED` receipt without touching the provider; re-running
  `FAILED_FINAL`/`RECONCILED` throws without touching the provider.
- **Storage**: one JSON file per execution (O_EXCL create, durable
  write→fsync→rename, `0600`, corrupt→throw), mirroring ADR-0017
  conventions. The journal exposes an `ExecutionRepository`-shaped
  interface (create/load/transition/find-by-key/recover) so the
  Phase-4 persistence decision can swap backends without touching the
  state machine. No TTL/GC: execution records are audit-supporting
  history; growth is one small file per effectful op (limits residual).

## Alternatives Considered

### Journal inside the authority store file

- **Pros**: single file, revision CAS covers both.
- **Cons**: couples authority lifecycle to execution lifecycle; every
  execution rewrites authority state; rollback semantics blur.
- **Why not**: separation keeps authority accounting (burn-before-effect)
  independent from outcome tracking (reconcile).

### Blind retry with idempotency key only

- **Pros**: simpler; providers dedupe.
- **Cons**: not all providers honor keys; "unknown" stays unknown; a
  retry after an effected-but-unreported call depends entirely on
  provider dedup working.
- **Why not**: the mission explicitly forbids blind retry after ambiguous
  effects. Query-first reconcile is the mechanism; the key is the
  correlator, not the guarantee.

### SQLite now

- **Pros**: atomic multi-record updates, indexes for key lookup.
- **Cons**: pre-empts the Phase-4 backend decision (G4 EXPERIMENT);
  pulls a dependency and schema into the trust path prematurely.
- **Why not**: ADR-0019 requires storage-independence first; the file
  journal behind the repository interface preserves that sequencing.

## Consequences

- Crash windows move from "burned use, unknown outcome" to "burned use,
  recorded outcome-or-quarantine with a recovery procedure". The burned
  use itself is unchanged (still the safe direction).
- `SUBMITTED_UNKNOWN`/`RECONCILED` records require operator attention:
  reconcile needs a provider query capability (`ExecutionQuery` seam;
  fakes in tests, host rails in production).
- `docs/audit/limits.md` records: file-journal O(n) key lookup, no GC,
  single-writer topology unchanged (cross-process same-key races and
  read-then-write transitions rely on the single-writer backstop, same as
  proposals), manual step for `RECONCILED`.
