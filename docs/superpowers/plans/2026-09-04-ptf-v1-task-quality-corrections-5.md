# PTF v1 Task-Quality Corrections 5 — Plan 04 OpenID4VP

Status: **BINDING PLANNING CORRECTIONS; APPROVED SPEC UNCHANGED**

This document resolves the second-pass C10 findings and a protocol-normalization/Hard-Policy responsibility contradiction in Plan 04.

---

## 04/T1 — profile/package bootstrap

The first task-quality corrections document supplies the missing pre-creation import failure. The normative Final-spec check, exact profile record, package metadata, green command, and commit remain binding.

## 04/T2 — request normalization must not evaluate PTF Hard Policy

### Defect

The original negative-test list said the protocol normalizer rejects a request when it asks for a response mode/profile “not allowed by the reference Hard Policy,” but:

```python
normalize_authorization_request(...)
```

has no Hard Policy input, and a concrete protocol request normalizer must not become a PTF authority/policy engine.

### Corrected responsibility

`normalize_authorization_request(...)` may reject when the request violates the **fixed Plan 04 protocol reference profile**, including:

```text
response_type != vp_token
response_mode != direct_post
missing/empty nonce
unsupported request-object/DCQL extension that changes binding or disclosure semantics
client_id not bound to expected verifier Subject
response_uri not equal to the validated EndpointBinding
same display label but different verifier key/origin/binding
```

It MUST NOT read or decide PTF Hard Policy.

Whether a protocol-valid request is permitted by Hard Policy, Standing Grant, or Exact Human Approval is decided later through `ActionRuntime.request_action`, plan construction/validation, and authorization/revalidation in T7.

The first task-quality corrections document supplies the red command. The original normalized model/function signatures remain binding.

## 04/T3 — DCQL minimization

The first task-quality corrections document supplies the missing red command. The original `interpret_dcql_request(...)`, `build_minimized_disclosure_plan(...)`, claim fixture, escalation behavior, and `CredentialMetadata` shape are binding.

For gate-22 traceability, `CredentialMetadata.freshness_state` is not itself a source of authority. It must be produced from the configured Freshness Policy/status check at the credential provider/resource-status boundary. A consequential plan requiring current verification fails if state is `STALE`, `UNKNOWN`, or `REVOKED`.

## 04/T4 — Enforcement Map

The first task-quality corrections document supplies the missing red command. The original enforcement table, transaction-binding dimensions, and `build_openid4vp_enforcement_map(...)` signature are binding.

---

## 04/T5 — brokered wallet executor red state and resource-catalog binding

Before creating the executor, create the synthetic credential fixtures and write the original denial/leak tests, then run:

```bash
uv run pytest \
  executors/openid4vp-wallet/tests/test_executor.py \
  tests/integration/test_openid4vp_leak_canary.py -q
```

Expected: non-zero because `OpenID4VPWalletExecutor` does not exist.

The original `present(...)` signature is the minimal execution shape. In addition, the executor/provider resolution path MUST consume the Plan 01 Protected Resource Catalog record for `credential_ref` and verify at least:

```text
principal/resource ownership is the expected one for the execution plan
status is active/current for use
resource_type matches the credential profile
executor_subject_id matches this protected executor/profile
requested operation is in supported_operations
catalog metadata contains no raw credential or holder private key
```

`credential_ref` alone remains non-executable: the public `present(...)` method also requires the plan-bound `ExecutionGrantRecord`, exact `ExecutionPlan`, request, and DisclosurePlan.

Green is the same pytest command and must prove the raw-credential canary remains absent from controlled Agent/API/receipt/log/error surfaces.

---

## 04/T6 — direct-post response/session red state

Before creating `response.py`, write the endpoint-binding, replay, and outcome-classification tests in the named files, then run:

```bash
uv run pytest \
  adapters/openid4vp/tests/test_response.py \
  tests/integration/test_openid4vp_nonce_replay.py -q
```

Expected: non-zero because `OID4VPResponseEvidence`/`deliver_direct_post(...)` do not exist.

The original `deliver_direct_post(...)` signature and outcome table are the minimal implementation shape. A post-submit timeout remains `INDETERMINATE`; no automatic re-presentation of the same one-use authority is allowed.

Green is the same command.

---

## 04/T7 — concrete OpenID4VP flow red state and policy boundary

Before creating `flow.py`, write the original grant-covered/approval-required and substitution scenarios, then run:

```bash
uv run pytest \
  adapters/openid4vp/tests/test_flow.py \
  tests/integration/test_openid4vp_end_to_end.py \
  tests/integration/test_openid4vp_verifier_substitution.py \
  tests/integration/test_openid4vp_disclosure_escalation.py -q
```

Expected: non-zero because `OpenID4VPFlow` does not exist.

The original `prepare(...)` and `execute(...)` signatures and ordered sequences are the minimal implementation shape, with this responsibility clarification:

```text
normalize_authorization_request -> protocol/profile/binding validity only
interpret_dcql_request          -> protocol request -> PTF request semantics, no authority
runtime.request_action          -> authoritative Hard Policy / grants / trust resolution
plan construction/validation    -> exact disclosure, enforcement, transaction binding
runtime.authorize/revalidate    -> final authority and execution-time policy/trust/resource checks
```

Thus a syntactically and cryptographically valid OpenID4VP request can still be DENY or APPROVAL_REQUIRED under PTF; protocol validity never upgrades it.

Green is the same flow/integration pytest command.

---

## 04/T8 — acceptance/core-generality review is verification-only

This task adds acceptance evidence and a cross-domain review, not new production behavior. Mark:

```text
verification_only: true
```

Precondition:

```bash
test ! -f tests/acceptance/test_openid4vp_ptf_invariants.py && \
test ! -f docs/review/openid4vp-core-generality-review.md
```

Expected: exit 0 before acceptance artifacts are created.

The original ten acceptance cases, core-generality comparison table, architecture stop rule, and full pytest/Ruff/Pyright command remain binding. The review must explicitly confirm the T2 responsibility correction: no OpenID4VP parser/normalizer contains Hard Policy authorization logic.

---

## Plan 04 disposition

After applying this document and earlier corrections, all eight Plan 04 tasks have an explicit C10 execution or verification path and the request parser no longer inherits authority semantics it cannot legitimately evaluate. Final PASS status is assigned only by the regenerated matrix.