# ADR-0009: Authority engine over open standards, proprietary wire internal

**Date**: 2026-09-13
**Status**: accepted
**Deciders**: PTF maintainer + standards-pivot loop

## Context

PTF v0.1–v0.4 proves deterministic authority (`Authority.evaluate`, digest-bound approvals, attenuation, holder-bound disclosure, secretness receipts). During 2026 FIDO (Agentic Auth + AP2/Verifiable Intent), OpenID AuthZEN Authorization API draft-01 (Implementer's-Draft track) + COAZ-MCP + Approval profile, IETF `draft-mishra-oauth-agent-grants-02` (individual draft), 1Password zero-exposure, Bitwarden alpha SDK, Entra Agent ID, NPCI/UPI registry reports, and OSS RFC8693 attenuators converged on the same primitives. PTF must not fork the trust stack; its defensible seat is the user-owned policy decision + translation layer.

## Decision

PTF keeps the `Authority` semantic core and acts as PDP speaking standards at the edge. New code uses `adapters/authzen.ts` (SARC) and `adapters/oauth-agent.ts` (RFC8693 attenuation) for interop. `ptf/cap@0.1` remains implemented for local tests but is `@internal` — never wire. Wallet, new rail/chain, GNAP server, universal DID resolver stay out of scope.

## Alternatives Considered

### Alternative 1: Keep proprietary wire as primary interop

- **Pros**: No migration; full control of envelope.
- **Cons**: Forks FIDO/AuthZEN/OAuth ecosystem; gateway authors must learn PTF; audit/conformance burden.
- **Why not**: Standards already define mandate/evidence (AP2/VI), decision API (AuthZEN), and delegation (RFC8693); PTF wins on portable policy, not format.

### Alternative 2: Adopt external PDP and shrink PTF to policy DSL

- **Pros**: Smallest core; delegates decisions outward.
- **Cons**: Loses deterministic offline decision + citations + Personal≠Authority invariant; host-dependent availability.
- **Why not**: The surviving differentiator is the local decision runtime with `policy constrains never creates`; translation preserves it.

## Consequences

### Positive

- Gateways call a familiar AuthZEN PDP shape; agents delegate via standard `sub`/`act`/`scope`/`cnf`.
- Core stays zero-dep, small, auditable; adapters carry interop risk.
- Proprietary wire cannot leak into new integrations (lint + JSDoc + tests).

### Negative

- Two representations to maintain (internal cap + standard JWT/SARC) during migration.
- SD-JWT/KB-JWT emission is host-side and evidence-only (ticket 05); independent audit anchoring is out of scope, anchor reuse only (ticket 06).

### Risks

- IETF draft is individual (no standing), Bitwarden alpha, NPCI sources-based — track upstream; translators are narrowly scoped so spec drift is contained in `adapters/`.
- 1Password-style brokers protect credentials but not post-auth sessions — PTF must still deny over-broad demands after authentication (covered by `evaluateAuthZen` + existing policy gates).
