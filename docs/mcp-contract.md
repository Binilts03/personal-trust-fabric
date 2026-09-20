---
layout: default
title: MCP Contract
nav_order: 4
permalink: /mcp-contract/
---

# MCP Contract

The server speaks for **ONE fixed identity pinned at startup** — tool schemas carry no identity fields, so callers can never self-certify.

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

- `PTF_MCP_PRINCIPAL` — the human (DID)
- `PTF_MCP_ACTOR` — the agent (DID)
- Both verified OUT-OF-BAND by host — never from request body
- Server rejects any tool call with mismatched identity
