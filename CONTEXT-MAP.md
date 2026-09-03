# Personal Trust Fabric — Context Map

Status: Architecture-approved domain model for the first full PTF specification.

This document defines the canonical domain language for Personal Trust Fabric (PTF). It is intentionally implementation-free. Frameworks, databases, serialization formats, cryptographic libraries, cloud providers, and programming languages do not belong here.

## Product Thesis

Personal Trust Fabric is an open, user-controlled delegated-authority runtime for AI agents. It lets a Principal define standing authority, lets Agents propose concrete actions, deterministically resolves whether those actions are permitted, minimizes information disclosure, and turns approved actions into narrowly scoped execution through existing identity, commerce, payment, and agent protocols without unnecessarily giving the Agent the underlying credential, key, payment instrument, secret, or complete private context.

Agentic commerce is the first proving ground, not the architectural boundary.

## Global Invariants

1. Knowledge is not authority.
2. Personalization is not authorization.
3. Hard Policy constrains authority but never creates it.
4. Authority originates only from a deliberate Standing Grant or an Exact Human Approval.
5. An Agent may request authority but cannot create, approve, broaden, or self-authorize it.
6. A Protected Resource reference is not a bearer capability and confers no authority.
7. No derived authority may be broader than its authority source.
8. Separate grants cannot be unioned to manufacture broader authority.
9. Unknown attenuation semantics fail closed.
10. Further delegation is disabled unless explicitly authorized.
11. No authority-relevant constraint may silently disappear between authorization and execution.
12. Protocol artifacts are evidence or execution mechanisms, not canonical PTF authority objects.
13. External protocols are adapters; they do not define the PTF core domain.
14. Personal State may inform reversible decision support but cannot create Hard Policy, Standing Grants, or Execution Grants.
15. Source transformation, summarization, model inference, or repetition cannot upgrade the authority of an information source.
16. Identity, authentication, trust, and authorization are distinct concepts.
17. Local PTF subject identifiers have no external authentication meaning by themselves.
18. Protected resource interfaces prefer bounded operations over extraction of secrets or private keys.
19. Non-possession claims are always relative to an explicit trusted-computing boundary.
20. Audit and observability must not become alternate stores of protected values.
21. Security-sensitive conflicts fail closed rather than being merged for convenience.
22. Self-improvement may improve preferences, strategies, and implementation quality; it cannot silently expand authority.

---

# Bounded Contexts

## 1. Personal State

### Purpose

Represent useful information about the Principal while preserving provenance, epistemic status, sensitivity, scope, freshness, and correction history. Produce task-specific context without exposing the Principal's complete personal state.

### Canonical Terms

**Observation** — A record that some source said, emitted, or exhibited something. An Observation is evidence, not automatically truth.

**Claim** — A proposition concerning the Principal or their world. Claims preserve provenance and may be asserted, verified, inferred, disputed, stale, or superseded according to domain semantics.

**Preference** — A tendency or choice used to improve decisions. Preferences distinguish explicit preferences from inferred preferences.

**Derived Context** — An ephemeral value computed from Personal State for a particular purpose, such as deriving an adult age band from protected date-of-birth information.

**Handling Class** — The maximum technical handling mode allowed for an item, such as shareable, derivable, use-only, direct-delivery-only, or non-exportable. Handling Class does not authorize disclosure to any recipient.

**ContextView** — A task-specific projection containing only the Personal State useful and permitted for the Agent's current task.

**Safe View** — The Agent-facing projection composed from independently derived ContextView and AuthorityView. It is ephemeral and is not canonical Personal State.

### Invariants

- An Observation does not become a trusted Claim merely because an LLM summarizes it.
- Confidence is distinct from source authority.
- Explicit user correction outranks incompatible inferred preference.
- Objective Claim verification is domain- and issuer-specific.
- Material contradictions are not resolved by model guesswork.
- Corrections supersede history; erasure is a distinct privacy operation.
- Safe View never becomes a trust shortcut back into Personal State.

### Outbound Relationships

Personal State may provide ContextView to the Agent and may provide resource availability metadata to Planning. It has no automatic authority-creation edge to the Authority context.

---

## 2. Identity and Trust

### Purpose

Represent who PTF is reasoning about, how external identities are bound to those actors, how current parties authenticate, and for what role or purpose those authenticated identities are trusted.

### Canonical Terms

**Subject** — A stable PTF-local actor PTF reasons about. Subjects may play roles such as Principal, Agent, Recipient, Issuer, Executor, or Agent Provider.

**Principal** — A human or organization whose authority ultimately matters. A Principal need not be globally or legally identified.

**Agent** — The logical delegated software actor that requests or performs actions for the Principal. Agent identity is distinct from model identity, provider identity, runtime identity, and session identity.

**Agent Instance** — A currently executing/authenticated instance acting as an Agent.

**Recipient** — The Subject intended to receive disclosure, execution, payment, evidence, or another consequential effect.

**Issuer** — A Subject whose signed or otherwise authenticated assertions may be trusted for specific Claim types.

**Executor** — A Subject operating a Protected Executor.

**IdentityBinding** — Independently validated evidence connecting a Subject to an external identity mechanism, such as a key, origin, certificate, wallet address, account identifier, or protocol identifier.

**EndpointBinding** — A validated relationship between a Subject and the concrete endpoint, key, origin, account, address, or service through which that Subject participates in a particular operation.

**Authentication Evidence** — Fresh evidence that the current interacting party controls an accepted IdentityBinding.

**TrustRelation** — A role- and purpose-specific statement that a Subject or binding is accepted for a defined security function.

**Trust Registry** — The set of validated IdentityBindings, EndpointBindings, TrustRelations, status, rotation history, and provenance used by a PTF deployment. It is not a global reputation score.

**Trusted Surface** — A deterministic user-interaction boundary trusted to display canonical approval terms and capture Principal authorization bound to those same terms.

### Invariants

- A Subject name or identifier is metadata, not authentication.
- Identity, authentication, trust, and authorization remain separate.
- Protocol identifiers are not assumed equivalent because labels match.
- Trust is relational and purpose-specific, never a universal scalar.
- Successful behavior cannot silently create TrustRelations.
- Principal authentication may be pseudonymous and deployment-specific.
- Agent signing or proof-of-possession keys need not be held by the LLM process.
- Key rotation requires continuity evidence.

---

## 3. Authority

### Purpose

Represent deliberate human delegation, non-overridable policy constraints, concrete action requests, deterministic authorization decisions, approval, usage accounting, revocation, and transaction-scoped execution authority.

### Canonical Terms

**Hard Policy** — A deterministic restriction on what PTF is permitted to authorize. Hard Policy can narrow authority but never create or broaden it.

**Standing Grant** — Deliberate, continuing authority delegated by the Principal for more than one immediately approved concrete action.

**Action Request** — A concrete action proposed by an Agent for PTF to evaluate.

**Exact Human Approval** — A Principal decision authorizing one exact planned action. It is distinct from creating Standing Grant authority.

**Authorization Decision** — Deterministic result of evaluating an Action Request against current identity/trust state, Hard Policy, Standing Grant state, resource state, reservations, and required approval. Outcomes are deny, approval-required, or provisionally authorizable.

**Execution Grant** — Immutable, narrow, short-lived authority to execute one concrete Execution Plan or a deliberately bounded set of identical executions. It is bound to the approved plan fingerprint.

**Authority Basis** — The deliberate source supporting an Execution Grant: a Standing Grant, Exact Human Approval, or both where policy requires supplemental approval.

**Reservation** — Atomic commitment of capacity, use count, budget, or other aggregate authority so concurrent requests cannot oversubscribe the same authority.

### Invariants

- Only Standing Grant and Exact Human Approval create authority.
- Hard Policy is a ceiling, not an authority source.
- Relaxing Hard Policy does not broaden existing authority.
- Tightening Hard Policy can prevent previously issued but not yet committed execution.
- One Standing Grant must independently cover an autonomous action; grants cannot be unioned.
- One-off exceptions do not mutate a Standing Grant.
- Standing Grants are versioned/immutable in meaning and preserve history.
- Execution Grants bind exact security-relevant transaction semantics.
- Aggregate authority uses atomic reservations.
- Indeterminate consequential outcomes are not automatically retried.

---

## 4. Planning

### Purpose

Turn a provisionally authorizable Action Request into a concrete, minimum-disclosure, fully enforceable plan before final approval or autonomous execution.

### Canonical Terms

**DisclosurePlan** — The exact permitted disclosure representation, recipient, purpose, channel constraints, model visibility, and assurance for protected information involved in an action.

**ExecutionPlan** — The exact route by which an authorized action will occur, including authority basis, recipient, resource references, executor, protocol, transaction binding, DisclosurePlan, enforcement obligations, failure semantics, and evidence expectations.

**Plan Fingerprint** — Deterministic canonical binding of all approval-relevant/security-relevant ExecutionPlan terms.

**Enforcement Map** — Exhaustive mapping of every authority-relevant constraint to where it is actually enforced: PTF, protocol, executor, recipient, composite enforcement, or unenforceable.

**Downgrade** — A selected execution route that provides weaker disclosure, custody, authentication, or assurance properties than policy or preferred execution expected.

### Invariants

- Planning occurs before final exact human approval when approval is required.
- Exact approval binds the selected ExecutionPlan fingerprint.
- No authority-relevant constraint may silently disappear.
- Unenforceable security requirements cause denial unless an explicit Hard Policy permits a specifically disclosed downgrade requiring any necessary human approval.
- Least disclosure and least externally reusable authority are preferred after correctness and required assurance.
- Evidence of authority is distinct from actual enforcement.

---

## 5. Protected Execution

### Purpose

Exercise protected resources without exposing unrestricted resource contents or reusable secret material to the Agent when avoidable.

### Canonical Terms

**Protected Resource** — Something whose disclosure, cryptographic use, payment use, account exercise, or other operation requires PTF authority.

**ProtectedResourceRef** — Safe logical reference to a Protected Resource. The reference provides no authority and must not behave as a bearer credential.

**Protected Executor** — A trusted execution boundary capable of performing bounded operations over Protected Resources according to validated Execution Grants/Plans.

**Custody Profile** — Explicit description of where a resource lives and which parties/processes can access plaintext or usable key material. Profiles include provider-brokered, Principal-device, customer-controlled, managed PTF, and attested-confidential arrangements.

**Protected Execution Domain** — The runtime/administrative boundary containing Protected Executors and resources. It may be separate from the PTF Control Runtime.

### Invariants

- Interfaces prefer operations such as sign, authenticate, present, prove, authorize-payment, disclose-approved-claims, and execute-account-action over generic secret extraction.
- Encryption at rest does not imply operator/runtime non-possession.
- Non-exportability does not substitute for operation authorization.
- Recovery does not create a hidden universal plaintext backdoor.
- Protected Executors independently validate the Execution Grant/Plan properties required by their topology.
- Every execution path states its trusted computing base and plaintext visibility.

---

## 6. Protocol Integration

### Purpose

Interoperate with external commerce, payment, credential, identity, agent, and authorization protocols without allowing those protocols to define PTF's canonical authority semantics.

### Canonical Terms

**Protocol Adapter** — Integration logic that interprets external requirements, describes protocol-native enforcement capabilities, translates an already-authorized ExecutionPlan into protocol artifacts, and verifies protocol results.

**Evidence Artifact** — Protocol-specific cryptographic or authorization material produced, consumed, or verified during execution, such as an AP2 mandate, OpenID presentation, x402 payment authorization, OAuth token, passkey assertion, or signed transaction.

**External Receipt** — Protocol/provider-specific evidence describing an externally observed result.

### Invariants

- Adapters do not grant authority, broaden authority, create trust, or decide Principal approval requirements.
- Evidence Artifacts are not canonical PTF authority records.
- Protocol-native security is reused where available.
- Unknown authority-affecting extension semantics fail closed.
- No universal adapter programming interface is frozen until at least two materially different concrete adapters force a genuine common seam.

---

## 7. Audit and Conformance

### Purpose

Provide privacy-minimized, tamper-evident evidence of why and how consequential actions occurred and prove PTF security properties adversarially.

### Canonical Terms

**AuditEvent** — Structured internal evidence that a security-relevant lifecycle event occurred, containing safe metadata and references rather than protected values.

**PTFReceipt** — Durable PTF record linking authority basis, execution plan fingerprint, enforcement summary, identities, executor, protocol, external evidence references, result, reservations, assurance properties, and residual risks.

**Conformance Suite** — Versioned adversarial tests that verify behavioral PTF security properties at public seams.

### Invariants

- Audit is not a duplicate protected-value database.
- Protocol receipts and PTFReceipts remain distinct.
- Privacy-sensitive audit commitments may be externally witnessed without publishing private transaction details.
- Conformance proves behavior rather than trusting adapter or implementation declarations.

---

# Cross-Cutting Contexts

## Trusted Surface

Renders canonical plans, distinguishes approve-once from standing delegation, captures Principal authentication, and binds approval to the plan fingerprint. Agent-generated prose is never the authoritative approval object.

## Portability, Sync, Revocation, and Recovery

Coordinates versioned state movement without treating all state as equally mergeable or exportable. Security-state conflicts fail closed. Aggregate usage requires an authoritative coordination point. Account recovery may require resource re-enrolment or reissuance.

## Developer Platform

Provides Agent Gateway, recipient/verifier integration, simulation, policy/grant inspection, ExecutionPlan/Enforcement Map inspection, protocol fixtures, and conformance tools while preserving trust-boundary separation.

## Security and Operations

Maintains the threat model, safe observability, software supply-chain controls, release provenance, incident response, and verification gates. Self-improving automation cannot bypass these gates.

## Governance and Versioning

Separates the open specification from the reference implementation, manages compatibility and migration, documents major ADRs, preserves genuine project provenance, and evolves standards integrations without redefining core authority semantics.

---

# Forbidden Conflations

The following terms must not be treated as synonyms in specifications, code, tests, or documentation:

- Observation ≠ Claim ≠ Preference.
- ContextView ≠ AuthorityView.
- Personal State ≠ Authority State.
- Handling Class ≠ authorization.
- Hard Policy ≠ Standing Grant.
- Standing Grant ≠ Execution Grant.
- Execution Grant ≠ Evidence Artifact.
- ProtectedResourceRef ≠ bearer capability.
- Subject ID ≠ authenticated identity.
- Identity ≠ authentication.
- Authentication ≠ trust.
- Trust ≠ authorization.
- Merchant business identity ≠ web origin ≠ payment address ≠ protocol identifier unless validated bindings connect them.
- Agent ≠ Agent Instance ≠ model ≠ provider ≠ session.
- Encryption at rest ≠ operator non-possession.
- Non-exportable key ≠ authorized use.
- External Receipt ≠ PTFReceipt.
- Safe View ≠ canonical Personal State.
- Protocol compatibility ≠ PTF conformance.

# Architectural Direction

PTF's core is a user-controlled delegated-authority runtime. Agentic commerce is the first environment used to falsify and refine the core through materially different integrations, beginning with AP2 and x402 and then credential presentation such as OpenID4VP. The architecture is intentionally protocol-neutral and must remain useful beyond commerce if the same semantics survive real integrations.
