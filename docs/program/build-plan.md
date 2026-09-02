# Bounded implementation plan

Program status: OPEN. This plan decomposes W1–W18 into reviewable outcomes; it does not convert unimplemented work into roadmap-only completion.

## M0 critical path

The official deadline is 2026-09-03 13:00 PDT (2026-09-04 01:30 IST). M0 uses synthetic data and an explicitly weaker hosted sandbox profile. Every slice consumes generic PTF contracts and leaves complete-product gaps OPEN.

| Slice | Workstreams | Bounded outcome | Depends on | Exit evidence |
|---|---|---|---|---|
| M0-A | W1 | Versioned generic records, constraint lattice, separate canonical/agent/UI/recipient/audit DTOs, scenario-vocabulary lint | Accepted semantic ADRs | Unit/property serialization tests |
| M0-B | W5 | Pure typed policy evaluation, versioned policies, approval proposal digest/lifecycle, mutation invalidation | M0-A | Table/property tests for deny/approval/allow and all M0 constraints |
| M0-C | W6 | Server-held opaque operation references, grant/capability lifecycle, atomic single-use/revoke/expiry, recipient proof hook | M0-A/B | Attenuation, forwarding, concurrency, replay tests |
| M0-D | W7/W8 | Authorized disclosure candidate ordering, downgrade label, safe receipts/audit schemas | M0-A–C | Minimality oracle and canary scans |
| M0-E | W4/W9 | Synthetic observations/claims, provenance/correction, task safe view; no learning-to-authority path | M0-A/B/D | Poisoning and safe-view exclusion tests |
| M0-F | W10 | Synthetic credential/status provider and verifier A through generic disclosure/capability seams | M0-A–E | Authorized, over-request, nonce/replay, recipient mutation tests |
| M0-G | W11 | Synthetic payment provider and merchant B with amount/currency/transaction approval binding and no reusable secret exposure | M0-A–E | Authorized, amount/recipient mutation, forwarding, double-use tests |
| M0-H | W14/W17 | Generic recipient request/redemption fixture API, two recipients, deterministic reset/debug data | M0-F/G | Second-recipient integration from public contract only |
| M0-I | W12/W13 | Protocol-neutral HTTP/local gateway plus real WebMCP adapter using current `document.modelContext.registerTool` | M0-A–H | Contract tests, Chrome/ChatGPT judge-like tool evals |
| M0-J | W15 | PTF-first UI for safe view, resources, policies, approvals, capabilities, activity, correction/revocation, developer evidence | M0-A–I | E2E, accessibility, comprehension review |
| M0-K | W18/M0 | Dependency-free/pinned build, secrets scan, release evidence, public docs/license decision, deployment/video/submission package | M0-A–J | Full suite, fresh scope/security/standards/release reviews; Human confirms public side effects |

## Complete-product program

### W1 — Domain contracts

- W1.1 classification and constraint vocabulary;
- W1.2 state machines and versioned canonical records;
- W1.3 model/UI/recipient/audit/sync serialization allowlists;
- W1.4 invariant/property and scenario-vocabulary checks.

### W2 — Principal, device, and agent identity

- W2.1 principal/device enrollment and authenticated session model;
- W2.2 agent/client/task provenance and delegation chain;
- W2.3 device/agent revocation and assurance mapping;
- W2.4 supported-platform authentication conformance.

### W3 — Protected Store and keys

- W3.1 production runtime/process/keystore spike for the Human-approved platform;
- W3.2 structured protected records and non-exporting operations;
- W3.3 key hierarchy, rotation, lock, temp/crash/log handling;
- W3.4 backup/recovery integration after recovery-authority ADR;
- W3.5 canary and compromised-agent/renderer evidence.

### W4 — Personal State / Persona

- W4.1 observation/evidence ingestion and trust labels;
- W4.2 claim provenance/confidence/context/contradiction state;
- W4.3 correction, supersession, decay and version rollback;
- W4.4 protected persona persistence and export.

### W5 — Hard Policy and Approval

- W5.1 closed typed policy schema and pure evaluator;
- W5.2 explanation/simulation and version lifecycle;
- W5.3 trusted approval ceremony and canonical term binding;
- W5.4 supported-profile constraint matrix and adversarial mutation suite.

### W6 — Capability Runtime

- W6.1 issuance from authority only and non-bearer operation references;
- W6.2 atomic execute/redeem, idempotency, expiry and use counts;
- W6.3 attenuation/delegation and descendant revocation;
- W6.4 recipient/holder authentication profiles and concurrency suite.

### W7 — Disclosure Planner

- W7.1 representation/channel candidate model separate from authorization;
- W7.2 deterministic minimality and recipient capability matching;
- W7.3 cumulative disclosure/inference accounting;
- W7.4 downgrade policy/UI evidence and minimality properties.

### W8 — Audit / Provenance

- W8.1 safe lifecycle event schema and rejecting write boundary;
- W8.2 integrity/tamper-evidence mechanism and verification;
- W8.3 human history and safe forensic export;
- W8.4 canary coverage for logs/traces/support/crash/export surfaces.

### W9 — Learning and Agent Safe View

- W9.1 task/recipient projection allowlists;
- W9.2 evidence-to-claim shadow/promotion workflow;
- W9.3 poisoning, contradiction, correction and reversibility suite;
- W9.4 calibration and privacy-volume evaluation without authority expansion.

### W10 — Credential / Identity Broker

- W10.1 credential metadata/holder/status core independent of formats;
- W10.2 synthetic issuer/verifier fixtures;
- W10.3 first Human-approved interoperable issuance/presentation profile;
- W10.4 conformance, status/revocation and selective-disclosure evidence.

### W11 — Payment and signing/action authority

- W11.1 generic consequential-operation contract;
- W11.2 payment authority profile independent of payment credential;
- W11.3 signing/authentication profile independent of private-key export;
- W11.4 bounded account-action profile, high-risk confirmation and provider conformance.

### W12–W14 — Gateways and recipient platform

- W12.1 local/programmatic agent gateway;
- W12.2 requirement-selected agent adapter(s) and version negotiation;
- W13.1 WebMCP adapter and origin/recipient assurance mapping;
- W13.2 selected Digital Credentials/legacy adapter with downgrade labeling;
- W14.1 recipient registry/auth/request/redeem/outcome SDK;
- W14.2 nonce/replay fixtures, second-recipient test and migration/versioning.

### W15 — User product

- W15.1 persona/state and protected-resource surfaces;
- W15.2 policies, concrete approvals, capabilities and emergency revoke;
- W15.3 activity/explanations/security evidence;
- W15.4 devices/recovery/portability and developer/test mode;
- W15.5 accessibility, destructive-action and user-comprehension acceptance.

### W16 — Portability, sync, revocation, recovery

- W16.1 versioned export/import and cross-implementation fixtures;
- W16.2 device enrollment and encrypted sync envelopes;
- W16.3 conflict, rollback, monotonic revocation and propagation bounds;
- W16.4 Human-approved recovery actors, loss/replacement and disaster exercises.

### W17 — Developer platform and conformance

- W17.1 public schemas/SDKs/emulator and deterministic synthetic reset;
- W17.2 policy/capability debugger with secret-safe explanations;
- W17.3 adapter/profile conformance and negative fixtures;
- W17.4 semantic versioning, migration and integration documentation.

### W18 — Production security and operations

- W18.1 dependency/SBOM/secret/build provenance gates;
- W18.2 migrations, backup/restore and upgrade rollback;
- W18.3 incident, key/provider compromise and global revocation procedures;
- W18.4 sanitized metrics/logs/alerts and abuse/resource controls;
- W18.5 finite supported-profile release checklist and independent final review.

## Integration gates

1. W1 contract gate: domain/security ledgers mapped to tests; fresh interpretation review.
2. W5–W8 trust-seam gate: property, adversarial, concurrency and canary suites; fresh security review.
3. M0 gate: same-core trace for both journeys, judge-like WebMCP tests, live artifact checks, fresh scope/standards/release reviews.
4. Production profile gate: real TCB/custody/recovery/provider evidence, cross-device/portability, operations and Human-approved security decisions.
5. Product completion gate: every U/P/S/INV ledger row has inspected implementation, fresh runnable evidence, review, and residual risk; M0 completion is irrelevant to rows it does not cover.
