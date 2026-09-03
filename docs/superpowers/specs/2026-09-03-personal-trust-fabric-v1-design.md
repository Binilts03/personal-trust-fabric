# Personal Trust Fabric v1 — Canonical Architecture Specification

Status: **Architecture Approved / Formal Specification Draft for Human Review**  
Date: 2026-09-03  
Repository: `Binilts03/personal-trust-fabric`  
Architecture branch: `architecture/ptf-v1-spec`

This document is the canonical specification produced from the approved PTF architecture discussions. It supersedes the synthetic WebMCP milestone as the source of product architecture. It is deliberately implementation-neutral: programming language, database, cloud, policy DSL, serialization, specific cryptographic libraries, specific KMS/HSM/TEE products, and final protocol adapter interfaces remain implementation-stage decisions.

The repository's current `main` is a historical synthetic WebMCP milestone. It is useful as evidence and prior art, but it is **not** the product architecture defined here.

---

# 1. Problem

AI agents increasingly need to take consequential actions for humans: purchase goods, pay for resources, present credentials, sign requests, authenticate, operate accounts, and use private personal context. Existing agent systems often solve this by giving the agent or its hosting infrastructure broad access to reusable credentials, tokens, keys, payment instruments, or large user profiles.

This creates several coupled problems:

- a model may receive more private information than is necessary for the task;
- a compromised or prompt-injected Agent may possess reusable authority;
- long-lived credentials may be copied into agent infrastructure that was never designed to custody them;
- user intent, authorization, identity, payment, and protocol execution become conflated;
- protocol adapters may silently lose constraints when translating between authorization and external execution;
- persistent memory may turn untrusted external content into apparent user truth;
- one successful approval may silently become broader future authority;
- recipient identity may be represented by an unverified string rather than an authenticated counterparty;
- logs and audit systems may become secondary stores of private information;
- agentic commerce stacks must repeatedly reinvent delegation, approval, budget, disclosure, revocation, and execution safety.

The foundational PTF question is therefore:

> How can an Agent exercise useful human authority while receiving only the information and execution power necessary for a specific task, without automatically possessing the underlying protected resource or unrestricted future authority?

---

# 2. Solution

Personal Trust Fabric (PTF) is an **open, user-controlled delegated-authority runtime for AI agents**.

PTF lets a Principal define deliberate authority, allows an authenticated Agent to propose a concrete Action Request, deterministically resolves whether the request is permitted, constructs an exact minimum-disclosure Execution Plan, obtains exact human approval where required, issues a narrow Execution Grant, and performs the action through a Protected Executor and existing external protocols.

PTF does not require the Agent to receive the underlying private key, payment instrument, credential, refresh token, passport data, or complete personal profile where a bounded operation can be performed instead.

Agentic commerce is PTF's **first proving ground**, not its architectural boundary.

PTF is designed to interoperate with emerging and established systems such as AP2, UCP, x402, OpenID4VP, Digital Credentials, OAuth, MCP, WebMCP, A2A, wallets, credential providers, payment providers, and platform identity mechanisms. These systems remain external protocols or providers; they do not define PTF's canonical authority model.

---

# 3. Product Thesis

The product thesis is:

> Give AI agents the authority to act for users without unnecessarily giving them the underlying secrets, credentials, unrestricted access, payment instruments, private keys, or complete private context.

A second formulation is:

> PTF is the deterministic authority and disclosure layer between human intent and consequential agent execution.

PTF's desired ecosystem position is not "another payment protocol" or "another identity standard." It is the reusable place where developers can answer:

- Did this Principal actually authorize this Agent?
- Does the proposed action fit the delegated authority?
- Which recipient is actually being acted upon?
- Which Protected Resource may be exercised?
- What is the minimum information that needs to leave the trusted boundary?
- Which party/protocol enforces each constraint?
- Does the selected external protocol preserve all relevant authority semantics?
- Is additional Principal approval required?
- Can the operation be replayed or redirected?
- What happens if the external outcome is ambiguous?
- What evidence proves what happened afterward?

---

# 4. Goals

PTF v1 architecture MUST support the following goals.

1. **Delegated authority** — represent deliberate continuing authority separately from one-time approval.
2. **Deterministic authorization** — consequential permission decisions happen outside the LLM.
3. **No silent broadening** — derived authority never becomes broader than its source.
4. **Minimum disclosure** — use the least revealing feasible representation that satisfies the authorized action.
5. **Protected execution** — prefer bounded use of Protected Resources rather than extracting reusable values.
6. **Protocol interoperability** — use external protocols without allowing them to redefine PTF's core semantics.
7. **Constraint preservation** — every authority-relevant constraint is mapped to an actual enforcement point.
8. **Identity anchoring** — recipient, Agent, Principal, Issuer, and Executor identities are backed by explicit authentication/trust semantics rather than labels.
9. **Personalization without authority creep** — Personal State improves reversible decisions but cannot silently create authority.
10. **Privacy-preserving audit** — produce useful accountability without duplicating protected data into logs.
11. **Revocation and lifecycle control** — distinguish grant, binding, device, trust, resource, and execution revocation.
12. **Concurrency safety** — aggregate budgets/use limits cannot be oversubscribed by concurrent Agents/runtimes.
13. **Explicit assurance** — describe who can see plaintext and which security properties actually hold for a specific execution.
14. **Portability** — preserve user-controlled state and policy without pretending every non-exportable resource can be copied.
15. **Open-source credibility** — publish an inspectable specification, reference implementation, test suite, governance, and security documentation.
16. **Adversarial conformance** — prove properties through executable negative tests instead of relying on implementation claims.
17. **Protocol neutrality** — architecture must survive materially different AP2, x402, and OpenID4VP integrations before general abstractions are frozen.

---

# 5. Non-Goals

PTF v1 is NOT intended to:

- replace AP2, UCP, x402, OpenID4VP, Digital Credentials, FIDO, OAuth, MCP, WebMCP, A2A, card networks, payment rails, wallets, credential issuers, or identity providers;
- define a new global human identity system;
- define one global Agent identity PKI;
- operate a universal reputation score for merchants, Agents, or issuers;
- become a commerce catalog/cart/order/fulfilment protocol;
- become a payment network or settlement rail;
- require PTF to centrally custody every user's credentials or keys;
- guarantee zero-knowledge disclosure where the underlying protocol/provider does not support it;
- claim operator non-possession merely because storage is encrypted;
- expose generic `readSecret`, `exportPrivateKey`, or equivalent Agent-facing APIs;
- treat repeated user behavior as implied spending/signing/disclosure authority;
- use LLM judgment as a substitute for deterministic authorization or attenuation checking;
- event-source every piece of user data forever;
- synchronize every key/credential across every device;
- require confidential computing as a universal deployment dependency;
- define exact commercial SaaS packaging/pricing in the architecture;
- freeze programming language, database, ORM, cloud vendor, UI framework, policy language, message bus, cryptographic library, KMS/HSM/TEE provider, or final universal adapter programming interface;
- reuse current synthetic sandbox code merely to avoid rewriting it.

---

# 6. Architectural Invariants

The following are non-negotiable requirements unless explicitly changed by a future human-approved architecture decision.

## 6.1 Authority

1. Knowledge is not authority.
2. Personalization is not authorization.
3. Hard Policy constrains authority but never creates authority.
4. Authority originates only from a deliberate Standing Grant or Exact Human Approval.
5. Repeated approvals, repeated purchases, high model confidence, or repeated behavior cannot silently create Standing Grant authority.
6. One Standing Grant must independently cover an autonomous action; unrelated grants cannot be unioned to manufacture broader authority.
7. One-off human exceptions create only the approved Execution Grant unless the Principal separately chooses to create/modify a Standing Grant.
8. Standing Grants are immutable/versioned in meaning and retain historical provenance.
9. Execution Grants are narrow, immutable, transaction/plan-bound, short-lived, and revocable while under PTF control.
10. Current Hard Policy, identity/trust state, resource state, revocation, expiry, and reservations are revalidated immediately before consequential execution.
11. Relaxing Hard Policy does not broaden an existing Standing Grant or Execution Grant.
12. Tightening Hard Policy may prevent a not-yet-committed action.
13. Unknown attenuation semantics fail closed.
14. Further delegation is disabled by default.

## 6.2 Planning and Execution

15. Planning occurs before final Exact Human Approval when approval is required.
16. Exact Human Approval binds the selected ExecutionPlan fingerprint, not merely free-form Agent prose.
17. No authority-relevant constraint may silently disappear between authority and execution.
18. Every security-relevant constraint must appear in an Enforcement Map.
19. Unenforceable constraints cause denial unless a specifically permitted downgrade is made explicit and appropriately approved.
20. Evidence of authority and enforcement of authority are separate concepts.
21. Consequential execution uses just-in-time external artifacts where practical.
22. Retry is prohibited after ambiguous external effect unless no effect can be proven or strong idempotency for the identical action exists.
23. `INDETERMINATE` is a first-class outcome.
24. Aggregate limits are reserved atomically before Execution Grant consumption can oversubscribe them.

## 6.3 Personal State

25. Observation, Claim, and Preference are distinct.
26. Every durable Personal State item preserves provenance and original source class.
27. Source transformation, summarization, model inference, tool echo, or memory compaction cannot upgrade source authority.
28. Confidence is distinct from source authority and truth.
29. Explicit user correction outranks incompatible inferred preference.
30. Objective Claim verification is domain-/issuer-specific.
31. Material contradictions are not resolved by model guesswork.
32. Inferred preferences may support low-risk reversible personalization but cannot create Hard Policy, Standing Grants, Exact Human Approval, or Execution Grants.
33. Safe View is task-specific, minimized, and ephemeral.
34. ContextView and AuthorityView are independently derived and typed even if composed into one Safe View.
35. Correction and erasure are distinct operations.

## 6.4 Identity and Trust

36. Identity, authentication, trust, and authorization are separate.
37. Local Subject IDs have no external authentication meaning.
38. External identities are linked through validated IdentityBindings/EndpointBindings.
39. Different protocol identifiers are never assumed equivalent merely because their human-readable labels match.
40. Trust is role- and purpose-specific, not a global boolean or scalar reputation score.
41. Successful behavior cannot silently create or broaden TrustRelations.
42. Principal identity may be pseudonymous; legal identity is not required as the universal root.
43. Agent identity is distinct from Agent Instance, model, provider, session, and orchestration runtime.
44. Recipient binding requires fresh authenticated evidence appropriate to the execution.
45. Payment address, web origin, verifier identity, merchant business identity, and protocol identifier remain distinct until validated bindings connect them.
46. Issuer trust is Claim-/credential-type-specific.
47. Key rotation requires validated continuity evidence.
48. Delegated child Agents must be independently authenticated.

## 6.5 Protected Resources and Custody

49. Protected Resource is a logical domain concept and does not imply PTF plaintext custody.
50. ProtectedResourceRef is not a bearer capability and confers no authority.
51. Protected resource interfaces prefer bounded operations over extraction.
52. Non-exportability does not substitute for operation authorization.
53. Encryption at rest does not equal operator/runtime non-possession.
54. Custody profiles explicitly state which parties/processes are in the trusted computing base and which can see plaintext/usably invoke keys.
55. External/provider custody is preferred where it reduces PTF custody without weakening required authority semantics.
56. Recovery cannot introduce a hidden universal plaintext backdoor.
57. Some non-exportable resources may require revocation/re-enrolment rather than recovery.
58. Control Runtime and Protected Execution Domain may live in different physical/administrative locations.
59. Protected Executors use narrow interfaces and do not accept arbitrary Agent free-form instructions.
60. Protected Executors validate the Execution Grant/Plan properties required by their topology before consequential use.

## 6.6 Protocols, Audit, and Operations

61. External protocols are adapters, not authority sources by default.
62. Evidence Artifacts are protocol-specific and are not canonical PTF authority records.
63. Adapters translate and verify; they do not create authority, create trust, change policy, or silently drop constraints.
64. Unknown authority-affecting extension semantics fail closed.
65. Audit does not routinely store Protected Resource plaintext, raw secrets, private keys, or full model context.
66. PTFReceipt is distinct from External Receipt.
67. Conformance verifies observable behavior at public seams.
68. Observability is allowlisted/privacy-minimized by construction.
69. Automated/self-improving development cannot bypass security, conformance, or independent review gates.
70. Security-sensitive migration defaults remain conservative and never silently broaden authority.

---

# 7. Actors

The core architecture recognizes these actors/roles.

- **Principal** — human or organization whose authority ultimately matters.
- **Agent** — logical delegated software actor proposing actions.
- **Agent Instance** — authenticated runtime instance currently acting as an Agent.
- **Recipient** — Subject intended to receive disclosure or consequential effect.
- **Issuer** — Subject whose assertions may be trusted for specific Claim types.
- **Executor** — Subject operating a Protected Executor.
- **Agent Provider** — Subject operating an Agent platform and, in some profiles, a trusted user interface or signing boundary.
- **Verifier** — Recipient role that verifies credential/authority evidence.
- **Administrator** — deployment-specific human/organization authorized to configure enterprise trust/policy within the Principal's governance model.
- **Auditor/Reviewer** — authorized party inspecting safe receipts/evidence without receiving protected values beyond its granted scope.
- **Developer/Integrator** — builds Agent, recipient, provider, or protocol integrations against PTF.

A Subject may play multiple roles, but every role relationship remains explicit.

---

# 8. Exhaustive User Stories

The following stories define the required externally meaningful behavior. Implementation planning may split them further, but may not silently omit them.

## 8.1 Principal and Authority

1. As a Principal, I want to approve one exact consequential action so that the Agent can complete it without receiving broader future authority.
2. As a Principal, I want to create a Standing Grant with explicit action, recipient, resource, budget, time, use, disclosure, and delegation constraints so that an Agent can operate autonomously within deliberate bounds.
3. As a Principal, I want approve-once and create-standing-authority to be distinct decisions so that one approval cannot silently become permanent authority.
4. As a Principal, I want to deny one action without revoking unrelated Standing Grants so that rejection is scoped correctly.
5. As a Principal, I want to suspend a Standing Grant temporarily so that no new Execution Grants are issued until I resume it.
6. As a Principal, I want to revoke a Standing Grant so that future PTF-controlled use stops.
7. As a Principal, I want increasing a Standing Grant limit/scope to require a new explicit authorization so that authority cannot grow silently.
8. As a Principal, I want a one-time exception above a normal limit to leave the normal Standing Grant unchanged so that exceptional approval does not become precedent.
9. As a Principal, I want PTF to tell me when an already-emitted external artifact cannot actually be revoked so that revocation guarantees are not overstated.
10. As a Principal, I want to see how much aggregate budget/use remains and what is reserved/in-flight so that autonomous authority is understandable.

## 8.2 Agent

11. As an Agent, I want a minimized Safe View relevant to my current task so that I can make useful decisions without receiving the Principal's complete private state.
12. As an Agent, I want to submit an Action Request describing the intended concrete action so that PTF can determine whether it is authorized.
13. As an Agent, I want to receive `deny`, `approval-required`, or safe authorization status with actionable safe reasons so that I can continue the workflow without learning protected information.
14. As an Agent, I want to receive a safe Receipt/outcome after execution so that I can continue the task without receiving reusable protected credentials.
15. As an Agent, I want inferred preferences to be marked as inferred so that I can distinguish them from explicit Principal preferences.
16. As an Agent, I want capability/resource availability metadata rather than the underlying secrets so that I can plan without possessing private resources.
17. As an Agent, I want a denied or expired authority request to fail deterministically so that I cannot accidentally rely on stale permission.
18. As an Agent, I want a materially modified transaction to require re-resolution so that I cannot mutate an approved plan after approval.

## 8.3 Personal State

19. As a Principal, I want PTF to distinguish Observations, Claims, and Preferences so that external content is not automatically treated as truth or preference.
20. As a Principal, I want explicit corrections to supersede earlier inferred or explicit preferences while preserving explainable history so that future decisions use the corrected state.
21. As a Principal, I want material contradictions surfaced or deterministically resolved by appropriate source rules instead of model guesswork so that consequential decisions are not based on fabricated certainty.
22. As a Principal, I want context-specific preferences to remain scoped so that a preference for personal travel does not silently apply to business travel.
23. As a Principal, I want stale/revalidation-sensitive Claims handled differently from permanent facts and historical Observations so that age, membership, licence, and preference semantics remain correct.
24. As a Principal, I want to erase personal information separately from correcting it so that privacy deletion is not confused with historical supersession.
25. As a Principal, I want summaries/compaction to preserve source lineage so that untrusted content cannot become trusted merely through repeated summarization.
26. As a Principal, I want the system to use low-risk inferred preferences for reversible ranking/suggestion while preventing those inferences from creating spending/signing/disclosure authority.

## 8.4 Identity and Trust

27. As a Principal, I want PTF to authenticate the actual Agent/recipient/executor rather than trust a human-readable identifier so that authority cannot be redirected through identity substitution.
28. As a Principal, I want the same real-world recipient to have multiple validated protocol-specific bindings so that PTF can interoperate across web, payment, credential, and commerce protocols without conflating identifiers.
29. As a Principal, I want trust to be role-specific so that an issuer trusted for membership cannot automatically assert legal identity or receive payment authority.
30. As a Principal, I want key/binding rotation to require continuity evidence so that attackers cannot take over an identity by claiming a new key.
31. As a Principal, I want Agent identity to survive model/provider changes where I delegated to the logical Agent rather than a particular model so that authority remains portable without becoming unbound.
32. As a Principal, I want high-value approvals to require the configured Principal-authentication assurance so that mere session presence is not sufficient where user verification is required.
33. As a Recipient, I want PTF/Agent evidence to be bound to my authenticated endpoint/identity so that an attacker cannot redirect an approved action to another recipient.
34. As an Issuer, I want my assertions to be trusted only for configured Claim types so that a valid signature is not treated as universal authority.

## 8.5 Planning and Disclosure

35. As a Principal, I want PTF to choose the least-disclosing feasible representation after correctness and assurance requirements so that an Agent/recipient learns no more than necessary.
36. As a Principal, I want an approval screen to show the actual selected disclosure/execution plan so that I authorize what will really happen.
37. As a Principal, I want any weaker-than-preferred execution route to disclose the downgrade, affected parties, and residual risk so that weaker privacy/security is never hidden.
38. As a Principal, I want policy to forbid selected downgrade classes entirely so that some information never travels through weaker routes.
39. As a Developer, I want each ExecutionPlan to identify where every authority-relevant constraint is enforced so that protocol translation cannot silently lose security semantics.
40. As a Developer, I want PTF to reject a plan with an unenforceable mandatory constraint so that interoperability does not become "best effort" authorization.

## 8.6 Protected Resources and Execution

41. As a Principal, I want credentials/keys/payment instruments to remain with external wallets/providers where practical so that PTF does not unnecessarily become their custodian.
42. As a Principal, I want a local/device Protected Executor option so that selected resources can remain under device-controlled custody.
43. As an Enterprise Principal, I want a customer-controlled Protected Executor option so that sensitive execution can remain inside my infrastructure.
44. As a deployment operator, I want a managed PTF execution profile whose assurance explicitly states operator/runtime visibility so that managed convenience is not marketed as operator non-possession.
45. As a high-assurance deployer, I want an attested-confidential execution profile where justified so that resource release can depend on verified workload properties.
46. As an Agent, I want to request `sign`, `present`, `prove`, `authorize-payment`, or equivalent bounded operations instead of retrieving reusable keys/credentials so that compromise has lower blast radius.
47. As a Principal, I want direct protected delivery to require validated recipient keys/endpoints so that encryption is not mistaken for recipient identity.
48. As a Principal, I want browser/page plaintext to be labelled as a weaker execution profile so that PTF does not claim stronger privacy than the route provides.
49. As a Principal, I want ambiguous external outcomes held as `INDETERMINATE` and reconciled before retry where duplication matters so that network failures cannot cause repeated consequential actions.
50. As a Principal, I want aggregate limits reserved atomically across concurrent Agents/runtimes so that simultaneous requests cannot overspend a shared grant.

## 8.7 Audit and Transparency

51. As a Principal, I want a PTFReceipt explaining who acted, which authority basis applied, what plan was executed, where constraints were enforced, and what external result occurred so that consequential actions are understandable afterward.
52. As a Principal, I want audit records to exclude protected values by default so that accountability does not create another secret database.
53. As an Auditor, I want safe forensic evidence linking decisions, grants, plan fingerprints, and external receipts so that incidents can be reconstructed without requiring unrestricted access to user secrets.
54. As a Principal, I want tamper-evident history and optional externally witnessed privacy-safe checkpoints so that local history rewriting can be detected in stronger deployments.
55. As a Developer, I want explanations to derive from structured evidence rather than LLM speculation so that "why allowed" answers are reproducible.

## 8.8 Portability, Sync, and Recovery

56. As a Principal, I want to export supported Personal State, policies, Standing Grants, trust metadata, resource references, and receipts in a versioned portable package so that PTF is not a data lock-in mechanism.
57. As a Principal, I want imports to preserve provenance and require revalidation of security-sensitive trust/binding data so that an imported file cannot self-declare a recipient trusted.
58. As a Principal, I want non-exportable resources to re-enrol/reissue rather than pretend they can be copied so that portability claims remain truthful.
59. As a Principal, I want device loss to revoke that device without destroying my Principal identity and unrelated bindings so that revocation is granular.
60. As a Principal, I want account recovery to avoid granting the recovery operator broader plaintext access than the normal custody profile claims so that recovery is not a universal backdoor.
61. As a Principal, I want Personal State conflicts handled differently from authority-state conflicts so that useful contextual data can merge while security state fails closed.

## 8.9 Developers and Protocols

62. As an Agent developer, I want a narrow Agent Gateway for Safe View, Action Request, status, and safe Receipt so that my Agent cannot access administrative authority controls.
63. As a recipient/verifier developer, I want a focused verification integration so that I can authenticate and verify PTF evidence without embedding PTF's entire internal runtime.
64. As a protocol-adapter developer, I want to describe protocol-native enforcement capabilities and translate authorized plans without becoming an authority engine so that protocol code remains replaceable.
65. As a developer, I want synthetic identities/resources and a local simulator so that I can build integrations without using real user secrets.
66. As a developer, I want a policy/grant/ExecutionPlan/Enforcement Map debugger so that authorization failures are explainable.
67. As a developer, I want versioned adversarial conformance tests for recipient substitution, replay, amount mutation, disclosure escalation, budget races, revocation, expiry, and semantic loss so that compatibility claims have evidence.
68. As a developer, I want AP2 and x402 to be implemented concretely before PTF freezes a universal protocol-adapter interface so that abstractions are earned from real differences.
69. As a developer, I want OpenID4VP as the third materially different proving integration so that the core is tested beyond payment/commerce authorization.

## 8.10 Open Source and Operations

70. As a contributor, I want a public specification separate from the reference implementation so that semantics are reviewable independently of code structure.
71. As a contributor, I want major irreversible architectural decisions recorded as ADRs so that future maintainers understand why the system is designed this way.
72. As a maintainer, I want secure release provenance, dependency controls, secret scanning, SBOM, and signed/reproducible releases where practical so that users can verify the software supply chain.
73. As a security researcher, I want a documented threat model and disclosure process so that weaknesses can be reported and reproduced responsibly.
74. As a maintainer, I want privacy-safe telemetry schemas and leak-canary tests so that debugging does not silently leak protected values.
75. As a maintainer, I want unknown security-sensitive extension semantics and ambiguous security migrations to fail closed so that evolution cannot accidentally broaden authority.

---

# 9. Bounded Context Architecture

The canonical bounded contexts are defined in `CONTEXT-MAP.md` and are normative terminology for this specification:

1. Personal State
2. Identity and Trust
3. Authority
4. Planning
5. Protected Execution
6. Protocol Integration
7. Audit and Conformance

Cross-cutting contexts:

- Trusted Surface
- Portability / Sync / Revocation / Recovery
- Developer Platform
- Security and Operations
- Governance and Versioning

The implementation may package these differently, but it MUST preserve their semantic separation and invariants.

There is explicitly no automatic Personal-State-to-Authority transition.

---

# 10. Core Lifecycle

The normative conceptual lifecycle is:

1. **Agent authentication/context establishment** — identify the logical Agent and current Agent Instance according to the deployment profile.
2. **Safe View derivation** — produce task-specific ContextView and AuthorityView without exposing unrelated Personal State.
3. **Action Request** — Agent proposes a concrete action.
4. **Identity/trust resolution** — resolve Principal, Agent, Recipient, Executor, Issuer, and endpoint bindings relevant to the action.
5. **Preliminary authority resolution** — evaluate invariants, revocation/resource state, Hard Policy, applicable Standing Grant, reservations, and whether approval may be required.
6. **Candidate planning** — identify feasible DisclosurePlan, protocol, Protected Executor, recipient route, native enforcement mechanisms, and failure properties.
7. **Enforcement Map construction** — account for every authority-relevant constraint.
8. **Plan selection** — choose a plan satisfying correctness and required assurance, then prefer least disclosure and least externally reusable authority.
9. **Exact Human Approval where required** — Trusted Surface renders canonical selected plan terms and captures Principal authentication/approval bound to the plan fingerprint.
10. **Execution Grant issuance** — issue narrow, immutable authority tied to the selected plan and authority basis.
11. **Atomic reservation** — reserve aggregate usage/capacity where required.
12. **Just-in-time revalidation** — recheck grant, policy, trust, identity binding, resource, expiry, reservation, and plan fingerprint.
13. **Prepare** — Protected Executor verifies the grant/plan and prepares transient execution material.
14. **Commit** — perform the consequential external effect.
15. **Reconciliation** — determine consumed, released-no-effect, or indeterminate result; reconcile external systems where needed.
16. **Receipt** — persist privacy-minimized AuditEvents, PTFReceipt, and references to External Receipts/Evidence Artifacts.

An implementation MAY optimize internal sequencing only if all externally observable security invariants remain equivalent.

---

# 11. Authority Domain

## 11.1 Authority Sources

PTF recognizes exactly two deliberate authority sources:

- **Standing Grant** — continuing delegated authority; and
- **Exact Human Approval** — authority for the selected concrete plan.

External mandates/tokens/credentials may provide evidence of prior authority but MUST be validated and mapped into PTF semantics before being relied upon as authority basis.

Hard Policy, Personal State, inference, agent recommendations, successful prior transactions, or protocol availability are not authority sources.

## 11.2 Standing Grant Lifecycle

Standing Grant states are conceptually:

- `PROPOSED` — not authority;
- `ACTIVE` — may support new Execution Grants;
- `SUSPENDED` — temporarily unavailable for new execution;
- `REVOKED` — terminal;
- `EXPIRED` — terminal;
- `SUPERSEDED` — historical authority replaced by a deliberately approved version.

Grant history MUST remain explainable for previous transactions.

Increasing scope/amount/recipient set/disclosure/delegation/validity requires deliberate authorization of a new effective grant/version.

## 11.3 Execution Grant Lifecycle

Execution Grant states conceptually include:

- `ISSUED`;
- `REVOKED`;
- `EXPIRED`;
- `IN_FLIGHT`;
- `CONSUMED`;
- `RELEASED_NO_EFFECT`;
- `INDETERMINATE`.

Consumption/release semantics MUST be tied to reservation/usage accounting.

## 11.4 No-Broadening Rule

Where PTF has deterministic semantics for a constraint dimension, a child/Execution Grant must be provably contained by its parent authority.

Required deterministic dimensions include, where applicable:

- actions/operations;
- resources;
- recipients;
- purposes;
- amounts;
- currencies;
- aggregate limits;
- validity/time windows;
- use counts;
- disclosure permissions;
- delegation depth/scope;
- required assurance.

Natural-language or subjective preferences that cannot be deterministically evaluated are not authoritative constraints. They may inform planning/recommendation and may trigger human approval.

## 11.5 Grant Composition

PTF MUST NOT combine independent grants to synthesize an authorization that no individual grant provides.

If multiple grants independently authorize the same Action Request, PTF MUST choose an explicit authority basis deterministically and account usage/reservations against that basis.

## 11.6 Aggregate Limits and Concurrency

Available aggregate authority is conceptually:

`limit - committed_usage - outstanding_reservations`.

Reservation and grant issuance affecting a shared aggregate limit MUST be atomic with respect to competing execution paths.

Disconnected replicas that cannot coordinate shared aggregate authority MUST NOT independently exercise that aggregate authority.

## 11.7 Exceptions

Exact Human Approval may authorize a single action outside a Standing Grant without mutating the Standing Grant.

The Trusted Surface MUST distinguish an exception from permanent grant modification.

## 11.8 Delegation

Further Agent-to-Agent delegation defaults to disabled.

If enabled by the parent Standing Grant, a child grant MUST:

- identify an independently authenticated child Agent;
- remain no broader than the parent;
- satisfy delegation-depth constraints;
- preserve delegation provenance;
- become unusable when the parent is revoked/invalid under PTF control.

---

# 12. Planning Domain

## 12.1 DisclosurePlan

DisclosurePlan describes the exact information/protected representation permitted to leave the trusted boundary for a concrete execution.

It MUST account for:

- recipient;
- purpose;
- Protected Resource source;
- requested claims/information;
- permitted information;
- selected representation;
- channel requirements;
- Agent/model visibility;
- known recipient visibility/retention assumptions;
- assurance properties;
- downgrade status.

Preferred disclosure order, subject to technical feasibility and policy, is conceptually:

1. no disclosure;
2. predicate/proof;
3. derived attribute;
4. selective claims;
5. opaque/encrypted presentation;
6. direct protected delivery;
7. raw plaintext.

This preference is not a claim that every protocol supports each mode.

## 12.2 ExecutionPlan

ExecutionPlan is the selected exact execution route. It MUST include enough canonical security-relevant semantics to bind final approval and detect material mutation.

It conceptually contains:

- Action Request reference;
- authority basis;
- relevant Principal/Agent/Recipient subjects and bindings;
- Protected Resource references;
- DisclosurePlan;
- Protected Executor identity/profile;
- protocol/operation choice;
- transaction binding;
- Enforcement Map;
- aggregate reservation requirements;
- replay/idempotency strategy;
- expected Evidence Artifacts/External Receipts;
- expected outcome semantics;
- failure/reconciliation semantics;
- expiry;
- custody/trusted-computing properties;
- plan fingerprint.

## 12.3 Enforcement Map

Every authority-relevant constraint MUST be assigned to one or more of:

- `PTF`;
- `PROTOCOL`;
- `EXECUTOR`;
- `RECIPIENT`;
- `COMPOSITE`;
- `UNENFORCEABLE`.

The map MUST distinguish evidence that a property was asserted from the party that actually enforces it.

A mandatory `UNENFORCEABLE` property invalidates the candidate plan unless an explicit downgrade policy permits proceeding with disclosed weaker assurance.

## 12.4 Plan Mutation

Any material change to recipient, amount, resource, claims/disclosure, protocol, executor, assurance, transaction, purpose, or downgrade status after final approval MUST invalidate the prior approval/Execution Grant and trigger re-planning/re-resolution.

---

# 13. Personal State Domain

## 13.1 Canonical Entities

- Observation
- Claim
- Preference
- Derived Context
- Handling Class
- ContextView
- Safe View

Protected Resources remain outside Personal State even when Personal State references their availability.

## 13.2 Provenance

Every durable item MUST preserve sufficient provenance to determine:

- source class and identity where appropriate;
- observed/asserted time;
- derivation lineage;
- context/scope;
- sensitivity/handling classification;
- verification/epistemic state;
- supersession/correction history;
- freshness/revalidation semantics where applicable.

## 13.3 Source Integrity

Model transformation cannot upgrade origin trust. External content remains externally sourced through all summaries/derivations unless separately verified or explicitly asserted by the Principal.

## 13.4 Claims

Claims distinguish at least the semantics of asserted, verified, inferred, disputed, stale, and superseded states where relevant.

Verification MUST mean verification under a domain-appropriate source/issuer mechanism, not model confidence.

## 13.5 Preferences

Preferences distinguish explicit from inferred.

Latest applicable explicit correction/explicit preference outranks incompatible inferred preference.

Inferred preferences may be used only for reversible decision support unless a separate deliberate authority decision exists.

## 13.6 Safe View

Safe View is ephemeral and task-specific.

It is composed from independently derived:

- `ContextView` — what useful personal context the Agent may reason over; and
- `AuthorityView` — safe information about what actions may be requested/current authority status.

The two views MUST NOT be derived through one generic "user profile" object that allows Personal State values to become authority.

Safe View SHOULD expose minimum provenance/epistemic metadata necessary for Agent reasoning without exposing sensitive full provenance unnecessarily.

---

# 14. Identity and Trust Domain

## 14.1 Subject

PTF uses stable local Subjects for reasoning. A Subject identifier alone has no external authentication meaning.

Subjects MAY have roles such as Principal, Agent, Recipient, Issuer, Executor, or Agent Provider.

## 14.2 IdentityBinding and EndpointBinding

PTF associates Subjects with externally verifiable identities/endpoints through validated bindings. Examples may include:

- public keys;
- Web origins;
- certificates;
- wallet/payment addresses;
- OAuth client/workload identities;
- verifier attestations;
- protocol-native identifiers;
- provider accounts.

No binding mechanism is universally required.

## 14.3 Authentication

PTF records the relevant properties of fresh authentication rather than reducing it to a generic boolean.

Properties may include:

- possession proof;
- user presence;
- user verification;
- key/certificate validation;
- endpoint/origin match;
- workload/attestation properties;
- freshness/challenge;
- transaction binding.

## 14.4 TrustRelation

Trust is specific to subject, role, accepted function, accepted binding, context, source/provenance, validity, and status.

PTF MUST NOT treat a global `trusted=true` or scalar reputation score as sufficient authorization evidence.

## 14.5 Principal

Principal is the authority-owning human/organization. PTF does not require a globally correlatable legal identifier.

Where protocols permit, external identity SHOULD be context-specific/pseudonymous to avoid unnecessary correlation.

## 14.6 Agent

Agent is the logical delegated actor. Agent Instance, model, provider, runtime, and session remain separate provenance/authentication concepts.

Standing Grants bind the intended Agent Subject, not a caller-supplied string.

## 14.7 Trusted Surface

Trusted Surface is an authenticated deterministic approval boundary. It renders canonical ExecutionPlan terms rather than Agent-authored free text and binds Principal authentication/approval to the plan fingerprint.

---

# 15. Protected Resource and Custody Domain

## 15.1 Protected Resource

A Protected Resource is any resource whose disclosure/use/exercise requires PTF authority. It may live outside PTF.

ProtectedResourceRef is safe metadata/reference only and MUST not provide bearer-like exercise authority.

## 15.2 Protected Executor

Protected Executor is the narrow interface that performs bounded operations over Protected Resources.

Examples of operation classes include:

- sign;
- authenticate;
- prove;
- present credential;
- authorize payment;
- disclose approved claims;
- execute bounded account action.

Generic Agent-facing secret extraction is prohibited by default.

## 15.3 Custody Profiles

The architecture supports multiple profiles:

1. External/provider-brokered;
2. Principal-device/local;
3. Customer-controlled runtime;
4. Managed PTF runtime;
5. Attested-confidential runtime.

Profiles are not a one-dimensional score. Each execution MUST report concrete properties including which parties can see plaintext, which can exercise keys/resources, and which are in the TCB.

## 15.4 Control Runtime vs Protected Execution Domain

PTF distinguishes the Agent-facing/control runtime from the Protected Execution Domain.

They may reside in different processes, hosts, devices, networks, or administrative domains.

Protected Executors MUST not execute free-form Agent instructions; they consume validated Execution Grants/Plans according to their profile.

## 15.5 Recovery and Key Roles

Key roles (Principal authentication, Agent authentication, resource encryption/wrapping, operational signing, credential holder, sync, recovery, attestation) remain conceptually distinct.

Recovery authority MUST not be the routine universal execution key.

Recovery may restore Principal/state continuity while some resources require provider recovery, reissuance, or re-enrolment.

---

# 16. Protocol Integration

## 16.1 Adapter Responsibilities

A Protocol Adapter MAY:

- interpret an external request into relevant PTF Action Request inputs;
- report protocol-native mechanisms/properties useful for planning;
- translate an approved ExecutionPlan into an Evidence Artifact/external request;
- verify external protocol results/receipts.

A Protocol Adapter MUST NOT:

- create Standing Grants or Exact Human Approval;
- broaden authority;
- override Hard Policy;
- create TrustRelations merely from labels;
- decide Personal State trust;
- read arbitrary Protected Resources;
- silently discard constraints.

## 16.2 Evidence Artifact

Evidence Artifact is protocol-specific material such as an AP2 Mandate, x402 PaymentPayload, OpenID presentation, token, assertion, or signed transaction.

It is never the canonical PTF authority record.

Artifact custody/transfer MUST be classified, including whether it is direct-delivery, sender/recipient-constrained, bearer-like, or local-only.

## 16.3 Abstraction Rule

The implementation MUST NOT freeze a universal adapter programming interface until at least two materially different concrete adapters demonstrate a real common seam.

Initial proving sequence:

1. AP2;
2. x402;
3. OpenID4VP.

UCP, MCP, WebMCP, A2A, OAuth, Digital Credentials, and other protocols remain subsequent adapters/integrations based on product need.

## 16.4 Semantic Preservation

For each integration, conformance must prove that every authority-relevant source constraint is either preserved by the protocol, enforced by PTF/executor/recipient, or explicitly marked unenforceable/downgraded.

---

# 17. Audit, Receipts, and Conformance

## 17.1 AuditEvent

AuditEvent is privacy-minimized structured evidence of lifecycle activity. It MUST use safe metadata/references by default and MUST NOT routinely include Protected Resource plaintext, private keys, payment credentials, raw passport data, or complete model context.

## 17.2 PTFReceipt

PTFReceipt MUST be capable of explaining:

- Principal;
- Agent/delegation provenance;
- authority basis;
- action/recipient;
- ExecutionPlan fingerprint;
- Enforcement Map summary;
- Protected Executor/profile;
- protocol;
- safe External Receipt/Evidence references;
- result (`CONSUMED`, `RELEASED_NO_EFFECT`, `INDETERMINATE`, etc. as appropriate);
- reservation/aggregate usage result;
- important assurance properties;
- downgrades/residual risks;
- relevant timestamps.

## 17.3 Tamper Evidence

Baseline deployments require structured durable audit integrity appropriate to their threat model.

Stronger profiles may use cryptographic linking/signing/checkpoints and optional external witnessing of privacy-safe commitments. Publishing private user transaction details to a public transparency system is not required and generally should be avoided.

## 17.4 Conformance

Conformance is behavioral and adversarial.

The reference conformance suite MUST eventually include, at minimum:

- recipient substitution;
- endpoint/payment-address substitution;
- transaction/amount/claim mutation;
- grant unioning attempt;
- expired/revoked authority;
- replay;
- incorrect delegation depth;
- unauthorized Agent instance;
- stale/revoked identity binding;
- missing trust relation;
- disclosure escalation;
- unsupported downgrade;
- semantic constraint loss;
- aggregate budget concurrency race;
- indeterminate retry protection;
- Personal State memory poisoning / source laundering;
- Personal State to authority escalation attempt;
- protected-value canary leakage through Agent interfaces, logs, receipts, telemetry, errors, browser state under the tested profile;
- adapter native-enforcement claim falsification;
- recovery/revocation behavior;
- portability import trust-escalation attempt.

"PTF Conformant" MUST be tied to a specification/conformance-suite version and an explicit tested profile.

---

# 18. Durable State, Coordination, Portability, and Recovery

## 18.1 State Classes

PTF conceptually distinguishes at least:

- Personal State;
- Security Configuration (Hard Policy, Standing Grants, TrustRelations, bindings);
- Usage/Reservation Ledger;
- Audit;
- Protected Resource Catalog.

One generic consistency/merge strategy MUST NOT be assumed for all classes.

## 18.2 Security State

Security-sensitive conflicts fail closed. Revocation cannot be casually merged with an older active grant. Aggregate usage requires authoritative coordination.

## 18.3 Personal State

Personal State may retain concurrent observations/context where provenance permits. Contradiction/conflict semantics remain explicit.

## 18.4 Portable State Package

PTF MUST define a versioned portable representation for supported state such as Personal State, policies, Standing Grants, trust metadata, resource references, and selected receipts/audit.

Imported security-sensitive bindings/trust MUST be revalidated according to policy/profile. Import declarations do not establish trust by themselves.

## 18.5 Recovery

Recovery semantics are resource/profile-specific and MUST not silently broaden the TCB. Recovery may restore account/state continuity without restoring non-exportable resources.

---

# 19. Developer and Integration Architecture

## 19.1 Public Seams

The architecture requires distinct trust-level interfaces for:

- Agent Gateway;
- Trusted Surface;
- Authority Runtime;
- Personal State / Safe View;
- Protected Executor;
- Protocol Adapter;
- Recipient / Verifier integration;
- Principal/administrative controls;
- Audit/conformance tooling.

Exact programming interfaces remain implementation decisions.

## 19.2 Agent Gateway

The Agent-facing seam SHOULD be intentionally narrow and conceptually support:

- obtain Safe View;
- submit Action Request;
- inspect safe status;
- receive safe PTFReceipt/result.

The Agent seam MUST NOT expose generic authority administration, trust administration, Principal approval recording, secret extraction, or policy mutation.

## 19.3 Recipient / Verifier Integration

Recipient tooling SHOULD make it straightforward to verify PTF/protocol evidence, recipient/transaction binding, expiry, and required outcome without importing unrelated PTF internals.

## 19.4 Developer Tooling

The reference project SHOULD provide:

- local simulator;
- synthetic identities/resources;
- policy/grant debugger;
- Safe View inspector;
- ExecutionPlan/Enforcement Map inspector;
- synthetic protocol fixtures;
- conformance runner;
- privacy/leak test fixtures;
- integration examples.

---

# 20. Trusted Surface / Reference Product

A reference user surface is part of the product architecture because unsafe approval UX can invalidate otherwise correct backend semantics.

It MUST support the human capabilities of:

- exact approvals;
- Standing Grant and Hard Policy management;
- Personal State review/correction/erasure controls;
- Protected Resource visibility/status;
- identity/device/trust management;
- receipts/activity;
- recovery/export.

The product UX MUST clearly distinguish:

- approve once;
- create/modify Standing Grant;
- deny once;
- suspend grant;
- revoke grant.

Approval content MUST derive from the selected canonical ExecutionPlan, not free-form Agent prose.

User-facing explanations MUST derive from structured policy/grant/identity/Enforcement Map/receipt evidence rather than speculative LLM rationale.

---

# 21. Open Source, Specification, and Governance

PTF is expected to be open source unless a later explicit product decision changes this.

The project MUST distinguish:

- the **PTF Specification** — normative semantics/invariants/conformance requirements; and
- the **PTF Reference Implementation** — one implementation of those semantics.

PTF SHOULD NOT market itself as an external industry "standard" until genuine independent adoption/governance justifies that term.

Standards strategy:

1. adopt established protocols where suitable;
2. integrate via adapters;
3. contribute interoperability/security improvements upstream where they belong;
4. introduce PTF-specific extensions only when a genuine cross-protocol gap remains.

Security-relevant unknown extensions fail closed.

Project provenance/attribution SHOULD be preserved through public Git history, AUTHORS, architecture/specification documents, ADRs, releases, governance documentation, design papers, and standards contributions.

Initial governance may be maintainer-led and evolve as contributors/adopters emerge.

---

# 22. Security Engineering and Software Supply Chain

PTF MUST maintain a living threat model covering at least:

- compromised/prompt-injected Agent/model;
- malicious external content and memory poisoning;
- malicious recipient/merchant/verifier;
- malicious or defective protocol adapter;
- compromised Protected Executor;
- compromised Principal device;
- cloud/operator/administrator abuse;
- stolen artifacts/tokens;
- replay and transaction substitution;
- concurrent budget/use races;
- rollback/state-fork attacks where relevant;
- recovery abuse;
- telemetry/log leakage;
- supply-chain compromise;
- malicious migration/extension behavior.

Verification SHOULD include public-seam tests, property/state-machine tests, concurrency tests, fuzzing, protocol interoperability tests, leak-canary tests, negative authorization tests, red-team scenarios, recovery/revocation tests, and migration tests.

Observability MUST be allowlisted/privacy-minimized rather than "log everything then redact."

The release process SHOULD eventually include:

- dependency review/pinning as appropriate;
- secret scanning;
- vulnerability scanning;
- SBOM;
- signed release artifacts;
- build provenance;
- reproducible builds where practical;
- protected release workflow;
- documented vulnerability disclosure/response.

Automated/self-improving development may propose code or policy-supporting changes but cannot bypass review, test, conformance, and security release gates.

---

# 23. Versioning, Migration, and Compatibility

Persisted security-relevant objects MUST carry explicit semantic/schema versioning appropriate to the object type.

Security-sensitive migrations MUST NOT silently broaden authority or trust. Ambiguous migrations require explicit review/reapproval or fail closed.

Protocol adapter compatibility MUST be tested against explicit protocol versions/profiles. Dependency upgrades do not automatically imply supported protocol compatibility.

Major architecture choices meeting the hard-to-reverse/surprising/trade-off threshold SHOULD have ADRs.

---

# 24. Repository Rewrite Strategy

The existing GitHub repository identity and public history SHOULD be retained.

The current synthetic WebMCP implementation MUST be preserved as historical evidence before the rewrite, for example through an immutable tag and/or `legacy/webmcp-sandbox` branch referencing the pre-rewrite commit.

The new implementation on `main` SHOULD be treated as a clean rewrite from the approved specification.

The implementation MUST NOT retain existing modules merely because they exist. Each reused line/module must be justified by the new architecture and pass new tests.

Concepts demonstrated by the sandbox — transaction-term hashing, safe-view filtering, provenance, leakage canaries, denial of recipient substitution, one-use semantics — may inform the rewrite, but the old module boundaries are non-normative.

The architecture branch/specification MUST be preserved during the rewrite so implementation agents cannot redefine the product from the current sandbox README/source.

Recommended high-level repository organization, subject to implementation planning:

- canonical context/specification;
- ADRs and threat model;
- core/runtime packages;
- adapters;
- conformance tests;
- reference Trusted Surface;
- recipient/verifier integration;
- examples/synthetic fixtures.

A monorepo is preferred initially because core/adapters/conformance will evolve together while abstractions are still being proven.

---

# 25. Initial Protocol Proving Program

The rewrite MUST not begin by implementing all protocols.

The purpose of initial integrations is to falsify the core abstraction.

## 25.1 AP2

AP2 tests continuing delegated authority and transaction-specific commerce authorization.

PTF must demonstrate that a Standing Grant/Execution Grant can interoperate with AP2 open/closed mandate semantics without making AP2 artifacts the canonical PTF authority objects.

The integration must test:

- trusted-surface approval relationship;
- Agent key/proof-of-possession binding where applicable;
- transaction-specific narrowing;
- selective disclosure of relevant open-authority constraints;
- merchant/verifier identity binding;
- external receipt reconciliation.

## 25.2 x402

x402 tests payment execution where the protocol handles payment requirements/authorization/settlement but PTF retains higher-level user budget/purpose/delegation semantics.

The integration must test:

- payment requirement to Action Request conversion;
- payee/payment endpoint identity binding;
- aggregate budget reservation;
- protected wallet execution without Agent key possession;
- amount/recipient/validity/replay enforcement split;
- settlement/indeterminate reconciliation.

## 25.3 OpenID4VP

OpenID4VP tests credential disclosure/presentation where there may be no Standing Grant and exact human approval/disclosure minimization can dominate.

The integration must test:

- verifier identity/binding;
- requested-claim minimization;
- nonce/transaction binding;
- credential provider/wallet brokering without copying credentials into PTF where possible;
- disclosure-plan representation choice;
- External Receipt/verification outcome.

If the same core semantics cannot survive these three materially different integrations without protocol leakage, the architecture must be revisited rather than papering over the incompatibility with a larger abstraction layer.

---

# 26. Highest-Level Testing Seams

Tests SHOULD prefer the highest stable public seams rather than mocking internal helper functions.

Required behavioral seams include:

1. Agent Gateway → authorization/planning/receipt behavior.
2. Trusted Surface → exact plan-bound approval behavior.
3. Protected Executor → reject/execute/reconcile behavior using validated plans.
4. Recipient/Verifier seam → recipient binding and evidence verification.
5. Portable-state seam → export/import/revalidation behavior.
6. Conformance seam → adversarial end-to-end scenarios.

Internal implementation may be refactored freely as long as these public behaviors/invariants remain valid.

---

# 27. Acceptance Criteria for the Full Rewrite

The rewrite is not considered architecturally successful merely because a demonstration UI works.

At minimum, before calling the foundational PTF runtime complete, the project must demonstrate:

1. Personal State and Authority State are structurally separated.
2. Safe View is task-specific and cannot manufacture authority.
3. Standing Grant and Exact Human Approval are distinct authority sources.
4. Execution Grants are plan-bound and materially mutated plans fail.
5. Hard Policy can narrow but never create/broaden authority.
6. Grant unioning is rejected.
7. Aggregate reservation race tests cannot oversubscribe limits.
8. Recipient identity is authenticated through real profile evidence, not caller-supplied booleans.
9. ProtectedResourceRef alone cannot exercise a resource.
10. At least one Protected Executor keeps reusable secret/key material outside the Agent process.
11. ExecutionPlan + Enforcement Map account for all authority-relevant constraints.
12. Unsupported mandatory constraints fail closed rather than disappearing.
13. At least AP2 and x402 are implemented concretely before a common adapter interface is frozen.
14. OpenID4VP or another materially different credential presentation path validates cross-domain generality.
15. External artifacts are distinct from PTF authority records.
16. `INDETERMINATE` external outcomes cannot be blindly retried.
17. PTFReceipt explains authority basis, plan, enforcement, executor, and outcome without leaking protected values.
18. Memory/source-laundering tests cannot promote malicious external content into authority.
19. Revocation and expiry are rechecked at execution.
20. Portability import cannot self-declare trust.
21. Recovery profile does not violate stated custody/TCB claims.
22. Leak-canary tests cover Agent surfaces, safe receipts, normal logs/telemetry/errors, and applicable browser/runtime surfaces under each tested profile.
23. Conformance tests include recipient substitution, replay, amount/transaction mutation, disclosure escalation, authority broadening, concurrency, and downgrade behavior.
24. Public documentation describes assurance limits truthfully per execution/custody profile.
25. The repository's architecture/specification source of truth is self-contained and no longer depends on an archived external handoff directory.

---

# 28. Deferred Implementation Decisions

The following are intentionally unresolved and MUST be selected during implementation planning/research rather than guessed from this spec:

- primary implementation language/runtime;
- persistence technology and exact storage schemas;
- transaction/coordinator implementation for aggregate reservations;
- exact policy representation/DSL;
- exact canonical serialization and hashing formats;
- exact key hierarchy/wrapping scheme;
- exact Principal authentication profiles;
- exact Agent/workload authentication profiles;
- exact Trust Registry persistence/distribution model;
- exact Protected Executor IPC/RPC interface;
- exact hosted/customer/local deployment orchestration;
- exact confidential-computing integration, if any;
- exact audit cryptographic structure/witnessing system;
- exact UI framework/design system;
- exact monorepo build/package tooling;
- exact common adapter interface, pending AP2+x402 implementation evidence;
- exact recipient/verifier SDK API;
- exact open-source governance mechanics beyond initial maintainer-led operation;
- exact SaaS/enterprise monetization model.

No implementation agent may treat one of these deferred items as architecture precedent without documenting the decision and evidence.

---

# 29. Required ADRs

At minimum, the following architecture decisions satisfy the ADR threshold and should remain documented:

1. **Authority is dual-source and separate from Personal State/Hard Policy.**
2. **Execution is plan-bound and every constraint requires an Enforcement Map.**
3. **Identity/authentication/trust/authorization are separate with local Subjects + validated external bindings.**
4. **Protected Resource custody is plural and Protected Executors prefer use over extraction.**
5. **External protocols are adapters/evidence mechanisms, not the PTF authority model.**
6. **The project keeps repository history but rewrites the implementation from the new architecture.**

---

# 30. Specification Review Gate

Before implementation planning begins, human review must confirm that this specification accurately captures the approved architecture and that no architectural section has been accidentally omitted or weakened.

After approval, the next process step is a detailed implementation plan that decomposes the rewrite into bounded workstreams with research and verification gates. Implementation must not begin directly from conversational context.
