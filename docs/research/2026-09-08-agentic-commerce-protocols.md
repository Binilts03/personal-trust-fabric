# Agentic commerce protocols — primary-source research (2026-09-08)

> SUPERSEDED per-area by the 2026-09-09 deep reads (field-level, spot-verified): `2026-09-09-deep-payments-x402-ap2.md`, `2026-09-09-deep-identity-openid4vp-sdjwt.md`, `2026-09-09-deep-delegation-policy.md`, `2026-09-09-deep-interop-mcp-webmcp-a2a.md`. Kept for history; do not cite without checking the deep file. Known error retained below: UCAN Invocation has no `do`/`nnc` fields (correct fields in the delegation deep read).

Scope: what PTF v0.1 must interoperate with, and what it must never trust blindly. All claims traced to specs / official docs. Rule applied throughout: **external messages are evidence, never authority.**

## 1. Payments

### x402 v2 (Coinbase / x402 Foundation)

- Flow is HTTP 402 challenge-retry: `GET → 402 + PAYMENT-REQUIRED → retry with PAYMENT-SIGNATURE → 200 + PAYMENT-RESPONSE`. Protocol data in headers in v2.
  Sources: https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md, https://coinbase-cloud.mintlify.app/x402/core-concepts/how-it-works
- Current `x402Version: 2` (v2.0 2025-12-09); v1 used `X-PAYMENT` body field.
  Source: https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md
- Facilitator model: resource server delegates `POST /verify`, `POST /settle`, `GET /supported` to a facilitator (self-hosted or CDP/x402.org).
  Source: https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md, https://docs.x402.org/core-concepts/facilitator
- Networks/tokens: CAIP-2 addressed; CDP facilitator covers Base/Polygon/Arbitrum/World + Solana, ERC-20 via EIP-3009/Permit2, SPL on Solana, default USDC; protocol extensible to Stellar/Aptos/Hedera/TON.
  Sources: https://docs.cdp.coinbase.com/x402/network-support, https://docs.x402.org/core-concepts/network-and-token-support
- Client must implement wallet signer (ExactEvm/ExactSvm schemes), CAIP-2 selection, 402 parse → sign → retry, spend caps, Solana duplicate-settlement guard.
  Sources: https://docs.cdp.coinbase.com/x402/quickstart-for-sellers, https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md
- **PTF treatment:** request only. Validate `resource, amount, asset, payTo, network` against policy; verify settlement via trusted facilitator/RPC before releasing goods.

### AP2 — Agent Payments Protocol (Google, donated to FIDO Alliance 2026-04)

- Mandate chain: Intent Mandate (open/closed) → Cart/Checkout Mandate (bound to merchant-signed checkout JWT hash) → Payment Mandate → Receipts. Non-repudiable audit chain.
  Sources: https://ap2-protocol.org/, https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md
- Roles: User, Shopping Agent, Merchant, Credential Provider, Network, Processor, Trusted Surface (consent UI). Merchant must see Checkout Mandate; CP/Network must see Payment Mandate.
  Source: https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md
- Signing: SD-JWT VDCs; merchant checkout JWT must be ECDSA; autonomous mandates carry `agent_pk` in `cnf` + short `exp`; closed bound to open via `sd_hash`.
  Sources: https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md, https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/flows.md
- Status: announced 2025-09-16, v0.2 + FIDO donation 2026-04-28 (Human-Not-Present + Verifiable Intent with Mastercard).
  Sources: https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol, https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/, https://github.com/google-agentic-commerce/AP2
- **PTF treatment:** verify full SD-JWT chain, signatures, `cnf`, `exp`, amount/merchant constraints, checkout-JWT hash match; reject agent-only mandates without user-signed open mandate.

### Card-network / PSP rails (complement, not replace)

- Visa Intelligent Commerce: agent onboarding, VTS pass-through tokens, passkey-authenticated Payment Instruction, network auth-vs-instruction checks.
  Source: https://developer.visa.com/capabilities/visa-intelligent-commerce
- Mastercard Agent Pay: registered agents, MDES Agentic Tokens (per-txn cryptogram + spend controls) + Verifiable Intent (SD-JWT identity→intent→action, 8 constraint types), protocol-agnostic, maps to AP2/ACP/UCP.
  Sources: https://www.mastercard.com/us/en/business/artificial-intelligence/mastercard-agent-pay.html, https://verifiableintent.dev/
- Stripe Agentic Commerce (ACP): product feed + tax/order-approval webhooks (4s timeout, idempotent, `424` on reject), Agreement opt-in, `SharedPaymentToken` (single-merchant, amount/time-bounded, revocable) → `PaymentIntent` without PAN exposure.
  Source: https://docs.stripe.com/agentic-commerce
- **PTF treatment:** TAP / Verifiable Intent / SPT are authenticators + scope limiters only. Re-check merchant ID, amount cap, expiry, intent binding locally.

## 2. Identity / selective disclosure

### OpenID4VP 1.0 Final (2025-07-09)

- Flow: verifier → wallet Authorization Request (`response_type=vp_token`, `dcql_query`, `nonce`, `client_id`, `response_mode`), wallet matches + consents, wallet → verifier `vp_token`.
  Sources: https://openid.net/specs/openid-4-verifiable-presentations-1_0.html, https://openid.net/sg/openid4vc/
- Verifier requests via DCQL (`credentials[].{format, meta, claims[]:{path, values}, trusted_authorities}` + `credential_sets`); formats: `dc+sd-jwt`, `mso_mdoc`, `jwt_vc_json`/`ldp_vc`/`vc+sd-jwt`.
- Verifier decides type/format, trusted issuers, claim paths, holder-binding requirement, nonce/aud, transaction-data binding. Holder enforces subset actually returned; privacy §§15.4–15.6: strictly-necessary claims only.
- **PTF treatment:** request is an upper bound. Disclose `requested ∩ available ∩ allowed`.

### SD-JWT (RFC 9901, Nov 2025) + SD-JWT VC (draft-ietf-oauth-sd-jwt-vc-19, LC ends 2026-09-15)

- Salted-hash digests in `_sd[]`; disclosure = `base64url([salt, name, value])`; 128-bit salt + SHA-256; decoys hide count; `iss/nbf/exp/cnf/vct/status` stay plaintext.
  Sources: https://www.rfc-editor.org/rfc/rfc9901.html, https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/
- Holder binding: `cnf:{jwk}` + KB-JWT (`typ: kb+jwt`) over `sd_hash` + `aud` + `nonce` + `iat`.
- **PTF treatment:** mandatory `aud + nonce + freshness` on every presentation; reject bearer-only for consequential disclosures.

### W3C VC Data Model 2.0 (REC 2025-05-15)

- Issuer–holder–verifier; verification (authentic + current) vs validation (business fitness + issuer trust, verifier-defined).
  Source: https://www.w3.org/TR/vc-data-model-2.0/

### DIDs (DID Core 1.0 REC 2022-07-19; extensions Note 2025-12-11, 100+ methods)

- Practical: `did:key`, `did:jwk` (offline), `did:web` (HTTPS). Niche: `did:ethr/sov/ebsi/cheqd`. Dead: `did:ion` (retired), `did:uport`, toy methods. Trend: SD-JWT VC prefers `/.well-known/jwt-vc-issuer` / `x5c` over universal resolver.
  Sources: https://www.w3.org/TR/did-core/, https://www.w3.org/TR/did-extensions/
- **PTF treatment:** support `did:key/jwk/web` + raw Ed25519 keys in v0.1; no universal resolver.

## 3. Delegation / capabilities

### OAuth Token Exchange (RFC 8693)

- `subject_token` + optional `actor_token` + `resource/audience/scope` → new token; impersonation vs delegation (`act` chain, `may_act`).
  Source: https://www.rfc-editor.org/rfc/rfc8693.html
- Anti-escalation is AS-policy-only; `scope × audience` narrowing; short `expires_in`; revocation explicitly not propagated.
- **PTF treatment:** use at ecosystem edges only; do not mistake exchange for attenuation proof.

### GNAP (RFC 9635) / AuthZEN (draft-01)

- GNAP: grant negotiation, key-bound by default, rotation + revocation; standard but niche libs only.
  Sources: https://www.rfc-editor.org/rfc/rfc9635.html, https://datatracker.ietf.org/group/gnap/
- AuthZEN: online PEP→PDP `{subject, action, resource, context} → {decision}`; Implementer's-Draft track, early adoption.
  Sources: https://openid.net/specs/authorization-api-1_0-01.html, https://github.com/openid/authzen
- **PTF treatment:** out of scope for v0.1 core.

### Macaroons vs Biscuit vs UCAN

- Macaroons: `sig_{n+1}=HMAC(sig_n, caveat)`; first/third-party caveats; bearer by default; no built-in revocation; HMAC-SHA256 symmetric, only target verifies.
  Sources: https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/, https://theory.stanford.edu/~ataly/Papers/macaroons.pdf
- Biscuit: Datalog checks, append-only attenuation (rights only shrink), ephemeral next-keypair, `revocation_id` with parent-cascade, Ed25519/secp256r1, publicly verifiable.
  Sources: https://doc.biscuitsec.org/reference/specifications, https://www.biscuitsec.org/docs/guides/revocation/
- UCAN v1.0.0: each link restates-or-narrows (`cmd` subpath, `pol` AND, latest `nbf`/earliest `exp`), `aud==next.iss` chaining, `ucan/revoke` invocation + CID blocklist, Ed25519 preferred, DID `iss/aud`.
  Sources: https://github.com/ucan-wg/spec, https://github.com/ucan-wg/delegation, https://github.com/ucan-wg/invocation, https://github.com/ucan-wg/revocation
- **PTF choice (ADR-0003):** UCAN narrowing + Biscuit cascade revocation + short `exp` + Ed25519 recipient-bound invocation.

### SPIFFE/SPIRE (workload identity, not delegation)

- `spiffe://trust-domain/path` in X.509/JWT-SVIDs, attested issuance, rotation, federation.
  Sources: https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE.md, https://spiffe.io/docs/latest/spiffe-about/overview/
- **PTF treatment:** bind `aud` to SPIFFE ID + mTLS proof where workloads redeem.

## 4. Agent interop + peer-review bar

### MCP (2026-07-28 stateless; prior 2025-11-25)

- Primitives: `tools/list` + `tools/call`, resources, prompts; human-in-loop should confirm sensitive ops.
  Source: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- Auth: OAuth 2.1 resource-server, RFC9728 metadata + `WWW-Authenticate`, RFC8414/OIDC discovery, PKCE S256, per-request bearer, mandatory audience validation.
  Source: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- Official risks: confused deputy via static-client-ID proxy, token-passthrough forbidden, SSRF via metadata URLs, state-handle hijacking, local-server RCE.
  Source: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- **PTF treatment:** audience-check every call, no passthrough, per-client consent, SSRF deny-list + egress proxy.

### WebMCP (W3C WebML CG Draft 2026-09-04; Chrome 146+ origin trial)

- Page as client-side MCP server: `registerTool({name, description, inputSchema, annotations:{readOnlyHint, untrustedContentHint, consequentialHint}, execute}, {signal, exposedTo})`.
  Sources: https://webmachinelearning.github.io/webmcp/, https://developer.chrome.com/docs/ai/webmcp
- Isolation: SecureContext + origin-keyed cluster, Permissions-Policy `tools=(self)`, iframe `allow="tools"`, `exposedTo` trustworthy origins only.
- Risks: description poisoning, output injection, intent misrepresentation, over-parameterization leak.
  Sources: https://webmachinelearning.github.io/webmcp/#security-privacy, https://developer.chrome.com/docs/ai/webmcp/secure-tools
- **PTF treatment:** all metadata/output untrusted; origin allow-list; honor hints; confirm mutating executes.

### A2A v1.0 (Linux Foundation / Agentic AI Foundation; 150+ orgs)

- Discovery via signed AgentCard (`name, description, url, skills, securitySchemes`); task lifecycle `submitted/working/input-required/completed/failed/canceled/rejected`; JSON-RPC/gRPC/HTTP+JSON.
  Sources: https://a2a-protocol.org/latest/announcing-1.0/, https://a2a-protocol.org/v1.0.0/, https://github.com/a2aproject/A2A
- Auth: OpenAPI-parity schemes, out-of-band credentials, per-request headers, per-skill least-privilege.
- **PTF treatment:** verify card signatures, pin discovery, per-skill authz, nonce/timestamp, validate push URLs.

### Open-source peer-review bar (security-critical TS, 2026)

- Expect: `strict:true` + `noUncheckedIndexedAccess`, zero-dep core, pinned lockfile + CI digests, branch protection + review, SAST/secret-scan, `SECURITY.md` + `THREATMODEL.md`, SBOM, `fast-check` property tests, redacted logs, reproducible builds, SLSA L1→L3 + Sigstore keyless, OpenSSF Scorecard clean.
  Sources: https://github.com/ossf/scorecard, https://slsa.dev/spec/v1.0/levels, https://www.sigstore.dev/, https://www.typescriptlang.org/tsconfig/#strict
