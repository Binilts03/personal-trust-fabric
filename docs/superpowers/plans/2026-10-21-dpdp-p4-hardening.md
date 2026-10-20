# DPDP P4 hardening plan (post-merge backlog)

**Status:** planned. Each item lands as its own pull request, branched from
`main` after PR #104 (DPDP privacy enforcement) merged. Every PR runs the
full local gate (`npm run typecheck`, `npm test`, `npm run eval`,
`node scripts/check-seams.mjs`, `bash scripts/harness.sh`, `prettier --check`)
and an independent review before merge.

## Why these four

PR #104 shipped the privacy enforcement layer and an independent review
(Standards / Spec / Security). The reviews left no blocker, but they named
the residuals that are worth engineering next, in this order:

> **Status:** P4-1 (the withdrawal fence), P4-2 (the DEK/CAS consolidation),
> P4-3 (the indexed event store), and P4-4 (the per-host enforcement
> decision) have shipped.

1. **Consent-withdrawal race** - the privacy recheck happens before the
   effect, but nothing binds the recheck to the effect. A withdrawal that
   lands between the two still lets the effect through. This is the only
   residual with a _security_ character, so it comes first.
2. **DEK / CAS consolidation** - the vault, privacy and event stores each
   implement their own key resolution and revision CAS. Three copies of one
   rule drift; one shared helper makes the rules provable once.
3. **Indexed event store** - the encrypted event store scans and decrypts
   every record for a lookup. It is correct but O(n) and it caps at 5,000
   records, so it is not usable for a busy host.
4. **Global vs reference-host enforcement** - a decision, not an
   implementation: PTF cannot be a global interceptor without turning every
   host into a policy engine. The decision records what "enforced" means
   per host and what a future global mode would need.

## P4-1 - Revision-bound withdrawal fence (TDD)

**Problem.** `PrivacyRuntime.recheck` reloads the privacy state and
re-evaluates, but the effect that follows is not bound to the revision that
was evaluated. A withdrawal written in that window is invisible to the
in-flight attempt (`docs/audit/limits.md`, "Consent withdrawal race").

**Shape.**

- The allow result carries the privacy revision that was evaluated.
- The runtime exposes an explicit fence: re-read the privacy state and fail
  closed when the decision no longer holds.
- The fence runs at the effect boundary, _after_ the authority use is
  consumed and _before_ the secret is released or the provider is called.
  Burning the use instead of delivering is the existing safe direction
  (the vault already does burn-before-deliver).
- A revoked/withdrawn state is still a denial; a _moved revision_ is a
  pre-effect failure, not a privacy denial, so the evidence says
  `FAILED_FINAL` and the agent is told the attempt was stopped before the
  effect.

**Shipped (this PR).** `PrivacyRuntime.fence` re-evaluates the privacy
decision (never the authority: that use is already spent) and the three
processing paths call it at the effect boundary - the disclosure, the
protected use, and the `/pay` redemption. The tests move the privacy state
between the recheck and the fence with a stateful runtime, so they do not
depend on how many evaluations a path performs.

**Tests first.** A stateful privacy loader (active on the recheck,
withdrawn on the fence) proves: the secret is never released, the provider
is never called, the use is burned, and the evidence is pre-effect.

**Done when.** the residual in `docs/audit/limits.md` is narrowed to "the
fence and the external effect are not one atomic transaction" and the
TDD tests are in CI.

## P4-2 - One DEK resolution, one revision CAS

**Problem.** `resolveVaultDek` / `resolvePrivacyDek` / `readSealedEnvelopeKid`
and `withNextVaultRevision` / `withNextPrivacyRevision` / `withNextRevision`
are three copies of two rules.

**Shape.** one `resolveSealedDek(keys, alias, kid, opts)` and one
`withNextSealedRevision(dir, path, current, next, opts)` in the
`src/store/sealed-snapshot.ts` module, used by every store; the per-store
files keep their own error vocabulary.

**Done when.** the file and SQLite backends still pass their parity suites
and the store files each shrink by the duplicated rule.

## P4-3 - Indexed event store

**Problem.** `findByKey`, `listBySubject`, `findByAttempt` and the recovery
sweep decrypt every event file.

**Shape.** an encrypted index (attempt reference, subject reference, and
terms digest) beside the event files, so a lookup touches one record. The
index is written and rotated with the events, and a missing or stale index
falls back to the full scan (never to "not found").

**Done when.** a lookup costs one decryption, the 5,000-record cap is
raised or proven unnecessary, and the metadata side channel is documented.

**Shipped (this pull request).** `findByKey` now resolves the event file
directly from the idempotency key (the event id is derived from it), so it is
one file read instead of a scan that decrypts every event. `findByAttempt`
uses a sealed **attempt cache** (`privacy-event-index.json`, beside the store
so the backup manifest keeps counting events, not cache files) that maps an
attempt reference to the event files covering it. The cache is a cache and
nothing else: a missing, stale, tampered, or rotated-away index is a cache
miss, and the lookup falls back to the full scan, so the index can never hide
an event. Writing the index is best effort - it must never fail the evidence
write.

## P4-4 - Global vs reference-host enforcement (decision)

**Problem.** privacy enforcement is per host: the reference MCP host
enforces it, every other host must compose `PrivacyRuntime` itself. The
product wording has to be exact about that.

**Shape.** an ADR that decides: enforcement is opt-in per host, PTF does not
become a global interceptor, `privacy verify` reports _configured_
coverage (never runtime attestation), and the migration path for a host that
wants enforcement is "compose `PrivacyRuntime` at the effect boundary and
bind the evidence". The ADR also states what a future global mode would
need (a host-side interception seam) and why the library will not pretend
to offer it today.

**Done when.** the ADR exists, `docs/audit/limits.md`, the design and the
changelog all point at it, and the wording in the README/docs matches.

**Shipped (this pull request).** `docs/adr/0025-privacy-enforcement-is-per-host.md`
decides it: enforcement is per-host, explicit, and composed at the effect
boundary; the curated `./privacy` surface stays persistence-free; coverage is
reported, never attested; and the wording rules follow. The ADR also names
what a future global mode would need and gives the adoption path for a host
that wants enforcement. `docs/audit/limits.md` points at it where it
discloses the per-host coverage gap.
