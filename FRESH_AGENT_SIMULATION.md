# Fresh-Agent Simulation

Purpose: test whether this package communicates the intended product when read without conversation history.

**Limitation:** this static simulation was authored in the same model/session that produced the handoff. It is not independent evidence. Codex must run the fresh-subagent interpretation test in `TEST_AND_VALIDATION.md`.

## Question 1 — What product are you building?

Expected answer:

> Personal Trust Fabric, a general user-controlled trust/capability layer separating agent planning from protected execution. It includes persona/personal state, policy, capability/disclosure, credentials, payment/signing/action authority, audit, recovery/portability, adapters, UI and developer/verifier interfaces.

Failure answer:

> A secure airline booking app / WebMCP travel demo / payment demo / credential wallet.

## Question 2 — What is the WebMCP challenge?

Expected:

> A time-bound release milestone and adapter validation for PTF. It must demonstrate PTF generality and material WebMCP use but does not define the complete product.

## Question 3 — Are scenarios core concepts?

Expected:

> No. Scenarios consume generic PTF seams. Scenario vocabulary must be mechanically excluded from trust-core modules.

## Question 4 — What must be implemented for product completion?

Expected:

> P1–P18 in `PRODUCT_CONTRACT.md`, with traceability, integration and tests; not only challenge surfaces.

## Question 5 — What is trusted?

Expected:

> The selected Trust Runtime and explicitly named security boundaries after architecture validation. The model is not trusted for hard authorization/protected-value custody.

## Question 6 — What must Codex do before large implementation?

Expected:

> Inspect repo, discover full skill inventory, bootstrap harness, reverify current sources, dispatch falsification/security/standards reviews, run required spikes, create validation report and ADRs, then bounded specs/plans.

## Question 7 — How are skills handled?

Expected:

> Dynamic per-task discovery/routing over the actual installed inventory; no prescribed shortlist.

## Question 8 — What happens after Devpost submission?

Expected:

> Preserve submitted artifacts according to current competition rules and continue the complete PTF build through a separate permitted development line after rechecking the rules. The submission is not product completion.

## Static verdict

The package's top-level mission, product contract, boundary matrix, traceability table and bootstrap all point to the same general PTF product. Travel is explicitly optional and forbidden from defining the core.

Codex must repeat this test with a genuinely fresh reviewer before execution.
