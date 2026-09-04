# PTF v1 Task Review Protocol — Binding C10 Reviewer Gate

Status: **BINDING FOR EVERY EXECUTABLE TASK IN PLANS 00–06**

This document supplies the reviewer-acceptance dimension required by Contract C10. It does not change approved PTF semantics and does not make any task execution-ready by itself; the other seven C10 dimensions must still pass the task-quality matrix.

## Inheritance

Every executable task in Plans 00–06, including tasks inserted by September 4 corrections, inherits this gate after its green verification command and before any dependent task may start.

A commit boundary in a subsystem plan means **candidate task commit**, not accepted task completion.

## Gate sequence

For each task `<PLAN>/<TASK>`:

```text
RED EVIDENCE
  -> minimal implementation
  -> GREEN EVIDENCE
  -> candidate task commit
  -> Review A: specification/plan compliance
  -> Review B: implementation/test quality
  -> ACCEPTED or RETURNED TO TASK
```

A dependent task is blocked until both Review A and Review B are `PASS` against the same candidate commit SHA.

## Review A — specification and plan compliance

An independent reviewer who did not implement the task must check all of:

1. changed files are within the task's exact file set, or an additional file is justified by a reviewed task correction;
2. public names/signatures match the approved spec, ADRs, plan-set corrections, and task-quality contract;
3. the task does not create authority/trust from Personal State, model output, protocol validity, labels, or prior success;
4. no Hard Policy semantics are converted into authority;
5. no separate Standing Grants are unioned;
6. no protocol-specific concept leaks into canonical core unless already approved;
7. protected-resource/plaintext/key visibility matches the declared Assurance Manifest/TCB boundary;
8. no unsupported mandatory constraint is silently dropped;
9. no implementation claim exceeds the task's evidence;
10. no approved semantic was changed to make a test pass.

Review A result is one of:

```text
PASS
FAIL-SPEC
FAIL-PLAN
NEEDS-ADR-OR-SPEC-REVIEW
```

Only `PASS` releases Review B.

## Review B — implementation and test quality

A different independent reviewer, or the execution coordinator when a second independent reviewer is unavailable, must check all of:

1. the recorded red command actually failed for the intended missing behavior rather than environment noise;
2. the recorded green command passes on the candidate commit;
3. added tests exercise public/task seams rather than mocking away the security property;
4. negative/adversarial assertions are present where the task requires them;
5. error paths fail closed and use typed/safe errors;
6. no secret/protected canary appears in logs/errors/receipts/API/Agent/browser storage for tasks that touch those surfaces;
7. concurrency/replay tests are deterministic enough to falsify the stated property;
8. lint/type/build checks required by the task pass;
9. implementation does not contain unrequested abstraction/generalization;
10. code and tests are minimal enough that the next task does not depend on undocumented behavior.

Review B result is:

```text
PASS
FAIL-TESTS
FAIL-QUALITY
FAIL-SCOPE
```

Only `PASS` completes the task gate.

## Required task evidence record

Execution maintains one append-only review record per task under:

```text
artifacts/task-reviews/<plan-id>/<task-id>.json
```

Schema:

```json
{
  "plan": "00",
  "task": "T2",
  "candidate_commit": "<40-hex-sha>",
  "red_command": "<exact command>",
  "red_exit_code": 1,
  "red_reason": "missing target behavior/module",
  "green_command": "<exact command>",
  "green_exit_code": 0,
  "review_a": "PASS",
  "review_b": "PASS",
  "reviewed_spec_blob": "32fc9bb6119142e10b854b09a95544c4ec25d1cc"
}
```

The record must not contain protected values, credentials, raw protocol artifacts, or arbitrary logs.

## Mechanical release predicate

A task is accepted only if:

```python
record["candidate_commit"] == git_head_for_review
record["red_exit_code"] != 0
record["green_exit_code"] == 0
record["review_a"] == "PASS"
record["review_b"] == "PASS"
record["reviewed_spec_blob"] == "32fc9bb6119142e10b854b09a95544c4ec25d1cc"
```

For a verification-only task whose correct precondition is already green (for example a dependency provenance gate), replace `red_exit_code != 0` with an explicit precondition predicate recorded as `verification_only: true`; such a task must not fabricate a failing test merely to satisfy TDD vocabulary. Behavioral source tasks remain red-first.

## Failure behavior

- Review A or B failure returns to the same task; do not release a dependent task.
- A semantic conflict returns to planning/ADR/spec review; do not silently patch around it.
- A later commit after both reviews invalidates the task acceptance until the affected task's green command/reviews are rerun.

This protocol satisfies only Contract C10 item 8 (reviewer acceptance gate). It cannot be used to mark other missing C10 dimensions as complete.