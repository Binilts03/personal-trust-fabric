# Domain Model

Use these terms consistently. Keep implementation details out of the domain glossary.

## Human Principal
The person whose interests, personal state, and authority PTF represents.

## Agent
Software that plans or acts for the Human Principal. It is not the Human Principal.

## Agent Instance
A concrete agent runtime/session with provenance and, where available, an authenticated instance identity.

## Task
A bounded Human objective.

## Recipient
An external service or verifier intended to receive an authorized disclosure, proof, or action.

## Purpose
The declared reason an operation is requested. Purpose is a policy dimension, not free-form justification by the model.

## Protected Value
Data whose raw value is subject to protected handling: identifiers, secrets, credentials, payment information, private attributes, or similar data.

## Secret Reference
A trusted-runtime reference to a Protected Value. It is not itself evidence of authority.

## Personal Observation
A timestamped input/event that may be used as evidence for personal state. It can be untrusted.

## Evidence
A source-linked item supporting or contradicting a Persona Claim.

## Persona Claim
A fact or preference hypothesis about the Human with source, context, confidence, sensitivity, timestamp, and status.

## Confirmed Preference
A preference explicitly accepted by the Human or otherwise promoted under an approved rule.

## Hard Policy
A deterministic authorization rule. Hard Policy is not a learned preference.

## Authority Grant
A Human- or policy-approved authorization for a bounded action or disclosure.

## Capability
A constrained ability to request or execute an operation under an Authority Grant. A capability may be represented to an agent by an opaque handle, but the handle's possession must not imply broader rights than the grant.

## Capability Constraint
A restriction such as recipient, purpose, action, resource, scope, amount, currency, task, transaction, device, time, use count, or delegation depth.

## Disclosure Candidate
One possible representation/channel for satisfying a request.

## Disclosure Plan
The selected allowed representation and channel, after hard authorization.

## Agent Safe View
Task-specific model-visible state derived from canonical personal state and policy.

## Credential
Issuer-attested claims plus the metadata/cryptographic material required by its format.

## Credential Presentation
A verifier-targeted presentation/proof derived from a Credential.

## Payment Authority
Bounded permission to perform a payment action, distinct from the payment instrument/credential.

## Signing Authority
Bounded permission to use a signing key for an approved operation, distinct from possession/export of the private key.

## Consequential Action
An action with material external effect that may require explicit approval.

## Trust Runtime
The trusted PTF execution environment responsible for policy, protected state, capability enforcement, disclosure planning, and receipts.

## Trust Registry
Metadata used to evaluate recipients, issuers, protocol endpoints, keys, and assurance. Registry data itself can have different trust levels.

## Approval
A Human decision over a concrete proposed action/disclosure.

## Receipt
A non-secret record of what PTF authorized/executed/denied, under which policy and terms.

## Revocation
A state transition that invalidates authority, capability, device, credential, or trust metadata as applicable.

## Adapter
A translation layer between an external protocol/API and PTF semantics. An Adapter does not own the core authorization model.

## Scenario
A product demonstration or use case consuming the generic PTF interfaces. Scenario terms must not leak into the generic trust-core domain.

## Domain separation checks

- Persona Claim ≠ Hard Policy.
- Protected Value ≠ Capability.
- Authority Grant ≠ Capability Handle.
- Human Principal ≠ Agent.
- Recipient ≠ Agent.
- Authentication ≠ Authorization.
- Authorization ≠ Disclosure Plan.
- Credential ≠ Presentation.
- Payment Authority ≠ Payment Credential.
- Signing Authority ≠ Private Key.
- Scenario ≠ Product.
