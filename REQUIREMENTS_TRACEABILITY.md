# Requirements Traceability

This is the anti-drift ledger. The repository must maintain a live descendant of this table.

| ID | Binding requirement | Authority | Product seam | Build workstream(s) | Verification |
|---|---|---|---|---|---|
| U-01 | Build the complete PTF product; do not reinterpret the task as a reduced release slice. | USER REQUIREMENT | P1–P18 | W0–W18 | Product-completion checklist |
| U-02 | A Devpost/WebMCP release is a milestone, not the product boundary. | USER REQUIREMENT | Adapter/release layer | M0 + W0–W18 | Challenge release and product ledgers remain separate |
| U-03 | No single air-ticket/travel example may define the architecture or build map. | USER REQUIREMENT | Core domain | W1–W18 | Core source scan for scenario-specific terms; multi-scenario tests |
| U-04 | LLM/agent is not trusted with protected values by default. | PRODUCT INVARIANT | P2/P4/P5/P6 | W3/W5/W6/W7 | Canary leak tests + adversarial agent tests |
| U-05 | Sensitive values should move through protected paths or proofs where possible, not through the model. | PRODUCT INVARIANT | P5/P6/P7/P8/P9 | W6/W7/W10/W11 | Data-flow tests; network/tool trace inspection |
| U-06 | Full installed Codex skill inventory must be discovered; do not hard-code a small shortlist. | USER REQUIREMENT | Harness | W0 | Skill registry coverage audit |
| U-07 | Skill selection must occur per substantive task and re-route when task category changes. | USER REQUIREMENT | Harness | W0 + all work items | Execution ledger records candidates/selected skills |
| U-08 | Create and use a repository-native codebase harness. | USER REQUIREMENT | Harness | W0 | Harness acceptance tests |
| U-09 | Use loops and subagents; independent review is mandatory for material work. | USER REQUIREMENT | Execution system | W0 + all | Subagent/review ledger; final fresh review |
| U-10 | Research/review/test assumptions before treating the handoff as correct. | USER REQUIREMENT | Program governance | W0 | `VALIDATION_REPORT.md`, ADR evidence |
| U-11 | Separate verified facts, research evidence, hypotheses, provisional decisions, and open questions. | USER REQUIREMENT | Documentation | W0 | Context/ADR audit |
| U-12 | Handoff must be self-contained; no references to prior versions or unavailable conversation context. | USER REQUIREMENT | Handoff | W0 | Mechanical reference scan |
| U-13 | Avoid fluff/AI slop; agent docs must have one source of truth and progressive disclosure. | USER REQUIREMENT | Harness/docs | W0 | Context audit + duplicate/staleness scan |
| U-14 | WebMCP must be used materially for the challenge release. | VERIFIED CHALLENGE REQUIREMENT | P11 | M0/W13 | Deployed WebMCP evals and judge-like test |
| U-15 | Challenge submission must be a complete coherent product experience, not only a technical proof. | VERIFIED CHALLENGE REQUIREMENT | P16/P17 | M0/W15/W17 | Independent submission review |
| U-16 | Challenge repo must be public, licensed, live, and accompanied by required description/video/testing artifacts. | VERIFIED CHALLENGE REQUIREMENT | Release | M0 | Rules checklist against live artifacts |
| U-17 | Persona learning must not silently expand authority. | PRODUCT INVARIANT | P3/P4/P15 | W4/W5/W9 | Property/adversarial tests |
| U-18 | External content is evidence, not automatic trusted memory. | PRODUCT INVARIANT | P3/P15 | W4/W9 | Memory-poisoning tests |
| U-19 | Audit/provenance must not itself leak protected values. | PRODUCT INVARIANT | P13 | W8 | Canary scan over logs/audit/export |
| U-20 | External protocols are adapters; trust decisions remain in PTF. | PRODUCT INVARIANT | P11 | W12/W13 | Architecture lint + adapter contract tests |
| U-21 | Product must support user correction, revocation, portability, recovery, and multi-device semantics. | PRODUCT REQUIREMENT | P3/P5/P14/P15/P16 | W4/W6/W16/W9/W15 | Recovery/export/revoke integration tests |
| U-22 | Complete product must expose reusable developer/recipient integration, not bespoke demo wiring. | PRODUCT REQUIREMENT | P12/P17 | W14/W17 | Second-recipient integration from SDK only |
| U-23 | Security claims must state evidence limits; no fabricated visibility into model/platform internals. | PRODUCT INVARIANT | All security claims | W18/M0 | Claim-to-evidence table |
| U-24 | Challenge submission must demonstrate observable generality through multiple materially different capability classes using one trust core; one scenario is insufficient. | PROVISIONAL DECISION enforcing U-03 for the challenge milestone | P3/P7/P8/P9/P10 | M0 | Fresh product-scope review + scenario-to-core trace + source scan |
| U-25 | After challenge submission, do not stop the product build. Preserve submitted artifacts as required by competition rules and continue product development only in a separate permitted development line/repository after rechecking rules. | USER REQUIREMENT + VERIFIED CHALLENGE CONSTRAINT | Program governance | M0 + W0–W18 | Submission-freeze record + continuation ledger |

## Traceability enforcement

Before marking any workstream or release complete:

1. list all requirement IDs it claims to satisfy;
2. point to tests/evidence;
3. reject any requirement whose only evidence is prose;
4. update the ledger when scope changes;
5. require a human product decision for removing a USER REQUIREMENT or PRODUCT INVARIANT.
