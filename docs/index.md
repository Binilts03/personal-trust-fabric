# Documentation

This branch contains the approved architecture and formal specification for the full Personal Trust Fabric rewrite.

| Document | Purpose |
|---|---|
| `superpowers/specs/2026-09-03-personal-trust-fabric-v1-spec.md` | Canonical self-reviewed PTF v1 specification awaiting human spec approval |
| `../CONTEXT-MAP.md` | Canonical bounded contexts, terminology, and architectural invariants |
| `adr/0001-*.md` through `adr/0006-*.md` | Accepted hard-to-reverse architecture decisions |
| `research/current-sources.md` | Historical/current research sources from the synthetic WebMCP milestone; not the product specification |
| `judge-script.md` | Historical WebMCP sandbox evaluator flow |
| `commands.md` | Commands for the existing sandbox code inherited by this branch |

The synthetic WebMCP implementation remains historical milestone evidence. Do not use its module boundaries or archived handoff documents as the source of truth for the rewrite.

No implementation planning or code rewrite begins until the canonical specification receives human approval. The next workflow after approval is Superpowers `writing-plans`.
