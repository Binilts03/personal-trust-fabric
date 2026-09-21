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

**What CI proves on every merge:** strict TypeScript, the full unit suite, attack/property evaluations, public-seam and zero-dependency hygiene, secret scanning.

**What it is today:** a strong local authority engine, an encrypted personal-state vault, a propose→present/redeem→receipt agent loop for disclosure and payment, a domain-neutral provider seam with payment + travel profiles (further actions via `executeActionViaProvider`), and hash-chained audit — all tested including abuse cases. PTF will not become a PSP, wallet, settlement service, or rail.

**What it is not yet:** a live execution platform (reference providers move nothing), a multi-user service (single-operator topology), an HSM-backed custodian (file keystore reference), or a published package (npm pending). Every ceiling is documented in [docs/audit/limits.md](audit/limits) — the file lists what PTF _cannot_ do more carefully than what it can.

---

## Try it in 60 seconds

Requires Node 22+.

```sh
npm install
npm run typecheck && npm test && npm run eval
```

---

## Architecture (four planes)

| Plane                   | Location                                           | Responsibility                                                            |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| **Personal State**      | `src/store/vault.ts`                               | Encrypted, purpose/agent/expiry/sensitivity-scoped records                |
| **Authority**           | `src/core/`                                        | Zero-dependency deterministic: grants + digest-bound approvals            |
| **Protected Execution** | `src/core/execute.ts`, `src/adapters/providers.ts` | Credentials used inside PTF; outward go sanitized instructions + receipts |
| **Protocol Edge**       | `src/adapters/`                                    | AP2, x402, OAuth-agent, OpenID4VP/SD-JWT, MCP/WebMCP, A2A, AuthZEN PDP    |

Three flows cover everything: **disclose** (agent asks, PTF returns the minimal approved claim), **execute** (agent asks, PTF acts internally, agent gets a receipt), **approve** (agent proposes exact terms, the person approves or denies, any change needs a new approval).

---

## MCP contract

The server speaks for ONE fixed identity pinned at startup — tool schemas carry no identity fields, so callers can never self-certify.

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

Tools: `ptf_propose` (dry-run, exact terms + digest), `ptf_check` (status), `ptf_redeem` (`/pay` challenge→proof→receipt), `ptf_request_data` → `ptf_present_data` (holder-signed presentation, nonce-bound, single-present), `ptf_request_action` (propose any `/-path` except `/disclose*`), `ptf_get_receipt`, `ptf_list_capabilities` (this identity's live grants only), `ptf_revoke` (request-only). There is deliberately **no approve tool**: humans approve in the CLI, or standing grants cover the demand.

---

## Security model

Default-deny with citations: every allow names the grant or approval consumed. Policies narrow; learning never mints power. Capabilities attenuate monotonically, bind recipient + terms digest + expiry + uses, and redeem only against a live recipient key proof. Disclosure is `requested ∩ available ∩ allowed`, holder-bound. The vault is AES-256-GCM under a keystore DEK with freshness binding; the audit is hash-chained (optionally HMAC-keyed) and never carries secrets. External protocol messages are untrusted evidence re-validated locally.

Full model, threats, and honest limits: [THREATMODEL.md](https://github.com/Binilts03/personal-trust-fabric/blob/main/THREATMODEL.md), [SECURITY.md](https://github.com/Binilts03/personal-trust-fabric/blob/main/SECURITY.md), [docs/audit/](audit).

---

## Roadmap

### Phase 1 — Make it reviewable

- [x] **M1 — Authority kernel.** Default-deny engine, attenuation, exact-term approvals, receipts, audit.
- [x] **M2 — Personal vault.** Encrypted durable state, purpose/agent scoping, evaluate-first reads, receipt-only secret use.
- [x] **M3 — Agent loop.** Propose→present/redeem→receipt for disclosure and payment over MCP.
- [x] **M4 — Operability.** Backup/restore commands, rotation, health signals, container image.
- [ ] **M5 — Normative spec.** Implementation-agnostic `docs/spec/` (RFC-2119 MUST/SHOULD/MAY). Highest-leverage remaining work.
- [ ] **M6 — Conformance suite.** Frozen vectors and fixtures for independent implementations.
- [x] **M7 — One more domain.** Travel (`src/profiles/travel.ts`) over the generic `ExecutionReceipt` — proves generality beyond payment.

### Phase 2 — Make it credible

- [ ] **M8 — Independent audit.** Third-party review against public threat model.
- [ ] **M9 — Publish.** npm Trusted Publisher release, installable package.

### Phase 3 — Make it production-ready (after peer review)

- [ ] **M10 — HSM/KMS custody.** Replace file keystore behind existing `KeyProvider` seam.
- [ ] **M11 — Remote ingress + multi-tenant.** Per-caller auth, tenant isolation, rate limiting.
- [ ] **M12 — External anchoring.** Witness/remote append-only audit export.
- [ ] **M13 — Governance.** Governance charter, conduct process, OIDF/FIDO/IETF liaison.

---

## Contributing

Reviewers, standards authors, host integrators, and agent builders welcome — see [CONTRIBUTING.md](https://github.com/Binilts03/personal-trust-fabric/blob/main/CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](https://github.com/Binilts03/personal-trust-fabric/blob/main/CODE_OF_CONDUCT.md).

**Gate:** `typecheck`, unit, eval must be green; every change proves itself with fresh verifier run + one abuse case. Tests live at public seams (`src/index.ts`). Secrets never appear anywhere except the local store. Architecture changes need an ADR.

---

## License

Apache-2.0 — see [LICENSE](https://github.com/Binilts03/personal-trust-fabric/blob/main/LICENSE). Report vulnerabilities privately per [SECURITY.md](https://github.com/Binilts03/personal-trust-fabric/blob/main/SECURITY.md).
