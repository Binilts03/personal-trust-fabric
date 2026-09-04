# PTF v1 Plan-Set Amendments

Status: **Normative implementation-planning amendment**
Date: 2026-09-04

This document corrects the approved-spec implementation plan set after cross-plan review. It does **not** amend the approved PTF v1 specification. Where this document conflicts with the roadmap or Plans 00–06, this document wins for execution. Executors MUST read it before starting any plan task.

## A1. Execution order is sequential through AP2

The roadmap statement that Plans 02 (x402) and 03 (AP2) may execute in parallel is superseded.

Required order:

```text
Plan 00 Foundation
  -> Plan 01 Runtime
  -> Plan 02 x402
  -> Plan 03 AP2 dependency convergence + AP2
  -> mandatory x402/AP2 seam review
  -> Plan 04 OpenID4VP
  -> Plan 05 Product Surface and Plan 05B Developer/Integration Closure
  -> Plan 06 Conformance/Portability/Recovery/Release
```

Reason: Plan 03 deliberately converges the shared workspace to AP2's audited dependency constraints and requires the **completed Plan 00–02 suite** to pass unchanged before AP2 integration. Therefore Plan 03 cannot safely run in parallel with Plan 02.

Plan 05 and Plan 05B MAY run in isolated parallel worktrees only after Plan 04 core-generality acceptance. Plan 06 final release tasks depend on acceptance of both.

## A2. ApprovalEvidence is target-generic, not plan-specific

The Plan 01 `ApprovalEvidence.plan_fingerprint` field is superseded by:

```python
class AuthorizationTargetKind(StrEnum):
    EXECUTION_PLAN = "EXECUTION_PLAN"
    STANDING_GRANT = "STANDING_GRANT"

class ApprovalEvidence(FrozenModel):
    principal_id: str
    target_kind: AuthorizationTargetKind
    canonical_fingerprint: str
    assurance_profile: str
    challenge_id: str
    authenticated_at: datetime
    expires_at: datetime
```

Rules:

- `ActionRuntime.record_exact_approval(...)` MUST require `target_kind == EXECUTION_PLAN` and `canonical_fingerprint == selected ExecutionPlan fingerprint`.
- `activate_grant(...)` MUST require `target_kind == STANDING_GRANT` and `canonical_fingerprint == canonical Standing Grant fingerprint`.
- `ExecutionGrantRecord.plan_fingerprint` remains plan-specific and is **not** renamed.
- Product Plan 05 `CanonicalApprovalView.canonical_fingerprint` and `PrincipalAuthorizationService` MUST produce this generic evidence shape.
- A challenge/evidence object for one target kind MUST NOT authorize the other kind even if hashes collide by programmer error or fixture reuse; the target kind is part of the bound challenge semantics.

## A3. Plan 01 approval endpoints implement AA0 only

Before Plan 05 adds the reference Trusted Surface/WebAuthn ceremonies, Plan 01 Principal API may exercise approval/grant activation only under the **AA0 — Authenticated Session** reference path and only when current Hard Policy explicitly permits AA0 for the exact target.

Plan 01 MUST:

- derive AA0 evidence server-side from the authenticated Principal context and canonical target fingerprint;
- reject client-supplied claims that an approval is AA1/AA2/AA3;
- return a typed `ASSURANCE_PROFILE_UNAVAILABLE` (or equivalent typed error) when policy requires AA1–AA3;
- never label ordinary signed-request authentication as AA1/AA2/AA3;
- keep exact plan/grant fingerprint mutation checks even for AA0.

Plan 05 replaces/extends this reference path with real AA1/AA2 WebAuthn ceremonies. AA3 remains externally configured and cannot be manufactured by ordinary WebAuthn.

## A4. There is one locked authorization regression corpus

The duplicate fixture locations are superseded. The **only** locked corpus path is:

```text
tests/conformance/fixtures/authorization-regression-v1.json
```

Plan 00 Task 8 creates it and its foundation tests consume it.

Plan 06 Task 2 MUST reuse the same file; it MUST NOT create a second corpus. Later modification requires an explicit reviewed change identifier in fixture metadata and the migration/self-improvement release gate must compare pre/post behavior against this same corpus.

The superseded path `tests/fixtures/authorization_regression_v1.json` MUST NOT be created.

## A5. Plan 00 Personal State closure requirements

Before Plan 00 is accepted, add tests and minimal domain behavior for approved stories not explicit enough in the original plan:

1. **Contradiction handling:** material contradictory Claims cannot be resolved by model confidence. Test explicit human correction, deterministic source/domain precedence, context separation, and `DISPUTED`/withheld outcomes.
2. **Compaction/source lineage:** a derived summary/compacted item retains transitive source/evidence IDs and original source classes. Summarization cannot upgrade source authority. Invalidating/removing underlying evidence invalidates/recomputes the derived item rather than laundering it into a trusted fact.
3. **Logical Agent identity vs model/provider:** Agent authority binds `Agent` Subject; changing model/provider/session metadata does not silently create a new Agent identity or broaden authority. A deliberately different Agent Subject does not inherit the grant merely because it uses the same model/provider.
4. **Unknown security-sensitive extensions:** canonical security/domain models reject unknown authority-, trust-, disclosure-, or migration-affecting extension semantics until explicitly recognized. Informational metadata may be preserved only through an explicitly non-authoritative extension channel.

Plan 00 completion review MUST cite these tests.

## A6. Plan 01 identity/trust continuity requirements

Before Plan 01 is accepted, Trust Registry and authentication tests MUST additionally cover:

- one Subject with multiple independently validated active bindings;
- key/binding rotation requiring accepted continuity evidence (old-key proof, accepted provider rotation evidence, or an independently authenticated re-enrollment path);
- superseded/revoked binding cannot authenticate after the authoritative epoch advances;
- a new key plus a matching display name/Subject label is insufficient continuity evidence;
- Agent Instance/model/provider provenance is recorded separately from logical Agent Subject;
- logical Agent authority remains bound to the Agent Subject and does not move to another Subject through provider/model reuse.

If the old binding is unavailable and continuity cannot be proved, treat the new binding as re-enrollment requiring the configured Principal/admin assurance; do not silently rotate.

## A7. Plan 05B is mandatory before Plan 06 release closure

Add and execute:

`docs/superpowers/plans/2026-09-04-ptf-v1-developer-integration-plan.md`

It closes approved user stories for:

- direct protected delivery bound to authenticated recipient endpoint/key/channel;
- truthful browser/page plaintext downgrade semantics;
- local simulator with synthetic identities/resources;
- plan/grant/policy/Safe View/Enforcement Map inspectors;
- focused recipient/verifier developer integration without inventing a universal protocol adapter API.

Plan 06 release tasks MUST NOT declare foundational/full v1 release readiness until Plan 05B is accepted.

## A8. Plan 06 must complete identity/device/trust product lifecycle

Plan 06 Task 5/7 is extended to include authenticated Principal/admin lifecycle operations and Trusted Surface controls for:

- enrolling a new Principal device/binding through an accepted assurance ceremony;
- revoking a device/binding and incrementing Trust Registry epoch;
- rotating a binding only with continuity evidence or explicit re-enrollment;
- inspecting TrustRelations and their accepted role/purpose/Claim-type scope;
- proposing/activating/revalidating/revoking deployment TrustRelations through validated binding evidence and Principal/admin control;
- proving these routes remain absent from Agent OpenAPI/SDK.

Suggested Principal routes are implementation details and may be refined, but the behavior above is mandatory. No Agent route may create/rotate/revalidate/revoke trust or devices.

## A9. Final release dependency

Plan 06 Tasks that produce final release evidence/claims execute only after:

1. Plans 00–04 accepted;
2. Plan 05 accepted;
3. Plan 05B accepted;
4. Plan 06 portability/recovery/device/trust functionality and mandatory oracles pass.

`PTF v1 / <profile> / suite <version>` conformance wording remains prohibited until the executable suite passes the declared profile.

## A10. User-story traceability is a release artifact

Before final release, create/update a machine-reviewable or Markdown matrix mapping **all 60 approved user stories** in spec section 27 to concrete implementation paths and tests. A story may be marked deferred only if the approved spec explicitly makes that behavior optional/deferred; it cannot be omitted merely because it is absent from the 28 foundational acceptance gates.
