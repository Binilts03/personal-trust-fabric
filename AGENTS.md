# Personal Trust Fabric — Agent Instructions

This branch (`architecture/ptf-v1-spec`) contains the approved architecture and formal specification for the full Personal Trust Fabric rewrite.

## Canonical sources of truth

1. `docs/superpowers/specs/2026-09-03-personal-trust-fabric-v1-spec.md` — canonical reviewed specification awaiting human spec approval.
2. `CONTEXT-MAP.md` — canonical bounded contexts, terminology, and forbidden conflations.
3. `docs/adr/` — accepted hard-to-reverse architecture decisions.

The current synthetic WebMCP code and its README are historical milestone evidence only. Do not infer the new product architecture from the old module boundaries, WebMCP demo flow, in-memory capability runtime, synthetic recipient proof, or archived external handoff documents.

## Process gate

Do not implement or plan the rewrite directly from conversational context or the synthetic sandbox. The canonical specification must be human-approved first. After approval, use the Superpowers writing-plans workflow to create the implementation plan.

## Scope guardrail

The full PTF specification is the product boundary. AP2, x402, OpenID4VP, WebMCP/MCP/A2A, or any single milestone may prove part of the architecture but must not redefine PTF as that milestone.
