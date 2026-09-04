# PTF v1 Task-Quality Corrections 10 — Plan 06 Device Ceremony and Supply-Chain Pins

Status: **BINDING NARROW CORRECTION; APPROVED SPEC UNCHANGED**

This document supersedes only conflicting Plan 06 T7/T9 details in earlier corrections. It closes two remaining implementer decisions discovered under Superpowers plan self-review and Matt Skills Curated codebase-design/research review.

---

## 06/T7 — exact owner for WebAuthn device-registration verification

Correction 7 correctly keeps WebAuthn out of the canonical `DeviceService`, but it did not name the server module/interface that turns a browser registration response into the verified `IdentityBinding` consumed by `DeviceService.complete_enrollment(...)`.

### Exact file additions

T7 also modifies:

```text
packages/ptf-api/src/ptf_api/principal_authorization.py
packages/ptf-api/tests/test_principal_authorization.py
```

### Principal authorization interface

Extend the existing Plan 05 Principal authorization service with:

```python
class DeviceRegistrationOptions(FrozenModel):
    challenge_id: str
    public_key_options: dict[str, object]
    expires_at: datetime


class PrincipalAuthorizationService:
    # Existing action/grant begin/verify methods remain unchanged.

    def begin_device_registration(
        self,
        *,
        principal: AuthenticatedActor,
        required_assurance: str,
        now: datetime,
    ) -> DeviceRegistrationOptions: ...

    def verify_device_registration(
        self,
        *,
        principal: AuthenticatedActor,
        challenge_id: str,
        credential_response: dict[str, object],
        now: datetime,
    ) -> IdentityBinding: ...
```

`begin_device_registration(...)` obtains the T5 `DeviceEnrollmentChallenge` from `DeviceService.begin_enrollment(...)`, generates server-side WebAuthn registration options, and binds the stored challenge to:

```text
Principal Subject
required assurance
configured RP ID
configured origin
expiry
single-use state
```

`verify_device_registration(...)` uses the pinned server WebAuthn library and rejects unless all of these are verified against server-held challenge state:

```text
challenge equality and single use
challenge freshness
expected RP ID
expected origin
credential/public-key validity
Principal context
required user verification for the configured enrollment assurance
credential ID/public key not already actively bound to a different Principal/device
```

Only after successful verification may it construct and return an `IdentityBinding`. The verified credential/key identity is the binding value. Caller-provided display labels, usernames, Subject labels, or public keys carried outside the verified registration response are not authentication evidence.

### Route choreography

The Contract C8 route remains exactly:

```text
POST /v1/principal/devices/enroll
```

with the two discriminated phases from correction 7.

For `phase="BEGIN"`:

```text
authenticate existing Principal
-> PrincipalAuthorizationService.begin_device_registration(...)
-> return DeviceRegistrationOptions
```

For `phase="COMPLETE"`:

```text
authenticate existing Principal
-> PrincipalAuthorizationService.verify_device_registration(...)
-> DeviceService.complete_enrollment(
       principal=principal,
       challenge_id=challenge_id,
       verified_binding=binding,
       now=now,
   )
-> return safe DeviceEnrollment metadata
```

The FastAPI handler MUST NOT construct an `IdentityBinding` directly from request JSON.

### Required test names

Add to `packages/ptf-api/tests/test_principal_authorization.py` before implementation:

```text
test_device_registration_rejects_wrong_origin
test_device_registration_rejects_wrong_rp_id
test_device_registration_rejects_replayed_challenge
test_device_registration_rejects_unverified_user_for_aa2
test_device_registration_rejects_request_label_as_binding_identity
```

Red command:

```bash
uv run pytest \
  packages/ptf-api/tests/test_principal_authorization.py \
  packages/ptf-api/tests/test_principal_product_routes.py -q
```

Expected: non-zero before device-registration methods/routes are implemented. Green is the same command plus the T7 device E2E test defined by correction 7.

The resulting module boundary is:

```text
WebAuthn registration ceremony -> PrincipalAuthorizationService
canonical device lifecycle     -> DeviceService
binding/epoch authority        -> TrustRepository/PostgreSQL
Trusted Surface                -> public Principal API only
```

---

## 06/T9 — authoritative release-toolchain profile supersedes stale action pins

Mandatory planning input:

```text
docs/research/2026-09-04-release-toolchain-profile.md
```

The older T9 action-pin table in correction 7 is superseded. Workflows use these exact full SHAs:

```text
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1             # v7.0.1
actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97        # v7.0.0
actions/setup-node@820762786026740c76f36085b0efc47a31fe5020          # v7.0.0
astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d          # v10.0.1
pypa/gh-action-pip-audit@1220774d901786e6f652ae159f7b6bc8fea6d266   # v1.1.0
gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e   # v3.0.0
actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a  # v7.0.1
actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9            # v6.1.0
```

The reviewed Gitleaks Action commit runs on Node 24 and its source defaults to Gitleaks binary `8.24.3`; PTF pins the binary explicitly:

```yaml
env:
  GITLEAKS_VERSION: "8.24.3"
```

`GITLEAKS_VERSION=latest` is forbidden. Syft remains `1.51.0`; `pip-audit` remains `2.10.1`.

### CI configuration acceptance rule

`tests/acceptance/test_ci_configuration.py` must compare every external workflow `uses:` pair against the reviewed repository+SHA allowlist above. A generic “contains 40 hex characters” check is insufficient.

It fails on:

```text
mutable @vN/@main/@branch references
unknown repository+SHA pair
missing explicit GITLEAKS_VERSION=8.24.3
GITLEAKS_VERSION=latest
artifact upload occurring before canary/private-key/protected-marker scan
security/vulnerability scan unavailability represented as PASS
```

A future action/tool upgrade requires first-party tag/release evidence, resolved SHA/digest, reason, compatibility/security review, an updated research note, and an updated CI allowlist in the same reviewed planning change.

---

## Effect

No new Plan 06 task is introduced. The plan still contains ten tasks. This correction removes only two remaining implementation choices: the precise WebAuthn-registration verification seam and the precise release-workflow revisions allowed by the plan.