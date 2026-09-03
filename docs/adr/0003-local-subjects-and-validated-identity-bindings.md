# ADR 0003 — Local Subjects with Validated External Identity Bindings

Status: **Proposed**

## Context
PTF must reason consistently across web origins, payment addresses, verifier identities, Agent keys, provider accounts, and protocol identifiers without inventing a global identity system or trusting labels.

## Decision
If approved, PTF will use stable local Subjects plus independently validated IdentityBindings/EndpointBindings. Identity, authentication, trust, and authorization remain separate. Trust is role-/purpose-specific.

## Consequences
Recipient substitution must be tested against fresh authenticated binding evidence. A pseudonymous Principal may still satisfy strong user verification because legal identity and authentication are separate properties.

This ADR becomes Accepted only after explicit human approval of the proposed specification.