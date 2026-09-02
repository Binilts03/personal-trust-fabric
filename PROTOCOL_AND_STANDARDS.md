# Protocol and Standards Strategy

Research snapshot: **2026-09-02**. Re-check current status before implementation/release.

## 1. Adapter rule

Use existing standards where they solve a PTF subproblem. Do not force PTF's core semantics into a protocol that does not express them, and do not invent cryptography merely to avoid a standard.

## 2. Current relevant sources

| Technology | Status at snapshot | PTF relevance | Design rule |
|---|---|---|---|
| WebMCP | Draft Community Group Report, 26 Aug 2026; not a W3C Standard or Standards Track; Chrome 149 origin trial/flag | Agent ↔ website structured tools | Required for challenge adapter; implement the ChatGPT/Chrome intersection and do not make core depend on it |
| W3C Digital Credentials API | W3C Working Draft, 27 Aug 2026 | Browser/user-agent mediated credential issuance/presentation | Candidate experimental web credential adapter |
| OpenID4VP 1.0 | OpenID Final Specification approved 10 Jul 2025 | Credential presentation | Candidate verifier/presentation adapter |
| OpenID4VCI 1.0 | OpenID Final Specification approved 16 Sep 2025 | Credential issuance | Candidate issuance adapter |
| WebAuthn Level 3 | W3C Recommendation, 25 Aug 2026 | Strong scoped public-key authentication/user consent | Candidate device/user/recipient authentication primitive; not general PTF authorization |
| OAuth RAR RFC 9396 | IETF Standards Track RFC | Fine-grained authorization details | Strong prior art/candidate mapping for bounded authority |
| OAuth Token Exchange RFC 8693 | IETF Standards Track RFC | Delegation/token exchange | Candidate adapter/prior art; not sufficient alone for PTF |
| DPoP RFC 9449 | IETF Standards Track RFC | Sender-constrained OAuth tokens | Candidate for proof-of-possession/sender binding where OAuth fits |
| OAuth Security BCP RFC 9700 | BCP | OAuth security requirements | Apply to OAuth-based adapters |
| HPKE RFC 9180 | CFRG/IRTF Informational RFC | Recipient public-key encryption | Candidate primitive only through mature libraries/profiles |
| MCP 2026-07-28 | Current MCP specification release | Agent ↔ tools/data | Required candidate agent adapter; note current stateless core/deprecations |
| A2A v1.0 | Stable v1.0 announced Mar 2026 | Agent ↔ agent | Add only when a concrete PTF agent-to-agent use case exists |

## 3. WebMCP facts affecting design

Current Chrome documentation uses `document.modelContext.registerTool()`. WebMCP supports imperative/declarative APIs, JSON-schema tool contracts, origin isolation, Permissions Policy, same/cross-origin discovery rules, cancellation, and current tool lifecycle semantics. ChatGPT's built-in browser currently supports only top-level imperative tools, not declarative or iframe tools, so M0 targets that shared subset and feature-detects the API.

WebMCP is under active discussion. Security questionnaire/current issues explicitly recognize risks such as:
- sensitive/high-privilege tools;
- over-parameterization/privacy leakage;
- multi-origin agent state;
- agent-to-tool identity/delegation gaps;
- proposals for sensitive output handling.

Therefore PTF must treat WebMCP as an untrusted/limited adapter and keep hard authorization in the Trust Runtime.

## 4. Protocol adoption gate

Before adding any adapter:

1. identify a product requirement it satisfies;
2. verify current specification/version/maturity;
3. identify security model and unresolved issues;
4. implement conformance/evals;
5. map external identity/authority concepts into PTF;
6. avoid adapter-specific fields in the generic domain model;
7. add migration/version handling.

## 5. Internet-Drafts / proposals

Active agent-authorization proposals may be useful research, but drafts/proposals do not become core dependencies without explicit maturity/risk review.

## 6. Cryptography rule

Codex must use established libraries and existing protocol profiles. Any new cryptographic construction requires an explicit security review and a compelling reason; default is not to invent one.
