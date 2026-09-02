# Fresh standards/protocol review

Reviewer date: 2026-09-02. Controller independently reopened the load-bearing primary sources after the review.

## Gate verdict

W0 may proceed with generic contracts, harness, and M0 WebMCP adapter work. Production credential, OAuth/capability, recipient-authentication, payment/signing, MCP, and cross-agent profiles remain OPEN.

## Current challenge/WebMCP facts

- Official deadline is 2026-09-03 13:00 PDT; judges may use ChatGPT's built-in browser or Chrome 149+ with WebMCP testing enabled.
- The Devpost Submission is frozen after the submission period and the Project must remain available through judging. A blanket repository/site freeze is a conservative inference, not current rule text.
- WebMCP is a Draft Community Group Report dated 2026-08-26, not a W3C Standard or Standards Track document.
- Chrome exposes the broader imperative/declarative/origin/cancellation surface; current ChatGPT site tools accept only top-level imperative registration and reject iframe/declarative discovery.
- M0 therefore uses feature-detected `document.modelContext.registerTool`, strict schemas with no extra properties, truthful annotations, server revalidation, cancellation, ordinary UI fallback, and no protected-value results.
- WebMCP cannot prove agent/recipient identity or enforce PTF authority. `untrustedContentHint` is a signal, and sensitive-output/agent-delegation mechanisms remain proposals.

## Material snapshot corrections

- Digital Credentials is now a **W3C Working Draft dated 2026-08-27**. The handoff's 3 August date and the fresh review's intermediate 12 August result were both superseded by the latest official publication.
- WebAuthn Level 3 is now a **W3C Recommendation dated 2026-08-25**, not a Candidate Recommendation.
- OpenID4VP/VCI remain Final specifications; official HAIP conformance/self-certification exists, but M0 synthetic credentials defer claiming those profiles.
- MCP 2026-07-28 remains current; A2A remains deferred for lack of requirement.

## Required M0 evals

Registration/schema/errors/cancellation/navigation/origin behavior; cross-client ChatGPT/Chrome matrix; correct/ambiguous tool selection; missing/extra/oversized/stale inputs; replay/double execution; tool-description/output injection; redirect/origin substitution; approval mutation; canary absence from tool definitions, arguments, results, errors, DOM diagnostics, and logs.

Primary sources and adoption rulings are maintained in `docs/research/current-sources.md`.
