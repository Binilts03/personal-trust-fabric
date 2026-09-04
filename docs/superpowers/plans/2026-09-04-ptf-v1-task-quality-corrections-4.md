# PTF v1 Task-Quality Corrections 4 — Plan 03 AP2

Status: **BINDING PLANNING CORRECTIONS; APPROVED SPEC UNCHANGED**

This document resolves the second-pass C10 findings and one concrete cross-task interface contradiction in Plan 03. Read after the earlier September 4 correction documents and before the original AP2 subsystem plan.

---

## 03/T1 — dependency convergence is verification-only

Contract C2 supersedes this task's original dependency-edit behavior. Mark:

```text
verification_only: true
```

It verifies the pinned AP2 source metadata and confirms that the already-converged workspace uses:

```text
pydantic==2.12.5
cryptography==46.0.5
```

and that all Plan 00–02 tests remain green. It MUST NOT edit these dependency pins if they already match.

The upstream metadata command and complete regression command in the original task are its precondition/green evidence. If resolution fails, stop for the already-defined isolated-AP2-environment ADR path.

## 03/T2 — AP2 package bootstrap

The first task-quality corrections document supplies the missing pre-creation import failure. Exact source pin, package metadata, resolution verification, green tests, and commit remain binding.

## 03/T3 — mandate mapping

The first task-quality corrections document supplies the missing red command. The original `build_open_payment_mandate(...)` and `build_closed_payment_mandate(...)` signatures, exact 5,000/2,500 USD fixture, and rejection list provide the implementation/test contract.

No further correction is required.

## 03/T4 — AP2 Enforcement Map

The first task-quality corrections document supplies the missing red command. The original enforcement-location table, hash-mode assertions, and `build_ap2_enforcement_map(...)` signature are binding.

No further correction is required.

---

## 03/T5 — protected signing executor red state

Before creating the AP2 signing executor, write the private-key leak and grant/plan/binding tests described in the original task, then run:

```bash
uv run pytest \
  executors/ap2-signing/tests/test_executor.py \
  tests/integration/test_ap2_leak_canary.py -q
```

Expected: non-zero because `AP2SigningExecutor` does not exist.

The original `issue_open_mandate(...)` and `present_closed_mandate(...)` signatures are the minimal implementation shape, subject to the T6 flow correction below. Both methods require a current `ExecutionGrantRecord` bound to the exact selected `ExecutionPlan`; neither method may accept a Standing Grant or artifact reference as executable bearer authority by itself.

Green is the same pytest command and must exit 0.

---

## 03/T6 — correct open-mandate issuance to use the same plan-bound execution path

### Defect

The original flow signature:

```python
issue_open_payment_authority(
    *,
    principal: AuthenticatedActor,
    grant_id: str,
    holder_subject_id: str,
    holder_public_jwk: dict[str, object],
    now: datetime,
) -> AP2Artifact
```

was not composable with T5 because `AP2SigningExecutor.issue_open_mandate(...)` requires an `ExecutionGrantRecord` and `ExecutionPlan`. It also left the holder public key as caller-carried data rather than an explicitly validated binding.

The flow is replaced by a two-stage preparation/execution path.

### Corrected public flow

```python
class AP2MandateFlow:
    def prepare_open_payment_authority(
        self,
        *,
        agent: AuthenticatedActor,
        grant_id: str,
        grant_version: int,
        holder_binding: IdentityBinding,
        now: datetime,
    ) -> PreparedAction: ...

    def issue_open_payment_authority(
        self,
        *,
        action_id: str,
        now: datetime,
    ) -> AP2Artifact: ...

    def prepare_payment(
        self,
        *,
        agent: AuthenticatedActor,
        parent_mandate_ref: str,
        request: ActionRequest,
        merchant_binding_id: str,
        nonce: str,
        now: datetime,
    ) -> PreparedAction: ...

    def execute_payment_mandate(
        self,
        *,
        action_id: str,
        audience: str,
        nonce: str,
        now: datetime,
    ) -> PTFReceipt: ...
```

`holder_binding` must be an active, current, independently validated key binding for the holder Subject. The AP2 public JWK used in `cnf` is derived from that binding's validated public-key material; a caller-provided display name or unbound JWK cannot substitute it.

### Open-authority preparation semantics

`prepare_open_payment_authority(...)` MUST:

1. resolve the exact active Standing Grant `(grant_id, grant_version)` from authoritative state;
2. reject proposed/suspended/revoked/expired grants;
3. validate `holder_binding` against current Trust Registry state;
4. create a canonical PTF `ActionRequest` for protocol-authority-artifact issuance whose source authority is the exact Standing Grant version and whose recipient/delegate is the bound holder Subject;
5. create an `ExecutionPlan` containing at least the Standing Grant fingerprint/version, holder Subject + binding ID/public-key thumbprint, exact AP2 open-mandate constraints, issuer executor/profile, expiry, disclosure mode, Enforcement Map, Assurance Manifest, and AP2 transaction/artifact binding;
6. call `runtime.request_action(...)` and `runtime.select_plan(...)`;
7. return the safe `PreparedAction` only.

The plan must be no broader than the active Standing Grant. AP2 does not create or broaden the Standing Grant.

### Open-authority execution semantics

`issue_open_payment_authority(...)` MUST:

1. call `runtime.authorize_execution(action_id=..., now=...)`;
2. call `runtime.revalidate_execution(...)` immediately before signing;
3. retrieve the exact selected plan and active source grant version referenced by that plan;
4. build the upstream `OpenPaymentMandate` from that exact grant and bound holder public key;
5. call `AP2SigningExecutor.issue_open_mandate(execution_grant=..., plan=..., payload=...)`;
6. record the AP2 artifact only as protocol Evidence Artifact reference/digest;
7. reconcile successful artifact issuance as the exact planned effect; ambiguous signing/delivery failure after possible external exposure is classified fail-closed according to the plan's reconciliation semantics.

No direct `StandingGrant -> signed AP2 artifact` bypass is permitted.

### T6 red command

Write the original delegation/merchant/disclosure fixtures plus an open-authority test that proves no signed artifact can be produced without the runtime-issued execution grant. Before `flow.py` exists, run:

```bash
uv run pytest \
  adapters/ap2/tests/test_flow.py \
  tests/integration/test_ap2_delegation.py \
  tests/integration/test_ap2_merchant_binding.py \
  tests/integration/test_ap2_disclosure.py -q
```

Expected: non-zero because `AP2MandateFlow` is absent.

Green is the same command after implementation.

---

## 03/T7 — AP2 receipt verification red state

Before creating `receipts.py`, write the original reference/signature/unknown-mandate cases and reconciliation assertions, then run:

```bash
uv run pytest \
  adapters/ap2/tests/test_receipts.py \
  tests/integration/test_ap2_receipt.py -q
```

Expected: non-zero because `AP2ReceiptEvidence` and `verify_ap2_payment_receipt(...)` do not exist.

The original `verify_ap2_payment_receipt(...)` signature and reconciliation table are the minimal implementation shape. Green is the same command.

---

## 03/T8 — AP2 acceptance lock is verification-only

This task creates acceptance evidence over completed Plan 03 behavior. Mark:

```text
verification_only: true
```

Precondition:

```bash
test ! -f tests/acceptance/test_ap2_ptf_invariants.py
```

Expected: exit 0 before the acceptance test is created.

The original ten acceptance assertions and full AP2 pytest/Ruff/Pyright command are binding. Add one assertion from the T6 correction:

```text
open AP2 authority artifact issuance requires a plan-bound PTF Execution Grant; an active Standing Grant alone cannot call the signing executor.
```

---

## 03/T9 — x402/AP2 seam review is verification-only unless evidence selects a code seam

The task is primarily a review/decision task. Mark:

```text
verification_only: true
```

Precondition:

```bash
test ! -f docs/review/ap2-x402-seam-review.md
```

The original comparison table, deletion test, and three candidate designs are the exact review fixture.

Expected/default result remains **candidate 1: no additional interface** unless actual accepted implementations prove a deeper common seam. Candidate 2 may add only the specified evidence value object. Candidate 3 requires a new ADR and therefore cannot be selected silently inside this task.

If candidate 1 wins, the task implementation is documentation-only and must not stage unrelated source paths. Commit exactly:

```bash
git add docs/review/ap2-x402-seam-review.md
git commit -m "docs: review concrete AP2 and x402 protocol seam"
```

If candidate 2 or 3 is selected through the required review/ADR path, update the task file set and candidate commit explicitly before code changes; the implementer must not use the broad original `git add packages/ptf-runtime adapters/x402 adapters/ap2 tests` as permission to stage unrelated changes.

Green verification after any approved seam change remains the original full pytest/Ruff/Pyright command.

---

## Plan 03 disposition

After applying this document and earlier corrections, all nine Plan 03 tasks have an explicit C10 execution or verification path, and the open-mandate signing seam is plan-bound rather than left to implementer invention. Final PASS status is assigned only by the regenerated matrix.