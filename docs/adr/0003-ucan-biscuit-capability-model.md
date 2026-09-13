# UCAN-style attenuation with Biscuit-style cascade revocation over Ed25519

Capabilities must shrink as they travel across agents and be revocable when a parent is revoked. We adopt UCAN v1.0.0 narrowing semantics (command subpath + policy AND-narrowing + `aud == next.iss` chaining + earliest-expiry wins) with Biscuit-style cascade revocation (`revocation_id` per block; revoking a parent cascades to derived tokens), signed with Ed25519 and short expiries.

## Considered Options

- **Macaroons (HMAC-SHA256)**: elegant offline attenuation, but symmetric-only — only the verifier can check. Rejected for a portable layer where any peer must verify.
- **OAuth Token Exchange (RFC 8693)**: online AS-mediated delegation with no propagated revocation. Useful at ecosystem edges, but not a local-first capability format.
- **GNAP (RFC 9635)**: standard but niche adoption; no reason to require it in v0.1.

## Consequences

Any peer can verify a capability with the root public key; child ≤ parent is checkable without a server call. We must still operate a revocation list check at redemption and evict entries after expiry — revocation is not free.

Amendment (2026-09-13, ADR-0009): `ptf/cap@0.1` is local-only `@internal` — never wire; interop uses the standards edge.
