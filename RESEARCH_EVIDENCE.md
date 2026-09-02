# Research Evidence and Gaps

Research snapshot: **2026-09-02**.

This ledger distinguishes standards facts from proposals and research.

## A. Primary/current sources

### WebMCP Challenge official rules — VERIFIED FACT
https://webmcp.devpost.com/rules/

Current facts used by this handoff:
- submission deadline Sep 3, 2026 at 1:00 PM PT;
- live URL/public repo/open-source license/<3-minute public YouTube demo required;
- existing projects must document qualifying WebMCP extension during submission period;
- judging criteria are equally weighted: WebMCP Leverage, Execution, Potential Impact, Creativity & Ambition.

Recheck immediately before submission because the rules state they may change.

### OpenAI WebMCP Challenge page — VERIFIED FACT
https://openai.com/webmcp-challenge/

Describes WebMCP as experimental/open and emphasizes apps that become meaningfully better when people and agents use them together.

### Chrome WebMCP documentation — VERIFIED FACT
https://developer.chrome.com/docs/ai/webmcp/
https://developer.chrome.com/docs/ai/webmcp/imperative-api
https://developer.chrome.com/docs/ai/webmcp/build-tools

Current documentation:
- uses `document.modelContext`;
- supports imperative/declarative WebMCP;
- origin isolation and `tools` Permissions Policy;
- cross-origin tool exposure requires explicit controls;
- WebMCP is experimental/subject to change;
- encourages goal/state/role-play/evals.

### WebMCP security/privacy questionnaire — VERIFIED FACT about current draft
https://github.com/webmachinelearning/webmcp/blob/main/security-privacy-questionnaire.md

It recognizes sensitive/high-privilege tool risks and over-parameterization; current mitigation/spec work remains active.

### WebMCP sensitive-output proposal #110 — RESEARCH/PROPOSAL
https://github.com/webmachinelearning/webmcp/issues/110

Proposal explores `sensitiveHint` and opaque secret references. It is not an adopted standard. It supports the relevance of model-excluded sensitive tool results but does not define PTF.

### WebMCP agent-to-tool trust proposal #96 — RESEARCH/PROPOSAL
https://github.com/webmachinelearning/webmcp/issues/96

Discusses agent identity, scoped permissions and delegation-context gaps. Not an adopted standard.

### W3C Digital Credentials API — VERIFIED FACT on maturity
https://www.w3.org/TR/digital-credentials/

Working Draft dated 27 Aug 2026. User-agent mediated credential presentation/issuance; still a work in progress.

### OpenID4VP 1.0 — VERIFIED FACT
https://openid.net/specs/openid-4-verifiable-presentations-1_0.html
https://openid.net/openid-for-verifiable-presentations-1-0-final-specification-approved/

OpenID Final Specification approved 10 Jul 2025; defines a protocol for requesting and presenting credentials.

### OpenID4VCI 1.0 — VERIFIED FACT
https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0-final.html
https://openid.net/openid-for-verifiable-credential-issuance-1-final-specification-approved/

OpenID Final Specification approved Sep 16, 2025.

### WebAuthn Level 3 — VERIFIED FACT on maturity
https://www.w3.org/TR/webauthn-3/

W3C Recommendation dated 25 Aug 2026. Strong scoped public-key credentials/user-agent mediation; it does not encode arbitrary PTF authorization terms.

### RFC 9396 — VERIFIED FACT
https://www.rfc-editor.org/rfc/rfc9396.html

OAuth Rich Authorization Requests; fine-grained `authorization_details`.

### RFC 8693 — VERIFIED FACT
https://www.rfc-editor.org/rfc/rfc8693.html

OAuth Token Exchange; impersonation/delegation token exchange.

### RFC 9449 — VERIFIED FACT
https://www.rfc-editor.org/rfc/rfc9449.html

OAuth DPoP; sender-constrained token proof-of-possession.

### RFC 9700 — VERIFIED FACT
https://www.rfc-editor.org/rfc/rfc9700.html

OAuth 2.0 Security Best Current Practice.

### RFC 9180 — VERIFIED FACT
https://www.rfc-editor.org/rfc/rfc9180.html

HPKE. Informational CFRG/IRTF RFC; use only through suitable profiles/libraries.

### MCP 2026-07-28 — VERIFIED FACT
https://blog.modelcontextprotocol.io/posts/2026-07-28/

Current MCP release includes stateless protocol core, authorization hardening, extensions framework, and deprecations. Codex must check current SDK defaults/version opt-ins before adopting.

### A2A v1.0 — VERIFIED FACT
https://a2a-protocol.org/dev/blog/2026/03/12/a2a-protocol-ships-v10-production-ready-standard-for-agent-to-agent-communication/

Stable v1.0 announcement. PTF adoption remains requirement-driven.

## B. Research evidence

### GAAP — RESEARCH EVIDENCE
https://arxiv.org/abs/2604.19657

Evidence for enforcing private-data disclosure outside an untrusted model using information-flow/reference-monitor concepts. Research result, not proof that PTF's architecture is correct.

### MNC — RESEARCH EVIDENCE
https://arxiv.org/abs/2608.01719

Research on recipient/purpose/lifetime/logging/memory-scoped semantic declassification and cumulative disclosure. Useful to disclosure-planner/reference-monitor design.

### Puda — RESEARCH EVIDENCE
https://arxiv.org/abs/2602.08268

User-sovereign personalized-data architecture with multiple disclosure granularities. Its reported personalization result is evaluation-specific and must not be generalized.

### Memory poisoning research — RESEARCH EVIDENCE
https://arxiv.org/abs/2606.04329
https://arxiv.org/abs/2607.14611

Supports treating persistent memory updates as a security boundary.

## C. Harness engineering research/projects

### AI Builder Club skills — RESEARCH REFERENCE
https://github.com/AI-Builder-Club/skills

Relevant patterns: codebase harness, verifier, context audit, loops, isolated agent execution.

### Sol Advisor — RESEARCH REFERENCE
https://github.com/DannyMac180/sol-advisor

Relevant pattern: controller-owned architecture/acceptance with bounded implementation and fresh review.

### Microsoft SkillOpt — RESEARCH REFERENCE
https://github.com/microsoft/SkillOpt

Relevant pattern: trajectory-driven bounded skill changes behind validation gates.

### Headroom — RESEARCH REFERENCE
https://github.com/headroomlabs-ai/headroom

Relevant context-compression/retrieval ideas. Lossy context manipulation must not be adopted without evaluating correctness/security impact.

## D. Research gaps Codex must resolve

Before freezing architecture:
- actual target platforms and OS security APIs;
- browser/renderer/process isolation behavior for selected deployment;
- recipient authentication/key-distribution model;
- capability representation;
- chosen hard-policy engine;
- sync/recovery key hierarchy;
- selected credential formats and conformance suites;
- real payment/signing provider integration strategy;
- legal/compliance implications if real regulated credentials/payments are introduced;
- usability of approval/disclosure UI;
- metadata/inference leakage;
- downstream-recipient obligations;
- exact WebMCP behavior in judge-like ChatGPT/Chrome environment.
