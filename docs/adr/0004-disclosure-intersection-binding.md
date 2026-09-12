# Disclosure as intersection with holder binding

Verifiers routinely request more claims than they need. We disclose `requested ∩ available ∩ allowed`, bound to audience, nonce, and freshness, with cryptographic holder binding (SD-JWT KB-JWT `sd_hash`, mdoc SessionTranscript, or DataIntegrity challenge+domain). Bearer-only presentations are rejected for anything consequential.

## Considered Options

- **Full credential share**: simplest, violates minimal-disclosure and fails peer review.
- **Verifier-decides model**: treats OpenID4VP `dcql_query` as authorization to overshare. Rejected — the request is an upper bound, not a grant.
