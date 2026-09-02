# Product capability ledger

This closes the structural gap in the original U-level traceability table. Every P-capability remains OPEN until a versioned supported profile has implementation, runnable acceptance, and independent review.

| ID | Mandatory outcome | Minimum closeable acceptance for a supported profile | Status / gap |
|---|---|---|---|
| P1 | Principal, device, and agent identity | Enroll/authenticate/revoke device and agent sessions; prove principal and agent identities cannot be confused | OPEN |
| P2 | Protected Store and cryptographic operations | Supported store/key profile passes locked/unlocked, rotation, revocation, backup/temp/crash, and model/log serialization canary tests | OPEN |
| P3 | Personal State / Persona | Explicit/inferred/negative/contextual claims preserve provenance, correction, versions, decay, and safe projection | OPEN |
| P4 | Hard Policy and Human Approval | Versioned deterministic allow/deny/approval evaluation; every supported constraint and proposal mutation has positive/negative tests | OPEN |
| P5 | Capability Runtime | Issue, narrower derivation, independently authenticated use where required, atomic use-count, expiry, revocation, and safe errors | OPEN |
| P6 | Disclosure Planner | For every supported representation set, selects the lowest authorized disclosure; cannot turn deny into allow; downgrade is explicit | OPEN; requires a falsifiable minimality oracle |
| P7 | Credential / Identity Broker | One declared interoperable profile plus synthetic fixtures passes issuance/presentation/status/holder-binding conformance | OPEN; first profile undecided |
| P8 | Payment Authority | One declared provider/test profile binds recipient, amount, currency, transaction, time/use and never exposes reusable payment credential to model | OPEN; independent from P9 |
| P9 | Signing / Authentication / Consequential Action | One signing/auth profile and generic bounded action profile execute without key export and enforce high-risk confirmation | OPEN; independent from P8 |
| P10 | Agent Safe View | Task/recipient-specific DTO excludes all model-forbidden classes across success, denial, debug, and error paths | OPEN |
| P11 | Agent and Web Adapters | Protocol-neutral seam plus adopted adapter(s) pass contract/conformance; weaker legacy mode is labeled | OPEN; WebMCP required for M0 |
| P12 | Recipient / Verifier SDK | A second recipient integrates from the public SDK/fixtures only; auth, nonce, replay, verification, outcome, and safe-error tests pass | OPEN |
| P13 | Audit / Provenance / Transparency | Lifecycle history is human-readable, integrity verification works, and canary scan proves declared audit/export surfaces exclude raw protected values | OPEN |
| P14 | Portability, Sync, Revocation, Recovery | Versioned export/import works across two independent environments; schema migration, device loss, rollback/conflict, and propagation-bound tests pass | OPEN |
| P15 | Persona Learning and Self-Improvement | Observations cannot self-promote authority; shadow/promotion/correction/rollback and poisoning tests pass for supported learning profile | OPEN |
| P16 | User Product Surfaces | All named concepts are distinguishable; approval/revoke/correct/export/recover journeys pass accessibility and comprehension acceptance | OPEN |
| P17 | Developer Platform and Conformance | SDKs, emulator, fixtures, debugger, versioning, migration, and adopted-protocol suites are runnable from public docs | OPEN; close per released profile |
| P18 | Production Security / Operations | Finite release checklist for the supported profile passes supply-chain, secrets, build provenance, migration, incident/revoke, backup/restore, and no-secret observability gates | OPEN; continuous work does not erase per-release exit criteria |

## Supported-profile gate

A release must name its platforms, custody/TCB, protected-operation classes, adapters/profiles, recipient assurance, recovery and revocation bounds, downgrade modes, and operational controls. Qualifiers such as “where supported” are resolved by that profile rather than used as completion escape hatches.

For M0, synthetic fixtures may satisfy judgeability but cannot satisfy production custody/interoperability claims. M0 and complete-product evidence remain separate.
