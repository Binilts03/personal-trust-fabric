# W0 validation report

Date: 2026-09-02. Scope: supplied PTF specification package, runtime inventory, official immediate sources, and pre-implementation architecture/security review.

## Gate outcome

**PROVISIONAL DECISION:** W0 is sufficient to begin the bounded M0 synthetic sandbox slices and generic W1 contract work in `docs/program/build-plan.md`.

**OPEN / BLOCKED SCOPE:** production protected-store/key custody (W3), production recipient/redemption profiles, sync/recovery authority, plaintext downgrade policy, and real credential/payment/signing providers remain blocked on Human security decisions and profile-specific evidence. No current result supports a “product complete,” production security, interoperability, or production custody claim.

## M0 implementation update

The repository now has a dependency-free Node 22 synthetic sandbox with a generic policy/disclosure/capability runtime, closed persona/audit boundaries, two materially different protected-operation fixtures, per-browser Human-session approval/correction, a top-level imperative WebMCP adapter, and a PTF-first UI. `npm test` passes 27 tests; architecture and harness checks pass; Playwright completed the ordinary-browser payment/proof/attack/correction surfaces with no console errors. `npm ls --all` is empty and the release secret-pattern scan found no matches. Real ChatGPT/Chrome WebMCP execution, live deployment, license, video, public repository, and submission remain OPEN.

This update does not change the W0 production blockers below. Synthetic server-held recipient sessions prove the hook and policy binding only, not production recipient authentication.

## Repository facts

- **VERIFIED FACT:** the supplied directory contained 26 Markdown documents and no Git metadata, source code, build configuration, dependencies, tests, CI, or runnable product.
- **VERIFIED FACT:** there was no repository history to inspect. A new local Git repository was initialized on `main`; no commit or external repository was created.
- The repository now has a thin `AGENTS.md`, documentation map, command registry, U/P/S/INV ledgers, execution ledger, ADR log, skill registry, research ledger, bounded plan, review artifacts, and deterministic W0 verifier.
- Fresh run: `pwsh scripts/refresh-skill-registry.ps1` recorded 454 physical packages / 356 unique parsed identifiers. This includes cached, duplicate, and possibly inactive versions.
- Fresh run: `pwsh scripts/verify-harness.ps1` passed the W0 structure, U-01–U-25 row sequence, registry consistency, and generic-core vocabulary check.
- **KNOWN LIMITATION:** no machine-readable API exposed the active per-turn Codex skill catalog. Physical presence is not callability; the surfaced runtime catalog remains authoritative for routing.

## Current external facts

- **VERIFIED FACT:** Devpost deadline is 2026-09-03 13:00 PDT, equivalent to 2026-09-04 01:30 IST. Live URL, public licensed repository, description, and public sub-three-minute YouTube video with audio are required.
- **VERIFIED FACT:** current rules freeze the Devpost Submission after the period and require Project availability through judging. They do not explicitly ban every later repository commit/deployment; immutable submitted identifiers plus a final rules check is the conservative plan.
- **VERIFIED FACT:** WebMCP is a 2026-08-26 Draft Community Group Report, not a W3C Standard or Standards Track document.
- **VERIFIED FACT:** current ChatGPT site tools implement only top-level imperative registration. M0 targets the ChatGPT/Chrome intersection with feature-detected `document.modelContext.registerTool` and an ordinary UI fallback.
- **VERIFIED FACT:** Digital Credentials is a W3C Working Draft dated 2026-08-27; WebAuthn Level 3 is a W3C Recommendation dated 2026-08-25. The handoff snapshot was stale.
- OpenID4VP/VCI Final, OAuth RFCs, and MCP 2026-07-28 are available adapter inputs; none becomes PTF's trust model. A2A and MCP are deferred from M0.

Detailed sources and dates: `docs/research/current-sources.md`.

## Fresh review results

### Product scope

**PASS** for interpreting PTF as a generic P1–P18 trust/capability product and M0 as a milestone. **FAIL** for the original acceptance structure: workstream names were not closeable capability evidence. `docs/program/capability-ledger.md` now supplies one acceptance row per P-capability.

Minimum credible M0 uses one generic pipeline for two authenticated recipient fixtures:

1. synthetic credential/status disclosure to verifier A;
2. transaction-bound synthetic payment to merchant B;

with task safe-view personalization visible across the experience. The same policy, disclosure, capability, recipient, receipt, and canary modules must serve both.

### Architecture

Compared device-sovereign, hosted custodial, and device-authoritative-plus-untrusted-services designs. The broad “hybrid” label was rejected because it does not name the authority and can make atomic use/revocation a distributed-consistency problem.

**PROVISIONAL DECISION:** production reference is one device-sovereign authoritative runtime with optional untrusted relay/ciphertext services. M0 may use a hosted synthetic sandbox that shares contracts/behavior while carrying a weaker-assurance label. Human acceptance is required for platform, key custody, recovery actors, approval surface, downgrade permission, and revocation bounds.

### Security (initial W0 verdict)

**FAIL** for production implementation/security claims. The specification has strong intent but no implemented controls. Top risks are approval substitution, bearer-like forwarded handles, double-use races, serialization leakage, persona poisoning, downgrade/origin confusion, revocation rollback, recipient-registry poisoning, and trusted-runtime supply-chain compromise.

`docs/program/security-properties-ledger.md` maps S-01–S-10 and INV-01–INV-12. It now records bounded M0 evidence while keeping complete-property rows OPEN.

### Standards

**PASS** to implement the generic gateway and M0 WebMCP adapter. **OPEN** for production credential formats, OAuth/capability/recipient profiles, Digital Credentials adoption, WebAuthn ceremony, MCP, payment/signing providers, and A2A. Current OpenAI/Chrome intersection and required evals are in `docs/validation/reviews/standards-review.md`.

## Assumptions rejected

- The handoff directory was an existing repository with history.
- A workstream mapping by itself makes P1–P18 traceable or closeable.
- A hosted M0 profile validates production custody/security.
- “Hybrid” is an adequate authority/topology decision.
- An opaque handle is safe if possession alone can redeem it.
- WebMCP origin/annotations authenticate a recipient or enforce protected authority.
- The challenge rules explicitly freeze every repository/site change during judging.
- Digital Credentials remained at the handoff's 3 August snapshot or WebAuthn remained a Candidate Recommendation.
- A framework, external policy engine, MCP/A2A adapter, real payment rail, TEE, or new cryptography is needed for the first M0 slice.

## Assumptions retained with limits

- A hosted synthetic sandbox is appropriate for public judgeability if every surface labels its weaker assurance and no real sensitive data enters it.
- A closed typed in-process evaluator is sufficient for the first supported constraint profile; Cedar/OPA remain revisit options, not dependencies.
- Server-held opaque operation references plus independent recipient proof hooks are the smallest safe generic semantics.
- Separate allowlisted DTO families are intentional security-boundary duplication.
- Node 22 native facilities can support the initial sandbox, tests, and UI without runtime dependencies; this does not select the production native platform.

## ADR resolution

Accepted:

- ADR-0002: opaque operation references are not bearer authority;
- ADR-0003: closed typed evaluator for the first profile;
- ADR-0004: separate allowlisted serialization families;
- ADR-0005: dependency-minimal Node sandbox profile.

Proposed / requires more authority or evidence:

- ADR-0001: production runtime authority and M0 release profiles;
- ADR-0006: versioned approval-terms encoding/digest, pending normalization/property tests and approval-surface decision.

## First bounded implementation specs

1. M0-A/W1: generic constraints, state machines, DTO families, classification and architecture lint.
2. M0-B/W5: pure policy and typed approval terms with mutation tests.
3. M0-C/W6: authoritative opaque references, atomic one-use and recipient proof hook.
4. M0-D/W7/W8: disclosure minimality, safe receipts and canary scan.
5. M0-E/W4/W9: synthetic persona provenance/correction and safe view without authority learning.
6. M0-F/G/W10/W11: two materially different synthetic operation classes through one core.
7. M0-H–K: recipient fixtures, protocol-neutral gateway, top-level imperative WebMCP, PTF-first UI, full eval/release evidence.

The complete W1–W18 decomposition and integration gates are in `docs/program/build-plan.md`.

## Human decisions preserved

Before production custody/recovery or public release actions:

1. Approve the production platform/runtime/key boundary and survivable compromise cases.
2. Approve minimum recipient authentication/redemption assurance by operation class.
3. Approve recovery actors, acceptable irrecoverability/operator access, and revocation bounds.
4. Approve which plaintext/legacy downgrade modes are allowed and the trusted approval ceremony.
5. Select an open-source license before public repository submission.
6. Confirm public push, deployment, video upload, and Devpost submission.

## Evidence limitations

The current passing commands prove only the named synthetic M0 behaviors and instrumented surfaces. They cannot establish absence from undocumented model-provider internals or production logs, custody, devices, networks, and providers. A legitimate authorized recipient may misuse plaintext after receipt unless an actual recipient-side control prevents it.
