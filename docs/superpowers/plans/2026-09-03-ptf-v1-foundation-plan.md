# PTF v1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the clean Python reference-workspace foundation and pure domain core that encodes PTF v1 terminology, immutable authority semantics, plan fingerprinting, Personal-State separation, and deterministic conformance oracles without database, network, UI, or protocol dependencies.

**Architecture:** `ptf-core` is a pure semantic library. It owns immutable domain values and deterministic pure functions, not persistence or transports. Pydantic models provide validated/frozen value objects; service logic remains ordinary pure Python functions/classes. CP1 is an in-memory reference ledger only for deterministic authority tests; CP2/PostgreSQL belongs to Plan 01.

**Tech Stack:** Python 3.14.7; uv workspace; Pydantic 2.x; pytest; Hypothesis; Ruff; Pyright. No FastAPI, PostgreSQL, AP2, x402, OpenID4VP, browser, or cloud dependencies in this plan.

**Spec:** `docs/spec/PTF-V1-PROPOSED.md`, exact approved blob recorded by `docs/spec/PTF-V1-APPROVAL.md`.

## Global Constraints

- Execute only after the roadmap repository-preservation/tag gate passes.
- Build on `rewrite/ptf-v1` in an isolated worktree; do not modify legacy `main` directly.
- `ptf-core` must not import any protocol adapter, database package, web framework, model/LLM SDK, or secret provider.
- Personal State cannot produce authority objects.
- Hard Policy is a restriction, not an authority source.
- Separate Standing Grants cannot be unioned.
- Unknown constraint/attenuation semantics fail closed.
- Plan fingerprints include every approval/security-relevant plan field.
- Monetary values use integer minor units + explicit ISO-4217 currency string; no binary floats in canonical security terms.
- UTC instants are timezone-aware and serialized in canonical `Z` form at security boundaries.
- All models reject unknown fields (`extra="forbid"`) and are frozen after construction.
- Public core errors are typed domain errors; do not expose raw dependency exceptions.
- Every task uses red-green-refactor and ends with a commit.

---

## File map

```text
pyproject.toml                         # uv workspace + shared dev tooling
.python-version                       # 3.14.7
packages/ptf-core/pyproject.toml       # ptf-core package metadata/dependencies
packages/ptf-core/src/ptf_core/
├── __init__.py
├── errors.py                          # typed domain failures
├── canonical.py                       # canonical security serialization/fingerprint
├── personal_state/
│   ├── __init__.py
│   ├── models.py                      # Observation/Claim/Preference/freshness
│   ├── freshness.py                   # freshness evaluation
│   └── safe_view.py                   # ContextView only; no authority derivation
├── identity/
│   ├── __init__.py
│   └── models.py                      # Subject/bindings/auth/trust snapshots
├── authority/
│   ├── __init__.py
│   ├── models.py                      # policies/grants/requests/decisions
│   ├── constraints.py                 # deterministic containment
│   ├── resolver.py                    # pure preliminary authorization
│   └── ledger.py                      # CP1 in-memory reservation reference
├── planning/
│   ├── __init__.py
│   ├── models.py                      # DisclosurePlan/ExecutionPlan/EnforcementMap
│   ├── fingerprint.py                 # plan fingerprint
│   └── validation.py                  # total map + downgrade checks
├── protected_resources/
│   ├── __init__.py
│   └── models.py                      # ResourceRef/custody/AssuranceManifest semantic types
└── audit/
    ├── __init__.py
    └── models.py                      # AuditEvent/PTFReceipt semantic types
packages/ptf-core/tests/
├── test_canonical.py
├── personal_state/
├── identity/
├── authority/
├── planning/
└── protected_resources/
tests/acceptance/test_foundation_invariants.py
```

---

### Task 1: Bootstrap the clean Python workspace

**Files:**
- Create: `.python-version`
- Create: `pyproject.toml`
- Create: `packages/ptf-core/pyproject.toml`
- Create: `packages/ptf-core/src/ptf_core/__init__.py`
- Create: `packages/ptf-core/tests/test_import.py`
- Create: `docs/adr/0007-python-reference-runtime.md`

**Interfaces:**
- Consumes: repository preflight from roadmap Task 1.
- Produces: importable `ptf_core` package and root tooling commands used by every later task.

- [ ] **Step 1: Verify runtime versions before scaffolding**

Run:
```bash
python3.14 --version
uv --version
```
Expected: Python `3.14.7`; uv installed. If Python is not exactly 3.14.7, install/select it before continuing rather than silently changing `.python-version`.

- [ ] **Step 2: Write the failing import test**

Create `packages/ptf-core/tests/test_import.py`:
```python
def test_ptf_core_imports() -> None:
    import ptf_core

    assert ptf_core.__all__ == []
```

- [ ] **Step 3: Create workspace configuration**

Create `.python-version`:
```text
3.14.7
```

Create root `pyproject.toml`:
```toml
[project]
name = "personal-trust-fabric-workspace"
version = "0.0.0"
requires-python = ">=3.14,<3.15"

[tool.uv.workspace]
members = ["packages/*", "adapters/*", "executors/*"]

[dependency-groups]
dev = [
  "hypothesis>=6.167,<7",
  "pyright>=1.1,<2",
  "pytest>=8,<10",
  "pytest-xdist>=3,<4",
  "ruff>=0.12,<1",
]

[tool.pytest.ini_options]
addopts = "-ra --strict-config --strict-markers"
testpaths = ["packages", "adapters", "executors", "tests"]

[tool.ruff]
target-version = "py314"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "RUF"]

[tool.pyright]
pythonVersion = "3.14"
typeCheckingMode = "strict"
include = ["packages", "adapters", "executors", "tests"]
```

Create `packages/ptf-core/pyproject.toml`:
```toml
[project]
name = "ptf-core"
version = "0.1.0"
requires-python = ">=3.14,<3.15"
dependencies = ["pydantic>=2.13,<3"]

[build-system]
requires = ["hatchling>=1.27,<2"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/ptf_core"]
```

Create `packages/ptf-core/src/ptf_core/__init__.py`:
```python
__all__: list[str] = []
```

- [ ] **Step 4: Record the implementation-stack decision**

Create `docs/adr/0007-python-reference-runtime.md`:
```markdown
# ADR 0007 — Python-First Reference Runtime

Status: **Accepted for v1 reference implementation**

## Context
The first proving integrations are x402, AP2, and OpenID4VP. AP2's official SDK is Python-first and x402 provides a maintained Python v2 SDK. Reimplementing AP2 schemas in TypeScript before proving the core would add protocol-translation risk.

## Decision
Use Python 3.14.7 + uv for the PTF v1 reference runtime. Protocol-neutral semantics remain independent of Python. Node.js 24 LTS/TypeScript is reserved for the later reference Trusted Surface and TypeScript Agent SDK.

## Consequences
Protocol adapters can use official upstream Python implementations during falsification. The public protocol semantics remain language-neutral and a future runtime implementation may use another language if it passes the same conformance suite.
```

- [ ] **Step 5: Resolve and lock dependencies**

Run:
```bash
uv sync --all-packages --all-groups
uv lock --check
```
Expected: `uv.lock` created and consistent.

- [ ] **Step 6: Run the import test**

Run:
```bash
uv run pytest packages/ptf-core/tests/test_import.py -q
```
Expected: PASS.

- [ ] **Step 7: Run lint/type baseline**

Run:
```bash
uv run ruff check .
uv run pyright
```
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add .python-version pyproject.toml uv.lock packages/ptf-core docs/adr/0007-python-reference-runtime.md
git commit -m "build: bootstrap PTF v1 Python workspace"
```

---

### Task 2: Add canonical immutable model base and security fingerprinting

**Files:**
- Create: `packages/ptf-core/src/ptf_core/errors.py`
- Create: `packages/ptf-core/src/ptf_core/canonical.py`
- Create: `packages/ptf-core/tests/test_canonical.py`

**Interfaces:**
- Produces: `FrozenModel`, `canonical_security_bytes(value: BaseModel) -> bytes`, `security_fingerprint(value: BaseModel) -> str`, `CanonicalizationError`.
- Consumes: Pydantic.

- [ ] **Step 1: Write failing deterministic fingerprint tests**

Create `packages/ptf-core/tests/test_canonical.py`:
```python
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict

from ptf_core.canonical import canonical_security_bytes, security_fingerprint


class Example(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    recipient: str
    amount_minor: int
    currency: str
    expires_at: datetime


def test_security_fingerprint_is_stable_for_same_value() -> None:
    value = Example(
        recipient="merchant-1",
        amount_minor=1850,
        currency="INR",
        expires_at=datetime(2026, 9, 3, 18, 0, tzinfo=UTC),
    )
    assert security_fingerprint(value) == security_fingerprint(value)


def test_security_fingerprint_changes_on_material_mutation() -> None:
    original = Example(
        recipient="merchant-1",
        amount_minor=1850,
        currency="INR",
        expires_at=datetime(2026, 9, 3, 18, 0, tzinfo=UTC),
    )
    mutated = original.model_copy(update={"amount_minor": 1851})
    assert security_fingerprint(original) != security_fingerprint(mutated)


def test_canonical_bytes_use_sorted_compact_json() -> None:
    value = Example(
        recipient="merchant-1",
        amount_minor=1850,
        currency="INR",
        expires_at=datetime(2026, 9, 3, 18, 0, tzinfo=UTC),
    )
    encoded = canonical_security_bytes(value)
    assert b'"amount_minor":1850' in encoded
    assert b" " not in encoded
```

- [ ] **Step 2: Verify red state**

Run:
```bash
uv run pytest packages/ptf-core/tests/test_canonical.py -q
```
Expected: FAIL because `ptf_core.canonical` does not exist.

- [ ] **Step 3: Implement canonical serialization and typed error**

Create `packages/ptf-core/src/ptf_core/errors.py`:
```python
class PTFDomainError(Exception):
    """Base error for deterministic PTF domain failures."""


class CanonicalizationError(PTFDomainError):
    pass
```

Create `packages/ptf-core/src/ptf_core/canonical.py`:
```python
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from ptf_core.errors import CanonicalizationError


class FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


def _normalize(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise CanonicalizationError("security datetime must be timezone-aware")
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, BaseModel):
        return _normalize(value.model_dump(mode="python"))
    if isinstance(value, dict):
        return {key: _normalize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    if isinstance(value, float):
        raise CanonicalizationError("binary floats are forbidden in security terms")
    return value


def canonical_security_bytes(value: BaseModel) -> bytes:
    normalized = _normalize(value)
    return json.dumps(
        normalized,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def security_fingerprint(value: BaseModel) -> str:
    return hashlib.sha256(canonical_security_bytes(value)).hexdigest()
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest packages/ptf-core/tests/test_canonical.py -q
```
Expected: PASS.

- [ ] **Step 5: Add negative tests for naive datetimes and floats, then run full core test**

Add tests asserting `CanonicalizationError` for a naive datetime and a float-valued security field. Run:
```bash
uv run pytest packages/ptf-core/tests -q
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ptf-core/src/ptf_core packages/ptf-core/tests
git commit -m "feat(core): add deterministic security fingerprinting"
```

---

### Task 3: Implement Personal State provenance and deterministic freshness

**Files:**
- Create: `packages/ptf-core/src/ptf_core/personal_state/models.py`
- Create: `packages/ptf-core/src/ptf_core/personal_state/freshness.py`
- Create: `packages/ptf-core/src/ptf_core/personal_state/safe_view.py`
- Create: `packages/ptf-core/src/ptf_core/personal_state/__init__.py`
- Create: `packages/ptf-core/tests/personal_state/test_freshness.py`
- Create: `packages/ptf-core/tests/personal_state/test_safe_view.py`

**Interfaces:**
- Produces: `Observation`, `Claim`, `Preference`, `FreshnessPolicy`, `FreshnessState`, `evaluate_freshness(...)`, `ContextView`, `build_context_view(...)`.
- Does not produce or import any Authority type.

- [ ] **Step 1: Write freshness tests covering all four approved policies**

Test STATIC, VALID_UNTIL, MAX_AGE, and STATUS_CHECK and assert `CURRENT`, `STALE`, `UNKNOWN`, or `REVOKED` exactly as specified. Include a test proving a revoked claim never evaluates CURRENT.

- [ ] **Step 2: Run to verify failure**

```bash
uv run pytest packages/ptf-core/tests/personal_state/test_freshness.py -q
```
Expected: import failure.

- [ ] **Step 3: Implement the minimum immutable Personal State models**

Use string IDs, explicit `source_class`, `source_id`, `observed_at`, `scope`, `sensitivity`, and `evidence_ids`. Define:
```python
class FreshnessKind(StrEnum):
    STATIC = "STATIC"
    VALID_UNTIL = "VALID_UNTIL"
    MAX_AGE = "MAX_AGE"
    STATUS_CHECK = "STATUS_CHECK"

class FreshnessState(StrEnum):
    CURRENT = "CURRENT"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"
    REVOKED = "REVOKED"
```
`STATUS_CHECK` takes a caller-supplied deterministic status value; no provider call belongs in core.

- [ ] **Step 4: Implement and run freshness tests**

```bash
uv run pytest packages/ptf-core/tests/personal_state/test_freshness.py -q
```
Expected: PASS.

- [ ] **Step 5: Write Safe View minimization tests**

Create `test_safe_view.py` proving:
- only requested/scope-matching shareable fields appear;
- full evidence/provenance strings are not copied into ContextView;
- inferred preferences remain labelled inferred;
- a stale preference may be included only when the request allows stale reversible context;
- no authority field exists in `ContextView`.

- [ ] **Step 6: Implement `ContextView` and `build_context_view`**

The function signature:
```python
def build_context_view(
    *,
    claims: tuple[Claim, ...],
    preferences: tuple[Preference, ...],
    requested_keys: frozenset[str],
    context_scope: str,
    allow_stale_preferences: bool,
) -> ContextView:
    ...
```
Return only minimized derived entries with `key`, safe `value`, `basis` (`explicit`/`inferred`/`verified`), and optional confidence—not raw provenance/evidence bodies.

- [ ] **Step 7: Run Personal State suite**

```bash
uv run pytest packages/ptf-core/tests/personal_state -q
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ptf-core/src/ptf_core/personal_state packages/ptf-core/tests/personal_state
git commit -m "feat(core): model provenance-aware personal state"
```

---

### Task 4: Implement Subjects, identity bindings, authentication evidence, and TrustRelations

**Files:**
- Create: `packages/ptf-core/src/ptf_core/identity/models.py`
- Create: `packages/ptf-core/src/ptf_core/identity/__init__.py`
- Create: `packages/ptf-core/tests/identity/test_identity_models.py`

**Interfaces:**
- Produces: `Subject`, `SubjectRole`, `IdentityBinding`, `EndpointBinding`, `AuthenticationEvidence`, `TrustRelation`, `TrustSnapshot`.
- TrustSnapshot contains `registry_epoch: int` and decision-time selected bindings/relations; persistence belongs to Plan 01.

- [ ] Write failing tests proving a Subject ID alone cannot satisfy `AuthenticationEvidence` and that human-readable display names are never binding keys.
- [ ] Run `uv run pytest packages/ptf-core/tests/identity -q` and verify failure.
- [ ] Implement frozen models with explicit binding type/value, status, verified_at, valid_until, and provenance reference.
- [ ] Add tests proving `TrustRelation` requires explicit role/function and cannot be constructed as a generic `trusted=True` record.
- [ ] Run identity tests and `uv run pyright`.
- [ ] Commit:
```bash
git add packages/ptf-core/src/ptf_core/identity packages/ptf-core/tests/identity
git commit -m "feat(core): add identity and trust domain values"
```

---

### Task 5: Implement Authority models, containment, no-grant-union resolution, and CP1 ledger

**Files:**
- Create: `packages/ptf-core/src/ptf_core/authority/models.py`
- Create: `packages/ptf-core/src/ptf_core/authority/constraints.py`
- Create: `packages/ptf-core/src/ptf_core/authority/resolver.py`
- Create: `packages/ptf-core/src/ptf_core/authority/ledger.py`
- Create: `packages/ptf-core/src/ptf_core/authority/__init__.py`
- Create: `packages/ptf-core/tests/authority/test_containment.py`
- Create: `packages/ptf-core/tests/authority/test_resolver.py`
- Create: `packages/ptf-core/tests/authority/test_cp1_ledger.py`

**Interfaces:**
- Produces: `HardPolicy`, `StandingGrant`, `ActionRequest`, `AuthorizationDecision`, `DecisionKind`, `AuthorityBasis`, `ExecutionGrantTerms`, `constraint_contains(parent, child) -> bool`, `resolve_preliminary(...) -> AuthorizationDecision`, `CP1AuthorityLedger.reserve(...)`.
- `resolve_preliminary` consumes an explicit tuple of grants; it may select one independently covering grant but may never combine fields from different grants.

- [ ] **Step 1: Write no-broadening property tests**

Use Hypothesis to generate parent/child integer amount limits, recipient sets, use counts, validity windows, and allowed operation sets. Assert a child is allowed only when each dimension is contained.

- [ ] **Step 2: Write grant-union attack test**

Construct:
- Grant A: Merchant X, max 500;
- Grant B: Merchant Y, max 5000;
- Request: Merchant X, 5000.
Assert `resolve_preliminary` does not authorize.

- [ ] **Step 3: Run red tests**

```bash
uv run pytest packages/ptf-core/tests/authority -q
```
Expected: FAIL/import errors.

- [ ] **Step 4: Implement minimal frozen authority values and containment**

Represent exact amounts as `amount_minor: int | None`; currency is an explicit string when an amount is present. Represent operations/recipients/resources/purposes as immutable `frozenset[str]`. Unknown custom constraint kinds are rejected until their deterministic containment semantics are registered explicitly.

- [ ] **Step 5: Implement `resolve_preliminary`**

Signature:
```python
def resolve_preliminary(
    *,
    request: ActionRequest,
    hard_policy: HardPolicy,
    active_grants: tuple[StandingGrant, ...],
    trust_snapshot: TrustSnapshot,
    now: datetime,
) -> AuthorizationDecision:
    ...
```
Resolution order: hard deny/restrictions → binding/trust prerequisites → find independently covering grants → select deterministic authority basis → return DENY / APPROVAL_REQUIRED / PROVISIONALLY_AUTHORIZABLE. Hard Policy alone must never return PROVISIONALLY_AUTHORIZABLE without a grant/approval basis.

- [ ] **Step 6: Implement CP1 in-memory reservation reference**

`CP1AuthorityLedger.reserve(grant_id, expected_version, amount_minor, execution_grant_id) -> Reservation` must serialize operations under a lock and check `committed + outstanding + requested <= limit`. This is reference behavior only; no async/distributed claim.

- [ ] **Step 7: Add race test**

Run concurrent thread requests against a limit where the sum exceeds capacity and assert successful reservations never exceed the limit.

- [ ] **Step 8: Run authority suite**

```bash
uv run pytest packages/ptf-core/tests/authority -q
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/ptf-core/src/ptf_core/authority packages/ptf-core/tests/authority
git commit -m "feat(core): enforce PTF authority invariants"
```

---

### Task 6: Implement DisclosurePlan, ExecutionPlan, Enforcement Map, Assurance Manifest, and mutation-sensitive fingerprint

**Files:**
- Create: `packages/ptf-core/src/ptf_core/planning/models.py`
- Create: `packages/ptf-core/src/ptf_core/planning/fingerprint.py`
- Create: `packages/ptf-core/src/ptf_core/planning/validation.py`
- Create: `packages/ptf-core/src/ptf_core/planning/__init__.py`
- Create: `packages/ptf-core/src/ptf_core/protected_resources/models.py`
- Create: `packages/ptf-core/src/ptf_core/protected_resources/__init__.py`
- Create: `packages/ptf-core/tests/planning/test_enforcement_map.py`
- Create: `packages/ptf-core/tests/planning/test_plan_fingerprint.py`
- Create: `packages/ptf-core/tests/protected_resources/test_assurance_manifest.py`

**Interfaces:**
- Produces: `DisclosureMode`, `DisclosurePlan`, `EnforcementLocation`, `ConstraintEnforcement`, `EnforcementMap`, `CustodyProfile`, `ArtifactCustodyMode`, `AssuranceManifest`, `ExecutionPlan`, `plan_fingerprint(plan) -> str`, `validate_execution_plan(plan, source_constraints) -> None`.

- [ ] Write failing tests proving every source constraint must appear in the Enforcement Map and `UNENFORCEABLE` without an approved downgrade fails validation.
- [ ] Write failing fingerprint mutation tests covering recipient, amount, resource, disclosure mode, protocol route, executor, downgrade, expiry, transaction binding, and Assurance Manifest.
- [ ] Run planning tests and verify red state.
- [ ] Implement immutable planning and assurance models. Store TCB/plaintext/key-use parties as explicit immutable sets of Subject IDs/role labels, never free-form “high security” scores.
- [ ] Implement plan validation and fingerprint using Task 2 canonical serialization.
- [ ] Run:
```bash
uv run pytest packages/ptf-core/tests/planning packages/ptf-core/tests/protected_resources -q
```
Expected: PASS.
- [ ] Commit:
```bash
git add packages/ptf-core/src/ptf_core/planning packages/ptf-core/src/ptf_core/protected_resources packages/ptf-core/tests/planning packages/ptf-core/tests/protected_resources
git commit -m "feat(core): add plan and assurance semantics"
```

---

### Task 7: Add AuditEvent/PTFReceipt semantic values with protected-field rejection

**Files:**
- Create: `packages/ptf-core/src/ptf_core/audit/models.py`
- Create: `packages/ptf-core/src/ptf_core/audit/__init__.py`
- Create: `packages/ptf-core/tests/audit/test_receipt.py`

**Interfaces:**
- Produces: `AuditEvent`, `PTFReceipt`, `ExecutionOutcome`.
- Receipt references evidence/artifacts by IDs/digests; it contains no generic arbitrary payload dictionary.

- [ ] Write failing tests asserting PTFReceipt contains authority basis, plan fingerprint, enforcement summary, executor/profile, protocol, result, assurance/downgrade summary, reservation result, timestamps.
- [ ] Add negative construction test ensuring known protected-value fields such as `private_key`, `card_number`, `passport_number`, `refresh_token`, `raw_credential`, and arbitrary raw payload maps are not part of the model schema.
- [ ] Implement minimal frozen models.
- [ ] Run `uv run pytest packages/ptf-core/tests/audit -q` and expect PASS.
- [ ] Commit:
```bash
git add packages/ptf-core/src/ptf_core/audit packages/ptf-core/tests/audit
git commit -m "feat(core): add privacy-minimized PTF receipt semantics"
```

---

### Task 8: Lock the foundational metamorphic conformance oracles

**Files:**
- Create: `tests/acceptance/test_foundation_invariants.py`
- Create: `tests/fixtures/authorization_regression_v1.json`

**Interfaces:**
- Consumes: all Plan 00 pure core APIs.
- Produces: locked baseline proving Personal-State-only changes cannot broaden authority and plan/grant mutation behavior remains stable.

- [ ] **Step 1: Create fixed authorization regression cases**

The JSON fixture must contain at least these named cases with deterministic expected decisions:
```json
[
  {"id":"no-authority","expected":"DENY"},
  {"id":"approval-required-over-limit","expected":"APPROVAL_REQUIRED"},
  {"id":"standing-grant-covered","expected":"PROVISIONALLY_AUTHORIZABLE"},
  {"id":"recipient-mismatch","expected":"DENY"},
  {"id":"expired-grant","expected":"DENY"},
  {"id":"grant-union-attack","expected":"DENY"}
]
```
The test code builds complete typed inputs for each ID; the fixture itself is only the locked case/expected-decision index.

- [ ] **Step 2: Implement the Personal-State metamorphic test**

For each fixed authority case, evaluate with an empty/minimal ContextView and again after changing only inferred preferences/claims. Assert the decision never becomes more permissive and no authority object is created/changed by the Safe View builder.

- [ ] **Step 3: Implement plan semantic-loss/mutation tests at the acceptance seam**

Delete one Enforcement Map entry and assert validation fails. Mutate each approval-relevant plan dimension and assert fingerprint changes.

- [ ] **Step 4: Run full foundation verification**

```bash
uv run pytest -q
uv run ruff check .
uv run pyright
```
Expected: all exit 0.

- [ ] **Step 5: Verify forbidden imports**

Run:
```bash
python - <<'PY'
from pathlib import Path
for path in Path('packages/ptf-core/src').rglob('*.py'):
    text = path.read_text()
    for forbidden in ('fastapi', 'psycopg', 'x402', 'ap2', 'openid', 'mcp', 'webmcp'):
        assert forbidden not in text.lower(), (path, forbidden)
PY
```
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/acceptance tests/fixtures
git commit -m "test: lock foundational PTF authority invariants"
```

---

## Plan 00 completion gate

Before Plan 01 begins:

```bash
uv run pytest -q
uv run ruff check .
uv run pyright
```

must all pass. An independent reviewer must specifically check:

1. Personal State has no import/dependency edge into Authority mutation.
2. Hard Policy cannot create authority.
3. Grant unioning is impossible by construction/resolver behavior.
4. Unknown constraints fail closed.
5. plan fingerprint mutation coverage is complete.
6. Enforcement Map validation is total.
7. CP1 tests do not make distributed atomicity claims.
8. No protocol/domain-demo vocabulary has entered canonical core types.

If any finding requires changing approved semantics, stop and create a spec amendment/ADR review rather than silently modifying the architecture in code.
