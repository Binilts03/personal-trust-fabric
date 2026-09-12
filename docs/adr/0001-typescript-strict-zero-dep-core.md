# TypeScript strict, zero-dependency deterministic core

The agentic web is JS-native (MCP, WebMCP, x402, OpenID4VP libraries all ship JS first), but reviewers of a security-critical trust layer require a tiny auditable core. We use TypeScript with `strict` + `noUncheckedIndexedAccess`, and the authority path (`normalize → evaluate → issue → redeem → execute`) has zero runtime dependencies beyond `node:crypto`.

## Considered Options

- **Rust core compiled to WASM**: stronger isolation, but doubles the contributor bar and slows WebMCP/x402 adapter iteration. Deferred until a browser-isolated executor is proven necessary.
- **Python core**: faster prototyping, weaker type guarantees for capability invariants and poorer MCP/WebMCP interop.

## Consequences

Core stays small enough for peer review; adapters carry all third-party risk behind an import boundary (`core` never imports `adapters`). Cost: we must enforce the boundary with lint, not just convention.
