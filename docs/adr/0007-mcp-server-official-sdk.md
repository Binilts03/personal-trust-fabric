# MCP server as the LLM-facing interface, official SDK as its transport

PTF needs a door agents can knock on, and the ecosystem already standardized
that door: MCP over stdio. We expose propose/check/redeem tools through the
official `@modelcontextprotocol/server` (v2, spec 2026-07-28) instead of
hand-rolling JSON-RPC, because protocol compliance (handshake, capabilities,
notifications) is exactly the kind of surface that rots in a hand-rolled copy.

## Considered Options

- **Hand-rolled stdio JSON-RPC**: zero new dependencies, but we would own
  tracking every spec revision and every interop quirk. Rejected: the SDK
  exists, is maintained by the protocol owners, and is small.
- **No agent interface (core + CLI only)**: keeps the dependency count at
  zero, but leaves agents with no way to operate through PTF — the product
  would be a vault with no door. Rejected per the product direction.

## Consequences

These are the first runtime dependencies, so the zero-dep rule is rescoped,
not dropped: `src/core/` stays `node:crypto`-only (test-enforced import
allowlist); `dependencies` is an explicit allowlist whose every entry needs
a comment-level justification. The server itself never approves: there is no
approve tool, and every mutating call re-verifies against live authority.
