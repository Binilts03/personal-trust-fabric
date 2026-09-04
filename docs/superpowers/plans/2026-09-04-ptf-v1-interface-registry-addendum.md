# PTF v1 Final Interface Registry Addendum — Personal State and Audit Values

Status: **BINDING WITH `2026-09-04-ptf-v1-final-interface-registry.md`; APPROVED SPEC UNCHANGED**

This addendum defines model fields that the final registry previously named but did not fully materialize. It exists so Superpowers test steps can use executable constructors rather than ellipses or invented fixtures.

---

# Personal State values — Plan 00 T3

```python
PersonalScalar = str | int | bool


class PersonalStateSourceClass(StrEnum):
    EXPLICIT_PRINCIPAL = "EXPLICIT_PRINCIPAL"
    OBSERVED = "OBSERVED"
    VERIFIED_EXTERNAL = "VERIFIED_EXTERNAL"
    INFERRED = "INFERRED"


class PersonalStateStatus(StrEnum):
    ACTIVE = "ACTIVE"
    SUPERSEDED = "SUPERSEDED"


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


class FreshnessPolicy(FrozenModel):
    kind: FreshnessKind
    valid_until: datetime | None = None
    max_age_seconds: int | None = None


class Observation(FrozenModel):
    id: str
    principal_id: str
    key: str
    value: PersonalScalar
    source_class: PersonalStateSourceClass
    source_id: str
    observed_at: datetime
    scope: str
    sensitivity: str
    evidence_ids: tuple[str, ...]


class Claim(FrozenModel):
    id: str
    principal_id: str
    key: str
    value: PersonalScalar
    source_class: PersonalStateSourceClass
    source_id: str
    observed_at: datetime
    scope: str
    sensitivity: str
    evidence_ids: tuple[str, ...]
    freshness_policy: FreshnessPolicy
    confidence_millis: int | None = None
    status: PersonalStateStatus = PersonalStateStatus.ACTIVE
    superseded_by: str | None = None


class Preference(FrozenModel):
    id: str
    principal_id: str
    key: str
    value: PersonalScalar
    source_class: PersonalStateSourceClass
    source_id: str
    observed_at: datetime
    scope: str
    sensitivity: str
    evidence_ids: tuple[str, ...]
    freshness_policy: FreshnessPolicy
    confidence_millis: int | None = None
    status: PersonalStateStatus = PersonalStateStatus.ACTIVE
    superseded_by: str | None = None
```

Rules:

```text
Observation records evidence and has no correction status/freshness authority semantics.
Claim/Preference confidence_millis is 0..1000 when present; binary float confidence is forbidden.
STATIC forbids valid_until/max_age_seconds.
VALID_UNTIL requires valid_until and forbids max_age_seconds.
MAX_AGE requires positive max_age_seconds and forbids valid_until.
STATUS_CHECK forbids both; caller supplies deterministic checked status to evaluate_freshness.
REVOKED status result always dominates time-based CURRENT evaluation.
```

Safe Context value:

```python
class ContextItem(FrozenModel):
    key: str
    value: PersonalScalar
    basis: str
    freshness: FreshnessState
    confidence_millis: int | None = None


class ContextView(FrozenModel):
    principal_id: str
    scope: str
    items: tuple[ContextItem, ...]
```

`basis` is one of `explicit`, `observed`, `verified`, or `inferred`. ContextView contains no source/evidence bodies, authority/grant objects, or raw protected resources.

`build_context_view(...)` must also receive `principal_id`:

```python
def build_context_view(
    *,
    principal_id: str,
    claims: tuple[Claim, ...],
    preferences: tuple[Preference, ...],
    requested_keys: frozenset[str],
    context_scope: str,
    allow_stale_preferences: bool,
    now: datetime,
) -> ContextView: ...
```

Older signatures lacking Principal/time context are superseded.

---

# AuditEvent and PTFReceipt — Plan 00 T7

```python
class AuditEvent(FrozenModel):
    event_id: str
    event_type: str
    principal_id: str
    actor_subject_id: str | None
    action_id: str | None
    resource_ref: str | None
    plan_fingerprint: str | None
    outcome: ExecutionOutcome | None
    evidence_refs: tuple[str, ...]
    occurred_at: datetime


class PTFReceipt(FrozenModel):
    receipt_id: str
    action_id: str
    principal_id: str
    authority_basis: AuthorityBasis
    agent_subject_id: str
    delegation_path: tuple[str, ...]
    operation: str
    recipient_id: str | None
    purpose: str
    plan_fingerprint: str
    enforcement_map: EnforcementMap
    executor_subject_id: str
    executor_profile_id: str
    protocol: str
    external_evidence_refs: tuple[str, ...]
    outcome: ExecutionOutcome
    reservation_state: str | None
    assurance_manifest: AssuranceManifest
    downgrade_ids: tuple[str, ...]
    residual_risks: tuple[str, ...]
    started_at: datetime
    finished_at: datetime
```

Neither type has an arbitrary `payload`, `raw`, `context`, `credential`, `secret`, `private_key`, `card_number`, `passport_number`, `refresh_token`, or protocol-token field. Safe evidence references/digests are used instead.

---

# Prepared Action state values

```python
class PreparedActionState(StrEnum):
    PREPARED = "PREPARED"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    AUTHORIZED = "AUTHORIZED"
    EXECUTING = "EXECUTING"
    CONSUMED = "CONSUMED"
    RELEASED_NO_EFFECT = "RELEASED_NO_EFFECT"
    INDETERMINATE = "INDETERMINATE"
    DENIED = "DENIED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"
```

`ExecutionOutcome` values used by reconciliation are exactly:

```python
class ExecutionOutcome(StrEnum):
    CONSUMED = "CONSUMED"
    RELEASED_NO_EFFECT = "RELEASED_NO_EFFECT"
    INDETERMINATE = "INDETERMINATE"
```

---

## C10 rule

Tests in the strict task supplement use these exact constructors/fields. If implementation planning later requires another approval/security-relevant field, it is added through reviewed planning/spec traceability rather than an ad hoc `dict[str, object]` escape hatch.