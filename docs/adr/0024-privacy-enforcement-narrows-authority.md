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

- **Staged coverage is intentional and fail-closed where enabled:** the stdio reference MCP host gates `ptf_request_data`/`ptf_present_data` and the `/pay` proposal, challenge and journaled execution route when `PTF_MCP_PRIVACY_CONFIG` is set. Missing operator-defined payment categories or inactive/missing processing basis deny. The built-in journaled MCP payment path calls the privacy wrapper before consumption and effect.
- This does **not** make privacy a global interceptor. The separately exported `executeProtectedAction` adapter, other adapters, independently invoked library helpers and operator CLI effect paths do not gain implicit DPDP gating. Every other host performing personal-data processing must explicitly compose `PrivacyRuntime`; choosing not to integrate it is not compliant processing enforcement. The reference MCP host fails closed on generic `ptf_request_action` when privacy mode is configured: that proposal-only path has no safe pay/disclose binding, so it is denied rather than reported as merely uncovered.
- The public privacy library surface is `./privacy` (`src/privacy/api.ts`). File-backed privacy configuration and event stores remain host internals and are intentionally not re-exported from the root barrel; repository-owned persistence suites reach them only through exact, file-scoped test seam exemptions. This keeps the supported integration contract persistence-free without pretending the reference host does not need durable stores.
- `privacy verify --mcp-config` checks configured reference-host input and reports scoped coverage with `runtimeAttested: false`, never claiming that a separately running agent/host actually uses it. The reference stdio server also reports enabled/disabled mode to operator stderr at startup. This is a configured-host diagnostic, not a runtime security attestation.
- Consent withdrawal is evaluated at the last live recheck but not in one atomic transaction with Authority CAS and external effects. Operators requiring strict real-time revocation ordering must provide host-level serialization/transaction fencing; the residual race must be disclosed.
- Processing Event reconciliation requires an explicit offline operator command after quiescing writers. `privacy events reconcile` may adopt a terminal outcome only when the execution journal proves it for the exact terms; otherwise the event remains `OUTCOME_UNKNOWN`. Neither startup nor a successful provider receipt can silently turn ambiguous events into confirmed results without independently examined evidence.
