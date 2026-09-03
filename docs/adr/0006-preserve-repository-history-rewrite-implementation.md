# ADR 0006 — Preserve Repository History, Rewrite the Implementation

Status: **Accepted**

## Context
The current repository preserves genuine project provenance but its synthetic WebMCP implementation embodies an obsolete milestone architecture and can mislead future implementation agents.

## Decision
The repository identity/history is retained while the implementation is rebuilt from the approved specification. The synthetic milestone is preserved on `legacy/webmcp-sandbox` and must also be tagged `webmcp-sandbox-v0.1` before `main` is rewritten. The architecture/planning branch remains documentation-only.

## Consequences
Existing code receives no grandfathered status. Reuse requires independent justification and new tests. The pre-rewrite implementation remains recoverable as history rather than constraining the new architecture. See `docs/spec/PTF-V1-APPROVAL.md` for the exact approved specification blob.
