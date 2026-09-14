# ADR-0013: Trusted identity ingress (VerifiedIdentity; rooted removed; digest by construction)

**Date**: 2026-09-13
**Status**: accepted
**Deciders**: PTF maintainer + consolidation loop (tickets 15/16)
**Amends**: ADR-0010 (actor selectors, digest handling)

## Context

ADR-0010 made actor selectors explicit and derived the digest server-side,
but two caller-controlled inputs remained. First, the `actor` string was
explicit yet unauthenticated: the MCP server and `authZenToDemand` took
principal/agent straight from the agent-supplied request body, so any
injected agent could claim `did:agent:trusted-travel-agent` and inherit its
grants. Second, `rooted` delegation matched when a trusted root appeared
_anywhere_ in a caller-supplied `actorChain`, with no constraint tying the
chain to the actor — while RFC 8693 gives nested `act` claims informational
status only ("for access-control policy, only the current actor and
top-level claims are to be considered"). Third, the public `evaluate` API
still accepted a caller-supplied `termsDigest`, leaving the
never-self-certify invariant to convention rather than construction.

## Decision

Trusted ingress identity (`src/core/authority.ts`):

- The engine binds identity from a host-verified `VerifiedIdentity`
  (`{ id, principal, source, proofRef, chain? }`) handed in out-of-band —
  `source` is one of
  `oauth|mcp-token|dpop|mtls|local-registration|api-key`. Callers never
  choose their own identity.
- `evaluate(operation, ingress, opts?)` takes an identity-free,
  digest-free `AuthorityOperation` (action/resource/context/purpose only),
  binds principal/actor/chain from the ingress, and derives the digest
  internally (folding `opts.binding` when present).
- Request-carried identity fields are untrusted hints that fail closed on
  mismatch: `authZenToDemand` throws on present-but-unequal `subject.id` /
  `properties.actor` / `properties.actorChain` (absence is fine — the
  generic-PEP case binds everything from the ingress). The MCP server pins
  principal+actor at instantiation (`local-registration`, `stdio:<dir>`)
  and carries no identity in tool schemas; both PDP servers map each API
  key to a fixed verified identity (`api-key`, key id as `proofRef`) with
  the same hint-equality check.
- `rooted` is removed from `ActorSelector` (now `exact|set|any`;
  registration of `rooted` throws). Delegation history (`ingress.chain` →
  demand `actorChain`) is provenance for audit, never authorization.
  Approval `chain`, when present, must equal the demand chain exactly.
- Digest by construction: `termsDigest` leaves the public evaluation
  input. Verified protocol bindings travel separately as
  `VerifiedExternalBinding` (`{ scheme: "ap2", value, evidenceRef }`),
  covered by the digest and echoed in citations — preserving the ADR-0010
  AP2 carve-out without a caller-controlled digest field.

## Alternatives Considered

### Alternative 1: Keep `rooted`, tighten chain validation (first===root, last===actor)

- **Pros**: No selector removal; narrower spoof surface.
- **Cons**: Still authorizes from unverified history — any tightening is
  cosmetic until a verified-delegation proof exists, and it keeps using
  RFC 8693 history against the RFC's explicit guidance.
- **Why not**: Rejected — remove until a separately verified delegation
  mechanism exists (a future `delegated-from` selector).

### Alternative 2: Keep caller-supplied `termsDigest` alongside derived comparison

- **Pros**: No API break; external tx-id bindings ride the existing field.
- **Cons**: The never-self-certify invariant stays conventional; every
  new caller is a new chance to trust the field.
- **Why not**: Rejected — `VerifiedExternalBinding` carries the one
  legitimate external value with its evidence pointer.

## Consequences

- Amends ADR-0010: its `rooted` documentation and caller-shaped demand
  description are superseded (amendment note appended there); snapshot
  format break is unchanged (pre-0010 stores already rejected).
- Ingress mapping is host duty at every boundary (stdio env, API-key
  file, OAuth/DPoP/mTLS token validation) — the engine only validates
  shape, never credentials. Per-key/per-process limits (rate buckets,
  rotation, scope) stay host-owned; see the ticket-13 threat-model entry.
- Tests must prove `same claimed actor string + wrong ingress proof =
DENY` (spoof-hint cases in the MCP/PDP suites), not just
  unknown-string denial.
