# ADR-0022: Transactional persistence decision (SQLite WAL, file retained)

**Date**: 2026-09-22
**Status**: accepted
**Deciders**: PTF maintainer

## Context

PTF persists six durable surfaces as JSON + CAS: `authority.json` /
`registry.json` (whole-snapshot, revision CAS), `personal-state.json`
(encrypted envelope), `proposals/` + `executions/` (one file per record),
`audit.jsonl` (append-only chain), `anchor.json` (checkpoints), plus
host-owned nonce sets. Roadmap G4 asks whether this remains appropriate
for production operation of a Personal Authority Node, which needs atomic
state around authority consumption, proposal transitions, the execution
journal, nonce/replay state, receipts, revocation, and audit indexes.
Homes today: receipts live in journal records (`externalRef`/`receiptId`)
and audit entries; revocation sets live in the authority snapshot; both
stay where they are in this phase — only the execution journal gains a
second backend. The handles-only invariant for journal payloads is
enforced at the provider seam (`authorizedTermsCover` exact-context
equality in `src/adapters/providers.ts`, proven by the secret canary
tests), not by either store.

## Comparison

### A. Existing file/CAS backend (status quo)

- **Pros**: no dependencies, fully audited behavior, crash semantics
  understood and tested (atomic tmp+rename, O_EXCL create, revision CAS,
  freshness bindings), human-inspectable, backup = directory copy.
- **Cons**: whole-snapshot rewrites for authority/registry; O(n) scans for
  key lookups (proposals, executions, audit freshness); no atomic
  multi-record commit (authority + journal cannot commit together);
  read-then-write transitions without locks (single-writer backstop).
- **Verdict**: retain as reference / migration / test backend. It is the
  fallback if anything below regresses.

### B. SQLite WAL (`node:sqlite`, built-in, no new dependency)

- **Pros**: atomic multi-statement transactions (consume authority +
  journal in one commit — the exact gap in Phase 3 sequencing);
  indexed key/state lookups; single-file store with WAL crash safety;
  `UPDATE … WHERE state=?` gives real compare-and-swap per transition;
  built into Node (no supply-chain addition).
- **Cons**: `node:sqlite` is experimental in Node 22 (warning noise;
  API-drift risk, mitigated by the parity suite + retained file
  backend); WAL needs checkpoint/backup discipline (`VACUUM INTO` /
  online backup API) distinct from directory copy; binary file is not
  human-inspectable (mitigated: JSON export path).
- **Verdict**: CHOSEN for the node's transactional surfaces, incrementally
  behind repository interfaces, file remaining the default until each
  surface proves parity.

### C. SQLite + encrypted payloads (e.g. SQLCipher-style)

- **Pros**: ciphertext at rest inside the DB file.
- **Cons**: no built-in option — needs a native dependency (rejected:
  zero-new-deps posture, build complexity, supply chain); journal/proposal
  payloads are handles-only by construction (no secrets to encrypt);
  real secrets already live in the vault envelope, which stays file-based
  in this phase.
- **Verdict**: rejected for now; revisit only if a secret-bearing surface
  moves into the DB (then: encrypt record JSON with the vault DEK first,
  still no native dep).

### D. Embedded transactional KV store

- **Pros**: fast ordered KV, proven embedded story elsewhere.
- **Cons**: every option needs a third-party (often native) dependency;
  poorer ad-hoc queryability than SQL for audit indexes; same backup
  discipline questions as B with less stdlib support.
- **Verdict**: rejected — B dominates on zero-dep + queryability.

## Decision

- Authority engine stays storage-independent: `src/store/repositories.ts`
  defines `AuthorityRepository`, `ProposalRepository`,
  `ExecutionRepository`, `ReplayRepository`, `AuditRepository` shaped
  exactly on current behavior (`typeof` existing functions, no drift).
  `src/core/` never imports `src/store/` (existing CI zero-dep check).
- Bounded experiment first: SQLite WAL backs `ExecutionRepository`
  (`src/store/sqlite.ts`, `<storeDir>/ptf.sqlite`, `journal_mode=WAL`
  verified at open, `synchronous=FULL`, `busy_timeout`, checkpoint on
  close), proven by a parity suite running journal behavior against both
  backends plus a loss-free migration round-trip. Validation is shared
  (`validateExecutionRecord`) so tamper fails closed identically. File
  stays the default; SQLite is opt-in per surface until parity is proven
  for that surface.
- Audit log stays file-first (append-only chain + external tailers map
  poorly to SQLite value-add — no index/query analysis would change the
  append-only + tailer constraints); vault envelope stays file-based
  (real secrets; no native crypto deps). Authority/proposal SQLite ports
  follow only after the execution experiment holds in practice.
- Migration never discards: file→SQLite copies in one transaction
  (all-or-nothing; existing rows win), SQLite→file exports stage then
  atomically rename and refuse non-empty targets (never-merge rule),
  sources are never deleted by the migrator.

## Alternatives Considered

### Big-bang rewrite to SQLite

- **Pros**: one backend sooner.
- **Cons**: rewrites audited crash behavior wholesale; couples the
  Phase-3 journal (just landed) to an unproven store; violates "do not
  rewrite blindly".
- **Why not**: incremental, parity-gated, reversible.

### Status quo forever (no decision)

- **Pros**: zero work.
- **Cons**: leaves the atomicity gap (authority + journal commit),
  O(n) growth, and nonce durability to Phase 11 with no plan.
- **Why not**: G4 explicitly requires the decision before hardening.

## Consequences

- `node:sqlite` experimental residual recorded in limits (warning noise,
  API drift) with mitigations (parity suite, file fallback, no core
  contact — store-only import).
- New surfaces (`executions/`, `nonces.json`) join the backup unit with
  the same one-unit/never-merge/anchor rules; `ptf.sqlite` joins them
  when a deployment opts in (WAL + shm files travel together).
- `executeWithJournal` accepts an optional journal repository (default:
  file) so the experiment runs the real orchestrator, not a mock.
