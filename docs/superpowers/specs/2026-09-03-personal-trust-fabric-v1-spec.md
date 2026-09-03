# Personal Trust Fabric v1 — Canonical Specification

Status: **Architecture Approved / Self-Reviewed / Awaiting Human Spec Review**  
Date: 2026-09-03  
Repository: `Binilts03/personal-trust-fabric`  
Specification branch: `architecture/ptf-v1-spec`

This is the canonical architecture specification for Personal Trust Fabric (PTF). It supersedes the synthetic WebMCP milestone as the product source of truth and supersedes the earlier draft `2026-09-03-personal-trust-fabric-v1-design.md` on this branch.

Normative terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** express requirement strength. Implementation details intentionally deferred by this specification require evidence-based decisions during planning/implementation and MUST NOT be inferred from the old sandbox.

---

# 1. Product Definition

Personal Trust Fabric is an **open, user-controlled delegated-authority runtime for AI agents**.

PTF lets a Principal deliberately define authority, lets an authenticated Agent propose a concrete action, deterministically decides whether that action may proceed, constructs a minimum-disclosure Execution Plan, obtains exact human approval where required, issues narrowly scoped execution authority, and performs the action through protected execution and existing external protocols without unnecessarily giving the Agent the underlying credential, key, payment instrument, reusable token, secret, or complete private context.

Agentic commerce is PTF's first proving ground, not its architectural boundary.

The core thesis is:

> Give AI agents the authority to act for users without unnecessarily giving them the underlying protected assets or unrestricted future authority.

The privacy companion thesis is:

> Give an Agent enough personal context to be useful without making the model the canonical store of the Principal's life.

---

# 2. Problem

Agentic systems increasingly need to purchase goods, pay for resources, present credentials, authenticate, sign transactions, exercise accounts, and use private user context. Common implementations give the Agent or its hosting infrastructure broad reusable credentials and large personal profiles. This creates authority, privacy, identity, replay, recipient-substitution, concurrency, custody, recovery, and audit risks.

PTF exists to make the following questions deterministic and reusable rather than application-specific:

- Did the Principal deliberately authorize this Agent?
- Does this exact action fit the authority that exists now?
- Who is the authenticated intended recipient?
- Which protected resource may be exercised?
- What information may leave the trusted boundary?
- What is the least revealing feasible representation?
- Where is every authority-relevant constraint actually enforced?
- Does the selected external protocol preserve those constraints?
- Is human approval required for this exact route?
- What happens on replay, mutation, concurrency, revocation, or ambiguous external effect?
- What evidence can later explain what happened without leaking protected values?

---

# 3. Scope Discipline

This specification defines the **full PTF product architecture**.

Implementation MAY be delivered in ordered milestones, but a milestone MUST NOT redefine the product boundary. In particular:

- an AP2 integration is not the whole product;
- an x402 payment path is not the whole product;
- an OpenID4VP credential flow is not the whole product;
- a WebMCP/MCP/A2A adapter is not the whole product;
- a reference Trusted Surface is not the whole product;
- a synthetic sandbox is not the whole product.

Milestones exist to prove or falsify parts of this specification. They do not replace it.

Any implementation plan MUST preserve traceability back to this full specification even when work is sequenced incrementally.

---

# 4. Goals

PTF MUST support:

1. deliberate continuing delegation and exact one-time approval as separate authority modes;
2. deterministic authorization outside the LLM;
3. no silent authority broadening;
4. minimum feasible disclosure;
5. protected-resource use without unnecessary secret extraction;
6. protocol interoperability without protocol capture of the core domain;
7. explicit preservation/enforcement of every authority-relevant constraint;
8. authenticated identity and role-specific trust rather than labels;
9. adaptive Personal State without Personal-State-to-authority escalation;
10. privacy-minimized explainable audit;
11. revocation/lifecycle control across grants, bindings, devices, trust, resources, and execution;
12. concurrency-safe aggregate limits;
13. explicit per-operation assurance/trusted-computing properties;
14. portability without false claims that non-exportable resources can always move;
15. open specification/reference implementation/conformance tooling;
16. adversarial conformance rather than declarative compatibility claims;
17. enough protocol diversity to prove that the core is genuinely cross-protocol.

---

# 5. Explicit Non-Goals

PTF v1 does not attempt to:

- replace AP2, UCP, x402, OpenID4VP, Digital Credentials, FIDO, OAuth, MCP, WebMCP, A2A, wallets, card/payment rails, credential issuers, or identity providers;
- create one global human identity or Agent PKI;
- create global merchant/Agent/issuer reputation scores;
- implement catalog, cart, order, fulfilment, settlement-network, or card-network semantics already owned by commerce/payment protocols;
- require central PTF custody of every protected resource;
- guarantee cryptographic privacy modes unsupported by the selected provider/protocol;
- equate storage encryption with operator non-possession;
- expose generic Agent-facing secret/private-key extraction;
- turn behavior/inference into spending, signing, trust, or disclosure authority;
- let LLM judgment replace deterministic authorization or attenuation checking;
- event-source every personal datum forever;
- synchronize every protected key/credential across devices;
- require confidential computing universally;
- freeze language, database, ORM, policy DSL, cloud, UI framework, message bus, crypto library, KMS/HSM/TEE vendor, exact key hierarchy, or a universal protocol adapter programming interface at architecture stage;
- preserve old sandbox code solely to reduce rewrite effort.

---

# 6. Canonical Bounded Contexts

`CONTEXT-MAP.md` is normative terminology for this specification.

PTF has seven primary bounded contexts:

1. **Personal State**
2. **Identity and Trust**
3. **Authority**
4. **Planning**
5. **Protected Execution**
6. **Protocol Integration**
7. **Audit and Conformance**

Cross-cutting contexts:

- Trusted Surface
- Portability / Sync / Revocation / Recovery
- Developer Platform
- Security and Operations
- Governance and Versioning

Implementation packages MAY differ, but semantic boundaries MUST remain observable.

There is no automatic Personal-State-to-Authority edge.

---

# 7. Global Invariants

## 7.1 Authority

1. Knowledge is not authority.
2. Personalization is not authorization.
3. Hard Policy constrains authority but never creates or expands it.
4. Authority originates only from a deliberate Standing Grant or Exact Human Approval.
5. Repeated behavior, repeated approvals, model confidence, or successful transactions cannot create Standing Grant authority.
6. Separate grants cannot be unioned to manufacture authority no individual grant provides.
7. One-off approval outside a Standing Grant does not mutate that Standing Grant.
8. Standing Grants preserve immutable/versioned historical meaning.
9. Execution Grants are narrow, immutable, plan-bound, time/use bounded, and revocable while under PTF control.
10. Unknown attenuation semantics fail closed.
11. Further Agent delegation is disabled by default.
12. Current Hard Policy, identity/trust, resource, revocation, expiry, and reservation state are revalidated before consequential commit.
13. Relaxing policy never broadens existing authority; tightening policy may prevent not-yet-committed execution.

## 7.2 Planning and Execution

14. Planning precedes final Exact Human Approval when approval is required.
15. Exact Human Approval binds the selected ExecutionPlan fingerprint.
16. No authority-relevant constraint may silently disappear.
17. Every authority-relevant constraint appears in an Enforcement Map.
18. Mandatory unenforceable constraints cause denial unless an explicit permitted downgrade is disclosed and approved as required.
19. Evidence that a constraint exists is distinct from the enforcement of that constraint.
20. Consequential external artifacts are produced just-in-time where practical.
21. Ambiguous external outcomes become `INDETERMINATE`, not automatically retryable failures.
22. Retry after a consequential attempt requires proof of no effect or strong idempotency for the identical action.
23. Aggregate limit reservation and Execution Grant issuance MUST be atomic with respect to competing requests when the grant consumes/reserves aggregate authority.

## 7.3 Personal State

24. Observation, Claim, and Preference are distinct.
25. Durable Personal State preserves source provenance and derivation lineage.
26. Transformation, summarization, model inference, tool echo, and compaction cannot upgrade source authority.
27. Confidence is not source authority and is not truth.
28. Explicit applicable correction/preference outranks incompatible inference.
29. Objective Claim verification is domain- and issuer-specific.
30. Material contradictions are not resolved by model guesswork.
31. Inferred preferences may support low-risk reversible decision assistance but cannot create Hard Policy, Standing Grants, Exact Human Approval, Execution Grants, or TrustRelations.
32. Safe View is task-scoped, minimized, ephemeral, and never canonical Personal State.
33. ContextView and AuthorityView are independently derived and typed.
34. Correction and erasure are separate operations.

## 7.4 Identity and Trust

35. Identity, authentication, trust, and authorization are separate.
36. Local Subject IDs have no external authentication meaning.
37. External identity and endpoint equivalence require validated bindings.
38. Human-readable names never establish recipient identity.
39. Trust is role-/purpose-specific, not a global boolean or reputation score.
40. Successful behavior cannot create/broaden TrustRelations.
41. Principal identity MAY be pseudonymous; legal identity is not the universal root.
42. Agent identity is distinct from Agent Instance, model, provider, runtime, and session.
43. Recipient execution requires authenticated evidence appropriate to the selected route.
44. Payment address, web origin, merchant identity, verifier identity, account, key, and protocol identifier remain separate until validated bindings connect them.
45. Issuer trust is Claim-/credential-type-specific.
46. Binding/key rotation requires continuity evidence.
47. Delegated child Agents require independent authentication.

## 7.5 Protected Resources

48. Protected Resource is logical and does not imply PTF plaintext custody.
49. ProtectedResourceRef is not a bearer capability and confers no authority.
50. Protected interfaces prefer bounded use over secret/key extraction.
51. Non-exportability does not substitute for operation authorization.
52. Encryption at rest does not imply runtime/operator non-possession.
53. Every execution profile states its trusted computing base/plaintext visibility.
54. Recovery cannot introduce an undisclosed universal plaintext backdoor.
55. Protected Executors consume validated plans/grants rather than arbitrary free-form Agent instructions.
56. Protected Executors revalidate the properties required by their topology before consequential use.

## 7.6 Protocols, Audit, and Evolution

57. External protocol artifacts do not directly become PTF authority merely because they are syntactically valid; PTF validates/maps their semantics before relying on them as authority evidence/basis.
58. Evidence Artifacts are not canonical PTF authority objects.
59. Protocol adapters do not create authority/trust or silently remove constraints.
60. Unknown authority-affecting extension semantics fail closed.
61. Audit/telemetry do not routinely contain protected values or full model context.
62. PTFReceipt is distinct from External Receipt.
63. Conformance is behavioral/adversarial at public seams.
64. Security-sensitive migrations never silently broaden authority/trust.
65. Automated/self-improving development cannot bypass review, security, and conformance release gates.

---

# 8. Actors

- **Principal** — human/organization whose authority ultimately matters.
- **Agent** — logical delegated software actor.
- **Agent Instance** — current authenticated executing instance of an Agent.
- **Recipient** — intended Subject receiving disclosure/effect.
- **Issuer** — Subject whose assertions may be trusted for defined Claim types.
- **Executor** — Subject operating a Protected Executor.
- **Agent Provider** — provider operating Agent infrastructure and possibly trusted user/signing boundaries under an explicit trust model.
- **Verifier** — Recipient role verifying evidence.
- **Administrator** — deployment-governance actor allowed to configure defined policy/trust settings.
- **Auditor/Reviewer** — authorized evidence reviewer.
- **Developer/Integrator** — Agent, recipient, provider, or adapter developer.

Roles MAY overlap, but role relationships remain explicit.

---

# 9. User Stories

These stories are normative product behavior and MUST remain traceable through implementation planning.

## 9.1 Principal / Authority

1. As a Principal, I want to approve one exact consequential plan without granting broader future authority.
2. As a Principal, I want to create a Standing Grant with explicit operation/resource/recipient/purpose/time/use/disclosure/delegation/financial constraints.
3. As a Principal, I want approve-once and create-standing-authority to be separate actions.
4. As a Principal, I want to deny one action without changing unrelated grants.
5. As a Principal, I want to suspend/resume Standing Grants.
6. As a Principal, I want to revoke Standing Grants.
7. As a Principal, I want grant broadening to require explicit new authorization.
8. As a Principal, I want one-time exceptions to leave normal grant limits unchanged.
9. As a Principal, I want to know when an already-emitted external artifact cannot actually be revoked.
10. As a Principal, I want to inspect committed/reserved/available aggregate authority.
11. As a Principal, I want Standing Grant proposals rendered from canonical grant terms and authenticated on the Trusted Surface before becoming active.
12. As a Principal or authorized administrator, I want Hard Policy changes to occur only through authenticated administrative control, never via Agent mutation.

## 9.2 Agent

13. As an Agent, I want a minimized task Safe View without receiving complete Personal State.
14. As an Agent, I want to submit a concrete Action Request.
15. As an Agent, I want safe deterministic deny/approval-required/progress/outcome information.
16. As an Agent, I want operation/resource availability metadata rather than underlying protected values.
17. As an Agent, I want inferred preferences labelled as inferred.
18. As an Agent, I want material transaction changes to require re-resolution.
19. As an Agent, I want safe PTFReceipts/results sufficient to continue workflow without reusable secrets.

## 9.3 Personal State

20. As a Principal, I want Observations, Claims, and Preferences represented distinctly.
21. As a Principal, I want corrections to supersede prior state while preserving explainable history.
22. As a Principal, I want material contradictions surfaced or resolved only by deterministic source/domain rules.
23. As a Principal, I want context-specific preferences to remain context-specific.
24. As a Principal, I want freshness/revalidation semantics appropriate to each information type.
25. As a Principal, I want erasure separate from correction.
26. As a Principal, I want summaries/compaction to retain underlying source lineage.
27. As a Principal, I want low-risk inferred preferences usable for reversible ranking/suggestions without creating authority.

## 9.4 Identity and Trust

28. As a Principal, I want actual Agents/recipients/executors authenticated rather than trusted by label.
29. As a Principal, I want one Subject to support multiple independently validated protocol bindings.
30. As a Principal, I want trust scoped to role/purpose/claim.
31. As a Principal, I want binding/key rotation to require continuity evidence.
32. As a Principal, I want authority delegated to a logical Agent to survive model/provider changes where intended.
33. As a Principal, I want high-value approvals to require the configured user-verification assurance.
34. As a Recipient, I want evidence bound to my authenticated identity/endpoint.
35. As an Issuer, I want my assertions accepted only for configured Claim types.

## 9.5 Planning / Disclosure

36. As a Principal, I want the least-disclosing feasible route after correctness/assurance requirements.
37. As a Principal, I want final approval to show the actual selected disclosure/execution route.
38. As a Principal, I want weaker-than-preferred routes disclosed as explicit downgrades.
39. As a Principal, I want policy to forbid selected downgrade classes entirely.
40. As a Developer, I want every authority constraint mapped to an enforcement location.
41. As a Developer, I want mandatory unenforceable constraints to reject the plan rather than disappear.

## 9.6 Protected Execution

42. As a Principal, I want external wallets/providers to retain protected resources where appropriate.
43. As a Principal, I want a device-controlled Protected Executor option.
44. As an enterprise Principal, I want a customer-controlled Protected Executor option.
45. As a managed deployment operator, I want truthful disclosure of operator/runtime TCB visibility.
46. As a high-assurance deployer, I want an optional attested-confidential profile where justified.
47. As an Agent, I want bounded operations (`sign`, `present`, `prove`, `authorize-payment`, etc.) instead of secret extraction.
48. As a Principal, I want direct protected delivery bound to authenticated recipient endpoints/keys.
49. As a Principal, I want page/browser plaintext identified as weaker assurance.
50. As a Principal, I want ambiguous effects reconciled before retry.
51. As a Principal, I want concurrent aggregate authority protected by atomic reservation.

## 9.7 Audit / Portability / Recovery

52. As a Principal, I want a PTFReceipt explaining authority basis, plan, enforcement, executor, protocol, and result.
53. As a Principal, I want audit to exclude protected values by default.
54. As an Auditor, I want safe forensic linkage without unrestricted secret access.
55. As a Principal, I want tamper-evident history with optional privacy-safe external witnessing in stronger profiles.
56. As a Principal, I want a versioned export of supported state.
57. As a Principal, I want imported security-sensitive bindings/trust revalidated.
58. As a Principal, I want non-exportable resources re-enrolled/reissued rather than falsely copied.
59. As a Principal, I want device revocation granular to the device/binding.
60. As a Principal, I want recovery that does not violate the stated custody profile.
61. As a Principal, I want Personal State merge semantics separated from security-state conflict semantics.

## 9.8 Developers / Open Source / Operations

62. As an Agent developer, I want a narrow Agent Gateway for Safe View, Action Request, status, and safe result.
63. As a recipient/verifier developer, I want focused evidence verification integration.
64. As an adapter developer, I want to report protocol enforcement capabilities and translate authorized plans without becoming an authority engine.
65. As a developer, I want synthetic identities/resources and a local simulator.
66. As a developer, I want policy/grant/Safe View/ExecutionPlan/Enforcement Map inspection tools.
67. As a developer, I want versioned adversarial conformance suites.
68. As a developer, I want AP2 and x402 implemented before a common adapter API is frozen.
69. As a developer, I want a materially different OpenID4VP credential path to test generality.
70. As a contributor, I want specification separated from reference implementation.
71. As a contributor, I want major architecture trade-offs captured in ADRs.
72. As a maintainer, I want privacy-safe telemetry and leak-canary tests.
73. As a maintainer, I want release provenance/SBOM/security scanning/signing as the project matures.
74. As a security researcher, I want a maintained threat model and disclosure process.
75. As a maintainer, I want security-sensitive extensions/migrations to fail closed when semantics are unknown.

---

# 10. Precedence and Control Rules

For a concrete action, precedence is conceptually:

1. non-overridable PTF/security invariants;
2. current applicable Hard Policy (system/deployment/Principal governance as configured);
3. current revocation, resource, identity-binding, trust, device, and assurance status;
4. deliberate authority source (applicable Standing Grant and/or Exact Human Approval);
5. Action Request;
6. selected Execution Plan / Execution Grant.

Multiple applicable Hard Policies combine restrictively. Conflict/ambiguity in security-sensitive policy MUST fail closed unless the policy model defines an explicit deterministic precedence rule.

Hard Policy mutation MUST require authenticated Principal/authorized-administrator control and MUST NOT be exposed through the Agent Gateway.

Standing Grant creation/amendment MUST use a canonical grant proposal, deterministic validation, Trusted Surface rendering, and appropriate Principal authentication. `PROPOSED` grants are not authority.

---

# 11. Core Lifecycle

1. Establish authenticated Agent/Agent Instance context.
2. Derive task-specific ContextView + AuthorityView → Safe View.
3. Agent submits concrete Action Request.
4. Resolve required Subjects, IdentityBindings, EndpointBindings, TrustRelations, resource status, and executor candidates.
5. Evaluate invariants, current Hard Policy, relevant Standing Grant(s), existing reservations/usage, revocation/expiry, and whether the request is potentially authorizable.
6. Build feasible candidate DisclosurePlans/ExecutionPlans using real protocol/executor capabilities.
7. Build complete Enforcement Map for each candidate.
8. Reject candidates with unsatisfied mandatory constraints; identify any explicitly allowed downgrade.
9. Select the correct/assured route, then prefer least disclosure and least externally reusable authority.
10. If Exact Human Approval is required, render the selected plan canonically on the Trusted Surface and capture authenticated approval bound to its fingerprint.
11. Atomically reserve required aggregate authority and issue the Execution Grant where aggregate/use limits apply; failure to reserve means no usable Execution Grant is produced.
12. Immediately before commit, revalidate current grant/policy/trust/binding/resource/expiry/reservation/plan state.
13. Protected Executor validates the plan/grant properties required by its custody topology and prepares transient execution material.
14. Commit the external consequential effect.
15. Reconcile outcome as success/consumed, proven-no-effect/released, or `INDETERMINATE`.
16. Commit/release/hold aggregate reservations consistently with that outcome.
17. Record privacy-minimized AuditEvents, PTFReceipt, and safe references to External Receipts/Evidence Artifacts.

Implementation optimizations MUST preserve equivalent observable security semantics.

---

# 12. Authority Domain

## 12.1 Authority Sources

Only:

- **Standing Grant** — deliberate continuing delegation; and
- **Exact Human Approval** — deliberate authority for the selected concrete plan.

External mandates/tokens/credentials MAY be evidence of prior authority but are not relied upon until validated/mapped into PTF semantics.

## 12.2 Standing Grant

Lifecycle:

- `PROPOSED` — not authority;
- `ACTIVE`;
- `SUSPENDED`;
- `REVOKED` (terminal);
- `EXPIRED` (terminal);
- `SUPERSEDED` (historical version replaced by deliberate new version).

Creation/amendment requirements:

- canonical grant terms;
- validation against invariants/Hard Policy/governance;
- Trusted Surface display;
- required Principal authentication;
- deliberate acceptance;
- version/provenance record.

Broadening amount, resource, action, recipient set, disclosure, validity, uses, or delegation requires new deliberate authorization.

## 12.3 Execution Grant

Conceptual states:

- `ISSUED`;
- `REVOKED`;
- `EXPIRED`;
- `IN_FLIGHT`;
- `CONSUMED`;
- `RELEASED_NO_EFFECT`;
- `INDETERMINATE`.

It binds the selected ExecutionPlan fingerprint and explicit authority basis.

## 12.4 No Broadening / No Grant Union

For deterministic dimensions, child/execution authority MUST be contained by the source authority: operations, resources, recipients, purposes, amounts/currencies, aggregate limits, validity, use counts, disclosure permission, delegation depth/scope, and required assurance where applicable.

Subjective/natural-language preferences that cannot be deterministically evaluated are decision context, not authoritative constraints.

One Standing Grant MUST independently authorize an autonomous action. If several grants independently cover the action, one explicit authority basis is selected and receives usage accounting.

## 12.5 Aggregate Authority

Available capacity is conceptually:

`limit - committed_usage - outstanding_reservations`.

Reservation + usable Execution Grant issuance MUST be atomic for competing requests consuming that aggregate authority.

Disconnected replicas unable to coordinate the same aggregate authority MUST NOT independently exercise it.

## 12.6 Exceptions / Delegation

A one-off Exact Human Approval MAY authorize an action outside a Standing Grant without modifying the grant.

Further Agent delegation is opt-in, child-authenticated, no-broader, depth-limited, provenance-preserving, and invalidated when parent authority is invalid under PTF control.

---

# 13. Planning Domain

## 13.1 DisclosurePlan

MUST identify:

- recipient;
- purpose;
- Protected Resource source/reference;
- requested/permitted information;
- selected representation;
- channel constraints;
- Agent/model visibility;
- known downstream visibility/retention assumptions;
- assurance properties;
- downgrade status.

Preference order after correctness/required assurance:

1. no disclosure;
2. predicate/proof;
3. derived attribute;
4. selective claims;
5. opaque/encrypted presentation;
6. direct protected delivery;
7. raw plaintext.

This is preference, not a promise that every route supports every mode.

## 13.2 ExecutionPlan

MUST capture all approval/security-relevant semantics, including:

- Action Request reference;
- authority basis;
- Principal/Agent/Recipient identities/bindings relevant to the action;
- Protected Resource references;
- DisclosurePlan;
- Protected Executor/profile;
- protocol/operation;
- transaction binding;
- Enforcement Map;
- reservation/use accounting requirements;
- replay/idempotency strategy;
- expected Evidence Artifacts/External Receipts;
- outcome/failure/reconciliation semantics;
- expiry;
- trusted-computing/plaintext-visibility properties;
- deterministic plan fingerprint.

Material mutation invalidates approval/grant.

## 13.3 Enforcement Map

Every authority-relevant constraint maps to one or more of:

- `PTF`;
- `PROTOCOL`;
- `EXECUTOR`;
- `RECIPIENT`;
- `COMPOSITE`;
- `UNENFORCEABLE`.

Mandatory `UNENFORCEABLE` constraints invalidate the candidate unless the exact downgrade is policy-permitted and appropriately approved.

---

# 14. Personal State Domain

Canonical entities:

- Observation
- Claim
- Preference
- Derived Context
- Handling Class
- ContextView
- Safe View

Protected Resources remain separate.

Durable Personal State MUST preserve source class/identity where appropriate, observed/asserted time, derivation lineage, context/scope, sensitivity/handling, epistemic/verification state, correction/supersession history, and relevant freshness/revalidation semantics.

### Claims

Claim state MAY include asserted, verified, inferred, disputed, stale, and superseded semantics as appropriate. `Verified` means verified according to a domain-appropriate accepted source, not high model confidence.

### Preferences

Explicit and inferred preferences are distinct. Applicable explicit corrections/preferences outrank incompatible inference. Inference is usable for low-risk reversible assistance only unless deliberate authority separately exists.

### Safe View

Safe View is task-specific/ephemeral and combines separately derived ContextView and AuthorityView. It MUST NOT expose a generic full profile or let Personal State generate authority.

Internal provenance MAY be richer than the minimum epistemic metadata exposed to the Agent.

---

# 15. Identity and Trust Domain

## 15.1 Subject and Bindings

PTF uses stable local Subjects for reasoning. Local IDs have no external authentication meaning.

External identities/endpoints connect through independently validated IdentityBindings/EndpointBindings (keys, origins, certificates, wallet addresses, accounts, verifier attestations, protocol identities, etc.).

## 15.2 Authentication

PTF retains relevant fresh authentication properties rather than a generic boolean: possession proof, user presence, user verification, certificate/key validation, endpoint/origin matching, workload/attestation properties, challenge freshness, transaction binding, etc.

## 15.3 TrustRelation

Trust is specific to Subject/binding, role, accepted function/Claim, context, provenance, validity, and status.

A universal `trusted=true` or global reputation score is insufficient.

## 15.4 Principal / Agent / Recipient

Principal is the authority owner and need not have one global legal/correlatable identifier.

Agent is the logical delegated actor; Agent Instance/model/provider/session/runtime remain distinct.

Standing authority binds authenticated Agent Subjects rather than caller-provided strings.

Recipient execution binds the actual authenticated endpoint/identity required by the selected plan.

## 15.5 Trusted Surface

Trusted Surface is an authenticated deterministic boundary that renders canonical grant/ExecutionPlan terms and binds Principal authorization to those exact terms.

---

# 16. Protected Resource and Custody Domain

## 16.1 Protected Resource

A Protected Resource is anything whose disclosure/use/exercise requires authority. PTF MAY only hold safe metadata/reference while custody remains elsewhere.

ProtectedResourceRef MUST NOT be usable as bearer authority.

## 16.2 Protected Executor

Protected Executors expose bounded operations such as sign, authenticate, prove, present, authorize-payment, disclose-approved-claims, or execute bounded account action.

Generic Agent-facing key/secret extraction is prohibited by default.

## 16.3 Custody Profiles

Supported conceptual profiles:

1. external/provider-brokered;
2. Principal-device/local;
3. customer-controlled runtime;
4. managed PTF runtime;
5. attested-confidential runtime.

Profiles are property sets, not a single linear security score.

Each execution reports which parties/processes can access plaintext/usably invoke keys and which are inside the TCB.

## 16.4 Runtime Topology / Recovery

Control Runtime and Protected Execution Domain MAY be physically/administratively separated.

Protected Executors independently validate what their topology requires before use.

Principal-authentication, Agent-authentication, encryption/wrapping, signing, credential-holder, sync, recovery, and attestation key roles remain conceptually distinct.

Recovery MUST NOT silently broaden plaintext access. Some resources legitimately recover by revocation/re-enrolment/reissuance instead of restoring old key material.

---

# 17. Protocol Integration

A Protocol Adapter MAY:

- interpret external requirements into PTF-relevant Action Request inputs;
- describe protocol-native enforcement properties;
- translate an authorized ExecutionPlan into protocol artifacts/requests;
- verify external protocol results.

It MUST NOT create authority, create trust from labels, change Hard Policy, decide Personal State source authority, read arbitrary resources, broaden scope, or drop constraints.

Evidence Artifacts (AP2 Mandates, x402 payment payloads, OpenID presentations, tokens/assertions/signed transactions, etc.) remain protocol-specific and are not canonical PTF authority objects.

Artifact custody/transfer SHOULD state whether the artifact is direct-delivery, sender/recipient-constrained, bearer-like, or local-only.

## 17.1 Abstraction Gate

Do not freeze a universal adapter API until concrete AP2 and x402 integrations demonstrate a genuine common seam. OpenID4VP is the third cross-domain proving integration.

## 17.2 Protocol Proving Requirements

### AP2

Must test continuing delegated authority, transaction-specific narrowing, Trusted Surface relationship, Agent PoP/signing custody where applicable, selective disclosure of relevant authority constraints, merchant/verifier binding, and receipt reconciliation.

### x402

Must test payment requirement → Action Request conversion, payee/payment-endpoint binding, aggregate budget reservation, wallet execution without Agent private-key possession, amount/recipient/validity/replay enforcement split, and settlement/indeterminate reconciliation.

### OpenID4VP

Must test verifier binding, requested-claim minimization, nonce/transaction binding, brokered credential presentation without unnecessary PTF credential copying, disclosure representation selection, and verification outcome.

If these three require protocol-specific concepts to leak into the canonical authority model, architecture is revisited instead of inventing a larger paper abstraction.

---

# 18. Audit, Receipts, and Conformance

## 18.1 AuditEvent

Privacy-minimized structured lifecycle evidence. Protected Resource plaintext, private keys, payment credentials, raw identity documents, and complete model context are excluded by default.

## 18.2 PTFReceipt

A PTFReceipt MUST support explanation of:

- Principal;
- Agent/delegation provenance;
- authority basis;
- action/recipient;
- ExecutionPlan fingerprint;
- Enforcement Map summary;
- Protected Executor/profile;
- protocol;
- safe External Receipt/Evidence references;
- execution/grant outcome;
- aggregate reservation/usage outcome;
- material assurance properties;
- downgrades/residual risk;
- timestamps.

External Receipt remains distinct.

## 18.3 Tamper Evidence

Deployments SHOULD support durable audit integrity appropriate to threat model. Stronger profiles MAY use signed/linked checkpoints and privacy-safe external witnessing. Private transaction details need not be published to a public transparency log.

## 18.4 Conformance

"PTF Conformant" MUST identify specification version, suite version, and tested profile.

The conformance suite MUST eventually attack at least:

- recipient/endpoint/payment-address substitution;
- amount/transaction/claim mutation;
- grant unioning;
- expiry/revocation;
- replay;
- delegation depth/child identity;
- unauthorized Agent Instance;
- stale/revoked binding and missing trust;
- disclosure escalation;
- unsupported downgrade;
- semantic constraint loss;
- aggregate concurrency races;
- indeterminate retry;
- memory/source laundering;
- Personal-State-to-authority escalation;
- protected-value leakage through Agent surfaces, errors, receipts, logs, telemetry, and applicable browser/runtime surfaces;
- false adapter-native-enforcement claims;
- recovery/revocation behavior;
- portability import trust escalation.

---

# 19. Durable State, Coordination, Portability, Recovery

State classes include:

- Personal State;
- Security Configuration (Hard Policy, Standing Grants, TrustRelations, bindings);
- Usage/Reservation Ledger;
- Audit;
- Protected Resource Catalog.

One generic merge/consistency model MUST NOT be used for all classes.

Security-state conflict fails closed. Personal State may preserve concurrent contextual evidence where provenance permits.

PTF MUST define a versioned Portable State Package for supported state. Imported trust/bindings are revalidated; imported declarations do not establish trust.

Non-exportable resources MAY require re-enrolment/reissuance/provider recovery.

Account recovery MUST NOT violate the custody/TCB claims of the configured profile.

---

# 20. Developer Architecture

Distinct trust-level seams are required for:

- Agent Gateway;
- Trusted Surface;
- Authority Runtime;
- Personal State / Safe View;
- Protected Executor;
- Protocol Adapter;
- Recipient / Verifier integration;
- Principal/administrative controls;
- Audit / conformance tooling.

Exact programming interfaces are deferred.

### Agent Gateway

Conceptually supports Safe View, Action Request, safe status, and safe PTFReceipt/result. It MUST NOT expose authority administration, trust administration, approval recording, Hard Policy mutation, or generic protected-resource extraction.

### Recipient / Verifier

Should make recipient authentication, transaction/recipient binding, expiry, and required evidence verification straightforward without importing unrelated PTF internals.

### Developer Tooling

Reference project SHOULD include simulator, synthetic identities/resources, policy/grant/Safe View/ExecutionPlan/Enforcement Map inspectors, protocol fixtures, conformance runner, leak fixtures, and examples.

---

# 21. Trusted Surface / Reference Product

A reference user surface is architectural, not decorative.

It MUST support:

- Exact Human Approval;
- Standing Grant and Hard Policy management;
- Personal State review/correction/erasure controls;
- Protected Resource visibility/status;
- identity/device/trust management;
- receipts/activity;
- recovery/export.

The UX MUST distinguish approve once, create/modify standing authority, deny once, suspend, and revoke.

Approval/grant creation renders canonical deterministic terms. Explanations derive from structured evidence, not speculative LLM rationale.

---

# 22. Open Source, Governance, and Standards

PTF is expected to be open source unless a future explicit product decision changes that assumption.

The project distinguishes:

- **PTF Specification** — normative semantics/invariants/conformance;
- **PTF Reference Implementation** — one implementation.

PTF SHOULD NOT call itself an external industry standard until genuine independent governance/adoption warrants the term.

Standards strategy:

1. adopt existing standards where suitable;
2. integrate through adapters;
3. contribute upstream where a problem belongs upstream;
4. add PTF-specific extensions only for genuine remaining cross-protocol gaps.

Unknown security-sensitive extension semantics fail closed.

Genuine authorship/provenance SHOULD be preserved through Git history, AUTHORS, specification/architecture docs, ADRs, dated releases, governance docs, design papers, and standards contributions.

Initial governance MAY be maintainer-led and decentralize with real participation.

---

# 23. Security Engineering and Supply Chain

PTF maintains a living threat model including compromised/prompt-injected Agent/model, malicious external content/memory poisoning, malicious recipient, defective/malicious adapter, compromised Executor/device, operator/admin abuse, stolen artifacts, replay/substitution, concurrency, rollback/state fork, recovery abuse, log leakage, and supply-chain compromise.

Verification SHOULD include public-seam behavior tests, state-machine/property tests, concurrency, fuzzing, protocol interoperability, leak canaries, negative authorization, red-team scenarios, recovery/revocation, and migration tests.

Observability MUST be allowlisted/privacy-minimized by design.

The release process SHOULD mature toward dependency controls, secret/vulnerability scanning, SBOM, signed artifacts, build provenance, reproducibility where practical, protected release workflow, and vulnerability disclosure/response.

Automated/self-improving development MAY propose changes but cannot bypass review/conformance/security release gates.

---

# 24. Versioning and Migration

Persisted security-relevant objects carry explicit semantic/schema versions appropriate to their type.

Security-sensitive migration never silently broadens authority/trust. Ambiguity requires explicit review/reapproval or fails closed.

Protocol compatibility is tested against explicit protocol versions/profiles; dependency upgrades alone do not establish compatibility.

Major irreversible/surprising trade-offs are documented as ADRs.

---

# 25. Repository Rewrite Strategy

The canonical repository remains `Binilts03/personal-trust-fabric`.

Before any rewrite changes `main`:

1. create `legacy/webmcp-sandbox` pointing to the final pre-rewrite synthetic milestone commit;
2. create immutable tag `webmcp-sandbox-v0.1` pointing to that same commit;
3. preserve this specification branch and its architecture artifacts.

After those preservation steps, `main` becomes a clean implementation of this specification.

Existing code has **no grandfathered status**. Concepts or code are reused only if independently justified by the new architecture and verified by the new tests.

Useful sandbox ideas — safe-view filtering, term fingerprinting, provenance, leakage canaries, recipient-substitution denial, one-use behavior — may inform the rewrite but old interfaces/module boundaries are non-normative.

Initial repository shape SHOULD remain a monorepo while core/adapters/conformance evolve together. Exact build/package tooling is deferred.

The rewrite MUST become self-contained: canonical architecture/specification/security documents may not depend on an untracked external handoff directory.

---

# 26. Highest-Level Test Seams

Tests SHOULD exercise stable public seams rather than internal helper functions:

1. Agent Gateway → authority/planning/result;
2. Trusted Surface → canonical plan/grant approval;
3. Protected Executor → reject/prepare/execute/reconcile;
4. Recipient/Verifier → authenticated binding/evidence verification;
5. Portable State → export/import/revalidation;
6. Conformance → end-to-end adversarial behaviors.

Internal implementations remain refactorable as long as these semantics hold.

---

# 27. Foundational Rewrite Acceptance Criteria

The architecture-led rewrite is not successful merely because a demo works. Before the foundational runtime is called complete, it MUST demonstrate:

1. structural Personal State / Authority separation;
2. Safe View cannot manufacture authority;
3. distinct Standing Grant / Exact Human Approval flows;
4. authenticated canonical Standing Grant creation;
5. authenticated Hard Policy mutation outside Agent surfaces;
6. plan-bound Execution Grants and mutation rejection;
7. no grant unioning;
8. atomic aggregate reservation under concurrency;
9. real recipient-binding evidence rather than caller booleans;
10. ProtectedResourceRef alone cannot exercise a resource;
11. at least one protected execution path keeps reusable secret/key material outside Agent process;
12. complete Enforcement Map / no silent constraint loss;
13. unsupported mandatory constraints fail closed;
14. AP2 + x402 concrete integrations before common adapter API freeze;
15. OpenID4VP (or equally distinct credential-presentation integration) proving cross-domain generality;
16. Evidence Artifacts remain distinct from PTF authority records;
17. indeterminate outcomes cannot be blindly retried;
18. PTFReceipt explains basis/plan/enforcement/executor/outcome without protected-value leakage;
19. source-laundering/memory-poisoning cannot create authority/trust;
20. execution-time revocation/expiry/policy/trust revalidation;
21. portability import cannot self-declare trust;
22. recovery behavior does not violate declared custody/TCB;
23. leak-canary coverage of Agent surfaces, receipts, errors, normal telemetry/logs, and profile-relevant browser/runtime surfaces;
24. adversarial recipient/replay/mutation/disclosure/authority/concurrency/downgrade tests;
25. truthful per-profile assurance documentation;
26. self-contained repository source of truth;
27. milestone progress remains traceable to this full specification rather than redefining product scope.

---

# 28. Deferred Implementation Decisions

The architecture deliberately defers:

- implementation language/runtime;
- persistence/database and exact schemas;
- aggregate reservation transaction/coordinator technology;
- policy DSL/representation;
- canonical wire serialization/hashing formats;
- exact key hierarchy/wrapping;
- exact Principal/Agent authentication profiles;
- Trust Registry persistence/distribution;
- Protected Executor IPC/RPC;
- local/customer/hosted deployment orchestration;
- confidential-computing provider/implementation, if any;
- audit cryptographic checkpoint/witness mechanism;
- UI framework/design system;
- monorepo build/package toolchain;
- common adapter API until AP2+x402 evidence exists;
- recipient/verifier SDK API;
- detailed governance mechanics;
- SaaS/enterprise pricing/packaging.

Implementation agents MUST document evidence/decision rationale for these rather than infer precedent from the old sandbox.

---

# 29. Accepted ADR Set

The architecture branch records these accepted decisions:

- ADR 0001 — Dual-Source Authority and Personal-State Separation
- ADR 0002 — Plan-Bound Execution and Enforcement Map
- ADR 0003 — Local Subjects with Validated External Identity Bindings
- ADR 0004 — Plural Custody and Protected Executors
- ADR 0005 — External Protocols Are Adapters, Not the PTF Authority Model
- ADR 0006 — Preserve Repository History, Rewrite the Implementation

---

# 30. Review and Transition Gate

This specification has completed internal placeholder, consistency, ambiguity, and scope review.

No implementation planning or code rewrite begins until the human reviews and approves this canonical specification.

After human approval, the next workflow is **Superpowers writing-plans**: decompose the rewrite into implementation workstreams, research gates, tests, integration order, and verification checkpoints. Implementation is executed from that written plan rather than directly from conversational history.
