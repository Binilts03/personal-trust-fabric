# Architecture Decision Frame

This document intentionally does not freeze the implementation architecture. Codex must design foundational seams at least twice and record evidence.

## 1. Load-bearing architectural questions

### A1 — Where does the trusted runtime execute?
Compare at least:
- local/device-first trusted runtime;
- hosted trusted broker;
- hybrid local trust core plus optional hosted ciphertext/services.

Evaluate:
- secret custody;
- browser/device integration;
- recoverability;
- multi-device;
- judgeable WebMCP release;
- attack surface;
- deployability;
- portability;
- operating cost;
- platform constraints.

**Provisional direction:** hybrid is plausible, with the challenge using only synthetic data in a hosted/sandbox profile. This is not a final decision.

### A2 — How are hard policies represented and enforced?
Compare a typed in-process policy model, Cedar, OPA/Rego, or other evidence-backed alternative.

Required properties:
- deterministic evaluation;
- explicit deny semantics;
- schema validation;
- decision explanation;
- testability;
- no model-generated policy execution without validation;
- stable mapping to PTF domain constraints.

### A3 — What is a capability on the wire?
Compare:
- server-held state + opaque non-bearer reference;
- signed/macaroons-style attenuable token;
- OAuth/RAR/DPoP-aligned token;
- credential/presentation-based authorization.

Required property: possession by a prompt-injected agent must not be sufficient to exercise rights that policy requires an independently authenticated recipient or holder to prove.

Do not invent new cryptography.

### A4 — How are recipients authenticated and bound?
Compare:
- OAuth client authentication / DPoP / mTLS where applicable;
- WebAuthn/service keys;
- signed recipient metadata;
- platform-origin binding;
- transaction-specific verifier keys.

The answer may differ by adapter but must map to one PTF Recipient model.

### A5 — How is protected state stored and keyed?
Compare platform-native keystores/secure enclaves, application encryption, local databases, and sync key hierarchies.

Explicitly model:
- locked/unlocked device;
- backup;
- crash dumps/temp files;
- logs;
- compromised browser renderer;
- compromised agent process;
- lost device.

### A6 — How is persona/state represented?
Compare relational/event-sourced/typed graph approaches. Required regardless of storage:
- provenance;
- explicit vs inferred;
- confidence;
- context;
- sensitivity;
- timestamps;
- correction;
- contradiction;
- versioning/rollback.

### A7 — How are disclosure modes composed?
The Disclosure Planner must select among proof/derived/selective/direct/raw modes without becoming the authorization engine.

Evaluate cumulative disclosure/inference risk.

### A8 — What are the public seams?
Design at least two candidate interfaces for:
- agent gateway;
- recipient/verifier SDK;
- capability issuance/execution;
- disclosure planning;
- persona safe-view generation.

Prefer deep modules with narrow interfaces. Avoid one-adapter abstractions that add no leverage.

## 2. Recommended process for each foundational decision

1. State the requirement and threat it serves.
2. Gather current primary-source evidence.
3. Draft 2–3 materially different designs.
4. Identify trusted computing base and failure modes.
5. Build a throwaway spike only for uncertain mechanics.
6. Compare with explicit criteria.
7. Record ADR only if hard to reverse, surprising, and a real trade-off.
8. Map decision to traceability IDs and tests.

## 3. Architecture properties that are not provisional

The following are product invariants rather than technology choices:

- control plane and confidential execution must remain distinguishable;
- hard authorization cannot depend on model compliance;
- scenario/domain concepts do not own trust-core interfaces;
- external protocol adapters do not own PTF policy;
- model-facing serialization is a security boundary;
- user approval is bound to approval-relevant transaction terms;
- authority cannot silently expand from learning.
