# ADR 0006 — Preserve Repository History, Rewrite the Implementation

Status: **Proposed**

## Context
The current repository preserves genuine project provenance but its synthetic WebMCP implementation embodies an obsolete milestone architecture and can mislead future implementation agents.

## Decision
If approved, the repository identity/history will be retained while the implementation is rebuilt from the approved specification. The synthetic milestone is preserved on `legacy/webmcp-sandbox` and must also be tagged `webmcp-sandbox-v0.1` before `main` is rewritten. The specification branch remains documentation-only.

## Consequences
Existing code receives no grandfathered status. Reuse requires independent justification and new tests. The pre-rewrite implementation remains recoverable as history rather than constraining the new architecture.

This ADR becomes Accepted only after explicit human approval of the proposed specification.