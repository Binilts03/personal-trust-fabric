---
layout: default
title: Personal Trust Fabric
nav_order: 0
permalink: /
---

# Personal Trust Fabric

> **Authority should travel. Secrets should not.**

PTF is a user-owned authority and protected-use layer for interchangeable AI agents. An agent can act with precisely bounded authority without receiving the underlying credential, payment instrument, signing key, or unrestricted token.

```text
                     authority
person  --------------------------------+
                                         \
agent A  -------------------------------> [ PTF ] ---> protected action
agent B  -------------------------------> [     ] ---> disclosure
local    -------------------------------> [     ] ---> signature
                                             |
personal state -------------------------->  |
                                      secrets stop here
                                             |
                                             v
                                          receipt
```

Default deny. Exact terms. Use without possession. External messages are evidence, never authority.

---

## Quick Links

| Area                               | Description                                                                |
| ---------------------------------- | -------------------------------------------------------------------------- |
| [Getting Started](getting-started) | Run PTF locally in 60 seconds                                              |
| [Architecture](architecture)       | Four planes: Personal State, Authority, Protected Execution, Protocol Edge |
| [Security Model](security-model)   | Default-deny, attenuation, receipt-only secret use                         |
| [MCP Contract](mcp-contract)       | Agent-facing tools: propose, check, redeem, present                        |
| [CLI Reference](cli-reference)     | `ptf` command: init, keygen, grant, pay, audit, backup                     |
| [ADRs](adr)                        | Architecture Decision Records                                              |
| [Audit Docs](audit)                | Limits, operations, verification, threats                                  |
| [Research](research)               | Deep dives on protocols, standards, interop                                |

---

## Status

This is a working, tested reference implementation on the road to peer review — not a finished product.

**What CI proves on every merge:** strict TypeScript, full unit suite, attack/property evaluations, public-seam and zero-dependency hygiene, secret scanning.

**What it is today:** strong local authority engine, encrypted personal-state vault, propose→present/redeem→receipt agent loop for disclosure and payment, domain-neutral provider seam with payment as one profile, hash-chained audit.

**What it is not yet:** live execution platform, multi-user service, HSM-backed custodian, published npm package.

Every ceiling is documented in [docs/audit/limits.md](audit/limits) — the file lists what PTF _cannot_ do more carefully than what it can.

---

## For Humans: Run in 60 Seconds

Requires Node 22+.

```sh
npm install
npm run typecheck && npm test && npm run eval
```

---

## For Agents: MCP Contract

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

Tools: `ptf_propose` (dry-run), `ptf_check` (status), `ptf_redeem` (challenge→proof→receipt), `ptf_request_data` → `ptf_present_data` (holder-signed presentation), `ptf_request_action`, `ptf_get_receipt`, `ptf_list_capabilities`, `ptf_revoke` (request-only). No approve tool — humans approve in CLI or standing grants cover demand.

---

## Four Planes

| Plane                   | Location                                           | Responsibility                                                            |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| **Personal State**      | `src/store/vault.ts`                               | Encrypted, purpose/agent/expiry/sensitivity-scoped records                |
| **Authority**           | `src/core/`                                        | Zero-dependency deterministic: grants + digest-bound approvals            |
| **Protected Execution** | `src/core/execute.ts`, `src/adapters/providers.ts` | Credentials used inside PTF; outward go sanitized instructions + receipts |
| **Protocol Edge**       | `src/adapters/`                                    | AP2, x402, OAuth-agent, OpenID4VP/SD-JWT, MCP/WebMCP, A2A, AuthZEN PDP    |

---

## Roadmap

- [x] M1 — Authority kernel
- [x] M2 — Personal vault
- [x] M3 — Agent loop
- [x] M4 — Operability
- [ ] M5 — Normative spec
- [ ] M6 — Conformance suite
- [ ] M7 — Domain profiles beyond payment
- [ ] M8 — Independent audit
- [ ] M9 — HSM/KMS custody
- [ ] M10 — Remote ingress + multi-tenant
- [ ] M11 — External anchoring
- [ ] M12 — Publish + govern

---

## Contributing

Reviewers, standards authors, host integrators, and agent builders welcome — see [CONTRIBUTING.md](https://github.com/Binilts03/personal-trust-fabric/blob/main/CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](https://github.com/Binilts03/personal-trust-fabric/blob/main/CODE_OF_CONDUCT.md).

**Gate:** `typecheck`, unit, eval must be green; every change proves itself with fresh verifier run + one abuse case.

---

## License

Apache-2.0 — see [LICENSE](https://github.com/Binilts03/personal-trust-fabric/blob/main/LICENSE). Report vulnerabilities privately per [SECURITY.md](https://github.com/Binilts03/personal-trust-fabric/blob/main/SECURITY.md).
