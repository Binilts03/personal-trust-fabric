# Complete Product Build Workstreams

This is the dependency/program map for the complete product. Each workstream becomes one or more bounded specs/plans after repository validation.

## Capability-to-workstream coverage

This table is a traceability index, not an implementation order. W1 provides shared domain contracts and W0 provides program governance across all capabilities.

| Product capability | Primary implementation workstream(s) |
|---|---|
| P1 Principal/device/agent identity | W2 |
| P2 Protected Store/cryptographic operations | W3 |
| P3 Personal State/Persona | W4, W9 |
| P4 Hard Policy/Human Approval | W5 |
| P5 Capability Runtime | W6 |
| P6 Disclosure Planner/Reference Monitor | W7 |
| P7 Credential/Identity Broker | W10 |
| P8 Payment Authority | W11 |
| P9 Signing/Auth/Consequential Action Authority | W11 |
| P10 Agent Safe View | W9 |
| P11 Agent/Web Adapters | W12, W13 |
| P12 Recipient/Verifier SDK | W14 |
| P13 Audit/Provenance | W8 |
| P14 Portability/Sync/Revocation/Recovery | W16 |
| P15 Persona Learning/Self-Improvement | W9 |
| P16 User Product Surfaces | W15 |
| P17 Developer Platform/Conformance | W17 |
| P18 Production Security/Operations | W18 |

## W0 — Program bootstrap, research, harness

Deliver:
- repository assessment/history;
- complete installed-skill registry;
- codebase harness;
- live traceability ledger;
- research ledger;
- architecture alternatives;
- threat model;
- `VALIDATION_REPORT.md`;
- initial ADRs;
- program dependency graph.

Blocking gate: no foundational production implementation before load-bearing assumptions are reviewed.

## W1 — Domain contracts and classification

Implement generic domain types and serialization boundaries for:
- principals/agents/tasks/recipients;
- protected values;
- personal observations/claims;
- authority grants/capabilities;
- disclosure requests/plans;
- approvals;
- receipts/revocation;
- data classification.

Tests: domain invariants, serialization safety, scenario-vocabulary lint.

## W2 — Principal/device/agent identity

Enrollment, device/instance identity, sessions/tasks, revocation, authentication seams.

Depends on W1.

## W3 — Protected Store and key operations

Protected storage, key hierarchy/operations, secret references, secure serialization, key rotation/revocation, temp/log/crash handling.

Depends on W1 and architecture decision A1/A5.

## W4 — Personal State / Persona

Observation/evidence/claim/preference representation, provenance, confidence, context, correction, contradiction, versioning, safe persistence.

Depends on W1/W3.

## W5 — Hard Policy and Approval

Policy schema/evaluation, approval lifecycle, policy versioning, explanation/simulation, amount/recipient/purpose/action/time/use/delegation constraints as applicable.

Depends on W1/W2.

## W6 — Capability Runtime

Issuance, binding, execution/redemption, derivation/attenuation, revocation, expiry/use-count, recipient/holder authentication integration.

Depends on W1–W5.

## W7 — Disclosure Planner / Reference Monitor

Candidate representations, minimum-disclosure selection, recipient/channel constraints, cumulative disclosure accounting, downgrade semantics.

Depends on W4–W6.

## W8 — Audit / Provenance

Decision/capability/disclosure/action receipts, tamper-evidence design, user-readable history, forensic export, no-secret logging.

Begins after W1 and integrates continuously through W7+.

## W9 — Persona Learning and Safe View

Evidence ingestion, poisoning-resistant trust transitions, inference/shadow evaluation, preference proposal/promotion/reversal, task-specific Agent Safe View.

Depends on W4/W5/W7/W8.

## W10 — Credential / Identity Broker

Credential metadata/holder keys/presentations/status, synthetic issuer/verifier, standards adapter interface.

Depends on W2/W3/W5–W8.

## W11 — Payment and Signing/Action Authority

Generic payment authority, signing operations, authentication operations, bounded consequential action model, synthetic/test providers.

Depends on W2/W3/W5–W8.

## W12 — Agent Gateway and adapters

Stable local/programmatic interface; external agent adapters selected when requirements and current protocol evidence justify them.

Depends on W5–W9.

## W13 — Web Gateway

WebMCP adapter, Digital Credentials integration where selected, legacy web bridge with explicit assurance level, origin/recipient mapping.

Depends on W6–W12.

## W14 — Recipient / Verifier SDK

Generic recipient registration/authentication, requests, nonce/replay, capability redemption/presentation verification, outcome reporting, test recipient.

Depends on W5–W11.

## W15 — User Product

PTF application surfaces for persona, policies, protected resources, approvals, capabilities, activity, devices/recovery, portability and developer/test mode.

Can begin against stable interfaces; must not duplicate trust decisions in UI code.

## W16 — Portability, Sync, Revocation, Recovery

Export/import, multi-device/sync design, key/recovery semantics, device replacement, conflict/version rules, revocation propagation.

Depends on W2–W9 and architecture decisions.

## W17 — Developer Platform and Conformance

SDK packaging, local emulator/synthetic fixtures, verifier/agent test kits, protocol evals, capability/policy debugger, documentation, migration/versioning.

Begins early and expands with every public seam.

## W18 — Production Security and Operations

Supply-chain/security controls, secrets management, release process, migrations, incident/revocation operations, deployment observability, dependency scanning, backup/restore.

Runs continuously; gates product release.

---

# M0 — WebMCP Challenge release milestone

M0 is a cross-cutting release, not a separate product workstream.

## Entry criteria

Reusable PTF seams required by the selected scenarios exist. M0 must consume them rather than inventing parallel demo logic.

## Required deliverables

- coherent PTF product UI;
- WebMCP tools mapped to real PTF/application operations;
- multiple materially different capability classes demonstrated using the same trust core;
- multiple recipient/origin bindings or equivalent independently authenticated recipient fixtures;
- synthetic protected data;
- adversarial scenario;
- public repo/license/docs;
- live judgeable deployment;
- <3-minute demo video;
- Devpost copy/testing instructions;
- evidence mapped to all four judging criteria.

## M0 exit

Submission-ready evidence passes `TEST_AND_VALIDATION.md` and the official rules are freshly rechecked.

M0 completion does not close W0–W18.
