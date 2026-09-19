# Adapters (evidence in, never authority out)

Thin translators between external protocols/standards and the deterministic core.
They may parse, verify signatures, and fetch settlement proofs — they may
never manufacture authority. Every adapter output re-enters `Authority`
or `Capabilities` for an independent decision.

Standards edge (ADR-0009, current):

- `authzen.ts` — PTF `Authority` as PDP: demand ↔ AuthZEN SARC, decision with citations.
- `oauth-agent.ts` — RFC8693-style attenuation (`sub` fixed, `act` append-only, scope subset, exp clamp, sender `cnf`).
- `sd-jwt.ts` — PTF presentation → standard SD-JWT `_sd`/disclosures + KB-JWT claims (evidence-only; issuance host-side).
- `audit-interop.ts` — `AuditEntry` → interop record (`jti` = hash); unkeyed verify by recompute, keyed opaque.
- `x402/` — parse v2 `PAYMENT-REQUIRED` headers → PTF payment demand; verify settlement via the external facilitator/RPC (evidence only — PTF never facilitates).
- `ap2/` — verify Intent→Cart→Payment SD-JWT chains (`cnf`, `exp`, checkout hash) → demand.
- `oid4vp/` — DCQL request → disclosure demand (`requested ∩ available ∩ allowed`).
- `mcp/` + `webmcp/` — origin/audience/scope gate + confirm-mutating-executes.
- `a2a/` — signed AgentCard check + per-skill least-privilege tasks.

Out of scope (never add here): custodial wallet, new payment rail/chain, GNAP server,
universal DID resolver, PSP risk engine, production HSM/keychain backend.

Rule: `src/core` never imports from `src/adapters` (lint-enforced).
