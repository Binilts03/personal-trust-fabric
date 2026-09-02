# Subagent and Execution Loops

## 1. Controller responsibility

The primary Codex agent owns:
- product/spec interpretation;
- task decomposition;
- skill routing;
- dependency ordering;
- architecture rulings;
- integration;
- evidence inspection;
- acceptance.

A child saying “done” is not evidence.

## 2. Mandatory fresh roles

Use fresh subagents for material independent work. Minimum recurring roles:

### Product Scope Reviewer
Attempts to find reductions, missing mandatory capabilities, scenario leakage, invented scope, or “future work” evasion.

### Architecture/Falsification Reviewer
Designs alternatives and attacks assumptions before hard-to-reverse decisions.

### Security Reviewer / Red Team
Treats agent/tool/recipient as hostile; reviews actual code/evidence.

### Standards Reviewer
Rechecks current specifications, maturity, versioning, and conformance requirements.

### Implementer
Receives a bounded spec/plan task and isolated workspace when appropriate.

### Task Reviewer
Fresh context; checks spec compliance, correctness, regressions, tests, scope.

### Final Release Reviewer
Reviews whole diff/system plus evidence, not conversation narrative.

## 3. Parallelism rule

Parallelize work only when agents can operate without shared mutable state or sequential dependency.

Good parallel work:
- independent primary-source research;
- competing architecture designs;
- independent read-only reviews;
- non-overlapping isolated implementation.

Bad parallel work:
- two agents editing the same interface simultaneously;
- security review before the relevant behavior exists;
- downstream adapter coding before core contract is settled.

## 4. Program loop

**Validate → Specify → Plan → Implement → Verify → Review → Integrate → Re-evaluate**

Repeat per bounded context/workstream until the complete traceability ledger is satisfied.

## 5. Task loop

**Plan → Red test → Implement → Green test → Refactor if justified → Full scoped verification → Review → Fix/re-review → Ledger**

Use the best installed workflow skills that implement this discipline.

## 6. Architecture loop

**Question → Primary-source research → 2–3 designs → threat/failure comparison → spike uncertain mechanics → ADR/ruling → test obligations**

## 7. Security loop

**Threat → exploit fixture → verify red/unsafe condition if possible → enforcement → adversarial test → canary scan → fresh review**

## 8. Challenge loop

**Select reusable PTF seams → WebMCP journey/evals → live deployment → judge-like test → submission evidence → fresh rule check → freeze submitted release**

The challenge loop never replaces the program loop.

## 9. Harness evolution loop

**Execution trace → evaluator diagnosis → proposed harness/skill mutation → isolated evaluation → regression/held-out gate → stage → human/security approval when required → adopt or discard**

No evolution agent can approve its own weakening of:
- product invariants;
- security tests;
- permissions;
- review isolation;
- evidence requirements.

## 10. Context discipline

Subagent briefs are self-contained and narrow. Prefer artifact paths to repeated pasted context. Fresh reviewers should not inherit implementation-agent conversational assumptions.
