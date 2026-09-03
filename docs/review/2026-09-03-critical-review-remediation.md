# 2026-09-03 Critical Review Remediation

Status: factual record of changes made to the proposed-spec branch; not architecture approval.

The human review identified five categories of defects in the prior formalization. The proposed-spec branch was remediated as follows:

1. **Status:** all formal artifacts now say Proposed / awaiting human approval. ADRs are Proposed, not Accepted.
2. **Testability:** the proposed specification defines measurable/metamorphic oracles for Personal-State-to-authority separation, self-improvement regression, plan semantic loss, Trusted Surface mutation, concurrency, and TCB/leakage claims. It explicitly states that no executable v1 conformance suite exists yet and forbids a conformance claim until one exists.
3. **Hard decision shapes:** the proposed specification now defines Approval Assurance profiles (AA0-AA3), Coordination profiles (CP1-CP3), a deployment-authoritative Trust Registry with epoch/staleness rules, Audit Integrity profiles (AI0-AI1), a mandatory Assurance Manifest semantic shape, and deterministic Claim Freshness policies.
4. **Repository separation:** `legacy/webmcp-sandbox` preserves the pre-rewrite implementation. The architecture/spec branch is documentation-only. The immutable tag `webmcp-sandbox-v0.1` remains a hard pre-rewrite gate because the available GitHub connector cannot create tags.
5. **Duplication:** `docs/spec/PTF-V1-PROPOSED.md` is the sole normative proposed specification. `CONTEXT-MAP.md` is a non-normative glossary and contains no independent invariant list.

The formal specification still requires explicit human approval before planning or implementation.