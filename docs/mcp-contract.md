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
        "PTF_PASSPHRASE_FILE": "/absolute/path/to/.ptf/passphrase",
        "PTF_MCP_PRINCIPAL": "did:example:you",
        "PTF_MCP_ACTOR": "did:example:agent"
      }
    }
  }
}
```

Use a passphrase file created by the [Getting Started guide]({{ '/getting-started/' | relative_url }}).
The `PTF_PASSPHRASE_FILE` path above is a placeholder; replace it with
the actual private file path on the machine running the server. Do not
commit passphrases. A direct `PTF_PASSPHRASE` environment value takes
precedence if configured, so avoid setting it accidentally.

## Tools

| Tool                    | Purpose                                                 | Consumes Authority? |
| ----------------------- | ------------------------------------------------------- | ------------------- |
| `ptf_authenticate`      | Registry mode: challenge, then signature-bound session  | No                  |
| `ptf_propose`           | Dry-run: exact terms + digest                           | No (CHECK)          |
| `ptf_check`             | Status of a proposal                                    | No                  |
| `ptf_redeem`            | `/pay` or registered action: challenge → proof → receipt | **Yes** (REDEEM)    |
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

## Experimental DPDP privacy enforcement mode

The stdio reference host accepts **operator-controlled** `PTF_MCP_PRIVACY_CONFIG` pointing to a protected JSON file. Configure its controller, opaque `subject:` reference, recipient role map and optional trusted subject assurance as documented in [DPDP privacy enforcement](privacy/dpdp.md). Enabling this mode requires an initialized encrypted PTF privacy store and an applicable Processing Activity/Basis Evidence **in addition to** agent authority.

In this reference host the privacy gate covers `ptf_request_data` and `ptf_present_data` disclosures, plus `ptf_propose:/pay` and `ptf_redeem:/pay` (including the journaled payment executor). Payment processing additionally requires an operator-defined `actionCategories["/pay"]` and a matching active processing activity/basis. The precommitted privacy event precedes payment authority consumption or provider execution. No agent-controlled legal-basis/controller/subject fields are added to tool schemas. Explicit mode fails closed when configuration or evidence is unavailable. Omitting the environment variable preserves the authority-only processing path; shared input validation still rejects malformed or pathological values. A startup stderr message reports enabled/disabled mode and its coverage without identifying subjects.

**Limit:** Registered non-payment actions are protected only when explicitly composed by the trusted embedding host. Independently invoked adapter/provider paths and operator CLI actions are **not universally protected**. An integrator must explicitly wrap each personal-data processing path. A configured file is not proof that a running remote host actually uses it; `ptf privacy verify --mcp-config FILE` checks configuration and explicitly reports `runtimeAttested: false`.


## Host-registered generic execution (reference MCP host)

A trusted application embedding `createPtfServer` may register an
exact non-payment action through `registeredActions`. Registration
supplies the provider, a strict effect-bearing input validator, and
a trusted processing mode. The agent cannot register actions, select
the provider, determine the privacy policy, or supply its own identity.

For registered actions, `ptf_request_action` proposes exact terms
and `ptf_redeem` requests recipient signature proof before using the
same `createProtectedEffect` path used for payment. The execution
journal is checked **before** evaluating already-spent live Authority
on replay. A conclusive prior success is returned without resubmission;
a corrupt or ambiguous journal is never treated as absence. If the
provider succeeded but its Processing Event cannot be reconciled,
the response preserves `status: "executed"` with
`processingEvidence: "gap"`; investigate the evidence separately.

Unknown action registrations still have no execution route. With
privacy configured, unregistered action proposals fail closed.
The operator's CLI, arbitrary independently invoked providers,
remote ingress, and production email transports are not covered
automatically. The shipped example and tests use a **fake** email
provider: no real message is delivered.

The embedding host must arrange durable authorized-use persistence,
keys and proof verification, provider outcome reconciliation, and
appropriate privacy basis checks. The reference server remains
single-operator stdio; these tests do not certify a multi-tenant
production deployment.

### Trusted-host registration contract

The registration API is programmatic (`createPtfServer({ registeredActions })`), **not** a new stdio JSON-RPC registration tool or a new automatically enabled CLI flag. Each exact registration provides `action`, `provider`, `validate(demand)`, and `processing(demand, ingress, auth)`. The third argument is the **same live Authority handle** used for effect consumption; privacy gates must use it, not a reconstructed copy.

Validators must reject extra fields and require opaque resource handles. The built-in `validateOpaqueEmailAction(demand, recipient)` reference checks `/email/send`, `email-message` resources, `msg:` handles and exactly `messageId` plus `recipient` context. A default stdio launch that does not pass `registeredActions` stays payment-only for execution; all other arbitrary action proposals are still non-executable. A host with `PTF_MCP_PRIVACY_CONFIG` must return `{ kind: "enforced", runtime, gate }` for a registered action; the agent cannot override this via request JSON.

A submitted provider whose outcome is ambiguous requires query-first reconciliation; no blind retry occurs. A journal-proven success with missing privacy evidence is returned as `status: "executed"` and `processingEvidence: "gap"`, and that evidence-gap status is retained in a recovered proposal receipt for subsequent lookups. The Processing Event repository's durability and legal basis remain host/operator responsibilities.
