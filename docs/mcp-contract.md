---
layout: default
title: MCP Contract
nav_order: 4
permalink: /mcp-contract/
---

# MCP Contract

Two ingress modes, one invariant: verified identity binds the actor —
request JSON never carries identity (ADR-0013, ADR-0023).

- **Fixed mode** (no `agents.json` in the store): the server speaks for
  **ONE fixed identity pinned at startup** — tool schemas carry no
  identity fields, so callers can never self-certify.
- **Registry mode** (`agents.json` present): every evaluation binds a
  registry member. A launcher-asserted `PTF_MCP_ACTOR` must be registered
  - active (rechecked from disk per tool call); otherwise the session
    starts unauthenticated and `ptf_authenticate` (challenge → registry-key
    signature → bound session) is required first. Keyless entries cover
    plain LLM clients via launcher assertion + membership check.

## Server Config

```json
{
  "mcpServers": {
    "personal-trust-fabric": {
      "command": "node",
      "args": ["./dist/src/mcp-server.js"],
      "cwd": "/path/to/personal-trust-fabric",
      "env": {
        "PTF_STORE_DIR": "./ptf-store",
        "PTF_PASSPHRASE": "",
        "PTF_MCP_PRINCIPAL": "did:example:you",
        "PTF_MCP_ACTOR": "did:example:agent"
      }
    }
  }
}
```

`PTF_PASSPHRASE` must come from environment (or 0600 file) — never commit a real value; empty fails closed.

## Tools

| Tool                    | Purpose                                                 | Consumes Authority? |
| ----------------------- | ------------------------------------------------------- | ------------------- |
| `ptf_authenticate`      | Registry mode: challenge, then signature-bound session  | No                  |
| `ptf_propose`           | Dry-run: exact terms + digest                           | No (CHECK)          |
| `ptf_check`             | Status of a proposal                                    | No                  |
| `ptf_redeem`            | `/pay` challenge → proof → receipt                      | **Yes** (REDEEM)    |
| `ptf_request_data`      | Propose a disclosure                                    | No (CHECK)          |
| `ptf_present_data`      | Holder-signed presentation, nonce-bound, single-present | **Yes** (REDEEM)    |
| `ptf_request_action`    | Propose any `/-path` except `/disclose*`                | No (CHECK)          |
| `ptf_get_receipt`       | Retrieve execution receipt                              | No                  |
| `ptf_list_capabilities` | This identity's live grants only                        | No                  |
| `ptf_revoke`            | Request-only revocation                                 | Request only        |

**Deliberately no approve tool** — humans approve in CLI, or standing grants cover demand. Server only spends what already exists.

## Full Loop Example

See `examples/vault-protected-action.mjs` and `examples/mcp-client-config.json`.

## Identity Pinning

- `PTF_MCP_PRINCIPAL` — the human (DID), always required
- `PTF_MCP_ACTOR` — the agent (DID): required in fixed mode; optional in
  registry mode (unset → `ptf_authenticate` session required)
- Both verified OUT-OF-BAND by host — never from request body
- Registry members are operator-managed (`ptf agent --register/--remove/
--rotate/--list`); removal and rotation take effect on the next tool
  call; `ptf_authenticate` challenges are single-use, 120s TTL, in-memory
- Server rejects any tool call with mismatched identity
