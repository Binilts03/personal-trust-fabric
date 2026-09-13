# ADR-0010: Domain-neutral authority with verified actor binding

**Date**: 2026-09-13
**Status**: accepted
**Deciders**: PTF maintainer + standards-pivot loop (ticket 08)

## Context

The v0.1 `Authority` engine spoke payments natively: demands carried
`cmd`/`recipient`/`amount`/`currency`/`claims` as first-class fields, and
grants mirrored them (`amountMax`, `allowedClaims`). Every new domain
(signing, scheduling, MCP tool calls) would have needed new engine fields —
the exact fork-risk ADR-0009 assigns to adapters, not the core. Meanwhile
actor binding was implicit (absent `agent` meant "any agent of the
principal") and the terms digest was caller-supplied, so an untrusted PEP
could assert its own binding.

## Decision

The engine is now domain-neutral (`src/core/authority.ts`):

- Demands are `AuthorityRequest`: principal + verified `actor` (+ optional
  `actorChain`), structured `action` (`name` /-path + properties bag),
  structured `resource` (`type` + `id` + properties bag), a free-form
  `context` attribute bag, optional `purpose`, and a `termsDigest`.
- Grants match on identity (principal, actor selector, action subpath
  coverage via the existing `isCovered`, exact-if-present
  action-properties/resource/purpose) plus a list of `AttributeBound`
  predicates evaluated with the existing `policy.ts` `resolveSelector`
  syntax (e.g. `.context.amount`). Op semantics: `==` canonical
  deep-equal, `<=`/`>=` finite numbers, `in` scalar-membership,
  `subset` string-array inclusion. Unresolvable paths never match.
- Actor binding is explicit: `StandingGrant.actor` is REQUIRED.
  `{ kind: "exact" | "set" | "rooted" | "any" }`. Missing is never
  wildcard — `addGrant` throws. `rooted` matches when the demand chain
  includes the root. `any` is a deliberate, audit-visible wildcard
  (CLI `--any-agent`, MCP/test fixtures); prefer exact/set/rooted.
- The digest is DERIVED, never trusted: `digestForOperation` canonicalizes
  the normalized operation (absent chain ≡ `[]`, absent purpose ≡ `null`,
  absent bags ≡ `{}`) and hashes it. `createApproval` takes the operation
  (no terms field) and digests internally; `evaluate` keeps comparing
  digests. `authzen.ts` recomputes the digest from the recovered operation
  and IGNORES any caller-supplied `context.termsDigest` — a tampered
  envelope digest cannot change the decision (covered by test).
- Profiles are small helpers, not a policy language:
  `paymentBounds({ amountMax, currency })` and `claimsSubset(allowed)`.
  Payment/disclosure attributes live in context (`.context.amount`,
  `.context.currency`, `.context.recipient`, `.context.claims`,
  `.context.verifier`); `resource` carries the domain object
  (`{ type: "invoice", id: "invoice:1" }`, `{ type: "credential", id }`).
  Signing/MCP/calendar profiles are future work, not this ticket.
- AP2 exception: verified mandates (`adapters/ap2.ts`
  `toAp2PaymentDemand`) may bind an external transaction id as the digest,
  because there the id is verified evidence (checkout_hash linkage
  recomputed during verification), not caller assertion. Noted as a code
  comment in `authzen.ts`; `ap2.ts` itself migrates in ticket 09/10.

## Alternatives Considered

### Alternative 1: Embed Cedar (or Rego) as the grant language

- **Pros**: Expressive policies out of the box; familiar to gateway authors.
- **Cons**: A full policy engine inside the zero-dep core (new parser,
  new evaluator, new audit surface) for constraints that are currently
  five small predicates. Overkill for PTF's threat model, where grants
  are user-written ceilings, not multi-tenant policies.
- **Why not**: Rejected — the five-op `AttributeBound` list plus
  `resolveSelector` covers payment/disclosure/delegation bounds with ~60
  lines and no new trust surface. Revisit if a third domain needs joins
  or negation.

### Alternative 2: Keep payment-shaped fields and add per-domain fields

- **Pros**: No migration; existing snapshots keep working.
- **Cons**: Engine grows a field per domain; translators must map onto a
  vocabulary that was never theirs; the next domain repeats the work.
- **Why not**: Repeats the pre-0009 fork pattern inside the core.

### Alternative 3: Trust caller-supplied digests at the AuthZEN edge

- **Pros**: PEPs can pre-bind terms (e.g. AP2-style external tx ids).
- **Cons**: Any compromised PEP mints its own binding; the PDP stops
  being the binding authority.
- **Why not**: Rejected except for the verified-mandate carve-out above,
  where the binding value is itself verified evidence.

## Consequences

### Positive

- New domains need no engine change: bounds over context + resource
  typing. Core stays zero-dep (`node:crypto` only), strict TS.
- Actor scoping is auditable: no silent wildcards; near-misses deny
  `no-authority` with an `actor mismatch on <grant|approval id>` detail.
- Translators cannot weaken binding: derived digests everywhere except
  the documented AP2 carve-out.

### Negative / migration notes

- SNAPSHOT FORMAT BREAK: pre-0010 stores (grants with `cmd`, no `actor`)
  are rejected at restore with an explicit error (no version field
  existed to key tolerance off — see `addGrant`). Operators recreate
  grants via the CLI.
- CLI: `grant` requires exactly one of `--agent` (exact) / `--actor-set`
  / `--rooted-from` / `--any-agent`; `--amount-max`/`--currency`/
  `--recipient`/`--allowed-claims` become context bounds;
  `--resource-type` added; `pay`/`disclose` digests are derived and
  `--terms-json` is removed from both CLI and MCP (untrusted callers must
  not supply binding).
- `termsDigest` is a RESERVED AuthZEN context key (binding echo, stripped
  on recovery); demand data must not use it.
- Digest array order is significant (`["b","a"]` ≠ `["a","b"]`): the
  engine cannot know which arrays are order-insensitive.
- Pre-0010 `AuthorityDemand` (and its field names) is gone. `ap2.ts`,
  `x402.ts`, and their tests still construct the old shape — ticket 09/10
  migrates them (changed-API list in the ticket 08 report). Until then,
  `toAp2PaymentDemand`/`toX402PaymentDemand` must not feed
  `authZenToDemand` directly.
