# ADR 0003 — Local Subjects with Validated External Identity Bindings

Status: Accepted  
Date: 2026-09-03

## Context

PTF must reason consistently about Principals, Agents, Recipients, Issuers, and Executors across multiple external protocols. A protocol-only model leaves no stable internal subject, while a new global PTF identity system would create unnecessary centralization, correlation risk, and adoption burden. Earlier sandbox code also demonstrated the danger of treating a caller-supplied recipient identifier plus an `authenticated` boolean as if that were recipient authentication.

## Decision

PTF uses stable **local Subjects** for internal reasoning. Subject identifiers have no external authentication meaning by themselves.

External identities and endpoints are connected to Subjects through independently validated **IdentityBindings** and **EndpointBindings**.

Identity, authentication, trust, and authorization remain distinct:

- identity describes who/what a Subject represents;
- authentication is fresh evidence that the current party controls an accepted binding;
- TrustRelation describes the role/purpose for which an authenticated Subject/binding is accepted;
- authorization determines what that actor may do in the current action.

Trust is role- and purpose-specific, not a global boolean or scalar reputation score.

Different web origins, payment addresses, protocol identifiers, keys, certificates, verifier identifiers, or provider accounts are never assumed equivalent merely because they share a name.

## Consequences

- PTF can correlate a real merchant across AP2, OpenID, x402, and web identities only after validating the relevant binding relationships.
- Principal identity may remain pseudonymous where legal identity is unnecessary.
- Agent identity can remain stable across model/provider/runtime changes when the delegation intentionally targets the logical Agent.
- Recipient substitution tests must validate real authentication/binding evidence rather than strings.
- Trust registries store validated bindings/relations and provenance, not global reputation.
- Key rotation and endpoint migration require continuity evidence.
