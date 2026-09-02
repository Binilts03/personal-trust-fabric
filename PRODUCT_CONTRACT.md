# Product Contract

## 1. Problem

AI agents can plan and act across websites, tools, services, and other agents. Existing systems usually solve pieces of the stack separately: connectivity, memory, credentials, payments, authentication, or user-data storage.

The missing product is a user-controlled layer that can decide, for each task:

- what the agent may know;
- what it may prove;
- what protected asset it may use without reading;
- what it may do;
- which recipient may receive an authorized disclosure or action;
- for what purpose and transaction;
- under what limits;
- when human approval is required;
- how authority is revoked;
- how the decision is audited without leaking the protected value.

## 2. Product thesis

**Personal Trust Fabric (PTF)** separates the agentic **control plane** from the **confidential execution plane**.

- The control plane handles intent, planning, comparison, negotiation, and orchestration.
- The confidential plane handles protected values, credentials, keys, payment authority, signing, hard policy, protected disclosure, and recipient-bound execution.

An agent may request an operation. It does not automatically receive the underlying protected value.

## 3. Primary actors

### Human Principal
Owns personal state and grants/revokes authority.

### Agent / Agent Instance
Plans or acts for the Human. It is not the Human and is not trusted merely because the Human invoked it.

### Trust Runtime
Enforces hard policy, holds or brokers protected state, issues/executes constrained capabilities, produces safe views and receipts.

### Recipient / Verifier / Merchant
Requests a claim, proof, payment, signature, or other authorized action and must satisfy recipient/purpose/transaction policy.

### Issuer / Provider
Issues credentials or protected resources used by the Human.

### Developer
Integrates an agent, website, verifier, or service with PTF.

## 4. Mandatory complete-product capabilities

These are product scope. They are not a priority list.

### P1 — Principal, device, and agent identity
- Human principal representation.
- Device enrollment/keys/revocation.
- Agent/client/session/task provenance.
- Separation of principal identity from agent identity.
- Delegation provenance where delegation exists.

### P2 — Protected Store and cryptographic operations
- Structured protected values and secret references.
- Credential/key material storage or brokering.
- Key generation/wrapping/rotation/revocation as required by the chosen platform.
- No routine exposure of plaintext to model-facing interfaces.
- Explicit data-classification and serialization rules.

### P3 — Personal State / Persona
- Explicit facts and preferences.
- Context/domain-specific preferences.
- Inferred preferences with confidence and provenance.
- Negative preferences/exclusions.
- Corrections, versioning, timestamps, decay/revalidation.
- Task-specific safe projection for agents.

### P4 — Hard Policy and Human Approval
- Recipient, purpose, resource, action, scope, time, amount, use-count, delegation, and approval constraints as applicable.
- Versioned policies.
- Approval/denial/expiry.
- Policy explanation and simulation.
- Learned behavior cannot silently expand authority.

### P5 — Capability Runtime
- Opaque/non-introspective agent-facing references where non-possession is required.
- Constrained issuance/use/derivation/revocation.
- No capability broadening through derivation.
- Proof-of-possession or independently authenticated redemption where bearer semantics would violate policy.
- Safe error/receipt semantics.

### P6 — Disclosure Planner / Reference Monitor
Choose the lowest-disclosure allowed representation capable of completing the task:
1. no disclosure;
2. predicate/proof;
3. derived/aggregated attribute;
4. selectively disclosed claim;
5. opaque/encrypted presentation;
6. direct protected delivery/action;
7. raw plaintext only when unavoidable and authorized.

Authorization and disclosure planning are separate decisions.

### P7 — Credential / Identity Broker
- Credential metadata and holder binding.
- Credential request/presentation interfaces.
- Status/revocation handling where applicable.
- Selective disclosure where supported.
- Standards adapters selected through evidence.

### P8 — Payment Authority
- Payment instrument remains separate from spend authority.
- Merchant/recipient, amount, currency, transaction, time, and use constraints where supported.
- Approval escalation.
- Non-reusable payment authorization where a rail supports it.
- No model-facing payment secret.

### P9 — Signing / Authentication / Consequential Action Authority
- Signing/private-key operations without exporting the private key.
- Authentication operations where appropriate.
- Generic bounded account/action authority.
- Explicit confirmation for high-risk irreversible actions according to policy.

### P10 — Agent Safe View
For task T and recipient R, derive only task-relevant:
- non-sensitive facts/preferences;
- policy/approval status;
- available capability types;
- safe receipts/errors.

The safe view is derived state, not the canonical personal record.

### P11 — Agent and Web Adapters
- Stable local/programmatic interface independent of any one external protocol.
- Evidence-selected agent protocol adapters; MCP is a current candidate, not a product invariant.
- WebMCP adapter for the challenge milestone and for product use where it remains suitable.
- Additional agent/web protocols only through replaceable adapters.
- Legacy web mediation where a protocol cannot express the required operation, with an explicit weaker-assurance label.

### P12 — Recipient / Verifier SDK
- Recipient registration/trust metadata.
- Request schema for capability/credential/action.
- Recipient authentication.
- Nonce/replay controls.
- Redemption/presentation verification.
- Completion/outcome reporting.
- Safe errors and conformance fixtures.

### P13 — Audit / Provenance / Transparency
- Decision and capability lifecycle records.
- Recipient/purpose/scope/representation records.
- User-readable history.
- Tamper-evidence strategy.
- Forensic export that excludes raw secrets unless explicitly authorized.

### P14 — Portability, Sync, Revocation, and Recovery
- Export/import format for personal state and policies.
- Multi-device strategy.
- Revocation propagation.
- Device loss/replacement.
- Recovery that does not silently grant a hosted operator universal plaintext access.
- Conflict/version semantics.

### P15 — Persona Learning and Self-Improvement
- Observations enter as evidence, not trusted facts.
- Explicit user choices outrank inference.
- Shadow evaluation before durable promotion where appropriate.
- Poisoning-aware memory transitions.
- Reversible preference/strategy evolution.
- Self-improvement must not self-authorize.

### P16 — User Product Surfaces
- Persona/state management.
- Policies and authority.
- Credentials/protected resources.
- Approvals.
- Active capabilities and revocation.
- Activity/audit/explanations.
- Devices/recovery/portability.
- Developer/testing mode where appropriate.

### P17 — Developer Platform and Conformance
- SDKs/interfaces for agents and recipients.
- Local/synthetic test fixtures.
- Conformance/eval suite.
- Policy/capability debugger.
- Protocol adapter tests.
- Security guidance and versioning.

### P18 — Production Security / Operations
- Dependency/supply-chain controls.
- Secret scanning.
- Signed/reproducible release strategy where practical.
- Incident/revocation procedures.
- Upgrade/migration policy.
- Observability designed not to become a secret exfiltration path.

## 5. Product invariants

### INV-01 — Model is not the trust authority
The model may recommend an action. It cannot authorize protected disclosure or consequential authority by itself.

### INV-02 — Authority is not knowledge
Permission to use a protected resource does not imply permission to reveal its underlying value.

### INV-03 — Capability over value
Where non-possession is technically possible, model-facing interfaces expose authorization/capability state rather than reusable secrets.

### INV-04 — Deterministic enforcement
Prompt wording, system prompts, or model refusal are not security controls for protected values or hard authority.

### INV-05 — Minimum necessary disclosure
Release only the representation and scope required for the approved task.

### INV-06 — Recipient/purpose/transaction binding
Protected release/action is bound to the intended recipient, purpose, transaction, scope, expiry/use policy, and other approval-relevant terms where applicable.

### INV-07 — No silent authority growth
Persona learning, repeated approvals, or successful actions cannot silently expand spend, signing, disclosure, delegation, or recipient authority.

### INV-08 — Untrusted input is evidence
Web/tool/model/third-party content cannot automatically become trusted durable personal state.

### INV-09 — Audit without leakage
Logs, receipts, telemetry, crash artifacts, and audits must not become a routine copy of the protected data.

### INV-10 — Replaceable adapters
WebMCP, MCP, credential formats, payment protocols, and other external protocols do not define PTF's authority semantics.

### INV-11 — Explicit weaker-assurance downgrade
If an external service requires plaintext or a weaker channel, surface the downgrade and apply policy instead of pretending the stronger guarantee still holds.

### INV-12 — Evidence before security claims
Every security/privacy guarantee must state the trusted computing base, observable evidence, and known exceptions.

## 6. Product non-goals

- Replace standards with a PTF-specific identity/payment universe.
- Make an LLM a credential store or policy engine.
- Claim that an authorized recipient cannot misuse plaintext after legitimately receiving it.
- Treat encryption at rest as sufficient privacy.
- Treat “local-first” as automatically secure.
- Infer legal or financial authority from behavior.
- Trust arbitrary web content as personal memory.
- Make a demonstration vertical the product architecture.

## 7. Product-completion acceptance

PTF is not complete because one scenario works. Product completion requires:

1. P1–P18 implemented and integrated or explicitly changed by a human product decision.
2. Materially different agent clients/adapters can consume the same policy/persona/capability semantics, demonstrating portability beyond one integration.
3. Materially different protected-operation classes exercise the same trust core, demonstrating that the core is not a vertical-specific implementation.
4. The agent can complete supported non-possession workflows without receiving protected values.
5. A malicious/prompt-injected agent cannot convert available authority into broader disclosure/action than policy grants.
6. Personal state can be corrected, exported, revoked, recovered, and moved according to documented semantics.
7. Protocol adapters pass applicable conformance/eval suites.
8. Threat model and residual risks are documented and tested.
9. Developer/recipient integration is usable without reading trust-core internals.
10. No domain-specific demonstration concept appears in the generic trust-core domain model.
