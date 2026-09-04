# PTF v1 Task-Quality Corrections 3 — Plan 02 x402

Status: **BINDING PLANNING CORRECTIONS; APPROVED SPEC UNCHANGED**

This document resolves the second-pass C10 findings for Plan 02. Read after the earlier September 4 readiness/task-quality correction documents and before the original x402 subsystem plan.

## 02/T1 — package/provenance bootstrap

The first task-quality corrections document supplies the missing pre-creation import failure command. The upstream provenance/hash check is a verification precondition, not PTF behavior. The package import tests, exact package metadata, green command, and commit are otherwise sufficient.

## 02/T2 — payment requirement normalization

No further correction is required. The task already has:

- exact files;
- exact `interpret_payment_required(...)` signature;
- deterministic positive request assertions;
- explicit recipient/payment-endpoint/network/asset/amount rejection cases;
- red command;
- exact normalized model shapes;
- green command and commit.

It inherits the task-review protocol.

## 02/T3 — x402 Enforcement Map

The first task-quality corrections document supplies the missing red command. The original task's exact enforcement-location table plus unsupported-constraint semantic-loss fixture is the required test fixture, and `build_x402_enforcement_map(...)` is the implementation shape.

No additional correction is required.

## 02/T4 — protected wallet executor

The first task-quality corrections document supplies the missing red command. The task already freezes:

- public `create_payment_artifact(...)` signature;
- signer canary property;
- grant/plan/binding/resource-ref rejection list;
- official x402 client integration shape;
- artifact isolation requirement;
- truthful Assurance Manifest requirements;
- green command and commit.

No additional correction is required.

## 02/T5 — facilitator verification/settlement evidence red state

Before creating `adapters/x402/src/ptf_x402/evidence.py`, write the existing deterministic classification cases in `adapters/x402/tests/test_evidence.py`, then run:

```bash
uv run pytest adapters/x402/tests/test_evidence.py -q
```

Expected: non-zero because `X402VerificationEvidence`, `X402SettlementEvidence`, and `classify_x402_outcome(...)` do not exist.

The original implementation shape is binding:

```python
def classify_x402_outcome(
    *,
    verification: X402VerificationEvidence | None,
    settlement: X402SettlementEvidence | None,
    transport_phase: str,
    request_was_submitted: bool,
) -> ExternalExecutionResult: ...
```

The exact expected cases remain:

```text
verification rejected before submission -> RELEASED_NO_EFFECT
settlement success with transaction/hash evidence -> CONSUMED
deterministic facilitator settlement reject proving no effect -> RELEASED_NO_EFFECT
connection failure before request bytes submitted -> RELEASED_NO_EFFECT
connection/timeout after possible submission -> INDETERMINATE
malformed/contradictory response after possible submission -> INDETERMINATE
```

Green is the same pytest command and must exit 0.

## 02/T6 — concrete X402PaymentFlow red state

Before `flow.py` exists, write both the independently-covered Standing Grant path and the Exact Human Approval path in the named unit/integration files, then run:

```bash
uv run pytest \
  adapters/x402/tests/test_flow.py \
  tests/integration/test_x402_end_to_end.py -q
```

Expected: non-zero because `X402PaymentFlow` is absent.

The original `X402PaymentFlow.prepare(...)` and `.execute(...)` signatures and ordered preparation/execution sequences are the minimal implementation shape. No generic runtime protocol callback may be introduced.

Green is the same pytest command and must exit 0 without live-value transfer.

## 02/T7 — adversarial substitution/replay/indeterminate lock is verification-only

This task adds only adversarial integration evidence over already-implemented public seams. Mark:

```text
verification_only: true
```

Precondition before creating the two test modules:

```bash
test ! -f tests/integration/test_x402_recipient_substitution.py && \
test ! -f tests/integration/test_x402_indeterminate.py
```

Expected: exit 0 on the clean Plan 02 worktree.

The exact test fixtures are the original attack list:

```text
Merchant A -> Merchant B/pay-to B substitution
same label + different payment address
same address + different network
same recipient + amount +1 atomic unit
one-use execution replay
post-receipt timeout -> INDETERMINATE + HELD_INDETERMINATE + no second submission
```

Green remains:

```bash
uv run pytest \
  tests/integration/test_x402_recipient_substitution.py \
  tests/integration/test_x402_indeterminate.py -q
```

The task introduces no new production callable.

## 02/T8 — x402 acceptance lock is verification-only

This task creates acceptance evidence and a profile record; it does not introduce production behavior. Mark:

```text
verification_only: true
```

Precondition:

```bash
test ! -f tests/acceptance/test_x402_ptf_invariants.py
```

Expected: exit 0 before the acceptance test is added.

The original eight acceptance assertions, complete x402 verification command, deletion/seam review, and generic-adapter source scan are binding. The task's candidate commit is accepted only after the inherited two-stage review protocol passes.

Green remains the original full x402 pytest/Ruff/Pyright verification plus the adapter-abstraction scan.

## Plan 02 disposition

After applying this document and earlier September 4 corrections, all eight Plan 02 tasks have an explicit C10 path. Final PASS status is assigned only by the regenerated task-quality matrix after a fresh cross-document read.