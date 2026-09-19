# Personal Trust Fabric

User-owned authority and protected-use control plane that lets interchangeable agents use precisely bounded pieces of a person's authority, data, and credentials without possessing the underlying secrets. Domains include disclosure, execution (travel, APIs, purchases, payment as one profile), and signing. PTF owns authority, policy, protected state, approval, secret mediation, execution authorization, and audit evidence — never rails, settlement, or PSP functionality.

## Language

### Authority

**Principal**:
The person whose authority is exercised. PTF acts only on behalf of a named principal.
_Avoid_: User (too vague — user can mean agent operator, viewer, or principal)

**Authority State**:
What the principal has explicitly authorized via Standing Grants and one-time Approvals. The only source of power.
_Avoid_: Permissions flag, access grant

**Personal State**:
What PTF knows or believes about the principal (preferences, history, inferences). Never equals authorization.
_Avoid_: Profile, memory (implies permission)

**Policy**:
A default-deny constraint that narrows Authority State. Never creates authority.
_Avoid_: Rule (implies it can grant), permission

**Standing Grant**:
A deliberate, scoped, revocable authorization for a class of actions (e.g. grocery agent, ≤₹2,000/week, approved merchants).
_Avoid_: Policy, allowance

**Approval**:
A one-time human authorization of a concrete proposal, digest-bound to its exact terms. Any term change requires a new approval.
_Avoid_: Consent dialog, permission prompt

**Capability**:
A short-lived, bound right to perform one authorized operation: principal, agent, recipient, purpose, action, resource, amount, claims, expiry, max uses, terms digest. Local-only @internal per ADR-0009; interop uses adapters/authzen.ts, oauth-agent.ts, sd-jwt.ts.
_Avoid_: Token (too generic), credential, ticket

**Attenuation**:
Deriving a strictly narrower child capability from a parent. Authority can only shrink.
_Avoid_: Delegation (broader — includes lateral handoff), sub-grant

### Persona

**Persona Capsule**:
A task-scoped, minimal view of Personal State assembled for one agent and purpose. Contains no secrets.
_Avoid_: Profile dump, full context

**Agent-safe view**:
What the agent actually receives: Persona Capsule plus pending proposals and receipts. Never raw credentials or keys.
_Avoid_: Agent context

**Vault**:
The durable Personal State store (`personal-state.json`, revision CAS): purpose/agent/expiry/sensitivity-scoped records. Reads are evaluate-first (`readForPurpose`); secrets are use-only (`useCredential`, receipt-only). There is no generic read.
_Avoid_: Database (implies open queries), profile store

**Protected Provider**:
A host-owned rail adapter behind the provider seam: submits capability-bound requests and returns external refs as evidence. PTF owns policy, consent, secret-handling, and receipts — never the rail itself.
_Avoid_: Payment rail (implies PTF moves value), PSP integration

### Execution

**Protected Execution**:
Use of a credential, payment instrument, or signing key inside PTF without revealing it to the agent.
_Avoid_: Tool call, execution

**Recipient**:
The party that will receive money, data, or a signature effect. Must be authenticated before execution.
_Avoid_: Merchant (too narrow), destination

**Identity Binding**:
A registered mapping of a recipient alias to a verifiable public key.
_Avoid_: Address book entry

**Receipt**:
The agent-safe outcome of an execution: what happened, to whom, under which capability, without secrets.
_Avoid_: Result, log entry

**Proposal**:
A termsDigest-keyed durable record of an evaluated demand (pending, denied, or executed) awaiting redeem/present or kept as history. Re-proposing live terms returns it (idempotency); executed is immutable.
_Avoid_: Order, intent (implies commitment)

**Challenge**:
A short-lived in-memory redeem step: the server issues a capability id (`cidHex`) to sign, and the recipient proof authorizes it. Lost on restart by design (challenges carry live key material).
_Avoid_: Session, login flow

**Anchor**:
A Merkle-root consistency checkpoint (`anchor.json`: root + line count) over the audit log, recomputed and compared on restore so partial restores and mixed vintages fail closed. It proves a backup matches itself — not external freshness (a coherently rolled-back backup still verifies; only external retention defeats that).
_Avoid_: Blockchain proof, freshness anchor

**Keystore / DEK**:
The passphrase-sealed file holding signing keys plus the vault data-encryption key (`ptf/vault-dek`). Passphrase rotation re-wraps keys; DEK rotation re-seals vault data. Never backed up alongside its own passphrase file.
_Avoid_: Password file, wallet

**Revision CAS / single-writer**:
Every durable file carries a `revision` bumped atomically with the data; a stale handle's save fails closed instead of last-write-wins. One CLI/MCP writer per store is the supported topology; CAS is the backstop.
_Avoid_: Locking, transactions (implies multi-writer support)

### External

**Mandate**:
An external protocol message (AP2 mandate, x402 payment request, OpenID4VP request, MCP tool call) treated as evidence or a request. Never authority by itself.
_Avoid_: Authorization, instruction

**Presentation**:
A minimal disclosure answering a verifier request: requested ∩ available ∩ allowed claims, bound to audience, nonce, and freshness.
_Avoid_: Credential share, full disclosure

### Interop (edge only, never authority)

**AuthZEN / SARC / PDP**:
PTF `Authority` acts as PDP speaking the AuthZEN Subject-Action-Resource-Context shape; a demand projects to SARC and the decision (allow-with-citation or deny) still comes from `Authority.evaluate`.
_Avoid_: External PDP, policy outsourcing

**RFC8693 `sub` / `act`**:
Standard delegation vocabulary: `sub` (principal) fixed across delegation, `act` (actor chain) append-only, scope subset-only, expiry clamped, sender `cnf` required.
_Avoid_: Lateral delegation, scope widening

**SD-JWT / KB-JWT / `sd_hash`**:
A PTF presentation projects to standard SD-JWT `_sd`/disclosures; the holder proves possession with a KB-JWT bound via `sd_hash` to the presented disclosures. Emission is host-side, evidence-only.
_Avoid_: PTF-issued credential, bearer disclosure

**`jti`**:
Audit interop record id: `jti` is the hash of the canonical `AuditEntry`; unkeyed verify recomputes it, keyed mode stays opaque. No independent anchoring in v0.1.
_Avoid_: Ledger proof, witness receipt
