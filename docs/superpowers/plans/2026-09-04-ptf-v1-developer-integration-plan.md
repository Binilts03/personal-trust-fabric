# PTF v1 Developer Integration and Direct-Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans task-by-task. Read `2026-09-04-ptf-v1-plan-set-amendments.md` first.

**Goal:** Close the approved PTF v1 developer/product contract that is not fully covered by Plans 00–05: a concrete direct protected-delivery profile, a local simulator and security inspectors, and focused recipient/verifier integration examples without creating a speculative universal adapter interface.

**Architecture:** This plan adds concrete developer surfaces on top of the accepted protocol-neutral runtime. Direct delivery is a Protected Executor profile, not an Agent secret-reading feature. Developer tools use public runtime/API seams. Recipient integrations remain protocol-specific and share no common protocol-adapter base class merely for convenience.

**Prerequisites:** Plans 00–04 accepted and the OpenID4VP core-generality review passes. This plan may execute in parallel with Plan 05 on an isolated worktree. Plan 06 release closure depends on acceptance of both.

---

## File map

```text
executors/direct-delivery/
├── pyproject.toml
├── src/ptf_direct_delivery/
│   ├── __init__.py
│   ├── models.py
│   └── executor.py
└── tests/test_executor.py
packages/ptf-devtools/
├── pyproject.toml
├── src/ptf_devtools/
│   ├── __init__.py
│   ├── cli.py
│   ├── simulator.py
│   └── inspect.py
└── tests/
    ├── test_simulator.py
    └── test_inspect.py
examples/recipient-verifier/
├── README.md
├── x402/
├── ap2/
└── openid4vp/
tests/integration/
├── test_direct_delivery.py
├── test_direct_delivery_leak_canary.py
├── test_devtools_public_seams.py
└── test_recipient_verifier_examples.py
docs/assurance/direct-delivery-reference-profile.md
docs/developer/simulator.md
docs/developer/inspectors.md
docs/developer/recipient-verifier.md
```

---

### Task 1: Implement a concrete direct protected-delivery reference profile

**Files:**
- Create `executors/direct-delivery/pyproject.toml`
- Create `executors/direct-delivery/src/ptf_direct_delivery/models.py`
- Create `executors/direct-delivery/src/ptf_direct_delivery/executor.py`
- Create `executors/direct-delivery/tests/test_executor.py`
- Create `tests/integration/test_direct_delivery.py`
- Create `tests/integration/test_direct_delivery_leak_canary.py`
- Create `docs/assurance/direct-delivery-reference-profile.md`

**Interfaces:**

```python
class DirectDeliveryBinding(FrozenModel):
    recipient_subject_id: str
    endpoint_binding_id: str
    https_origin: str
    certificate_fingerprint: str | None
    verified_at: datetime

class DirectDeliveryResult(FrozenModel):
    outcome: ExecutionOutcome
    delivery_evidence_ref: str
    response_digest: str | None

class DirectDeliveryExecutor:
    async def deliver(
        self,
        *,
        execution_grant: ExecutionGrantRecord,
        plan: ExecutionPlan,
        resource_ref: ProtectedResourceRef,
        recipient_binding: DirectDeliveryBinding,
        approved_field_ids: tuple[str, ...],
        now: datetime,
    ) -> DirectDeliveryResult: ...
```

- [ ] **Step 1: Write failure tests first**

Reject delivery when:
- only a `ProtectedResourceRef` is supplied without a valid current Execution Grant;
- grant plan fingerprint differs from selected plan;
- recipient Subject/EndpointBinding differs from plan;
- endpoint origin/certificate no longer matches active binding;
- requested fields exceed `DisclosurePlan.permitted_claims`;
- selected plan requires a stronger channel/custody profile than this executor provides;
- plan is expired/revoked or runtime revalidation fails.

- [ ] **Step 2: Build the protected-value provider seam**

The executor receives an injected resource provider capable of `read_approved_fields(resource_ref, field_ids)` **inside the Protected Execution Domain only**. That method is not Agent/API-visible and returns data only to the executor's delivery path.

- [ ] **Step 3: Implement authenticated HTTPS direct delivery**

Use `httpx` with verified TLS. The reference fixture uses a local HTTPS recipient whose certificate/origin is represented by the active EndpointBinding. Where deployment policy requires mTLS, configure a client certificate through executor configuration; do not pass certificate/key material through Agent DTOs.

PTF does not invent a new application encryption protocol in this plan. The assurance claim is exactly the transport/executor boundary proven by the fixture.

- [ ] **Step 4: Produce truthful Assurance Manifest semantics**

Reference profile must state:
- Agent/model sees plaintext: **NO** on controlled PTF Agent surfaces;
- control runtime sees protected plaintext: **NO** if resource provider/executor boundary is isolated in the fixture;
- protected executor sees plaintext: **YES**;
- authenticated recipient endpoint receives exactly approved fields: **YES**;
- recipient may retain delivered plaintext: residual risk;
- ordinary browser/page JavaScript is **not** part of this direct-delivery profile.

- [ ] **Step 5: Add browser/page plaintext downgrade test**

Construct a candidate plan using an explicitly weaker `BROWSER_PLAINTEXT`/equivalent custody/channel profile. Assert Assurance Manifest truthfully marks recipient page/browser execution context as plaintext-visible and that Hard Policy can reject the downgrade entirely. Do not claim browser plaintext is protected delivery.

- [ ] **Step 6: Leak-canary test**

Use protected value `PTF_CANARY_DIRECT_DELIVERY_8E21`. Assert it appears only at the controlled recipient fixture and protected-executor internal capture, never in Agent responses, Safe View, PTFReceipt, generic logs/errors, or control-plane serialization.

- [ ] **Step 7: Run**

```bash
uv run pytest executors/direct-delivery/tests tests/integration/test_direct_delivery.py tests/integration/test_direct_delivery_leak_canary.py -q
uv run pyright
uv run ruff check .
```

- [ ] **Step 8: Commit**

```bash
git add executors/direct-delivery tests/integration/test_direct_delivery* docs/assurance/direct-delivery-reference-profile.md uv.lock
git commit -m "feat(executor): add authenticated direct protected delivery"
```

---

### Task 2: Build a local simulator with synthetic identities/resources through public seams

**Files:**
- Create `packages/ptf-devtools/pyproject.toml`
- Create `packages/ptf-devtools/src/ptf_devtools/simulator.py`
- Create `packages/ptf-devtools/src/ptf_devtools/cli.py`
- Create `packages/ptf-devtools/tests/test_simulator.py`
- Create `tests/integration/test_devtools_public_seams.py`
- Create `docs/developer/simulator.md`

**Interfaces:**

Console script:

```text
ptf-dev simulate list
ptf-dev simulate run <scenario-id> --base-url <url>
```

Reference scenarios include:
- exact approval payment;
- Standing Grant-covered payment;
- recipient substitution attack;
- OpenID4VP minimum-disclosure flow;
- Personal-State-only mutation no-broadening case;
- direct protected delivery.

- [ ] **Step 1: Write a public-seam guard test**

Simulator code may call documented Agent/Principal fixture interfaces and explicit local fixture bootstrap helpers, but MUST NOT import private resolver functions, repository SQL implementation modules, protected resource internals, or mutate runtime tables directly to manufacture a PASS.

- [ ] **Step 2: Create deterministic synthetic fixture bootstrap**

Fixtures use synthetic Principal/Agent/recipient Subjects, validated test bindings, synthetic resources, explicit Hard Policy/Standing Grants, and controlled canaries. Fixture creation is clearly marked developer/test-only and unavailable in production route registration.

- [ ] **Step 3: Implement scenario execution**

Each scenario prints/writes safe structured JSON containing action ID, decision, selected plan fingerprint, approval state, execution outcome, PTFReceipt reference, and declared assurance profile. Never print protected payloads.

- [ ] **Step 4: Run**

```bash
uv run pytest packages/ptf-devtools/tests/test_simulator.py tests/integration/test_devtools_public_seams.py -q
uv run ptf-dev simulate list
```

- [ ] **Step 5: Commit**

```bash
git add packages/ptf-devtools tests/integration/test_devtools_public_seams.py docs/developer/simulator.md uv.lock
git commit -m "feat(devtools): add public-seam PTF simulator"
```

---

### Task 3: Add safe plan/grant/policy/Safe View/Enforcement Map inspectors

**Files:**
- Create `packages/ptf-devtools/src/ptf_devtools/inspect.py`
- Create `packages/ptf-devtools/tests/test_inspect.py`
- Create `docs/developer/inspectors.md`

**Interfaces:**

```text
ptf-dev inspect action <id>
ptf-dev inspect grant <id>
ptf-dev inspect policy
ptf-dev inspect safe-view --task <task-id>
ptf-dev inspect enforcement <action-id>
ptf-dev inspect receipt <action-id>
```

- [ ] **Step 1: Write redaction/authority tests**

Inspectors must expose only safe structured fields. They MUST NOT expose raw protected resources, private keys, raw protocol artifacts, unfiltered Personal State, or Principal/admin mutation methods.

- [ ] **Step 2: Preserve epistemic labels**

Safe View inspector retains explicit/inferred/stale basis labels without exposing unnecessary source detail. Enforcement inspector shows every source constraint and mapped enforcement location/downgrade.

- [ ] **Step 3: Implement through public/debug-safe read seams**

If a required read does not exist, add a Principal/developer read-only safe endpoint rather than importing persistence internals into the CLI.

- [ ] **Step 4: Run**

```bash
uv run pytest packages/ptf-devtools/tests/test_inspect.py -q
```

- [ ] **Step 5: Commit**

```bash
git add packages/ptf-devtools/src/ptf_devtools/inspect.py packages/ptf-devtools/tests/test_inspect.py docs/developer/inspectors.md
git commit -m "feat(devtools): add safe PTF inspectors"
```

---

### Task 4: Publish focused recipient/verifier integration examples

**Files:**
- Create `examples/recipient-verifier/README.md`
- Create protocol-specific examples under `examples/recipient-verifier/x402`, `ap2`, and `openid4vp`
- Create `tests/integration/test_recipient_verifier_examples.py`
- Create `docs/developer/recipient-verifier.md`

**Interfaces:**

There is deliberately **no** `ProtocolAdapter`/`UniversalVerifier` interface in this task.

Each example demonstrates the protocol-native recipient/verifier checks plus PTF-safe evidence linkage appropriate to that protocol:

- x402: amount/payee/network/asset/settlement evidence and expected recipient binding;
- AP2: mandate signature/delegation/audience/nonce/constraint checks and PTF receipt linkage;
- OpenID4VP: verifier request/nonce/audience/claim presentation checks and PTF evidence linkage.

- [ ] **Step 1: Write negative integration tests**

Every example must reject its protocol's relevant substitution/replay mutation. A cryptographically valid external artifact MUST NOT be interpreted as creating PTF Standing Grant/Hard Policy/TrustRelation state.

- [ ] **Step 2: Add developer-facing examples**

Examples show the minimum recipient-side verification path and how to compare safe PTF identifiers/fingerprints without requiring access to PTF protected resources or internal authority state.

- [ ] **Step 3: Document trust assumptions**

`docs/developer/recipient-verifier.md` explicitly distinguishes protocol verification, PTF receipt/evidence linkage, recipient trust configuration, and business acceptance. Valid signature != universal trust.

- [ ] **Step 4: Run**

```bash
uv run pytest tests/integration/test_recipient_verifier_examples.py -q
```

- [ ] **Step 5: Commit**

```bash
git add examples/recipient-verifier tests/integration/test_recipient_verifier_examples.py docs/developer/recipient-verifier.md
git commit -m "docs(dev): add recipient verifier integration kit"
```

---

### Task 5: Lock Plan 05B acceptance and prevent speculative generalization

**Files:**
- Create `tests/acceptance/test_developer_integration_contract.py`
- Create `docs/review/developer-integration-seam-review.md`

- [ ] **Step 1: Acceptance tests**

Prove:
- direct protected delivery requires valid Execution Grant + plan + authenticated EndpointBinding;
- direct-delivery canary absent from Agent/control safe surfaces;
- browser plaintext downgrade reports weaker visibility truthfully and can be policy-denied;
- simulator uses only allowed public/test-fixture seams;
- inspectors are read-only/safe;
- recipient examples exist for x402/AP2/OpenID4VP and do not create authority/trust;
- no universal adapter/verifier base class was introduced.

- [ ] **Step 2: Run full verification**

```bash
uv run pytest packages/ptf-devtools tests/integration/test_direct_delivery.py tests/integration/test_direct_delivery_leak_canary.py tests/integration/test_recipient_verifier_examples.py tests/acceptance/test_developer_integration_contract.py -q
uv run ruff check .
uv run pyright
```

- [ ] **Step 3: Independent review**

Reviewer must decide whether any shared verifier/helper abstraction is genuinely deep and protocol-neutral. If not, keep protocol-specific examples separate. `no shared verifier API` is an acceptable outcome.

- [ ] **Step 4: Commit**

```bash
git add tests/acceptance/test_developer_integration_contract.py docs/review/developer-integration-seam-review.md
git commit -m "test: lock PTF developer integration contract"
```

---

## Plan 05B completion gate

Plan 05B is accepted only when:

1. direct delivery is bound to an authenticated recipient endpoint and exact approved Disclosure/Execution Plan;
2. reusable protected values remain outside Agent/control safe surfaces for the reference profile;
3. browser/page plaintext is truthfully treated as a weaker profile, not protected delivery;
4. local simulator runs representative authority/disclosure flows through public seams;
5. inspectors expose safe deterministic evidence without becoming admin/secret interfaces;
6. recipient/verifier developer examples cover all three proving protocols;
7. no universal protocol adapter/verifier abstraction was invented prematurely;
8. independent review passes.
