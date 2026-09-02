# Current primary-source checks

Checked: 2026-09-02. Fast-moving facts must be rechecked at the decision/release gate.

## Challenge

| Claim | Status | Evidence | Ruling |
|---|---|---|---|
| Submission deadline is 2026-09-03 13:00 Pacific Daylight Time. | VERIFIED FACT | [Official Devpost rules](https://webmcp.devpost.com/rules/) and [OpenAI challenge page](https://openai.com/webmcp-challenge/) | Equivalent to 2026-09-04 01:30 India Standard Time; recheck immediately before submission. |
| Judges need a working live WebMCP project reachable in ChatGPT's in-app browser or Chrome 149+ with WebMCP testing enabled. | VERIFIED FACT | [Official Devpost rules](https://webmcp.devpost.com/rules/) | M0 requires judge-like tests in both available environments. |
| Public source repository, visible open-source license, text description, and public YouTube video under three minutes with audio are required. | VERIFIED FACT | [Official Devpost rules](https://webmcp.devpost.com/rules/) | License selection remains a Human/legal choice; public actions require confirmation. |
| The four stage-two criteria are equally weighted: WebMCP Leverage, Execution, Potential Impact, Creativity & Ambition. | VERIFIED FACT | [Official Devpost rules](https://webmcp.devpost.com/rules/) | Preserve a coherent PTF product and material WebMCP usage. |
| Submission materials cannot be altered after the submission period; the working project must remain available through judging. | VERIFIED FACT | [Official Devpost rules](https://webmcp.devpost.com/rules/) | The previous blanket “do not modify repo/live site” wording is not established by the current rules text. Freeze submitted identifiers conservatively and recheck before continuing development. |

## WebMCP

| Claim | Status | Evidence | Ruling |
|---|---|---|---|
| The current imperative API registers tools with `document.modelContext.registerTool(...)`. | VERIFIED FACT | [Chrome WebMCP overview](https://developer.chrome.com/docs/ai/agents), [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) (updated 2026-08-20) | Use only behind the Web adapter. |
| WebMCP is experimental and subject to change. | VERIFIED FACT | [OpenAI challenge page](https://openai.com/webmcp-challenge/), [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) | Pin tested browser behavior and record the API date. |
| Tool inputs/outputs are structured JSON-serializable data; author-defined tools may expose sensitive or high-privilege operations, and current normative protection is incomplete. | VERIFIED FACT about the current draft | [WebMCP security/privacy questionnaire](https://github.com/webmachinelearning/webmcp/blob/main/security-privacy-questionnaire.md) | PTF policy, recipient binding, and protected execution cannot rely on WebMCP annotations or model behavior. |
| Tool discovery is origin/Permissions-Policy scoped; cross-origin exposure requires explicit configuration. | VERIFIED FACT about the current draft | [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), [security/privacy questionnaire](https://github.com/webmachinelearning/webmcp/blob/main/security-privacy-questionnaire.md) | Origin is adapter evidence, not sufficient recipient authentication for every operation. |
| The current specification is a Draft Community Group Report dated 2026-08-26, with linked WPT results; it is not a W3C Standard or on the Standards Track. | VERIFIED FACT | [Current WebMCP specification](https://webmachinelearning.github.io/webmcp/), [WPT results](https://wpt.fyi/results/webmcp) | Pin the tested surface and do not infer standard maturity from browser availability. |
| ChatGPT currently supports only top-level imperative site tools; declarative and iframe tools are not discovered. | VERIFIED FACT about current OpenAI behavior | [OpenAI Site tools documentation](https://learn.chatgpt.com/docs/webmcp) | M0 uses feature-detected top-level `registerTool`, ordinary UI fallback, narrow schemas, and safe results. |
| ChatGPT site tools currently require the latest desktop app, a Sol or Terra model, and a supported non-Enterprise/non-Edu workspace; Luna does not expose the feature. | VERIFIED FACT about current OpenAI behavior | [OpenAI Site tools documentation](https://learn.chatgpt.com/docs/webmcp) | Record the exact judge host/model/workspace and keep the ordinary-browser fallback. |

## Other immediate standards

| Claim | Status | Evidence | Ruling |
|---|---|---|---|
| OpenID4VP 1.0 and OpenID4VCI 1.0 are OpenID Final Specifications. | VERIFIED FACT | [OpenID4VP](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html), [OpenID4VCI](https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0-final.html) | Candidate credential adapters only; defer from M0 synthetic fixtures. |
| Digital Credentials is a W3C Working Draft dated 2026-08-27. | VERIFIED FACT | [W3C Digital Credentials](https://www.w3.org/TR/digital-credentials/) | The package and initial reviewer snapshot were stale; keep behind an experimental adapter/capability gate. |
| WebAuthn Level 3 is a W3C Recommendation dated 2026-08-25. | VERIFIED FACT | [W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) | Mature authentication/user-consent candidate; not arbitrary authorization, purpose, recipient, or transaction binding. |
| RAR RFC 9396, Token Exchange RFC 8693, DPoP RFC 9449, and OAuth Security BCP RFC 9700 retain their published IETF statuses. | VERIFIED FACT | [RFC 9396](https://www.rfc-editor.org/rfc/rfc9396.html), [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html), [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html), [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) | RAR/DPoP are adapter candidates; Token Exchange deferred; RFC 9700 is mandatory for any future OAuth profile. |
| MCP 2026-07-28 is the current stable revision and removed the initialize/session handshake. | VERIFIED FACT | [Official MCP release](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [specification](https://modelcontextprotocol.io/specification/2026-07-28) | Defer M0; pin/opt in and run auth/version negative tests if adopted. |
| A2A v1.0 is stable but no concrete PTF need exists. | VERIFIED FACT plus design ruling | [Official A2A releases](https://github.com/a2aproject/A2A/releases) | Defer; maturity alone is not a product requirement. |

## Still OPEN

- Concrete credential format/profile, WebAuthn ceremony, OAuth/capability/recipient mapping, payment/signing providers, sync, and recovery decisions.
- Actual behavior in the judge-like ChatGPT browser and Chrome environment.
- Submission-form wording or notices that may change after this check.
