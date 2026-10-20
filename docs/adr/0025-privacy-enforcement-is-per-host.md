# ADR-0025: Privacy enforcement is per-host, explicit, and composed at the effect boundary

**Status:** accepted
**Date:** 2026-10-21
**Deciders:** PTF maintainer
**Supersedes/extends:** ADR-0024 (privacy is a narrowing layer beside Authority)

## Context

PR #104 added a DPDP privacy-enforcement layer: encrypted privacy
configuration and Processing Events, a privacy operator CLI, and privacy
gates for the reference MCP host's disclosure and payment routes. The
independent review of that work raised one question that the code alone
cannot answer: **who is actually enforcing privacy?**

The honest answer today is: the host that composes `PrivacyRuntime` at its
effect boundary. The reference stdio MCP server does. The operator CLI's
payment and disclosure paths do not (they are operator actions, and
`privacy verify` reports them as _uncovered_). A library consumer that calls
`executeProtectedAction` directly, or an adapter that moves money, does not
get privacy enforcement unless its author composes the runtime. The DPDP
layer is a library, not an interceptor.

That is a deliberate design, but it is also a phrase that is easy to
overstate. "PTF enforces DPDP" is wrong as a blanket claim; "the reference
host enforces the configured DPDP controls for the routes it owns" is right.

## Decision

1. **Enforcement is per-host, explicit, and opt-in.** PTF does not become a
   global interceptor. A host that processes personal data either composes
   `PrivacyRuntime` at its effect boundary (and gets enforcement plus
   evidence) or it does not (and is _uncovered_, not _compliant_). PTF never
   claims the second case is compliant.
2. **The library surface stays persistence-free.** The curated `./privacy`
   subpath exposes the model, engine, runtime, rights helpers, and the
   policy builders - never the file-backed stores. Hosts wire the encrypted
   stores themselves (`src/privacy/mcp-host.ts` is the reference wiring). A
   host that wants enforcement needs two things: a `PrivacyRuntime` and a
   place to keep the evidence.
3. **The effect boundary is the only honest place to enforce.** The gate
   runs immediately before the effect, re-reads the privacy state, and binds
   the evidence to the exact operation. Enforcing earlier (at the proposal)
   would leave a withdrawal race; enforcing later (after the effect) would
   be theatre. The fence (ADR-0024, P4-1) narrows that race to the
   unavoidable gap between the fence and the external effect.
4. **Coverage is reported, never attested.** `privacy verify` reports the
   _configured_ coverage of the reference host (gated / denied / uncovered
   paths) and says `runtimeAttested: false`. It cannot prove that a
   separately running host executes the wrapper, so it does not pretend to.
   Operators prove the real boundary with end-to-end tests and deployment
   logs.
5. **The wording rules are part of the decision.** Product and docs text
   says "privacy enforcement mode", "helps enforce / support DPDP
   controls", "configured coverage", "not attested". It never says
   "compliant", "DPDP compliant", "guarantees compliance", or "registered
   Consent Manager", and it never implies that an uncovered path is
   compliant.

## What a future global mode would need (and why it is not this release)

A global mode would need an interception seam that PTF does not have: every
effect path (including third-party adapters and operator tooling) would have
to route through one host-side boundary, and the boundary would have to own
the privacy state rather than read it. Today the closest thing to that is
`executeProtectedActionWithPrivacy` plus the `PrivacyRuntime`, and a host
that adopts it _is_ globally enforced for its own effects. So the migration
path is real and small:

```text
host effect path
  -> runtime.preflight(gate)      # authority first, then privacy
  -> runtime.recheck(gate)        # live privacy state
  -> runtime.prepareEvent(...)    # durable, secret-free evidence
  -> effect
  -> runtime.finalizeEvent(...)   # observed outcome
```

A host adopts that sequence once, at its effect boundary, and every
operation it performs is then enforced and evidenced. That is the intended
adoption path, and it is what the reference MCP host does.

## Consequences

- Operators who want DPDP controls must run a host that composes the
  runtime, and must verify that the host they run actually does (the
  reference host's coverage is reported by `privacy verify`, with the
  attestation caveat above).
- The `docs/audit/limits.md` entry "every other host must compose
  `PrivacyRuntime` itself" stays true and stays disclosed.
- The library cannot be used as a compliance certificate, a DPIA, a
  breach-notification system, a DSAR tool, or a registered Consent
  Manager. Those remain operator obligations and are named as such.
- A future release may add a _host kit_ (a reusable effect-boundary helper
  with a conformance test) so that adoption is one call plus a test rather
  than a composition. That is an ergonomics improvement, not a change of
  the decision: the host still composes the runtime.
- The file-backed evidence store's scaling limits (documented in
  `docs/audit/limits.md`) are a property of the _reference_ store, not of
  the decision: a host with its own indexed event store keeps the same
  contract.

## References

- ADR-0024 - privacy enforcement narrows Authority.
- `docs/superpowers/specs/2026-10-18-dpdp-privacy-enforcement-design.md`
  - the approved design, §7 (module design), §14 (agent/MCP boundary),
    §23 (explicit residuals).
- `docs/audit/limits.md` - the disclosed boundaries, including the
  per-host coverage gap.
- `docs/superpowers/plans/2026-10-21-dpdp-p4-hardening.md` - the P4
  backlog this decision belongs to.
