# Personal Trust Fabric

Personal Trust Fabric (PTF) lets an agent request useful actions without receiving the protected credential, payment instrument, or other reusable secret. A deterministic core binds policy, minimal disclosure, concrete Human approval, recipient authentication, one-use execution, and safe receipts.

This repository currently contains a dependency-free Node 22 synthetic sandbox for the WebMCP milestone plus the complete-product specification and live gap ledgers. It is **not** a production custody system: no real credentials or payment instruments are accepted.

## Run locally

Requirements: Node.js 22 or newer. There are no runtime package dependencies.

```powershell
npm test
npm run dev
```

Open `http://127.0.0.1:3000`. The server binds loopback by default. The page can simulate both agent requests when WebMCP is unavailable; approval and persona correction remain separate Human-session actions.

Non-loopback binding is refused unless `PUBLIC_ORIGIN` is set to the exact HTTPS origin. For an authorized deployment environment, set `HOST`, `PORT`, and `PUBLIC_ORIGIN`; hosted session cookies are then marked `Secure`. This is configuration behavior, not authorization to deploy.

## What to try

1. Request the active-membership predicate proof for synthetic Verifier A, inspect every bound term, and approve or deny it.
2. Request the $42.50 synthetic payment for Merchant B and approve the one-use, five-minute authority.
3. Run the recipient-redirection adversarial check and observe deterministic denial.
4. Correct the agent-safe budget persona claim and observe the prior claim being superseded without changing policy.
5. Inspect the safe activity stream and its explicitly limited in-memory hash-chain evidence.

The exact judge flow and WebMCP tool prompts are in [`docs/judge-script.md`](docs/judge-script.md). The four top-level imperative tools are:

- `get_ptf_safe_view`
- `request_membership_status_proof`
- `request_synthetic_invoice_payment`
- `attempt_recipient_redirect_attack`

The adapter feature-detects `document.modelContext.registerTool`. Current ChatGPT/Chrome setup and API evidence are tracked in [`docs/research/current-sources.md`](docs/research/current-sources.md).

## Evidence and limits

- `npm test` runs core, architecture, HTTP, two-journey, leakage, Human-session, and WebMCP registration/callback checks.
- Playwright artifacts are written under `output/playwright/` during local judge-like testing.
- Synthetic recipient sessions demonstrate the recipient-authentication hook; they are not cryptographic production authentication.
- The audit chain demonstrates consistency relative to this process only; it is unkeyed, volatile, and not independently anchored.
- Production custody, recovery, interoperability, deployment, video, and submission remain OPEN and require the decisions/evidence in the live ledgers.

Licensed under the [Apache License 2.0](LICENSE).

For controller/onboarding context, read `START_HERE.md` and `docs/index.md`.

## Specification map

- `START_HERE.md` — execution entrypoint.
- `PRODUCT_CONTRACT.md` — product definition, actors, capabilities, invariants, completion boundary.
- `PRODUCT_BOUNDARY_MATRIX.md` — separates core product, protocol adapters, challenge milestone, scenarios, and non-goals.
- `REQUIREMENTS_TRACEABILITY.md` — maps every binding requirement to build and verification.
- `DOMAIN_MODEL.md` — canonical terms.
- `USER_STORIES_AND_UX.md` — observable user/developer/agent behavior.
- `DATA_MODEL_AND_STATE_MACHINES.md` — conceptual records and lifecycle semantics.
- `INTERFACE_CONTRACTS.md` — reusable behavioral seams.
- `ARCHITECTURE_DECISION_FRAME.md` — candidate architectures and decisions Codex must resolve from evidence.
- `SECURITY_PRIVACY_MODEL.md` — threat model, trust boundaries, required security properties.
- `PERSONA_AND_LEARNING.md` — personal state, learning, provenance, poisoning resistance, authority separation.
- `PROTOCOL_AND_STANDARDS.md` — standards/protocol maturity and adapter policy.
- `WEBMCP_CHALLENGE_MILESTONE.md` — current competition constraints and release strategy.
- `REFERENCE_SCENARIOS.md` — scenario requirements used to prove generality; no scenario defines the core.
- `BUILD_WORKSTREAMS.md` — dependency graph for the complete product plus the time-bound challenge milestone.
- `TEST_AND_VALIDATION.md` — deterministic, adversarial, conformance, usability, and release gates.
- `CODEBASE_HARNESS.md` — repository-native harness requirements.
- `SKILL_ROUTING_PROTOCOL.md` — dynamic routing over the complete installed Codex skill inventory.
- `SUBAGENT_AND_EXECUTION_LOOPS.md` — controller/subagent model and nested loops.
- `RESEARCH_EVIDENCE.md` — verified sources, research evidence, and known gaps.
- `DEVPOST_SUBMISSION.md` — submission artifacts and judging strategy.
- `OPEN_QUESTIONS_AND_ADRS.md` — unresolved decisions and ADR triggers.
- `CODEX_BOOTSTRAP_PROMPT.md` — exact initial instruction for the implementation controller.
- `FRESH_AGENT_SIMULATION.md` — static fresh-context interpretation test for this package.
- `HANDOFF_AUDIT.md` — generated quality audit and limitations.

## Status vocabulary

Use these labels consistently:

- **USER REQUIREMENT** — binding intent explicitly established for this project.
- **VERIFIED FACT** — checked against a primary/current source as of the research date.
- **PRODUCT INVARIANT** — defining property of PTF; changing it changes the product.
- **DESIGN HYPOTHESIS** — plausible design claim that requires validation.
- **PROVISIONAL DECISION** — recommended direction, not yet final.
- **OPEN** — unresolved.
- **RESEARCH EVIDENCE** — paper/project/proposal that informs design but does not prove PTF is correct.

No document in this package is proof that the architecture is correct. Repository evidence, primary sources, tests, and fresh independent review outrank this handoff.
