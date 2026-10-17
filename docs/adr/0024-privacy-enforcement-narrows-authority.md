# ADR-0024: Privacy enforcement narrows authority

**Date**: 2026-10-18  
**Status**: accepted  
**Deciders**: PTF maintainer

## Context

PTF already determines what a verified actor may do under explicit Authority State and protects personal data/credentials behind purpose-scoped disclosure and protected use. Privacy-law deployments add a separate question: even when the actor has technical authority, is this personal-data processing inside an operator-declared purpose, data scope, recipient scope, lifecycle, and processing-basis evidence record?

Conflating those questions would let legal/privacy metadata accidentally mint technical power and would force jurisdiction-specific rules into the domain-neutral Authority engine.

## Decision

Privacy is a second, independently sourced **narrowing** gate adjacent to Authority.

The semantic invariants are:

1. **Personal State ≠ Authority State ≠ Processing Basis Evidence.**
2. **PTF Principal ≠ Privacy Data Principal Reference.** They may denote the same human in a personal deployment, but enterprise processing must not assume that.
3. A privacy decision may deny an operation but may never create authority or override an Authority denial.
4. Agent-facing evaluation performs a non-consuming Authority preflight before reading privacy state, preventing privacy configuration from becoming an oracle for unauthorized callers.
5. Privacy subject/controller/basis/classification data comes from trusted host/operator context, never from agent-supplied request fields.
6. Jurisdiction profiles live outside `src/core/`. The first profile is India DPDP 2025; later profiles reuse the same jurisdiction-neutral model.
7. PTF validates configured evidence and enforces configured controls. It does **not** decide that a legal basis is legally sufficient and never emits `compliant=true`.
8. Privacy mode is explicit. Existing deployments remain behaviorally unchanged when it is disabled.
9. Consequential processing creates secret-free, crash-conservative Processing Events precommitted before the processing boundary; ambiguous crashes remain visible as `OUTCOME_UNKNOWN`.

## Consequences

- The Authority kernel remains unchanged and domain-neutral.
- Consent Evidence is not a Standing Grant or one-time Approval and cannot make an Authority denial executable.
- Privacy configuration and processing evidence are encrypted host state, with event history stored separately from mutable configuration.
- Rights/retention support is limited to PTF-observed/managed state; external copies, processor contracts, breach notification, DPIAs, grievance operations, and legal-basis correctness remain operator responsibilities.
- Product wording is “privacy enforcement/evidence” or “helps enforce/support DPDP controls,” never a guarantee of statutory compliance or a claim that PTF is a registered Consent Manager.
