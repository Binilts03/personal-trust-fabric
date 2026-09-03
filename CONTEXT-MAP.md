# Personal Trust Fabric — Context Map

Status: **Non-normative glossary for the Proposed PTF v1 specification.**

Normative requirements and invariants live only in `docs/spec/PTF-V1-PROPOSED.md`. This file exists to keep domain language consistent. If wording here conflicts with the proposed specification, the proposed specification wins.

## Bounded contexts

### 1. Personal State
Represents useful information about the Principal without making it authority.

- **Observation** — evidence that a source said, emitted, or exhibited something; not automatically truth.
- **Claim** — proposition about the Principal or their world, with provenance and epistemic state.
- **Preference** — explicit or inferred tendency used for decision support.
- **Derived Context** — ephemeral value computed from Personal State for a task.
- **Handling Class** — maximum technical handling mode for information; not authorization.
- **ContextView** — task-specific personal context permitted for Agent reasoning.
- **Safe View** — ephemeral Agent-facing projection combining ContextView with an independently derived AuthorityView.

### 2. Identity and Trust
Represents actors, externally verifiable bindings, fresh authentication evidence, and role-specific trust.

- **Subject** — stable PTF-local actor used for internal reasoning.
- **Principal** — human or organization whose authority ultimately matters; may be pseudonymous.
- **Agent** — logical delegated software actor.
- **Agent Instance** — current authenticated runtime instance acting as an Agent.
- **Recipient** — Subject intended to receive disclosure or consequential effect.
- **Issuer** — Subject whose assertions may be trusted for defined Claim types.
- **Executor** — Subject operating a Protected Executor.
- **IdentityBinding** — validated link from Subject to an external identity mechanism.
- **EndpointBinding** — validated link from Subject to the concrete endpoint/key/origin/account/address used for an operation.
- **Authentication Evidence** — fresh proof that the current party controls an accepted binding.
- **TrustRelation** — role-, purpose-, and function-specific acceptance of a Subject/binding.
- **Trust Registry** — authoritative deployment state containing bindings, trust relations, status, rotation history, and provenance; not a reputation score.
- **Trusted Surface** — deterministic user-interaction boundary rendering canonical terms and capturing Principal authorization bound to those terms.

### 3. Authority
Represents deliberate delegation and exact approval.

- **Hard Policy** — deterministic restriction on what PTF may authorize; never an authority source.
- **Standing Grant** — deliberate continuing authority delegated by the Principal.
- **Action Request** — concrete action proposed by an Agent.
- **Exact Human Approval** — Principal authorization for one exact planned action.
- **Authorization Decision** — deterministic deny / approval-required / provisionally-authorizable result.
- **Execution Grant** — narrow, immutable, plan-bound authority for concrete execution.
- **Authority Basis** — Standing Grant, Exact Human Approval, or both where required.
- **Reservation** — atomic commitment of aggregate capacity/use/budget preventing concurrent oversubscription.
- **AuthorityView** — Agent-safe projection of requestable action classes/current authority status; never generated from Personal State.

### 4. Planning
Turns a provisionally authorizable request into an exact executable route.

- **DisclosurePlan** — permitted disclosure representation, recipient, purpose, channel, visibility, and assurance.
- **ExecutionPlan** — exact route including authority basis, identities/bindings, resource refs, executor, protocol, transaction binding, disclosure, failure semantics, and evidence expectations.
- **Plan Fingerprint** — deterministic binding of approval/security-relevant ExecutionPlan terms.
- **Enforcement Map** — mapping of every authority-relevant constraint to its actual enforcement location.
- **Downgrade** — selected route weaker than the preferred/required protection, explicitly represented and policy-controlled.
- **Assurance Manifest** — per-execution structured statement of custody, TCB, plaintext visibility, usable-key authority, authentication properties, artifact custody, recovery parties, witness profile, and residual risks.

### 5. Protected Execution
Exercises protected resources through bounded operations.

- **Protected Resource** — credential, payment instrument, private key, account authority, protected datum, or similar resource whose use/disclosure requires authority.
- **ProtectedResourceRef** — safe logical reference only; not bearer authority.
- **Protected Executor** — trusted execution boundary performing bounded operations over Protected Resources according to validated grants/plans.
- **Custody Profile** — explicit placement/visibility model for protected resources.
- **Protected Execution Domain** — runtime/administrative boundary holding protected executors/resources, potentially separate from the control runtime.

### 6. Protocol Integration
Interoperates with external protocols without letting them define PTF authority semantics.

- **Protocol Adapter** — interprets external requirements, reports protocol-native enforcement properties, translates authorized plans, and verifies results.
- **Evidence Artifact** — protocol-specific authorization/cryptographic material such as AP2 mandate, x402 payment payload, OpenID presentation, OAuth token, assertion, or signed transaction.
- **External Receipt** — protocol/provider-specific result evidence.

### 7. Audit and Conformance
Explains actions and proves security properties.

- **AuditEvent** — privacy-minimized structured lifecycle evidence.
- **PTFReceipt** — PTF record linking authority basis, plan fingerprint, enforcement, identities, executor, protocol, result, assurance, and residual risk.
- **Conformance Oracle** — deterministic or metamorphic rule defining expected outcome for a security property.
- **Conformance Suite** — executable versioned tests implementing mandatory oracles for a declared profile.

## Cross-cutting concepts

- **Approval Assurance Profile** — required properties of Principal authentication at approval time.
- **Coordination Profile** — consistency/atomicity model for aggregate authority.
- **Audit Integrity Profile** — local or externally witnessed tamper-evidence profile.
- **Freshness Policy** — deterministic rule for deciding whether a Claim is current, stale, unknown, or revoked for a particular use.
- **Portable State Package** — versioned export/import representation for supported state.

## Forbidden conflations

Observation ≠ Claim ≠ Preference.  
ContextView ≠ AuthorityView.  
Personal State ≠ Authority State.  
Handling Class ≠ authorization.  
Hard Policy ≠ Standing Grant.  
Standing Grant ≠ Execution Grant.  
Execution Grant ≠ Evidence Artifact.  
ProtectedResourceRef ≠ bearer capability.  
Subject ID ≠ authenticated identity.  
Identity ≠ authentication ≠ trust ≠ authorization.  
Merchant identity ≠ web origin ≠ payment address ≠ protocol identifier unless validated bindings connect them.  
Agent ≠ Agent Instance ≠ model ≠ provider ≠ session.  
Encryption at rest ≠ operator non-possession.  
Non-exportable key ≠ authorized use.  
External Receipt ≠ PTFReceipt.  
Safe View ≠ canonical Personal State.  
Protocol compatibility ≠ PTF conformance.