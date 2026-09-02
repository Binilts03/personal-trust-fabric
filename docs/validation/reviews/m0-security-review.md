# Fresh M0 security review

Date: 2026-09-02. Scope: bounded synthetic local/hosted profile. Production security is not approved.

## Verdict

- **PASS:** bounded local synthetic M0.
- **PASS with configuration condition:** hosted synthetic M0 when `PUBLIC_ORIGIN` is the exact externally visible HTTPS origin and the proxy preserves the expected Host header.
- **NOT APPROVED:** production custody, identity, recipient authentication, recovery or operations.

## Closed after adversarial regression

- Per-browser tokens isolate the complete sandbox; visitor B receives HTTP 409 when attempting to approve visitor A's operation.
- Every agent/Human API requires a valid browser session; Human mutations additionally require the allowed same origin.
- Local hostname allowlisting and configured exact public origin reject hostile Host/Origin combinations.
- Hosted cookies are `Secure`; non-loopback startup without `PUBLIC_ORIGIN` fails.
- Per-session operations are capped at 100 and pending approvals at 20.
- Approval shows all material bound terms/digest.
- Provider-controlled detail/outcome/error paths cannot cross the safe response boundary.
- Reset requires Human mutation authority; correction is audited; audit limitations are visible.

## Residual risks

- Anonymous root traffic can churn the capped 1,000-session map and evict the oldest session. This is availability-only in M0; a public deployment needs edge session-creation throttling.
- Browser session possession is not authenticated principal identity.
- Recipient proof is a synthetic server-held hook, not cryptographic authentication.
- Server sessions have no independent server-side expiry timestamp.
- Audit/state/revocation are volatile; the chain is unkeyed and unanchored.
- Production store/key custody, recovery, real providers and multiple-allow-policy precedence remain unresolved.

Fresh reviewer evidence: `npm test` 26/26 and independent cross-visitor/unsafe-startup checks passed.
