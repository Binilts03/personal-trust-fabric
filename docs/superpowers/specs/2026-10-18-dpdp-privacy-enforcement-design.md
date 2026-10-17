# PTF DPDP Privacy Enforcement Design

**Status:** Draft for maintainer review  
**Date:** 2026-10-18  
**Target base:** `main@7b52d61ea207d1d37d11a8c85f3253466b732537`  
**Scope:** Jurisdiction-neutral privacy enforcement primitives plus an India DPDP profile. No product code may be implemented from this spec until the maintainer approves it.

## 1. Problem

PTF already answers a core authority question for AI agents: what may this verified actor do, on whose authority, under what exact terms, without possessing the underlying secret?

Privacy law introduces a separate question:

> Even when an agent has authority to access or act, is this processing of this person's personal data permitted for this purpose, scope, recipient, and lifecycle under the organisation's declared privacy basis?

The current PTF codebase has strong mechanisms for purpose-bounded disclosure, data minimisation, protected use, exact-operation binding, revocation, encryption, and audit evidence, but it does not model or enforce the organisation's processing-basis evidence, privacy-subject identity, retention/erasure lifecycle, or privacy-specific processing records.

The product goal is therefore **not** “PTF makes an organisation DPDP-compliant.” The goal is:

> PTF provides a privacy-enforcement and evidence layer for AI agents and automated systems that helps organisations operationalise DPDP-style requirements at runtime.

## 2. Legal baseline and implementation timing

This design is grounded only in primary Indian sources:

- Digital Personal Data Protection Act, 2023, India Code:
  https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf
- Digital Personal Data Protection Rules, 2025, Gazette notification G.S.R. 846(E):
  https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
- MeitY Rules landing page:
  https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa

Relevant statutory/control themes for this implementation:

- Act ss. 4–6: lawful processing, notice, consent; consent must be specific, informed and limited to data necessary for the specified purpose.
- Act s. 8: technical and organisational measures, reasonable security safeguards, breach obligations, erasure when consent is withdrawn or purpose ends subject to lawful retention.
- Act ss. 11–14: access, correction/erasure, grievance and nomination rights.
- Act s. 16: transfer restrictions may be notified by Government.
- Rules rr. 3, 6–11: notice content, minimum security safeguards, breach notification detail, retention/erasure mechanics, contact information, verifiable consent for children/guardians.
- First Schedule: statutory Consent Manager obligations are a distinct regulated role and are **not** assumed by PTF.

Commencement is phased. Rule 4/Consent Manager registration takes effect one year after the 13-Nov-2025 Gazette publication; most substantive Data Fiduciary rules take effect eighteen months after publication. The implementation must not hard-code commencement dates into the authority kernel.

## 3. Product boundary

### 3.1 What PTF will do

PTF privacy mode will:

1. keep privacy-law subject identity distinct from PTF authority identity;
2. record operator-supplied processing-basis evidence and notice/consent evidence;
3. record operator-declared processing activities;
4. deterministically deny personal-data processing that lacks a matching active processing activity/basis;
5. enforce purpose, data-category and recipient minimisation;
6. re-check privacy state at actual use/disclosure time so withdrawal or expiry takes effect before processing;
7. create secret-free processing evidence tied to the PTF authority decision and exact operation digest;
8. support exact-record erasure and retention holds;
9. provide a PTF-observed processing summary suitable as evidence for rights workflows;
10. expose an India DPDP profile over jurisdiction-neutral privacy primitives.

### 3.2 What PTF will not do

PTF will not:

- determine that a legal basis is legally sufficient;
- determine that an organisation is “DPDP compliant”;
- act as legal counsel, DPO, auditor, or Data Protection Board;
- become a statutory Consent Manager merely by enabling consent evidence;
- infer a lawful basis from model output, policy text, or personal state;
- make an agent choose or assert its own legal basis;
- implement breach detection or regulatory notification in v1 of this subsystem;
- manage processor contracts;
- decide whether a foreign transfer is lawful absent an operator-supplied transfer rule;
- replace the existing Authority engine with a privacy engine;
- put DPDP-specific branches in `src/core/authority.ts`;
- copy GDPR/other-jurisdiction logic into the DPDP profile. Future laws get separate profiles.

## 4. Domain model

### 4.1 New invariant

PTF will add this semantic invariant:

> **Personal State ≠ Authority State ≠ Processing Basis Evidence.**

A fourth distinction is also mandatory:

> **PTF Principal ≠ Privacy Data Principal.**

They may be the same individual in a personal deployment, but enterprise processing must not assume that. An organisation-controlled agent may act under an organisational/host authority principal while processing personal data relating to another individual.

### 4.2 Canonical terms

**Privacy Data Principal**  
The individual to whom the personal data relates for a privacy-law evaluation. Distinct from PTF `Principal`.

**Data Fiduciary / Controller**  
The organisation or person that determines the purpose and means of processing. PTF stores an identifier only; it does not infer this role.

**Processing Basis Evidence**  
An operator-supplied, durable record that asserts the privacy basis relied on for a processing activity and points to the evidence supporting that assertion. It is evidence, not authority.

**Notice Evidence**  
Versioned evidence that a notice for a specific purpose/data scope was presented. It stores references/hashes and metadata, not the full notice unless the host chooses to keep it elsewhere.

**Consent Evidence**  
Evidence of affirmative consent bound to one notice, one privacy data principal, one purpose and an explicit set of data categories. Withdrawal changes the evidence state; it does not mutate Authority State.

**Processing Activity**  
An operator-declared description of a class of personal-data processing: exact action, resource type, purpose, categories, recipients, basis reference and optional retention reference. Activities narrow runtime processing and never grant PTF authority.

**Privacy Decision**  
A deterministic allow/deny result. An allow proves only that configured privacy controls passed; it is not a legal-compliance conclusion.

**Processing Event**  
A secret-free, queryable record of personal-data processing actually delivered/used/executed through privacy mode. It links the activity, basis, data principal, actor, exact PTF terms digest and authority citations.

**Retention Hold**  
An operator-supplied reason and end condition that blocks erasure of specified records/categories while normal processing remains independently subject to privacy and authority checks.

**Privacy Profile**  
A jurisdiction/profile-specific validator over the jurisdiction-neutral model. `IN-DPDP-2025` is the first profile.

## 5. Invariants

The following MUST hold:

1. A Privacy Decision can deny processing; it can never create PTF authority.
2. No matching active privacy activity in privacy mode means deny.
3. No matching active processing-basis evidence means deny.
4. An AI/agent never supplies `basisId`, controller identity, privacy data-principal identity, or legal basis through an agent-facing tool schema.
5. Privacy subject identity comes from trusted host/application context.
6. Requested/used data categories must be a subset of the Processing Activity and active basis scope.
7. Recipients must be a subset of the Processing Activity and active basis scope.
8. Purpose must match exactly in v1; no purpose prefix/wildcard semantics.
9. Consent withdrawal must block future consent-based processing on the next privacy evaluation without revoking unrelated Authority State.
10. Privacy approval never substitutes for `Authority.evaluate`; both gates must pass.
11. Existing `authorized_operation === executed_operation` remains unchanged.
12. Processing events never contain raw personal values, secrets, credentials, notice bodies, or consent content.
13. Erasure is by exact vault record identifier; no unconstrained “delete all” primitive exists in the vault layer.
14. A retention hold can prevent erasure but does not itself authorise use/disclosure.
15. Privacy profiles do not infer legal conclusions. An external trusted actor must assert the basis/evidence.
16. Existing non-privacy deployments remain behaviorally backward-compatible unless privacy mode is explicitly enabled.
17. PTF must never describe the result as `compliant=true`. Decisions use control language such as `allow`, `deny`, `basis-active`, and `processing-recorded`.

## 6. Architecture

The privacy subsystem is a narrowing layer adjacent to, not inside, the authority kernel.

```text
trusted host / agent ingress
            |
            v
  canonical PTF operation
            |
            +-----------------------------+
            |                             |
            v                             v
  privacy processing context        Authority.evaluate
  (trusted host derived)                  |
            |                             |
            v                             |
     PrivacyRuntime                       |
            |                             |
      PrivacyProfile                      |
            |                             |
      PrivacyState                        |
            |                             |
            +----------- AND -------------+
                        |
                        v
             disclosure / protected use /
                 provider execution
                        |
                        v
                existing PTF receipt
                        |
                        v
               Processing Event
```

No privacy module imports into `src/core/`. Privacy code may depend on core public types, stores, and host-side adapters; core never depends on privacy.

## 7. Module design

### 7.1 New deep module: `src/privacy/`

#### `src/privacy/model.ts`

Owns the canonical jurisdiction-neutral types and validation helpers:

- `PrivacyDataPrincipalRef`
- `NoticeEvidence`
- `ConsentEvidence`
- `ProcessingBasisEvidence`
- `ProcessingActivity`
- `TrustedProcessingContext`
- `PrivacyDecision`
- `PrivacyDenyReason`
- `ProcessingEvent`
- `RetentionHold`
- `PrivacySnapshot`

No network, file, CLI, or MCP I/O.

#### `src/privacy/engine.ts`

A deterministic evaluator with a narrow interface:

```text
evaluateProcessing(activity, basis, trustedContext, profile, now)
  -> PrivacyDecision
```

Evaluation sequence:

1. validate trusted context;
2. locate one exact active activity;
3. ensure authority principal/controller relationship matches configured activity;
4. ensure privacy data-principal scope matches;
5. ensure exact purpose/action/resource-type match;
6. ensure requested categories are subsets of activity and basis scope;
7. ensure recipients are subsets of activity and basis scope;
8. ensure basis is active and profile-valid;
9. ensure no applicable privacy lifecycle block prevents processing;
10. return allow with evidence identifiers only.

No side effects and no PTF Authority mutation.

#### `src/privacy/runtime.ts`

Owns composition with existing PTF behavior.

Responsibilities:

- perform privacy preflight before authority consumption;
- call existing disclosure/use/execution seams rather than reimplement them;
- re-evaluate live privacy state immediately before consequential processing;
- record the Processing Event after successful delivery/use/execution and before returning the result to the agent-facing caller;
- idempotently recover processing-event recording when an existing execution journal already proves success;
- produce rights summaries from PTF-observed Processing Events;
- orchestrate exact-record erasure subject to Retention Holds.

The runtime is the public “privacy enforcement mode” seam. Callers wanting DPDP controls should use the runtime rather than manually composing lower-level stores.

#### `src/privacy/dpdp.ts`

Implements profile id `IN-DPDP-2025`.

It validates configured evidence; it does not decide legal sufficiency.

Minimum profile behavior:

- accepted basis codes in v1: `consent`, `certain-legitimate-use`;
- consent basis requires active Consent Evidence tied to Notice Evidence;
- consent purpose/data categories must exactly/subset match the configured activity;
- withdrawn consent fails closed;
- certain-legitimate-use requires a non-empty provision/evidence reference and trusted `assertedBy`;
- when trusted subject classification is `child`, processing requiring consent must include guardian-verification evidence;
- when subject classification indicates a person with disability acting through a lawful guardian, consent-based processing requires guardian evidence;
- transfer destination, if supplied, is checked only against an operator-supplied transfer constraint; the profile does not invent prohibited jurisdictions;
- profile output uses control references, never “legal” / “illegal”.

Future GDPR/UK-GDPR/PDPA/CCPA profiles implement the same privacy-profile interface without editing this file.

### 7.2 New durable privacy store: `src/store/privacy.ts`

Stores:

- Notice Evidence;
- Consent Evidence;
- Processing Basis Evidence;
- Processing Activities;
- Retention Holds;
- bounded Processing Events;
- revision metadata.

The store uses a separate privacy DEK alias, e.g. `ptf/privacy-dek`, in the existing keystore. Privacy metadata can itself be personal/confidential; it is encrypted at rest.

Privacy state is one CAS-managed encrypted snapshot in v1. Maximum processing-event count is bounded; operators must export/archive before pruning. Pruning cannot remove events still required by configured retention obligations.

### 7.3 Extract encrypted snapshot plumbing

Current `src/store/vault.ts` is ~1,048 lines and contains record semantics, disclosure/use logic, encryption envelope, persistence, migration and key rotation.

Adding a second encrypted privacy store by copy/paste is forbidden.

Extract the reusable cryptographic/persistence mechanics into a narrow module such as:

- `src/store/sealed-snapshot.ts`

It owns:

- AES-256-GCM envelope encode/decode;
- key-id fingerprint validation;
- canonical JSON sealing/opening;
- revision-CAS file save/load primitives.

Domain validation remains in the vault/privacy stores. The helper must not become a generic magic ORM/store.

### 7.4 Decompose vault without breaking imports

Preserve `./vault` and existing named exports.

Refactor internals so `src/store/vault.ts` becomes a compatibility facade over focused modules:

- record model/lifecycle;
- disclosure and protected secret use;
- persistence/encryption.

Add exact-record erasure in the record/lifecycle module:

```text
eraseRecord({ id, owner }, at) -> VaultErasureReceipt
```

Requirements:

- exact id required;
- owner must match;
- unknown record fails closed;
- receipt includes only id/type/version/timestamp;
- raw value never enters receipt/audit;
- persistence uses existing revision CAS;
- erasure audit event is appended after durable save;
- backup copies are explicitly outside immediate erasure reach and remain a documented host lifecycle duty.

No bulk `eraseAll(owner)` primitive at vault level.

### 7.5 Existing large files

No DPDP-specific conditional logic may be added directly to:

- `src/core/authority.ts`;
- `src/adapters/providers.ts`;
- `src/mcp-server.ts`;
- `src/cli.ts`.

Integration into large host files must be by small calls into focused modules.

If new operator commands are added, implement them in a dedicated CLI module and keep the existing top-level CLI to parsing/routing glue.

If MCP privacy mode is added, agent-facing schemas remain unchanged for existing tools. Basis/controller/privacy-subject fields are host-resolved and cannot be agent supplied.

## 8. Persistence and key custody

Privacy state is encrypted under `ptf/privacy-dek`.

Required behaviors:

- `privacy-init` creates the privacy DEK if absent;
- passphrase rotation re-wraps the keystore and does not re-encrypt privacy state;
- `privacy-rekey` rotates the privacy DEK with the same crash-safe stage/seal/promote philosophy used by the vault;
- backup/restore includes `privacy-state.json` and verifies that the privacy DEK is available when privacy state is present;
- restore treats the PTF store as one coherent unit;
- privacy revision is included in freshness/audit binding when privacy state mutates.

No privacy-state key or plaintext is emitted to agent tools, receipts, logs, or CLI output.

## 9. Privacy evaluation data flow

### 9.1 Disclosure

```text
agent asks for claims
        |
trusted ingress binds PTF actor/principal
        |
host derives Privacy Data Principal + recipient
        |
PrivacyRuntime maps request to exact Processing Activity
        |
privacy preflight (no authority consumption)
        |
Authority dry-run/proposal
        |
human approval if needed
        |
live privacy re-check
        |
existing VaultStore disclosure consumes authority
        |
signed presentation produced
        |
Processing Event persisted
        |
presentation returned
```

For vault disclosure, data categories are derived from the claim names PTF is actually about to disclose; they are not independently asserted by the agent.

### 9.2 Protected secret use / execution

The trusted provider/host adapter supplies the privacy processing context. Agent input is never trusted for basis or subject identity.

```text
agent proposes exact action
        |
privacy preflight
        |
authority/redeem
        |
live privacy re-check
        |
existing protected execution / journal
        |
success/reconcile
        |
Processing Event persisted idempotently
        |
secret-free result returned
```

No privacy layer reimplements the execution journal.

## 10. Processing evidence

Each Processing Event contains only identifiers/metadata:

- event id;
- privacy profile id/version;
- privacy data-principal reference;
- PTF authority principal;
- verified actor;
- controller/data-fiduciary id;
- activity id;
- basis id;
- purpose;
- action;
- resource type/id;
- data-category names;
- recipient ids;
- PTF terms digest;
- authority citation ids;
- linked execution/receipt reference when applicable;
- timestamp;
- outcome kind.

No raw personal value, secret, credential, free-text notice, free-text legal analysis, or model reasoning is permitted.

Processing Events must be idempotent for a stable operation/outcome key so crash recovery cannot duplicate evidence records.

## 11. Consent semantics

Consent Evidence is not a Standing Grant.

Recording consent:

- does not add an Authority grant;
- does not make an otherwise denied operation executable;
- is usable only through a Processing Activity that references it.

Withdrawing consent:

- sets the consent evidence inactive/withdrawn;
- immediately causes future privacy evaluation under that consent basis to deny;
- does not revoke unrelated Authority grants;
- does not erase data when an active Retention Hold or other configured retention necessity exists;
- exposes the affected activities/records to the rights/erasure planner.

The implementation stores evidence references and structured scope. A host may store the human-readable notice/consent artifact externally; PTF binds it by stable reference/hash.

## 12. Retention and erasure

PTF must not infer statutory retention periods.

The operator supplies Retention Holds/constraints with:

- id;
- privacy data-principal;
- target record ids and/or categories;
- reason reference;
- asserted-by identity;
- effective time;
- retain-until time or explicit indefinite/legal-hold marker.

Rights workflow:

```text
erasure request
     |
build exact candidate record ids
     |
privacy retention evaluation
     |
+---------------------+
|                     |
eligible              held
|                     |
v                     v
exact-record erase    retain encrypted
|                     |
processing/audit      normal use still requires
evidence              fresh privacy + authority allow
```

A hold prevents erasure; it does not create processing authority.

PTF v1 does not claim to erase copies outside its managed live store, including historical external backups, downstream processors, logs owned by other systems, or external providers. Those remain explicit host/Data Fiduciary obligations.

## 13. Rights support

The privacy subsystem provides **PTF-observed evidence**, not a complete enterprise DSAR platform.

### Processing summary

For one Privacy Data Principal, return:

- categories processed;
- purposes/activities;
- recipients/processors recorded through PTF;
- processing timestamps;
- basis references;
- current consent state;
- PTF-managed record ids eligible/held for erasure.

It must not dump secrets or unrelated Personal State.

### Correction

Correction continues through exact `VaultStore.putRecord` versioning with an operator-controlled rights flow. A correction Processing Event is recorded.

### Erasure

Use the exact-record erasure path described above. No agent-facing erasure MCP tool in v1.

## 14. Agent/MCP boundary

Privacy configuration is operator-owned.

Agents must not be able to:

- register notices;
- create bases;
- assert “legitimate use”;
- mark someone an adult/child;
- create/release retention holds;
- withdraw someone else's consent;
- erase data;
- edit Processing Events.

When privacy mode is enabled for an MCP server, existing agent tools use host-resolved privacy context. The agent schema does not grow fields such as `basisId` or `dpdpPurpose`.

Existing deployments with privacy mode disabled retain current behavior.

## 15. Operator surface

Add one top-level `privacy` command routed to a dedicated implementation module rather than expanding `cli.ts` with business logic.

Required operator flows in the first implementation:

- initialise privacy state;
- record/list notice evidence;
- record/list processing basis;
- withdraw consent basis;
- record/list processing activities;
- add/release/list retention holds;
- show privacy decision for a dry-run processing demand;
- produce processing summary for a privacy data principal;
- plan erasure;
- execute approved exact-record erasure;
- verify/rekey privacy store.

CLI output is metadata-only and must never print raw personal values or secret evidence artifacts.

## 16. Public package surface

Add a curated package subpath:

- `./privacy`

It exports the stable privacy runtime/model interfaces, not persistence internals.

Optionally expose:

- `./privacy/dpdp`

for the DPDP profile if it remains small and independently useful.

Extending the public surface requires updating ADR-0011 or a superseding ADR.

Internal stores remain deep/host-only.

## 17. Architecture records and glossary changes

Implementation must add one ADR because the decision is hard to reverse, surprising without context, and based on a genuine trade-off:

**ADR-0024 — Privacy enforcement is a narrowing layer, not authority**

It records:

- Personal State ≠ Authority State ≠ Processing Basis Evidence;
- PTF Principal ≠ Privacy Data Principal;
- privacy can deny, never grant;
- profiles at the edge, core jurisdiction-neutral;
- legal sufficiency is external evidence;
- privacy mode is explicit and backward-compatible.

`CONTEXT.md` gains the canonical terms from section 4 without implementation detail.

## 18. Structural refactoring requirements

The implementation is not approved if it achieves behavior by growing existing god files.

Mandatory structural constraints:

1. `src/core/authority.ts` must not gain DPDP/privacy-specific code.
2. `src/store/vault.ts` must end materially smaller than its current ~1,048 lines.
3. No new privacy implementation file should exceed ~500–600 lines without a documented reason.
4. `src/cli.ts` and `src/mcp-server.ts` may gain routing/hooks only; privacy business logic belongs in focused modules.
5. Encrypted snapshot mechanics are extracted once and reused; no copied AES-GCM/CAS implementation.
6. No new runtime dependency is expected. Adding one requires a separate ADR because CI currently pins the dependency allowlist.
7. Existing imports through `./vault` and current public exports remain compatible.

## 19. User stories

1. As a Data Fiduciary operator, I want to register the privacy purpose and data scope for an AI processing activity so that the AI cannot process unrelated personal data.
2. As a Data Fiduciary operator, I want processing-basis evidence stored separately from agent authority so that legal-basis evidence cannot accidentally grant technical power.
3. As a Data Principal, I want withdrawal of my consent to stop future consent-based processing on the next attempt.
4. As a Data Principal, I want the AI to receive only the claims necessary for the configured purpose.
5. As a Data Principal, I want my data disclosed only to configured recipients/processors.
6. As an operator, I want a legitimate-use basis to require a trusted external assertion/evidence reference rather than be inferred by an AI.
7. As an operator, I want processing involving a child or lawful guardian to fail closed when the configured DPDP profile requires verification evidence and none is present.
8. As a security reviewer, I want privacy allow decisions to remain incapable of overriding an authority denial.
9. As an auditor, I want every PTF-mediated personal-data processing event tied to an actor, purpose, basis, categories, recipient and exact terms digest without recording personal values.
10. As a Data Principal, I want a summary of the processing PTF has observed concerning me.
11. As an operator, I want to identify exact PTF-managed records eligible for erasure.
12. As an operator, I want legal/retention holds to block erasure without authorising unrelated processing.
13. As an operator, I want exact-record erasure to be durable and auditable without leaving the deleted value in receipts/logs.
14. As an operator, I want privacy state encrypted at rest with independent key rotation.
15. As a backup operator, I want privacy state included in PTF's one-unit backup/restore and verified on restore.
16. As an existing PTF user, I want all current non-privacy behavior to remain unchanged unless privacy mode is enabled.
17. As an agent developer, I do not want to choose legal-basis fields in my tool calls; the trusted host should resolve them.
18. As a future profile author, I want to add another jurisdiction without modifying PTF Authority semantics or the DPDP profile.
19. As a maintainer, I want the vault refactor to preserve existing imports/tests while reducing the god-file surface.
20. As a maintainer, I want privacy decisions and tests to use closed deterministic reason codes rather than free-form legal prose.

## 20. Deny reasons

The privacy engine uses a closed vocabulary, initially:

- `no-processing-activity`
- `activity-inactive`
- `principal-mismatch`
- `controller-mismatch`
- `purpose-mismatch`
- `action-mismatch`
- `resource-mismatch`
- `basis-missing`
- `basis-inactive`
- `basis-invalid`
- `data-category-forbidden`
- `recipient-forbidden`
- `guardian-evidence-required`
- `transfer-forbidden`
- `retention-restricted`
- `other` only for sanitized internal-validation failures

No denial detail may contain personal values.

## 21. Testing strategy

Tests continue to cross the public test seam through `src/index.ts`, except existing bin tests.

### Unit/property tests

- privacy evaluation default-deny;
- privacy allow never creates authority;
- exact purpose/action/resource matching;
- data-category subset properties;
- recipient subset properties;
- withdrawn/expired basis denial;
- consent requires notice evidence;
- legitimate-use requires trusted evidence reference;
- child/guardian evidence cases;
- retention hold does not grant processing;
- event records contain no supplied sentinel personal values;
- exact-record erase removes only the intended record;
- erased value does not appear in audit/receipt/processing evidence;
- sealed privacy state tamper/wrong-key failure;
- privacy-state CAS stale-writer failure.

### Integration tests

- MCP disclosure in privacy mode: valid activity+basis passes; same authority with missing basis denies.
- Agent cannot supply/override basis/controller/privacy-subject fields.
- Withdraw consent between proposal and present: present denies without disclosure.
- Change requested claims after privacy preflight: digest/normal checks fail; no widened disclosure.
- Successful disclosure persists Processing Event before response is returned.
- Protected action journal replay returns same external receipt and idempotently fills any missing Processing Event.
- Erasure under hold is blocked; release hold then exact record erase succeeds.
- Backup/restore round-trip includes encrypted privacy state.
- Old store without privacy state still passes all legacy tests.

### Adversarial cases

- prompt-injected agent tries to select a different basis;
- agent claims the data subject is an adult;
- agent adds extra claim/recipient;
- stale privacy snapshot after consent withdrawal;
- tampered consent/notice refs;
- privacy store rollback/mixed backup;
- processing-event injection with secret-looking values;
- repeated erase/replay;
- hostile free-text evidence references attempting log injection.

### Verification gate

Before merge:

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
npm pack --dry-run
```

Docs CI must also remain green.

## 22. Acceptance criteria

The implementation is acceptable only if all are true:

1. A valid PTF Authority grant alone cannot pass privacy mode without valid configured Processing Activity + Basis Evidence.
2. Valid privacy evidence alone cannot pass when PTF Authority denies.
3. Consent withdrawal between proposal and actual disclosure/use blocks processing.
4. Data minimisation is mechanically demonstrated by denial of one additional claim.
5. An agent cannot choose or mutate its legal basis through MCP input.
6. Processing evidence contains no raw personal data in sentinel leak tests.
7. Exact-record erasure is implemented and retention holds block erasure without granting use.
8. Privacy state is encrypted and participates in coherent backup/restore.
9. Existing non-privacy test/eval suites remain green.
10. No DPDP-specific branch is introduced into the Authority core.
11. `vault.ts` is decomposed rather than expanded.
12. Privacy business logic does not accumulate in `cli.ts` or `mcp-server.ts`.
13. Public docs say “helps enforce/support DPDP controls,” never “guarantees compliance.”
14. Known residuals and unsupported DPDP obligations are documented in `docs/audit/limits.md`.

## 23. Explicit residuals after this implementation

Even after this design is implemented, PTF will not by itself prove full DPDP compliance.

Residual responsibilities include:

- correctness of the organisation's asserted legal basis;
- correctness/completeness of notices;
- contracts with Data Processors;
- breach detection and statutory notification;
- data copies outside PTF;
- enterprise-wide DSAR completeness;
- backup expiry/destruction outside the live PTF store;
- external-system correction/erasure;
- DPO/grievance operations;
- Significant Data Fiduciary DPIA/audit duties;
- regulatory transfer notifications and other laws;
- statutory Consent Manager registration/governance if that role is pursued.

## 24. Implementation decomposition after approval

This design is an umbrella architecture. It is intentionally **not** safe to execute as one giant implementation plan or one giant PR. The implementation must remain one coherent mission, but it is decomposed into independently verifiable slices. Each slice must keep legacy verification green before the next slice is integrated.

### Slice A — Foundation and vault decomposition

Scope:

1. ADR-0024 + glossary changes + baseline verification evidence.
2. Extract `sealed-snapshot` cryptographic/CAS plumbing without behavior changes.
3. Decompose `vault.ts` behind the existing compatibility/public facade.
4. Add exact-record erasure and its audit/receipt semantics.
5. Prove all pre-existing tests/evals/harness checks remain green.

Exit criteria:

- no privacy semantics yet;
- no public API break;
- `vault.ts` materially smaller;
- baseline and treatment behavior equivalent except for the new exact-record erasure seam.

### Slice B — Privacy model, engine and encrypted state

Scope:

1. jurisdiction-neutral privacy model;
2. deterministic narrowing engine;
3. encrypted privacy store and separate DEK lifecycle;
4. DPDP profile;
5. backup/restore + freshness integration;
6. property/adversarial tests for default-deny, basis/consent scope, guardian evidence, minimisation and tamper/CAS behavior.

Exit criteria:

- privacy evaluation works through a pure public/test seam;
- privacy allow cannot create authority;
- privacy state is encrypted, bounded and backed up coherently;
- no MCP/CLI agent integration yet.

### Slice C — Runtime enforcement and evidence

Scope:

1. `PrivacyRuntime` composition over existing disclosure, protected-use and journal seams;
2. live re-evaluation immediately before processing;
3. secret-free Processing Events;
4. idempotent post-success evidence recovery;
5. processing summary;
6. retention/erasure planner using exact-record erasure.

Exit criteria:

- authority-only and privacy-only paths each fail independently when the other gate denies;
- withdrawal between proposal and processing blocks the effect;
- processing evidence contains no sentinel personal value;
- existing exact-operation/journal semantics are reused, not duplicated.

### Slice D — Operator and agent-host integration

Scope:

1. dedicated privacy CLI module + thin top-level routing;
2. explicit privacy-mode host configuration;
3. MCP hooks that resolve basis/controller/privacy-subject context outside agent schemas;
4. public package subpath(s);
5. docs, changelog, known limits and operator guidance.

Exit criteria:

- agents cannot select or mutate legal-basis fields;
- existing MCP deployments behave identically when privacy mode is disabled;
- privacy configuration remains operator-owned.

### Slice E — Independent review and release gate

Scope:

1. thermo-nuclear/engineering structural review of the complete diff;
2. fix all evidenced BLOCKER/MAJOR findings;
3. full project verification;
4. `verify-this` verdicts for the acceptance claims in section 22;
5. packaging/public-surface audit;
6. final no-regression comparison against the frozen base SHA.

A slice may use a dedicated implementation branch/PR, but the final feature is not complete until all slices pass the section-22 acceptance criteria. No slice may compensate for a failed invariant in another layer by adding a special case to the Authority core.


## 25. Decision

Proceed with a **privacy-enforcement subsystem**, not a “compliance engine.”

PTF remains an authority and protected-use fabric. Privacy mode adds a second, independently sourced narrowing gate over personal-data processing. The DPDP profile is the first jurisdiction profile; legal sufficiency remains external evidence.

This design deliberately spends complexity on a small number of durable concepts—Processing Activity, Processing Basis Evidence, Privacy Decision, Retention Hold and Processing Event—while reusing PTF's existing authority, exact-operation, protected-use, journal, audit and backup semantics.
