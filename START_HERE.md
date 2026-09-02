# Start Here

## Mission

Build **Personal Trust Fabric (PTF)**: a user-controlled trust and capability layer that lets AI agents act for a person without automatically possessing the person's sensitive data, credentials, private keys, payment secrets, or complete private context.

The WebMCP Challenge is a **time-bound release milestone for the same product**. It is not the product definition and is not permission to replace PTF with a travel, shopping, wallet, or other vertical application.

## Binding project rules

1. Build the general PTF platform described in `PRODUCT_CONTRACT.md`.
2. A scenario validates the platform; it does not define the platform.
3. WebMCP is an adapter and challenge surface, not the authority model.
4. The LLM/agent is outside the trusted confidential plane for protected-value handling.
5. Separate authority from knowledge: permission to use a protected asset does not imply permission to reveal it to the model.
6. Enforcement that protects secrets or consequential authority must be deterministic and outside model inference.
7. The product includes portable personal state/persona, policy, capability execution, disclosure minimization, credentials, payment/signing/action authority, audit, revocation, recovery/portability, agent/web adapters, and developer/verifier interfaces.
8. Do not declare an architecture or dependency correct because this handoff recommends it. Re-validate.
9. Do not reduce the complete build to a challenge demonstration.
10. Do not implement a fixed skill shortlist. Discover and route across the complete installed Codex skill inventory for every substantive work item.
11. Use a repository-native codebase harness, execution ledger, deterministic verification, isolated work where appropriate, subagents, and independent review.
12. Security claims require observable evidence and named trust boundaries.
13. The handoff is self-contained. Do not search for earlier versions.

## Reading order

1. `PRODUCT_CONTRACT.md`
2. `PRODUCT_BOUNDARY_MATRIX.md`
3. `REQUIREMENTS_TRACEABILITY.md`
4. `USER_STORIES_AND_UX.md`
5. `DOMAIN_MODEL.md`
6. `DATA_MODEL_AND_STATE_MACHINES.md`
7. `INTERFACE_CONTRACTS.md`
8. `ARCHITECTURE_DECISION_FRAME.md`
9. `SECURITY_PRIVACY_MODEL.md`
10. `PERSONA_AND_LEARNING.md`
11. `PROTOCOL_AND_STANDARDS.md`
12. `BUILD_WORKSTREAMS.md`
13. `TEST_AND_VALIDATION.md`
14. `CODEBASE_HARNESS.md`
15. `SKILL_ROUTING_PROTOCOL.md`
16. `SUBAGENT_AND_EXECUTION_LOOPS.md`
17. `WEBMCP_CHALLENGE_MILESTONE.md`
18. `REFERENCE_SCENARIOS.md`
19. `DEVPOST_SUBMISSION.md`
20. `RESEARCH_EVIDENCE.md`
21. `OPEN_QUESTIONS_AND_ADRS.md`
22. `FRESH_AGENT_SIMULATION.md`
23. `CODEX_BOOTSTRAP_PROMPT.md`

## Required first sequence

Before production implementation:

1. Inspect repository state and git history.
2. Read `REQUIREMENTS_TRACEABILITY.md`; convert it into a repository-local live traceability ledger without weakening requirements.
3. Discover the full installed Codex skill inventory and establish `SKILL_ROUTING_PROTOCOL.md`.
4. Bootstrap the codebase harness in `CODEBASE_HARNESS.md`.
5. Re-check current WebMCP/Devpost facts and all standards that affect immediate design.
6. Dispatch fresh subagents for product-scope falsification, security architecture, protocol/standards review, and competing architecture designs.
7. Run feasibility spikes only where primary documentation cannot settle a load-bearing question.
8. Produce `VALIDATION_REPORT.md` containing:
   - facts verified;
   - assumptions rejected or retained;
   - architecture alternatives compared;
   - security limitations;
   - unresolved decisions;
   - recommended first bounded-context specs.
9. Create ADRs only for hard-to-reverse decisions that survived comparison.
10. Decompose the complete product into bounded specs and implementation plans. Preserve program-level traceability.
11. Execute using `SUBAGENT_AND_EXECUTION_LOOPS.md`.

The time-bound WebMCP submission may be developed in parallel once reusable PTF seams exist. It must consume those seams; it must not create a separate demo-only trust model.

## Completion meanings

- **Challenge ready** means the Devpost milestone passes `WEBMCP_CHALLENGE_MILESTONE.md` and `DEVPOST_SUBMISSION.md`.
- **Product complete** means every mandatory product capability in `PRODUCT_CONTRACT.md` and `PRODUCT_BOUNDARY_MATRIX.md` has an implemented, tested, integrated, documented outcome or an explicit human-approved scope change.

Challenge readiness does not imply product completion.
