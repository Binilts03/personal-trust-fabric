# PTF v1 Strict C10 Code Supplement — Plan 06 Conformance, Portability, Recovery, Release

Status: **BINDING TEST/IMPLEMENTATION SUPPLEMENT FOR SUPERPOWERS PLAN QUALITY**

This supplement closes the remaining executable-test gaps in Plan 06. It is read with corrections 7 and 10, the final interface registry, release-toolchain research, the task-review protocol, and the original Plan 06.

The conformance package is a black-box/public-seam harness, never a second authority engine.

---

## T1 — conformance runner/evidence package

Original T1 is already strict enough: exact public models, profile completeness fixture, red import command, deterministic evidence behavior, green command, and commit boundary. No additional supplement is required.

---

## T2 — dependency-ready foundational oracle registration

Create `tests/conformance/test_foundation_profile.py` before oracle modules. Required registration test:

```python
MANDATORY_IDS = {
    "AUTH-PERSONAL-STATE-NO-BROADEN",
    "AUTH-NO-GRANT-UNION",
    "AUTH-EXCEPTION-NO-GRANT-MUTATION",
    "AUTH-PLAN-MUTATION-REAPPROVAL",
    "AUTH-REVOCATION-RECHECK",
    "AUTH-DELEGATION-ATTENUATION",
    "COORD-AGGREGATE-RACE",
    "ID-RECIPIENT-SUBSTITUTION",
    "ID-ENDPOINT-PAYMENT-SUBSTITUTION",
    "ID-STALE-BINDING",
    "TRUST-MISSING-RELATION",
    "DISCLOSURE-ESCALATION",
    "PLAN-SEMANTIC-LOSS",
    "PLAN-DOWNGRADE-POLICY",
    "EXEC-REPLAY",
    "EXEC-INDETERMINATE-NO-BLIND-RETRY",
    "RESOURCE-REF-NOT-AUTHORITY",
    "LEAK-AGENT-SURFACES",
    "LEAK-LOG-RECEIPT-ERROR-TELEMETRY",
    "MEMORY-SOURCE-LAUNDERING",
    "MIGRATION-NO-SILENT-BROADENING",
    "PORTABILITY-IMPORT-NO-TRUST-ESCALATION",
    "RECOVERY-TCB-NO-BROADENING",
}


def test_foundation_profile_registers_every_mandatory_id(profile) -> None:
    assert set(profile.required_oracle_ids) == MANDATORY_IDS


def test_pending_required_oracle_prevents_pass(runner, target) -> None:
    evidence = runner.run(target=target)
    assert evidence.overall_status == "FAIL"
    by_id = {r.oracle_id: r for r in evidence.results}
    for pending in (
        "MIGRATION-NO-SILENT-BROADENING",
        "PORTABILITY-IMPORT-NO-TRUST-ESCALATION",
        "RECOVERY-TCB-NO-BROADENING",
    ):
        assert by_id[pending].status != "PASS"
```

Locked authorization corpus case shape is exact JSON data:

```json
{
  "case_id": "payment-no-grant",
  "fixture_state_id": "state-payment-no-grant",
  "request_id": "request-payment-1",
  "expected_decision": "APPROVAL_REQUIRED"
}
```

No executable code is stored inside the corpus.

Red:

```bash
uv run pytest tests/conformance/test_foundation_profile.py -q
```

Expected: non-zero before registrations/oracles exist.

Implementation uses the correction-1 `ConformanceTarget`/`Oracle` public seam. Dependency-ready oracles drive `ActionRuntime`/HTTP public methods only. Green is package tests + foundation registration tests, while overall profile remains non-PASS until T4/T5/T8 close pending IDs.

---

## T3 — protocol conformance packs

Create the three named protocol test files before adding cases. Each calls accepted Plan 02–04 public flows.

Required invariant test skeleton:

```python
@pytest.mark.parametrize(
    "protocol,make_valid_external_artifact,run_ptf_denied_flow",
    [
        ("x402", make_valid_x402_artifact, run_denied_x402),
        ("ap2", make_valid_ap2_artifact, run_denied_ap2),
        ("openid4vp", make_valid_openid4vp_artifact, run_denied_openid4vp),
    ],
)
def test_protocol_validity_never_upgrades_ptf_deny(
    protocol, make_valid_external_artifact, run_ptf_denied_flow
) -> None:
    artifact = make_valid_external_artifact()
    result = run_ptf_denied_flow(artifact)
    assert result.decision != "AUTHORIZE"
```

Each protocol file also contains the exact attack cases listed by original T3/corrections: recipient/audience/verifier substitution, replay, disclosure escalation, key/raw credential leak, and ambiguous outcome handling.

Red:

```bash
uv run pytest \
  tests/conformance/test_x402_profile.py \
  tests/conformance/test_ap2_profile.py \
  tests/conformance/test_openid4vp_profile.py -q
```

Expected: non-zero because files/cases do not yet exist. This task introduces no production callable. Green is the same command.

---

## T4 — Portable State service + portability oracle

Use correction 7 exact files and `0003_portability.sql`.

Create `packages/ptf-conformance/tests/test_portability_oracle.py`:

```python
def test_imported_trust_metadata_cannot_authorize_before_destination_revalidation(
    target, source_package_with_trusted_merchant
) -> None:
    inspected = target.inspect_import(source_package_with_trusted_merchant)
    assert "trust:merchant-x" in inspected.requires_revalidation

    target.commit_import(source_package_with_trusted_merchant)
    decision = target.request_action(REQUEST_TO_MERCHANT_X)
    assert decision.authorization_decision != "AUTHORIZE"
```

Integration tests include:

```python
def test_export_contains_no_raw_resource_canaries(portability_service) -> None:
    package = portability_service.export_state(principal=PRINCIPAL, now=NOW)
    text = package.model_dump_json()
    for canary in (PAYMENT_KEY_CANARY, CREDENTIAL_CANARY, REFRESH_TOKEN_CANARY):
        assert canary not in text


def test_commit_rejects_package_changed_after_inspection(portability_service, package) -> None:
    inspected = portability_service.inspect_import(principal=PRINCIPAL, package=package, now=NOW)
    changed = package.model_copy(update={"personal_state": ()})
    with pytest.raises(Exception):
        portability_service.commit_import(
            principal=PRINCIPAL,
            package=changed,
            inspected_digest=package.package_digest,
            now=NOW,
        )
```

Red/green command is exactly correction 7's T4 three-file pytest command. T4 replaces pending `PORTABILITY-IMPORT-NO-TRUST-ESCALATION` with the real oracle.

---

## T5 — devices, revocation, recovery, recovery oracle

Use correction 7 exact files/interfaces.

Create `tests/integration/test_multi_device_revocation.py` with:

```python
def test_revoking_one_device_invalidates_its_binding_and_epoch_only_once(device_service, trust_repo) -> None:
    a = enroll_verified_device(device_service, principal=PRINCIPAL, key_id="device-a")
    b = enroll_verified_device(device_service, principal=PRINCIPAL, key_id="device-b")
    before = trust_repo.current_epoch()

    revoked = device_service.revoke_device(
        principal=PRINCIPAL,
        device_id=a.device_id,
        expected_version=a.version,
        now=NOW,
    )

    assert revoked.status is DeviceStatus.REVOKED
    assert trust_repo.current_epoch() == before + 1
    assert authentication_with(a.identity_binding_id).fails_closed()
    assert authentication_with(b.identity_binding_id).succeeds()
```

Create `tests/integration/test_recovery_tcb.py`:

```python
def test_recovery_cannot_add_plaintext_observer_without_separate_approval(recovery_service) -> None:
    proposed = PRE_LOSS_MANIFEST.model_copy(
        update={"plaintext_observers": PRE_LOSS_MANIFEST.plaintext_observers | {"new-operator"}}
    )
    plan = recovery_service.plan_recovery(
        principal=PRINCIPAL,
        pre_loss_manifest=PRE_LOSS_MANIFEST,
        proposed_post_recovery_manifest=proposed,
        now=NOW,
    )
    with pytest.raises(Exception):
        recovery_service.execute_recovery(
            principal=PRINCIPAL,
            recovery_plan=plan,
            approval=None,
            now=NOW,
        )
```

Recovery oracle:

```python
def test_recovery_oracle_fails_unapproved_tcb_broadening(target) -> None:
    result = RecoveryTcbNoBroadeningOracle().run(target=target, fixture=BROADENING_FIXTURE)
    assert result.status == "FAIL"
```

Red/green command is correction 7's T5 three-file command. T5 replaces pending `RECOVERY-TCB-NO-BROADENING`.

---

## T6 — AI1 witness

Create `tests/integration/test_ai1_witness.py` before implementation:

```python
class RecordingWitness:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int, datetime]] = []

    def witness_checkpoint(self, checkpoint_digest: str, sequence: int, created_at: datetime):
        self.calls.append((checkpoint_digest, sequence, created_at))
        return WitnessReceipt.fixture(checkpoint_digest=checkpoint_digest, sequence=sequence)


def test_witness_receives_only_commitment_tuple(audit_service) -> None:
    witness = RecordingWitness()
    service = audit_service.with_witness(witness)
    service.create_checkpoint()
    assert len(witness.calls) == 1
    assert len(witness.calls[0]) == 3
    assert "PTF_CANARY" not in repr(witness.calls)


def test_local_rewrite_cannot_match_external_witness(ai1_service) -> None:
    receipt = ai1_service.create_checkpoint()
    rewrite_local_history_and_rekey(ai1_service)
    assert ai1_service.verify_history_against_witness(receipt) is False
```

Red:

```bash
uv run pytest tests/integration/test_ai1_witness.py -q
```

Implementation interface remains `AuditWitness.witness_checkpoint(...)`. Green is same. AI0 is not relabelled AI1 when witness is absent/unavailable.

---

## T7 — final Principal product journeys including secure device registration

Correction 10 is the exact owner for WebAuthn registration verification.

Create `packages/ptf-api/tests/test_principal_authorization.py` additions:

```python
def test_device_registration_wrong_origin_rejected(service, registration_response) -> None:
    options = service.begin_device_registration(
        principal=PRINCIPAL,
        required_assurance="AA2",
        now=NOW,
    )
    bad = with_origin(registration_response, "https://evil.example")
    with pytest.raises(Exception):
        service.verify_device_registration(
            principal=PRINCIPAL,
            challenge_id=options.challenge_id,
            credential_response=bad,
            now=NOW,
        )


def test_device_registration_challenge_is_single_use(service, registration_response) -> None:
    options = service.begin_device_registration(principal=PRINCIPAL, required_assurance="AA2", now=NOW)
    service.verify_device_registration(
        principal=PRINCIPAL,
        challenge_id=options.challenge_id,
        credential_response=registration_response,
        now=NOW,
    )
    with pytest.raises(Exception):
        service.verify_device_registration(
            principal=PRINCIPAL,
            challenge_id=options.challenge_id,
            credential_response=registration_response,
            now=NOW,
        )
```

Add wrong RP ID, `user_verified=False` under AA2, and request-label-as-binding tests.

Principal route E2E asserts `POST /devices/enroll` BEGIN -> server options, COMPLETE -> server verified IdentityBinding -> DeviceService completion. No route handler constructs a binding directly from a request label/key.

Agent schema regression:

```typescript
expect(Object.getOwnPropertyNames(PtfClient.prototype).sort()).toEqual([
  'constructor','getAction','getReceipt','getSafeView','requestAction','selectPlan'
]);
```

and generated Agent OpenAPI contains no `devices`, `portability`, or `recovery` path.

Red/green commands are correction 10/correction 7's API + three Playwright journeys + Agent schema regeneration/test.

---

## T8 — migration/self-improvement oracle

Create `packages/ptf-conformance/tests/test_migration_oracle.py`:

```python
@pytest.mark.parametrize(
    "before,after",
    [
        ("DENY", "APPROVAL_REQUIRED"),
        ("DENY", "AUTHORIZE"),
        ("APPROVAL_REQUIRED", "AUTHORIZE"),
    ],
)
def test_unexplained_authority_broadening_fails(before, after) -> None:
    result = MigrationNoSilentBroadeningOracle().compare_case(
        case_id="case-1",
        before_decision=before,
        after_decision=after,
        approved_change_id=None,
    )
    assert result.status == "FAIL"
```

A second test changes planner/ranking/Personal-State strategy while authority state/corpus stay fixed and expects the same fail-closed rule.

Red:

```bash
PTF_TEST_DATABASE_URL="$PTF_TEST_DATABASE_URL" \
  uv run pytest \
    packages/ptf-conformance/tests/test_migration_oracle.py \
    tests/conformance/test_migrations.py -q
```

T8 replaces the final pending `MIGRATION-NO-SILENT-BROADENING`. Green is same and a foundation profile run must now contain no pending mandatory oracle.

---

## T9 — CI/supply-chain configuration

`verification_only: true`.

Use only correction 10 + `docs/research/2026-09-04-release-toolchain-profile.md`; correction 7's older action SHAs are superseded.

Create `tests/acceptance/test_ci_configuration.py` before workflow files:

```python
REVIEWED = {
    "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-python": "5fda3b95a4ea91299a34e894583c3862153e4b97",
    "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
    "astral-sh/setup-uv": "20cfd1bf945f4377ade1205e4dbc17946fc9a30d",
    "pypa/gh-action-pip-audit": "1220774d901786e6f652ae159f7b6bc8fea6d266",
    "gitleaks/gitleaks-action": "e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e",
    "actions/upload-artifact": "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "actions/download-artifact": "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "actions/cache": "55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
}


def test_every_external_action_is_exact_reviewed_sha(workflow_uses) -> None:
    for repository, revision in workflow_uses:
        assert REVIEWED[repository] == revision


def test_gitleaks_binary_is_explicitly_pinned(workflow_text) -> None:
    assert 'GITLEAKS_VERSION: "8.24.3"' in workflow_text
    assert "GITLEAKS_VERSION: latest" not in workflow_text
```

Add assertions for Python 3.14.7, Node 24.20.0, PostgreSQL 18, foundational conformance command, scan-before-upload ordering, vulnerability exception fields, and no unrestricted workspace/database/raw protocol artifact upload.

Precondition:

```bash
test ! -f .github/workflows/ci.yml && \
test ! -f .github/workflows/security.yml && \
test ! -f .github/workflows/release-evidence.yml
```

Green is correction 10's CI config test plus complete local Python/JS/security commands. Any vulnerability feed outage is non-PASS.

---

## T10 — external evidence and release-claim guard

`verification_only: true` for external evidence recording/release gating, but the release-claim test is red-first.

Create `tests/acceptance/test_release_claims.py` before claim registry:

```python
def test_missing_claim_registry_fails() -> None:
    assert CLAIM_REGISTRY_PATH.exists(), "claim registry is required"


def test_unqualified_guarded_claim_fails(scanner) -> None:
    result = scanner.scan_text("Our product is OpenID certified.")
    assert result.allowed is False


def test_profile_qualified_ptf_claim_requires_passing_evidence(scanner) -> None:
    result = scanner.scan_text(
        "PTF conformant: PTF-V1-FOUNDATION-1 / suite 1 / evidence sha256:abc",
        evidence_status="FAIL",
    )
    assert result.allowed is False
```

Red:

```bash
uv run pytest tests/acceptance/test_release_claims.py -q
```

Expected: non-zero before `docs/conformance/claim-registry.json` exists.

Registry structure/status semantics are correction 7's. OpenID external status is `PASS`, `FAIL`, or `NOT_RUN`; `NOT_RUN` renders “not demonstrated” and cannot support certification. Release manifest generator recomputes all digests and requires foundational conformance PASS/no mandatory skip/fail/pending.

Green is release-claim tests plus the original complete release gate and CI-config test.

---

## C10 disposition

Every Plan 06 behavioral task now has a concrete executable fixture/red command/public implementation seam. T9/T10 verification/configuration work has explicit preconditions and executable acceptance tests. Existing green commands, commit boundaries, and the inherited two-stage review gate complete the strict task shape.