# Threat model — skeleton (v0.1)

## Assets

Principal secrets (payment instruments, signing keys, credentials), Authority State (grants/approvals), Personal State, capabilities in flight.

## Trust boundaries

1. Agent (untrusted, possibly injected) ↔ PTF authority plane (trusted, deterministic).
2. PTF ↔ recipient (authenticated via Identity Binding + Ed25519 proof before execution).
3. PTF ↔ external protocol (x402/AP2/OpenID4VP/MCP/A2A treated as evidence, never authority).
4. PTF ↔ human approver (digest-bound proposal; any term change = new approval).
5. Standards edge (`authzen`/`oauth-agent`/`sd-jwt`/`audit-interop` projections) ↔ `Authority.evaluate`: projections are evidence in, decision in `Authority.evaluate`.

## Attackers in scope

Prompt-injected agent requesting `pay attacker ₹100k`; malicious tool description / WebMCP output; substituted recipient key; replayed capability; oversharing verifier; compromised adapter; log scraper; `act` chain confusion; `aud` widening; trusting `ptf_digest` without recompute.

## Out of scope for v0.1

Compromised OS/keychain, side-channels, independent audit anchoring (noted in ADR-0006), full AP2 Human-Not-Present flows.

## Must-hold properties

Default-deny; policy never creates authority; Personal State ≠ Authority State; child ≤ parent; expiry + maxUses enforced at redemption; `requested ∩ available ∩ allowed` disclosure; no secrets to agent or logs.

## Abuse cases to encode as regression evals

Replay, over-spend, expired use, wrong-recipient redeem, mutated termsDigest, verifier requesting 10 claims but allowed 2, MCP token-passthrough attempt, WebMCP description poisoning.
