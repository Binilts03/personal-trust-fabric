# PTF v1 Plan Readiness Addendum — September 4, 2026

Status: **PLANNING REOPENED — NOT READY FOR SOURCE EXECUTION**

> **For agentic workers:** This document is a planning-readiness gate. It does not change the approved PTF v1 specification or ADR semantics. Until every blocker below is closed, no execution workflow selection, worktree creation, source-code task, or rewrite of `main` is authorized by the plan set.

**Spec:** `docs/spec/PTF-V1-PROPOSED.md`, exact approved blob `32fc9bb6119142e10b854b09a95544c4ec25d1cc`, approved by `docs/spec/PTF-V1-APPROVAL.md`.

## Why planning is reopened

The September 4 verification pass discovered two classes of evidence that invalidate the earlier “verified implementation plan set complete” readiness claim while leaving the approved product semantics untouched:

1. repository-preservation state changed after the preservation baseline recorded by the approval/planning documents; and
2. Contract C10 is stricter than several tasks in the detailed plans and even stricter than parts of the remediation contract itself.

The correct response is to reopen planning, not to let an implementer guess.

---

## Blocker R1 — repository-preservation baseline drift

The approval record and existing execution documents freeze the preservation gate at:

```text
legacy/webmcp-sandbox -> 2ed4020c2f0ef91da1a5ee0e74e083539fed98b9
webmcp-sandbox-v0.1   -> same commit (required, currently absent)
```

After that lifecycle record was written, the public synthetic sandbox advanced on `main` to:

```text
f94a7bd3a59c440bddded8d6cab2956e595132e3
```

That later commit is explicitly titled a WebMCP synthetic sandbox freeze and is the target of annotated tag `webmcp-submit-freeze`. Therefore the factual phrase “final pre-rewrite synthetic milestone” can no longer be mechanically equated with `2ed4020c...` without an explicit lifecycle decision.

### Required decision — human, not implementer

Before source work, the human must explicitly approve exactly one preservation interpretation:

**PRESERVE-A — keep the approved preservation baseline.**

- `2ed4020c...` remains the architecture/planning preservation milestone named by the approval record;
- `f94a7bd3...` is recorded separately as the later Devpost/submission freeze, already protected by `webmcp-submit-freeze`;
- `webmcp-sandbox-v0.1` is created at `2ed4020c...` as the existing approval record requires;
- documentation must stop calling `2ed4020c...` the chronologically final synthetic commit and instead call it the **approved preservation baseline**.

**PRESERVE-B — rebaseline the preserved synthetic milestone.**

- `f94a7bd3...` becomes the preservation target;
- `legacy/webmcp-sandbox` and `webmcp-sandbox-v0.1` are aligned to it;
- the lifecycle/preservation record is amended through explicit human approval because the current approval record names `2ed4020c...` exactly.

Planning tooling MUST NOT select A or B implicitly. Until one is approved, the preservation gate is unresolved.

### Mechanical preflight after the decision

For PRESERVE-A:

```bash
test "$(git rev-parse origin/legacy/webmcp-sandbox)" = "2ed4020c2f0ef91da1a5ee0e74e083539fed98b9"
test "$(git rev-list -n 1 webmcp-sandbox-v0.1)" = "2ed4020c2f0ef91da1a5ee0e74e083539fed98b9"
test "$(git rev-list -n 1 webmcp-submit-freeze)" = "f94a7bd3a59c440bddded8d6cab2956e595132e3"
```

For PRESERVE-B, the equivalent checks must resolve the legacy branch and `webmcp-sandbox-v0.1` to the newly approved target, and the amended lifecycle record must be present on the execution base branch.

---

## Blocker R2 — Contract C10 is not yet satisfied by the whole plan set

Contract C10 requires every executable task to have all eight of:

1. exact files;
2. exact consumed/produced interfaces;
3. a concrete red test or explicit assertion fixture with exact expected values;
4. a command that demonstrates red state;
5. the minimal implementation shape/signature;
6. a command that demonstrates green state;
7. a commit boundary;
8. a reviewer acceptance gate.

The earlier audit treated C10 as a dispatch-time guard. That is insufficient for a plan set described as “complete” or “ready for execution selection.” A plan task that would immediately be returned to planning is not execution-ready.

### Confirmed defects

#### Q1 — Contract C5 uses repository methods it does not declare

`PersonalStateRepository` declares write/query methods but the mandatory tests call `get()` and `get_optional()` without defining them. The same test calls `latest_audit_event()` before the AI0 audit task is implemented.

The corrected Plan 01 Personal State repository interface is:

```python
class PersonalStateRepository:
    def append_observation(self, item: Observation) -> Observation: ...
    def put_claim(self, item: Claim) -> Claim: ...
    def put_preference(self, item: Preference) -> Preference: ...
    def get(self, item_id: str) -> Observation | Claim | Preference: ...
    def get_optional(self, item_id: str) -> Observation | Claim | Preference | None: ...
    def correct_item(
        self,
        *,
        item_id: str,
        replacement: Claim | Preference,
        principal_id: str,
    ) -> Claim | Preference: ...
    def erase_item(self, *, item_id: str, principal_id: str) -> None: ...
    def context_candidates(
        self,
        *,
        principal_id: str,
        scope: str,
        keys: frozenset[str],
    ) -> tuple[Claim | Preference, ...]: ...
```

Repository-task red tests are limited to repository-observable behavior:

```python
def test_correction_supersedes_without_rewriting_history(repo: PersonalStateRepository) -> None:
    repo.put_preference(OLD_PREF)
    new = repo.correct_item(item_id=OLD_PREF.id, replacement=NEW_PREF, principal_id="P1")
    old = repo.get(OLD_PREF.id)
    assert old.status == "SUPERSEDED"
    assert old.superseded_by == new.id


def test_erasure_removes_personal_content(repo: PersonalStateRepository) -> None:
    repo.put_claim(SENSITIVE_CLAIM)
    repo.erase_item(item_id=SENSITIVE_CLAIM.id, principal_id="P1")
    assert repo.get_optional(SENSITIVE_CLAIM.id) is None
```

Privacy-safe audit evidence for erasure moves to the later AI0 audit integration task, after `AuditSink`/audit persistence exists:

```python
def test_personal_state_erasure_audit_is_opaque(runtime, audit_repository) -> None:
    runtime.erase_personal_state(principal=PRINCIPAL, item_id=SENSITIVE_CLAIM.id, now=NOW)
    event = audit_repository.latest_for_action("PERSONAL_STATE_ERASED")
    assert event.resource_ref == SENSITIVE_CLAIM.id
    serialized = event.model_dump_json()
    assert "passport_number" not in serialized
    assert SENSITIVE_CLAIM.value not in serialized
```

The repository task must include a red command before implementation and a green command after implementation:

```bash
PTF_TEST_DATABASE_URL="$PTF_TEST_DATABASE_URL" \
  uv run pytest packages/ptf-postgres/tests/test_personal_state_repository.py -q
```

#### Q2 — Contract C6 names an undeclared repository and a not-yet-defined executor

The corrected resource-catalog public interface is:

```python
class ResourceCatalogRepository:
    def put(self, record: ProtectedResourceRecord) -> ProtectedResourceRecord: ...
    def get(self, *, principal_id: str, resource_ref: str) -> ProtectedResourceRecord: ...
    def get_optional(
        self,
        *,
        principal_id: str,
        resource_ref: str,
    ) -> ProtectedResourceRecord | None: ...
    def list_for_principal(self, *, principal_id: str) -> tuple[ProtectedResourceRecord, ...]: ...
    def set_status(
        self,
        *,
        principal_id: str,
        resource_ref: str,
        expected_version: int,
        status: str,
    ) -> ProtectedResourceRecord: ...
```

The resource-repository task tests only catalog behavior and schema secrecy. It MUST NOT call an undefined `executor.execute(...)`.

```python
def test_catalog_schema_rejects_known_secret_fields() -> None:
    forbidden = {"private_key", "card_number", "passport_number", "refresh_token", "raw_credential"}
    assert forbidden.isdisjoint(ProtectedResourceRecord.model_fields)


def test_resource_status_update_is_version_checked(repo: ResourceCatalogRepository) -> None:
    stored = repo.put(RESOURCE_RECORD)
    updated = repo.set_status(
        principal_id=stored.principal_id,
        resource_ref=stored.resource_ref,
        expected_version=stored.version,
        status="SUSPENDED",
    )
    assert updated.status == "SUSPENDED"
    assert updated.version == stored.version + 1
```

The foundational `ProtectedResourceRef`-is-not-authority negative test belongs to the synthetic Protected Executor task and each concrete protocol executor, where the real execution method signature exists. Those tests must prove there is no callable path accepting only a resource reference.

Repository red/green command:

```bash
PTF_TEST_DATABASE_URL="$PTF_TEST_DATABASE_URL" \
  uv run pytest packages/ptf-postgres/tests/test_resource_repository.py -q
```

#### Q3 — Safe View test helpers must be real fixtures, not invented names

The Safe View correction must create a test fixture module in the same inserted task:

```text
packages/ptf-runtime/tests/fixtures/safe_view.py
```

It must export `NOW`, `AGENT`, `SAFE_REQUEST`, and typed Personal State values used by the tests. Replace the undefined helper `add_inferred_preference(...)` with the actual repository port used by `ActionRuntime`:

```python
before = runtime.get_safe_view(agent=AGENT, request=SAFE_REQUEST, now=NOW).authority
personal_state_repository.put_preference(INFERRED_AUTONOMOUS_LIMIT)
after = runtime.get_safe_view(agent=AGENT, request=SAFE_REQUEST, now=NOW).authority
assert after == before
```

The red and green command is:

```bash
PTF_TEST_DATABASE_URL="$PTF_TEST_DATABASE_URL" \
  uv run pytest packages/ptf-runtime/tests/test_safe_view.py -q
```

#### Q4 — several original subsystem tasks remain under-specified under C10

Examples already confirmed include Foundation Task 6 and Task 7, and x402 tasks that combine “implement and run” without an independent red-state command. These are not isolated exceptions.

Therefore the execution coordinator MUST NOT rely on C10 as a future filter. Planning must first produce a task-quality matrix covering every task in Plans 00–06.

Create/maintain:

```text
docs/review/2026-09-04-plan-task-quality-matrix.md
```

One row per executable task with these exact columns:

```text
Plan | Task | exact-files | interfaces | red-test | red-command | implementation-shape | green-command | commit | reviewer-gate | status | notes
```

`status` is `PASS` only if all eight C10 dimensions are explicit in the task itself or in a binding correction that names that exact task. Otherwise it is `FAIL`.

Every `FAIL` task must be rewritten or supplied an exact task-scoped binding correction before source execution. The implementer may not supply the missing semantics while coding.

---

## Readiness definition after this addendum

The plan set may again be described as **ready for execution-workflow selection** only when all of the following are true:

1. the human has approved PRESERVE-A or PRESERVE-B;
2. the repository-preservation documents are internally consistent with that decision;
3. `webmcp-sandbox-v0.1` exists at the approved target;
4. every Plans 00–06 executable task is `PASS` in `docs/review/2026-09-04-plan-task-quality-matrix.md`;
5. all cross-plan public names/signatures are consistent after the repairs;
6. every one of the 28 foundational acceptance gates still maps to at least one implementation task and one later black-box/release oracle;
7. a fresh verification pass reads the actual Git refs and actual final plan files rather than relying on the earlier audit report.

Until then the correct lifecycle state is:

```text
SPECIFICATION: APPROVED
IMPLEMENTATION PLANNING: REOPENED
SOURCE IMPLEMENTATION: NOT AUTHORIZED
```

No source code is changed by this addendum.