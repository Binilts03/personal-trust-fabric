# Data Model and State Machines

This is a conceptual model. Codex must select storage/serialization technology after architecture validation.

## 1. Core records

### HumanPrincipal
- id
- created_at
- status

### Device
- id
- principal_id
- public_key / key reference
- assurance metadata
- enrolled_at
- revoked_at

### AgentInstance
- id
- agent/client identity metadata
- principal/task/session relationship
- assurance/provenance
- created_at / expires_at

### Observation
- id
- principal_id
- source
- observed_at
- sensitivity
- integrity/trust label
- content/reference
- provenance

### PersonaClaim
- id
- principal_id
- canonical subject/key
- value or protected reference
- context
- source evidence ids
- explicit/inferred
- confidence
- sensitivity
- state
- valid_from / expires_or_revalidate_at
- supersedes / contradicted_by

### HardPolicy
- id/version
- principal_id
- match conditions
- effect
- approval requirement
- created_by
- effective_from / revoked_at

### ProtectedValue
- id
- principal_id
- classification
- storage/key reference
- allowed handling modes
- metadata safe for model/UI
- created_at / rotated_at / revoked_at

### CredentialRecord
- id
- principal_id
- format/profile
- issuer/trust metadata
- holder/key reference
- safe claim metadata
- status/revocation metadata
- protected payload reference

### AuthorityGrant
- id
- principal_id
- source approval/policy
- action/resource/recipient/purpose constraints
- claim/data scope
- transaction binding
- amount/currency if applicable
- valid_from/expires_at
- use_count/delegation constraints
- state
- policy hash/version

### Capability
- id
- grant_id
- agent/session/task binding where applicable
- representation/holder binding
- issued_at/expires_at
- remaining uses
- state

### DisclosureRequest
- id
- requester/recipient
- purpose
- requested claims/proof/action
- task/transaction context
- nonce
- created_at

### DisclosurePlan
- request_id
- authorization decision reference
- selected representation
- selected channel
- allowed fields/actions
- assurance/downgrade
- obligations if any

### Approval
- id
- principal_id
- proposal digest
- displayed terms
- decision
- decided_at
- expires_at

### Receipt
- id
- correlation id
- action/disclosure type
- recipient/purpose
- policy/grant references
- safe outcome
- timestamp
- integrity/tamper-evidence fields
- no raw protected payload

### RevocationEvent
- id
- target type/id
- principal/source
- reason
- effective_at
- propagation status

### SyncEvent
- id
- principal/device
- object/version reference
- encrypted payload/reference
- causal/version metadata
- signature/integrity metadata

## 2. State machines

### Persona Claim
`observed -> candidate -> shadow/under-review -> confirmed | contextual | rejected -> superseded/expired`

Direct explicit Human entries may enter `confirmed` under policy. Untrusted external content cannot skip trust transitions.

### Approval
`proposed -> pending -> approved | denied | expired | superseded`

Any approval-relevant proposal mutation creates a new proposal/digest.

### Authority Grant
`draft -> active -> consumed | expired | revoked`

Multi-use grants may remain active until use/time constraints are exhausted.

### Capability
`issued -> active -> used/consumed | expired | revoked`

Derived capability must be equal-or-narrower across every constrained dimension.

### Credential
`available -> suspended | expired | revoked`
with format-specific status semantics mapped by the adapter.

### Device
`pending -> active -> revoked/lost`

### Sync event
`created -> signed/encrypted -> replicated -> applied | conflicted/rejected`

Policy conflicts that could broaden authority fail closed until resolved.

## 3. Serialization boundaries

Define separate DTO/schema families:
- canonical trusted records;
- agent-safe records;
- user UI records;
- recipient request/response;
- audit/receipt;
- sync ciphertext envelope.

Do not reuse trusted canonical serialization as a shortcut for model-facing or log-facing output.

## 4. Transaction digest

Consequential approval should bind a canonical representation of approval-relevant terms. The exact canonicalization format is an architecture decision. Tests must prove that semantically material mutations change the binding and semantically irrelevant representation changes are handled predictably.
