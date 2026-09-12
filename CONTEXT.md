# Personal Trust Fabric

User-owned trust and delegated-authority layer that lets AI agents act for a person without possessing that person's secrets. Single context for the v0.1 agentic-commerce slice: payments, selective disclosure, and signing through existing protocols.

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
A short-lived, bound right to perform one authorized operation: principal, agent, recipient, purpose, action, resource, amount, claims, expiry, max uses, terms digest.
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

### External

**Mandate**:
An external protocol message (AP2 mandate, x402 payment request, OpenID4VP request, MCP tool call) treated as evidence or a request. Never authority by itself.
_Avoid_: Authorization, instruction

**Presentation**:
A minimal disclosure answering a verifier request: requested ∩ available ∩ allowed claims, bound to audience, nonce, and freshness.
_Avoid_: Credential share, full disclosure
