# Adapters (evidence in, never authority out)

Thin translators between external protocols and the deterministic core.
They may parse, verify signatures, and fetch settlement proofs — they may
never manufacture authority. Every adapter output re-enters `Capabilities`
or `Policy` for an independent decision.

Planned (one folder each, deferred past ticket 01):

- `x402/` — parse v2 `PAYMENT-REQUIRED` headers → PTF payment demand; verify settlement via facilitator/RPC.
- `ap2/` — verify Intent→Cart→Payment SD-JWT chains (`cnf`, `exp`, checkout hash) → demand.
- `oid4vp/` — DCQL request → disclosure demand (`requested ∩ available ∩ allowed`).
- `mcp/` + `webmcp/` — origin/audience/scope gate + confirm-mutating-executes.
- `a2a/` — signed AgentCard check + per-skill least-privilege tasks.

Rule: `src/core` never imports from `src/adapters` (lint-enforced).
