# Adapters

## 1. Adapter Pattern

Every adapter MUST follow this pipeline:

1. **Parse**: Decode the external protocol message into a domain-specific structure.
2. **Translate**: Map into PTF's identity-free `AuthorityOperation`.
3. **Execute**: Submit through the `ProtectedProvider` seam.

## 2. Adapter Invariants

- **MUST NOT produce authority.** Parse and translate only. The host's `Authority.evaluate` creates authority from grants/approvals.
- **Identity MUST come from verified ingress.** Never from the adapter's parsed message.
- **Digest MUST be derived, not caller-supplied.** The adapter produces an `AuthorityOperation`; the engine derives `termsDigest`.
- **Effect-bearing context MUST exactly match authorized terms.** No extra keys in `context` that can alter the external effect.
- **Domain-neutral receipts for non-payment flows.** Use `ExecutionReceipt` (no `amount`/`currency`).
- **Rail results are evidence, never authority.** Hosts must run independent settlement checks before trusting provider output for value movement.

## 3. Existing Adapters

### 3.1 x402 (HTTP Payment)

| Aspect | Detail |
|--------|--------|
| Protocol | HTTP 402 Payment Required |
| Action | `/pay` |
| Resource Type | `x402-payment` |
| Amount | Atomic units, end-to-end |
| Settlement | Host duty (`checkSettlement`) |

Translation: `parsePaymentRequired(header)` -> `ParsedChallenge` -> `toX402PaymentDemand(req, ctx)` -> `{ operation, capabilityArgs }`.

### 3.2 AP2 (Mandate)

| Aspect | Detail |
|--------|--------|
| Protocol | AP2 mandates (SD-JWT) |
| Action | `/pay` |
| Resource Type | `ap2-payment` |
| Amount | Atomic units, end-to-end |
| Binding | `VerifiedExternalBinding` with `scheme: "ap2"` |

Translation: `verifyMandatePair(set, keys)` -> `VerifiedMandate` -> `toAp2PaymentDemand(verified, ctx)` -> `{ operation, binding, capabilityArgs }`.

### 3.3 OpenID4VP

| Aspect | Detail |
|--------|--------|
| Protocol | OpenID for Verifiable Presentations |
| Action | `/disclose` |
| Resource Type | `credential` |
| Production cut | `redirect_uri`-only by default |

### 3.4 SD-JWT

| Aspect | Detail |
|--------|--------|
| Protocol | Selective Disclosure JWT |
| Action | `/disclose` |
| Resource Type | `credential` |
| Digest | `sd_hash` over canonical disclosed set |

### 3.5 MCP

| Aspect | Detail |
|--------|--------|
| Protocol | Model Context Protocol (stdio) |
| Identity | Fixed at startup (no self-certification) |
| Tools | 9 tools, no approve tool |

### 3.6 WebMCP

| Aspect | Detail |
|--------|--------|
| Protocol | Web MCP |
| Constraint | Same-origin, `consequentialHint` self-attested |

### 3.7 A2A

| Aspect | Detail |
|--------|--------|
| Protocol | Agent-to-Agent |
| JCS | Plain JSON subset only |
| `jku` | Rejected |

### 3.8 AuthZEN

| Aspect | Detail |
|--------|--------|
| Protocol | Subject-Action-Resource-Context |
| Engine | PTF Authority as PDP |

### 3.9 OAuth-agent

| Aspect | Detail |
|--------|--------|
| Protocol | RFC8693 token exchange |
| Attenuation | Scope subset, expiry clamp, depth/cycle caps |

### 3.10 P3P (Pine Labs Payments Protocol)

| Aspect | Detail |
|--------|--------|
| Protocol | HTTP 402 challenge → `P3P-Credential` retry → capture → `Payment-Receipt` |
| Action | `/pay` |
| Resource Type | `p3p-payment` |
| Amount | Paise integer strings, end-to-end (no decimal shifting) |
| Methods | `RESERVE_PAY`, `OTM`, `CARD` (anything else fails closed) |
| Grant scopes | `mpp:payment:initiate` + `mpp:payment:max_txn_paise:<n>` as evidence only — a PTF Standing Grant is still REQUIRED |
| Receipt | Host duty (`checkP3PReceipt` + independent `getDebitStatus` to terminal state) |

Translation: `parseP3PChallenge(object)` -> `P3PChallenge` -> `toP3PPaymentDemand(challenge, ctx)` -> `{ operation, capabilityArgs }`. The host decodes the `WWW-Authenticate` challenge object (no header-string parser in-adapter); no SDK dependency and no network in-adapter.
