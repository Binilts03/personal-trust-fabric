# Personal Trust Fabric v1 — Proposed Specification

Status: **PROPOSED — awaiting explicit human approval**  
Date: 2026-09-03  
Repository: `Binilts03/personal-trust-fabric`  
Review branch: `architecture/ptf-v1-spec`

This document is the sole normative **proposed** specification for PTF v1. Committing it does not make it approved. The architecture, ADRs, implementation plan, and rewrite remain proposed until the human explicitly approves this document.

`CONTEXT-MAP.md` is a non-normative terminology glossary. If it conflicts with this document, this document wins.

Normative words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** describe the behavior that an approved implementation would be required to provide. They do not imply that the behavior is implemented today.

---

## 1. Product definition

Personal Trust Fabric (PTF) is an open, user-controlled delegated-authority runtime for AI agents.

PTF lets a Principal deliberately define authority, lets an authenticated Agent propose a concrete action, deterministically evaluates whether that action may proceed, constructs a minimum-disclosure execution route, obtains exact human approval when required, issues narrow execution authority, and performs the action through protected execution and existing external protocols without unnecessarily giving the Agent the underlying credential, private key, payment instrument, reusable token, secret, or complete private context.

Agentic commerce is PTF's first proving ground, not its architectural boundary.

Core thesis:

> Give AI agents the authority to act for users without unnecessarily giving them the underlying protected assets or unrestricted future authority.

Privacy thesis:

> Give an Agent enough personal context to be useful without making the model the canonical store of the Principal's life.

---

## 2. Scope discipline

This proposed specification defines the full PTF product boundary.

Implementation MAY later be delivered through milestones, but a milestone MUST NOT redefine the product as that milestone. AP2, x402, OpenID4VP, WebMCP, MCP, A2A, a payment demo, a credential demo, a Trusted Surface, or a synthetic sandbox is never the whole product.

Any future implementation plan MUST preserve traceability from each milestone to this full specification.

---

## 3. Explicit non-goals

PTF v1 does not attempt to:

- replace AP2, UCP, x402, OpenID4VP, Digital Credentials, FIDO, OAuth, MCP, WebMCP, A2A, wallets, payment rails, credential issuers, or identity providers;
- create one global human identity system or Agent PKI;
- create global reputation scores for Agents, merchants, issuers, or providers;
- implement catalog, cart, fulfilment, settlement-network, or card-network semantics already owned by external protocols;
- require central PTF plaintext custody of all protected resources;
- equate storage encryption with operator non-possession;
- guarantee cryptographic privacy modes unsupported by the selected provider/protocol;
- expose generic Agent-facing secret/private-key extraction;
- infer spending, signing, trust, or disclosure authority from repeated behavior;
- let LLM judgment replace deterministic authorization, trust evaluation, or attenuation checking;
- event-source every personal datum forever;
- synchronize every key or credential across every device;
- require confidential computing universally;
- freeze implementation language, database, cloud, UI framework, policy DSL, message bus, cryptographic library, KMS/HSM/TEE vendor, or universal protocol-adapter API at specification stage;
- preserve synthetic sandbox code solely because it already exists.

---

## 4. Normative bounded contexts

The implementation MUST preserve the semantic separation of:

1. Personal State;
2. Identity and Trust;
3. Authority;
4. Planning;
5. Protected Execution;
6. Protocol Integration;
7. Audit and Conformance.

Cross-cutting areas are Trusted Surface, Portability/Sync/Revocation/Recovery, Developer Platform, Security/Operations, and Governance/Versioning.

There is no automatic Personal-State-to-Authority transition.

---

## 5. Global authority invariants

1. Knowledge is not authority.
2. Personalization is not authorization.
3. Hard Policy constrains authority but never creates or expands it.
4. Authority originates only from a deliberate Standing Grant or Exact Human Approval.
5. Repeated behavior, repeated approvals, high model confidence, successful transactions, or Personal State changes MUST NOT create Standing Grant authority.
6. Separate Standing Grants MUST NOT be unioned to manufacture authority no single grant provides.
7. A one-time exception MUST NOT mutate a Standing Grant unless the Principal separately approves a grant amendment.
8. Standing Grants preserve immutable/versioned historical meaning.
9. Execution Grants are narrow, immutable, plan-bound, time/use bounded, and revocable while under PTF control.
10. Unknown attenuation semantics fail closed.
11. Further Agent delegation is disabled by default.
12. Current Hard Policy, grant state, identity/trust, resource state, revocation, expiry, reservation, and selected-plan state are revalidated before consequential commit.
13. Relaxing Hard Policy never broadens existing authority; tightening Hard Policy may block not-yet-committed execution.

### 5.1 Test oracle: Personal State cannot broaden authority

For a fixed Action Request and fixed authority-relevant state, a change limited to Personal State, inference, summarization, ranking strategy, or learned preference MUST NOT move the authorization result in the direction:

- `DENY -> APPROVAL_REQUIRED` solely because learning created implied authority;
- `DENY -> AUTHORIZE`;
- `APPROVAL_REQUIRED -> AUTHORIZE`.

It MUST NOT create or modify a Standing Grant, Exact Human Approval, Hard Policy, TrustRelation, IdentityBinding, or Execution Grant.

A conformance test implements this as a metamorphic comparison: hold all authority-relevant inputs constant, mutate only Personal State/learning, and verify that the permitted-action relation is unchanged or more restrictive, never broader.

### 5.2 Test oracle: self-improving implementation cannot silently broaden authority

A release that changes learned strategies, model prompts, planners, or self-improving code MUST replay a locked authorization regression corpus. Any scenario changing from `DENY` or `APPROVAL_REQUIRED` to `AUTHORIZE` is a security-significant behavior change and MUST fail the release gate unless it is explained by an explicit human-approved specification/policy change with updated tests.

This oracle is the measurable meaning of “self-improvement cannot silently expand authority.”

---

## 6. Personal State

Canonical concepts are Observation, Claim, Preference, Derived Context, Handling Class, ContextView, AuthorityView, and Safe View.

### 6.1 Provenance

Every durable Observation, Claim, and Preference MUST preserve enough provenance to identify source class, source identity where applicable, observation/assertion time, derivation lineage, scope/context, sensitivity/handling, correction/supersession history, and freshness/revalidation semantics where relevant.

Transformation, model inference, summarization, tool echo, or compaction MUST NOT upgrade source authority.

### 6.2 Claims and verification

A Claim MAY be asserted, verified, inferred, disputed, stale, superseded, unknown, or revoked according to its domain.

`Verified` means validated through a source/mechanism accepted for that Claim type. It never means “the model is confident.”

### 6.3 Freshness policy

Every Claim type used for consequential decisions MUST declare one deterministic Freshness Policy:

- **STATIC** — time alone does not make the Claim stale; supersession/revocation still applies;
- **VALID_UNTIL** — Claim is current only through an explicit validity end;
- **MAX_AGE** — Claim is current only if the accepted verification is no older than a configured duration;
- **STATUS_CHECK** — use requires a fresh status/revocation/provider check under the applicable profile.

At evaluation time the result is at least `CURRENT`, `STALE`, `UNKNOWN`, or `REVOKED`.

A `STALE`, `UNKNOWN`, or `REVOKED` Claim MUST NOT satisfy a requirement that explicitly needs a current verified Claim.

Preferences MAY additionally have `review_after` semantics. A stale Preference MAY still support low-risk reversible recommendation if clearly labelled stale/inferred, but it cannot satisfy an authority, trust, identity, or disclosure predicate.

### 6.4 Contradictions and correction

Material contradictions MUST be resolved only by explicit human correction, deterministic source/domain precedence, coexistence under separate contexts, or a disputed/withheld state. LLM guesswork is not a resolution rule.

Correction and erasure are separate operations.

### 6.5 Safe View

Safe View is ephemeral and task-specific. ContextView and AuthorityView are independently derived and typed.

AuthorityView MUST be derived from Authority state, never inferred from Personal State.

---

## 7. Identity, authentication, trust, and pseudonymity

Identity, authentication, trust, and authorization are separate concerns.

PTF uses local Subjects for reasoning. A Subject ID is metadata and has no external authentication meaning.

External identity and endpoint equivalence require validated IdentityBindings and EndpointBindings. Human-readable names never establish identity.

TrustRelations are role-, purpose-, and function-specific. A global `trusted=true` or reputation number is insufficient.

### 7.1 Pseudonymous Principal vs authentication

A Principal MAY be pseudonymous. Pseudonymity concerns whether PTF needs to know or expose the Principal's legal/civil identity.

Authentication concerns proving current control of the Principal's accepted authentication credential/session.

Therefore a pseudonymous Principal can satisfy strong user verification without revealing legal identity. A high-value Standing Grant may require a fresh cryptographic user-verification ceremony tied to Principal `P123` even if PTF has no legal name for `P123`.

No specification rule equates “user verified” with “legally identified.”

### 7.2 Agent identity

Agent is the logical delegated actor. Agent Instance, model, provider, runtime, and session remain separate.

Standing authority binds an authenticated Agent Subject, not a caller-provided label.

### 7.3 Trust Registry decision shape

PTF v1 uses a **deployment-authoritative Trust Registry** rather than an unspecified distributed trust database.

Normative properties:

- one authoritative trust state exists per deployment/security domain;
- each security-relevant mutation increments a monotonic registry epoch/version;
- authorization/execution records the trust-registry epoch used for the decision;
- read replicas/caches MAY exist, but a profile MUST define maximum acceptable staleness;
- a security decision using a replica older than the allowed staleness MUST fail closed or reach the authoritative registry;
- imports and labels cannot create TrustRelations without revalidation;
- federation/global distribution is deferred until a concrete interoperability requirement exists.

Exact persistence/distribution technology remains deferred.

---

## 8. Authority sources and control

PTF recognizes exactly two authority sources:

- **Standing Grant** — deliberate continuing delegation;
- **Exact Human Approval** — deliberate authority for one exact selected plan.

Hard Policy is a ceiling, not an authority source.

### 8.1 Standing Grant lifecycle

`PROPOSED` is not authority. A grant becomes `ACTIVE` only after canonical grant terms are deterministically validated, rendered on a Trusted Surface, and deliberately authenticated/approved by the Principal according to the applicable Approval Assurance Profile.

Lifecycle states are conceptually `PROPOSED`, `ACTIVE`, `SUSPENDED`, `REVOKED`, `EXPIRED`, and `SUPERSEDED`.

Broadening operation, resource, recipient set, purpose, amount, validity, uses, disclosure, or delegation requires a new deliberate grant authorization/version.

### 8.2 Hard Policy mutation

Hard Policy changes MUST occur through authenticated Principal/authorized-administrator control, never through the Agent Gateway.

Policy relaxations MUST NOT broaden existing grants. Policy tightening may immediately constrain not-yet-committed actions.

### 8.3 No-broadening rule

Where a constraint has deterministic semantics, child/execution authority MUST be contained by its source authority for operation, resource, recipient, purpose, amount/currency, aggregate limit, validity, use count, disclosure permission, delegation depth/scope, and required assurance as applicable.

Subjective natural-language preferences are not authoritative constraints unless converted through an explicitly defined deterministic policy mechanism and deliberately approved as such.

### 8.4 No grant union

One Standing Grant MUST independently cover an autonomous action. If multiple grants independently cover it, PTF chooses an explicit authority basis and accounts usage against that basis.

---

## 9. Approval Assurance Profiles and Trusted Surface

A Trusted Surface is a deterministic approval boundary rendering canonical grant/ExecutionPlan terms and capturing Principal authorization bound to those exact terms.

The Agent MAY explain a proposed action, but Agent-authored prose is never the authoritative approval object.

### 9.1 Approval Assurance Profile

Every Standing Grant creation/amendment and Exact Human Approval is associated with one of these semantic profiles:

- **AA0 — Authenticated Session:** an authenticated Principal session exists; no new presence/verification ceremony. Allowed only where Hard Policy explicitly permits low assurance.
- **AA1 — Fresh User Presence:** a fresh interaction/challenge demonstrates user presence and is bound to the canonical terms/fingerprint.
- **AA2 — Fresh User Verification:** fresh user verification distinguishes the Principal/controller and is bound to the canonical terms/fingerprint.
- **AA3 — Elevated External Assurance:** AA2 plus additional policy-required properties such as enterprise authentication, hardware-backed authentication, wallet ceremony, or attested trusted application.

Hard Policy selects the minimum profile for an action/grant. “Fresh” means a new approval-specific challenge or a previously verified context still within a policy-defined maximum age and bound against replay/substitution.

The exact authentication technology is deployment-specific; the required observable properties are not.

### 9.2 Trusted Surface conformance oracle

Mutation of any approval-relevant term after the Principal saw/authorized it MUST invalidate the approval. Tests mutate recipient, amount, disclosure, resource, protocol route, downgrade, expiry, and transaction binding and expect re-resolution/reapproval.

---

## 10. Planning, DisclosurePlan, ExecutionPlan

Planning occurs before final Exact Human Approval when approval is required.

DisclosurePlan identifies recipient, purpose, Protected Resource source, requested/permitted information, selected representation, channel constraints, Agent/model visibility, known downstream visibility, assurance properties, and downgrade status.

After correctness and required assurance, preferred representation is:

1. no disclosure;
2. predicate/proof;
3. derived attribute;
4. selective claims;
5. opaque/encrypted presentation;
6. direct protected delivery;
7. raw plaintext.

This is preference, not a promise that every protocol supports every representation.

ExecutionPlan captures all approval/security-relevant semantics, including authority basis, identities/bindings, resource refs, DisclosurePlan, Protected Executor/profile, protocol operation, transaction binding, Enforcement Map, reservation requirements, replay/idempotency behavior, expected evidence/results, failure/reconciliation semantics, expiry, Assurance Manifest, and deterministic plan fingerprint.

Material mutation invalidates approval/grant.

---

## 11. Enforcement Map and semantic preservation

Every authority-relevant constraint maps to one or more of:

- `PTF`;
- `PROTOCOL`;
- `EXECUTOR`;
- `RECIPIENT`;
- `COMPOSITE`;
- `UNENFORCEABLE`.

A mandatory `UNENFORCEABLE` constraint invalidates the candidate unless a specifically described downgrade is Hard-Policy-permitted and approved at the required assurance level.

Evidence that a constraint was asserted is distinct from enforcement of that constraint.

### 11.1 Semantic-loss oracle

For each selected ExecutionPlan, enumerate source authority constraints. The conformance oracle requires a total mapping: every source constraint must appear in the Enforcement Map with a non-empty enforcement assignment or an explicit `UNENFORCEABLE` downgrade path. Deleting a mapped constraint from an adapter/planner output must fail the plan/conformance test.

---

## 12. Coordination Profiles and atomic aggregate authority

Aggregate limits require a defined coordination profile. PTF MUST NOT merely say “atomic” without identifying the consistency boundary.

### 12.1 CP1 — Single-Authority Runtime

One authoritative runtime/ledger serializes reservations and usage for the grant. Suitable for local/single-writer operation.

### 12.2 CP2 — Shared Transactional Authority

Multiple Agents/runtimes share aggregate authority. The authoritative coordination mechanism MUST provide an atomic conditional transaction (or equivalent serializable primitive) over at least:

- grant/version validity;
- committed usage;
- outstanding reservations;
- requested reservation;
- issuance/activation of the corresponding usable Execution Grant.

If the transaction loses a race, the losing request receives no usable Execution Grant.

The reference implementation MUST use CP1 or CP2 for aggregate authority. Exact database/coordinator technology is deferred.

### 12.3 CP3 — Disconnected/Partitioned

A disconnected replica MUST NOT independently spend from shared aggregate authority unless it previously received a deliberately bounded pre-allocation/subgrant that cannot cause global oversubscription.

Pre-allocation design is optional/deferred; absent it, shared aggregate authority is unavailable while disconnected.

### 12.4 Concurrency oracle

Given remaining capacity `R`, concurrently submit requests whose sum exceeds `R`. Across repeated race schedules, committed plus outstanding reserved capacity MUST never exceed the configured limit.

---

## 13. Protected Resources, custody, and use-over-extraction

Protected Resource is logical and does not imply PTF plaintext custody.

ProtectedResourceRef is metadata/reference only and MUST NOT behave as bearer authority.

Protected Executors expose bounded operations such as sign, authenticate, prove, present, authorize-payment, disclose-approved-claims, or execute bounded account action. Generic Agent-facing private-key/secret extraction is prohibited by default.

Supported custody categories are external/provider-brokered, Principal-device/local, customer-controlled runtime, managed PTF runtime, and attested-confidential runtime. These are not a one-dimensional score.

### 13.1 Assurance Manifest — normative semantic format

Every selected ExecutionPlan and PTFReceipt MUST carry an Assurance Manifest with at least these semantic fields:

- `profile_id` and profile version;
- control-runtime operator/administrative domain;
- protected-executor operator/administrative domain;
- parties/processes able to observe protected plaintext;
- parties/processes able to invoke usable key/resource authority;
- Agent/model visibility of protected value/artifact;
- recipient disclosure actually delivered;
- key/resource exportability properties;
- recipient-authentication properties;
- Principal-approval assurance profile;
- remote-attestation status/properties where used;
- Evidence Artifact custody mode: local-only, direct-delivery, constrained-carried, or bearer-like;
- recovery parties/capabilities;
- audit-integrity profile;
- explicit residual risks/downgrades.

Exact wire serialization is deferred; these semantics are not.

### 13.2 TCB oracle

For each custody profile fixture, leak-canary tests MUST verify the declared negative visibility claims on controllable surfaces. A profile may only claim “Agent cannot see value,” “control plane cannot see plaintext,” etc. where the test harness can observe the relevant boundary. Untestable operator/hardware assumptions are listed as assumptions/residual risk rather than claimed as proven.

---

## 14. Identity, recipient binding, and key continuity

Execution binds the actual authenticated recipient/endpoint required by the selected route, not a string label.

Payment address, web origin, merchant identity, verifier identity, account, public key, and protocol identifier remain distinct until validated bindings connect them.

Key/binding rotation requires accepted continuity evidence. A new key plus the statement “I am the same merchant/Agent” is insufficient.

Issuer trust is Claim-/credential-type-specific.

Agent-to-Agent delegation is disabled by default; when enabled the child Agent must be independently authenticated, no broader than the parent, depth-limited, and provenance-preserving.

---

## 15. Protocol Integration

Protocol Adapters MAY:

- interpret external requirements into PTF Action Request inputs;
- report protocol-native enforcement properties;
- translate an already-authorized ExecutionPlan into protocol artifacts/requests;
- verify protocol results.

Adapters MUST NOT create authority, create trust from labels, mutate Hard Policy, decide Personal State source authority, read arbitrary Protected Resources, broaden scope, or silently drop constraints.

Evidence Artifacts remain protocol-specific and are not canonical PTF authority records.

A universal adapter programming interface MUST NOT be frozen until concrete AP2 and x402 integrations demonstrate a genuine common seam. OpenID4VP is the third materially different proving integration.

---

## 16. Initial protocol proving program

### 16.1 AP2

Tests continuing delegated authority, transaction-specific narrowing, Trusted Surface relationship, Agent proof-of-possession/signing custody where applicable, selective disclosure of relevant authority constraints, merchant/verifier binding, and receipt reconciliation.

### 16.2 x402

Tests payment requirement -> Action Request conversion, payee/payment-endpoint binding, aggregate budget reservation, protected wallet execution without Agent private-key possession, amount/recipient/validity/replay enforcement split, and settlement/indeterminate reconciliation.

### 16.3 OpenID4VP

Tests verifier binding, requested-claim minimization, nonce/transaction binding, brokered credential presentation without unnecessary PTF credential copying, disclosure representation choice, and verification outcome.

If these three force protocol-specific concepts into canonical authority semantics, the architecture is revisited instead of creating a larger speculative abstraction.

---

## 17. Execution lifecycle and ambiguous outcomes

Conceptual lifecycle:

1. authenticate Agent/Agent Instance;
2. derive Safe View;
3. receive Action Request;
4. resolve identity/trust/resource/executor state;
5. evaluate invariants, Hard Policy, Standing Grant, usage/reservations, revocation/expiry;
6. build candidate plans and Enforcement Maps;
7. select an enforceable route and explicit downgrade if any;
8. obtain Exact Human Approval when required;
9. atomically reserve aggregate authority and issue the usable Execution Grant where applicable;
10. revalidate immediately before commit;
11. Protected Executor validates required grant/plan properties and prepares transient material;
12. commit external effect;
13. reconcile as `CONSUMED`, `RELEASED_NO_EFFECT`, or `INDETERMINATE`;
14. commit/release/hold reservation consistently;
15. emit AuditEvents/PTFReceipt and safe External Receipt references.

Consequential execution MUST NOT be automatically retried after `INDETERMINATE`. Retry requires proof of no effect or strong idempotency for the identical action.

---

## 18. Audit Integrity Profiles and receipts

AuditEvent is privacy-minimized lifecycle evidence. PTFReceipt explains authority basis, Agent/delegation provenance, action/recipient, plan fingerprint, Enforcement Map, Protected Executor/profile, protocol, safe external evidence references, result, aggregate accounting result, Assurance Manifest, downgrade/residual risk, and timestamps.

Protected resource plaintext, private keys, payment credentials, raw identity documents, and full model context are excluded by default.

### 18.1 AI0 — Local Tamper-Evident Audit

Baseline reference profile:

- durable append-oriented audit records;
- cryptographic link/commitment over ordered records or batches;
- periodic checkpoint signed by a deployment audit key;
- verification tool capable of detecting modification, deletion/reordering within the committed history represented by checkpoints;
- residual risk explicitly states that an attacker controlling the deployment audit key and storage may forge future/reconstructed local history.

Exact storage/cryptographic format is deferred.

### 18.2 AI1 — Externally Witnessed Audit

AI0 plus periodic privacy-safe checkpoint commitments submitted to an independent witness/transparency mechanism. The witness receives only commitments/metadata required by the chosen mechanism, not private transaction contents.

Exact witness provider/protocol is deferred until a deployment requires AI1.

The spec therefore does not mandate an unspecified witness for every deployment; it mandates an explicit audit-integrity profile and truthful residual-risk statement.

---

## 19. Conformance Oracles and suite status

No executable PTF v1 conformance suite exists yet. Therefore this branch MUST NOT claim “PTF Conformant.”

The implementation may claim conformance only after an executable, versioned suite exists and passes the mandatory oracles for the declared profile.

Each oracle has:

- oracle ID/version;
- preconditions/profile;
- initial security state;
- stimulus/mutation/attack;
- expected deterministic property/outcome;
- observable public seam;
- evidence produced by the test.

Mandatory oracle classes for the first foundational suite:

- `AUTH-PERSONAL-STATE-NO-BROADEN` — Personal State/learning cannot broaden authority;
- `AUTH-NO-GRANT-UNION`;
- `AUTH-EXCEPTION-NO-GRANT-MUTATION`;
- `AUTH-PLAN-MUTATION-REAPPROVAL`;
- `AUTH-REVOCATION-RECHECK`;
- `AUTH-DELEGATION-ATTENUATION`;
- `COORD-AGGREGATE-RACE`;
- `ID-RECIPIENT-SUBSTITUTION`;
- `ID-ENDPOINT-PAYMENT-SUBSTITUTION`;
- `ID-STALE-BINDING`;
- `TRUST-MISSING-RELATION`;
- `DISCLOSURE-ESCALATION`;
- `PLAN-SEMANTIC-LOSS`;
- `PLAN-DOWNGRADE-POLICY`;
- `EXEC-REPLAY`;
- `EXEC-INDETERMINATE-NO-BLIND-RETRY`;
- `RESOURCE-REF-NOT-AUTHORITY`;
- `LEAK-AGENT-SURFACES`;
- `LEAK-LOG-RECEIPT-ERROR-TELEMETRY`;
- `MEMORY-SOURCE-LAUNDERING`;
- `MIGRATION-NO-SILENT-BROADENING`;
- `PORTABILITY-IMPORT-NO-TRUST-ESCALATION`;
- `RECOVERY-TCB-NO-BROADENING`.

Protocol adapters add protocol-specific oracles but cannot waive these core classes.

---

## 20. Durable state and coordination

At minimum, PTF distinguishes:

- Personal State;
- Security Configuration (Hard Policy, Standing Grants, TrustRelations, bindings);
- Usage/Reservation Ledger;
- Audit;
- Protected Resource Catalog.

One merge/consistency strategy MUST NOT be used for all classes.

Security-sensitive conflict fails closed. Personal State may preserve concurrent contextual evidence where provenance permits.

---

## 21. Portability, sync, revocation, recovery

PTF MUST define a versioned Portable State Package for supported Personal State, policies, Standing Grants, trust metadata, resource references, and selected receipts/audit.

Imported trust/bindings MUST be revalidated; the package cannot self-declare a new trusted recipient/issuer/Agent.

Non-exportable resources MAY require re-enrolment, reissuance, or provider recovery.

Recovery MUST NOT introduce plaintext access broader than the declared custody/Assurance Manifest. Restoring Principal/state continuity does not imply restoring every private key or credential bit-for-bit.

---

## 22. Developer and trust-level seams

Distinct trust-level seams are required for:

- Agent Gateway;
- Trusted Surface;
- Authority Runtime;
- Personal State/Safe View;
- Protected Executor;
- Protocol Adapter;
- Recipient/Verifier integration;
- Principal/administrative controls;
- Audit/conformance tooling.

The Agent Gateway conceptually exposes Safe View, Action Request, safe status, and safe result/PTFReceipt. It MUST NOT expose authority administration, trust administration, approval recording, Hard Policy mutation, or generic protected-resource extraction.

Exact programming interfaces are deferred until implementation design.

---

## 23. Trusted Surface / reference product

A reference user surface is architectural, not decorative. It must support:

- Exact Human Approval;
- Standing Grant and Hard Policy management;
- Personal State review/correction/erasure;
- Protected Resource status;
- identity/device/trust management;
- receipts/activity;
- recovery/export.

The UX distinguishes approve once, create/modify standing authority, deny once, suspend, and revoke.

Explanations derive from structured policy/grant/identity/Enforcement Map/receipt evidence, not speculative LLM rationale.

---

## 24. Security engineering and observability

PTF maintains a living threat model covering compromised/prompt-injected Agent/model, malicious external content/memory poisoning, malicious recipient, malicious/defective adapter, compromised Protected Executor/device, operator/admin abuse, stolen artifacts, replay/substitution, concurrency, rollback/state fork, recovery abuse, telemetry leakage, and supply-chain compromise.

Observability is allowlisted/privacy-minimized by design rather than “log everything then redact.”

Release verification SHOULD include public-seam behavior tests, state-machine/property tests, concurrency, fuzzing, protocol interoperability, leak canaries, negative authorization, red-team scenarios, recovery/revocation, and migration tests.

Automated/self-improving development may propose changes but cannot bypass review, conformance, security tests, or release gates.

---

## 25. Open source, governance, and standards strategy

The default proposal is open source.

PTF distinguishes the PTF Specification from the PTF Reference Implementation. PTF SHOULD NOT market itself as an external industry standard until genuine independent governance/adoption warrants that term.

Standards strategy is: adopt existing standards where suitable, integrate through adapters, contribute upstream where a problem belongs upstream, and add PTF-specific extensions only for genuine cross-protocol gaps.

Unknown security-sensitive extension semantics fail closed.

Project provenance should be preserved through public Git history, AUTHORS, proposed/accepted ADR history, dated releases, governance docs, design papers, and standards contributions.

---

## 26. Repository preservation and rewrite gate

The canonical repository remains `Binilts03/personal-trust-fabric`.

Current preservation state:

- `legacy/webmcp-sandbox` MUST point to the final pre-rewrite synthetic milestone. This branch has been created.
- immutable tag `webmcp-sandbox-v0.1` MUST point to the same commit before any rewrite of `main`.
- this proposed-spec branch MUST remain documentation-only.

The tag is a hard pre-rewrite gate. If tooling used for planning/implementation cannot verify that the tag exists and resolves to the same commit as the legacy branch, it MUST stop before modifying `main`.

After human approval and repository-preservation verification, `main` may be rebuilt cleanly from this specification. Existing source has no grandfathered status; code is reused only if independently justified by the proposed/approved architecture and new tests.

---

## 27. User stories

The implementation plan MUST preserve traceability to these externally meaningful stories.

1. As a Principal, I want to approve one exact consequential plan without granting broader future authority.
2. As a Principal, I want to create a deliberately scoped Standing Grant.
3. As a Principal, I want approve-once and create-standing-authority to be distinct actions.
4. As a Principal, I want to deny once without changing unrelated grants.
5. As a Principal, I want to suspend/resume/revoke Standing Grants distinctly.
6. As a Principal, I want grant broadening to require explicit new authorization.
7. As a Principal, I want one-time exceptions not to mutate normal authority.
8. As a Principal, I want aggregate committed/reserved/available authority visible.
9. As a Principal, I want claims of external-artifact revocation to match actual protocol capability.
10. As a Principal, I want canonical Standing Grant terms rendered before activation.
11. As a Principal/authorized administrator, I want Hard Policy mutation unavailable to Agents.
12. As an Agent, I want a minimized task Safe View.
13. As an Agent, I want to submit a concrete Action Request.
14. As an Agent, I want deterministic safe deny/approval/progress/result information.
15. As an Agent, I want resource/operation availability rather than protected values.
16. As an Agent, I want inferred preferences clearly distinguished from explicit preferences.
17. As an Agent, I want material plan mutation to require re-resolution.
18. As a Principal, I want Observations, Claims, and Preferences represented distinctly.
19. As a Principal, I want corrections to supersede while preserving explainable history.
20. As a Principal, I want material contradictions resolved without model guessing.
21. As a Principal, I want context scope and freshness semantics enforced.
22. As a Principal, I want erasure distinct from correction.
23. As a Principal, I want memory compaction to preserve source lineage.
24. As a Principal, I want low-risk inference useful for reversible decisions without creating authority.
25. As a Principal, I want actual Agents/recipients/executors authenticated rather than trusted by label.
26. As a Principal, I want one Subject to have multiple independently validated protocol bindings.
27. As a Principal, I want trust scoped to role/purpose/Claim type.
28. As a Principal, I want key/binding rotation to require continuity evidence.
29. As a Principal, I want logical Agent authority to survive model/provider changes only where deliberately intended.
30. As a Principal, I want high-value approval to require the configured fresh verification profile without requiring legal identification.
31. As a Recipient, I want evidence bound to my authenticated identity/endpoint.
32. As a Principal, I want the least-disclosing enforceable route.
33. As a Principal, I want final approval to show the actual selected route and downgrade.
34. As a Developer, I want every authority constraint mapped to enforcement.
35. As a Developer, I want mandatory unenforceable constraints to reject the route.
36. As a Principal, I want external wallets/providers to retain protected resources where appropriate.
37. As a Principal, I want device-, customer-, managed-, and optional attested-execution profiles with truthful TCB statements.
38. As an Agent, I want bounded protected operations instead of secret extraction.
39. As a Principal, I want direct protected delivery bound to authenticated recipient endpoints/keys.
40. As a Principal, I want browser/page plaintext identified as weaker assurance.
41. As a Principal, I want ambiguous effects reconciled before retry.
42. As a Principal, I want concurrency-safe aggregate authority.
43. As a Principal, I want a PTFReceipt explaining authority, plan, enforcement, executor, protocol, result, and assurance.
44. As an Auditor, I want privacy-safe forensic linkage without unrestricted secrets.
45. As a Principal, I want a versioned state export.
46. As a Principal, I want imported trust/bindings revalidated.
47. As a Principal, I want non-exportable resources re-enrolled/reissued rather than falsely copied.
48. As a Principal, I want recovery not to violate the custody profile.
49. As an Agent developer, I want a narrow Agent Gateway.
50. As a recipient/verifier developer, I want focused evidence-verification integration.
51. As an adapter developer, I want to translate authorized plans without becoming an authority engine.
52. As a developer, I want synthetic identities/resources and a local simulator.
53. As a developer, I want plan/grant/policy/Safe View/Enforcement Map inspection tools.
54. As a developer, I want executable, versioned adversarial conformance oracles.
55. As a developer, I want AP2+x402 implemented before a common adapter API is frozen.
56. As a developer, I want OpenID4VP to test credential/disclosure generality.
57. As a contributor, I want specification separated from implementation.
58. As a maintainer, I want privacy-safe telemetry, leak canaries, supply-chain provenance, and a threat model.
59. As a maintainer, I want unknown security-sensitive extensions/migrations to fail closed.
60. As a maintainer, I want self-improving changes unable to broaden authorization without an explicit reviewed specification/policy change.

---

## 28. Foundational acceptance gates

No implementation may be called foundational PTF v1 merely because a demonstration works. Before such a claim, the implementation must demonstrate at least:

1. Personal State/Authority structural separation;
2. executable `AUTH-PERSONAL-STATE-NO-BROADEN` oracle;
3. distinct Standing Grant / Exact Human Approval flows;
4. canonical authenticated Standing Grant creation;
5. authenticated Hard Policy mutation outside Agent surfaces;
6. plan-bound Execution Grants and mutation rejection;
7. no grant unioning;
8. CP1/CP2 aggregate-race safety;
9. real recipient-binding evidence rather than caller booleans;
10. ProtectedResourceRef alone cannot exercise a resource;
11. at least one Protected Executor keeps reusable secret/key material outside the Agent process;
12. Assurance Manifest generated for execution/receipt;
13. complete Enforcement Map/no silent constraint loss;
14. unsupported mandatory constraints fail closed;
15. AP2+x402 concrete integrations before common adapter API freeze;
16. OpenID4VP or equally distinct credential-presentation path;
17. Evidence Artifacts remain separate from PTF authority records;
18. `INDETERMINATE` cannot be blindly retried;
19. privacy-safe PTFReceipt;
20. memory/source-laundering cannot create authority/trust;
21. execution-time revocation/expiry/policy/trust revalidation;
22. Freshness Policy exercised for consequential Claim use;
23. Trust Registry epoch/staleness rules exercised;
24. portability import cannot self-declare trust;
25. recovery does not violate declared TCB;
26. leak-canary coverage for declared negative visibility properties;
27. executable mandatory conformance suite exists before any “PTF Conformant” claim;
28. repository source of truth is self-contained and documentation/code milestones cannot redefine full scope.

---

## 29. Deferred implementation choices with fixed decision shapes

The following technologies are deliberately deferred, but their decision shape is not open-ended:

- **Persistence/database:** must satisfy the selected state-class consistency and CP1/CP2 requirements; exact technology deferred.
- **Trusted Surface authentication:** implementation may choose passkeys, OS auth, enterprise auth, wallet auth, etc., but must satisfy AA0-AA3 observable properties selected by Hard Policy.
- **Trust Registry storage/distribution:** must implement the deployment-authoritative registry, monotonic epoch, and staleness/fail-closed semantics; technology deferred.
- **Audit witness:** must declare AI0 or AI1; AI1 witness provider/protocol deferred.
- **TCB disclosure serialization:** exact JSON/schema deferred, but Assurance Manifest semantic fields are mandatory.
- **Freshness storage:** representation deferred, but each consequential Claim type must choose STATIC/VALID_UNTIL/MAX_AGE/STATUS_CHECK semantics.
- **Atomic reservation coordinator:** technology deferred, but CP2 requires an atomic conditional/serializable authority transaction and CP3 cannot independently consume shared aggregate authority.
- **Key hierarchy:** exact cryptography deferred, but authentication, encryption/wrapping, operational signing, credential-holder, sync, recovery, and attestation roles remain distinct.
- **Protocol adapter API:** deferred until AP2+x402 reveal a real common seam.

Programming language/runtime, UI framework, build tool, cloud provider, KMS/HSM/TEE vendor, exact wire serialization, and commercial packaging remain implementation-planning decisions.

---

## 30. Proposed ADR set

The following ADRs remain **Proposed** until this specification is explicitly approved:

1. Dual-source authority and Personal-State separation.
2. Plan-bound execution and Enforcement Map.
3. Local Subjects with validated external identity bindings.
4. Plural custody and Protected Executors.
5. External protocols as adapters rather than canonical authority.
6. Preserve repository history while rebuilding implementation from the approved spec.

---

## 31. Human approval gate

This specification is **not approved**.

No Superpowers `writing-plans` workflow, implementation plan, or rewrite of `main` begins until the human explicitly approves this exact proposed specification (or a later revision).

Before a rewrite of `main`, tooling must additionally verify:

- `legacy/webmcp-sandbox` exists and resolves to the final pre-rewrite commit;
- immutable tag `webmcp-sandbox-v0.1` exists and resolves to that same commit;
- the proposed/approved specification branch remains available and self-contained.