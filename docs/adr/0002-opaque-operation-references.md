# ADR-0002: Opaque operation references are not bearer authority

**Date**: 2026-09-02
**Status**: accepted
**Deciders**: Controller
**Requirements**: U-04, U-05; P5, P12; INV-02, INV-03, INV-06; S-02–S-05

## Context

Agents need to correlate and continue protected operations without receiving protected values. A signed or opaque token can still become a transferable bearer secret if possession is sufficient. Different credential/payment/signing adapters may emit established artifacts, so a universal PTF cryptographic token would add risk without current need.

## Decision

The generic agent-visible reference is a random opaque correlation identifier backed by authoritative runtime state. It carries no self-contained authority. Every execute/redeem call re-evaluates current grant/capability state and constraints; policies that require recipient/holder authentication demand independent proof. Adapter-native artifacts stay outside the core semantic model.

## Alternatives considered

- Signed attenuable/macaroons-style token: useful for decentralized verification, but creates key/distribution/revocation and bearer-forwarding complexity before a requirement exists.
- OAuth/RAR/DPoP token: strong candidate for specific recipient adapters, but cannot define all PTF operation classes.
- Credential/presentation as universal authority: conflates credential proof with payment/signing/action authority.

## Security and trust effect

Prompt injection can disclose a reference without automatically transferring policy-required recipient rights. Authoritative state enables atomic one-time use and immediate revocation for the initial profile.

## Operational effect

Redemption requires runtime reachability. Distributed/offline use must introduce an evidence-selected adapter profile rather than silently changing reference semantics.

## Test obligations

- Forwarded/stolen reference rejected without required independent proof.
- Recipient/purpose/transaction mutations rejected.
- Exactly one concurrent single-use redemption succeeds.
- Expiry, revocation, derivation and safe error tests.

## Consequences and residual risks

Reference entropy, storage, lifecycle, caller authentication, and rate limiting remain implementation obligations. A compromised runtime still defeats the control.

## Revisit trigger

A concrete offline/decentralized recipient use case cannot be satisfied through an established adapter artifact plus authoritative runtime state.
