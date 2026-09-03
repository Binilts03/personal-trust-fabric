# Personal Trust Fabric — Agent Instructions

Status: **Proposed specification under human review.**

Nothing in this branch is approved merely because it is committed. Do not describe the architecture, ADRs, or specification as accepted/approved until the human explicitly approves the formal written specification.

## Source of truth

1. `docs/spec/PTF-V1-PROPOSED.md` — sole normative proposed specification.
2. `CONTEXT-MAP.md` — non-normative terminology/context glossary. If it conflicts with the proposed specification, the proposed specification wins.
3. `docs/adr/` — proposed hard-to-reverse decisions; their status becomes Accepted only after human approval of the formal specification.

## Repository safety

- The synthetic WebMCP milestone is preserved on `legacy/webmcp-sandbox`.
- The immutable tag `webmcp-sandbox-v0.1` is still required before any rewrite of `main`.
- Do not implement against the synthetic WebMCP source tree or infer architecture from it.
- This architecture branch is documentation-only by design.

## Process gate

Do not write an implementation plan or code from conversational context. Human approval of `docs/spec/PTF-V1-PROPOSED.md` is required first. After approval, use Superpowers `writing-plans` to produce the implementation plan.

## Scope guardrail

AP2, x402, OpenID4VP, WebMCP/MCP/A2A, a payment flow, a credential flow, a Trusted Surface, or any demonstration is a proving milestone, not the PTF product boundary.