# Execution

## 1. Provider Seam

A `ProtectedProvider` has:

| Field | Type |
|-------|------|
| `kind` | ProviderKind: `"payment" \| "travel" \| "retail" \| "email" \| "identity"` |
| `submit(req)` | ProviderRequest -> ProviderSubmission |
| `verify(sub, expected)` | Verify submission against expected values |

### 1.1 ProviderRequest

| Field | Type | Constraint |
|-------|------|------------|
| `capabilityId` | string | The capability that authorized this execution. |
| `termsDigest` | string | The terms digest. |
| `action` | string | The action name (e.g. `/pay`, `/travel/book`). |
| `recipient` | string | The recipient identity. |
| `resource` | string | The resource identifier. |
| `purpose` | string | The purpose. |
| `context` | Record<string, unknown> | Authorized, effect-bearing terms only. |
| `metadata` | Record<string, unknown> | Non-effectful telemetry only. MUST NOT alter external effect. |

### 1.2 ProviderSubmission

| Field | Type |
|-------|------|
| `kind` | ProviderKind |
| `capabilityId` | string |
| `termsDigest` | string |
| `externalRef` | string |
| `at` | number |

## 2. Execution Flow

1. Agent proposes an operation.
2. PTF evaluates authority (dry-run, no consume).
3. Human approves or standing grant covers the demand.
4. Agent calls redeem (with recipient proof).
5. PTF consumes authority and persists consumption BEFORE external effect.
6. PTF builds a sanitized instruction (ids, amounts — never secrets).
7. PTF calls provider.submit.
8. PTF calls provider.verify.
9. PTF returns a receipt (no secrets).

## 3. Instruction Boundary

### 3.1 PaymentInstruction

| Field | Type |
|-------|------|
| `capabilityId` | string |
| `recipient` | string |
| `amount` | number |
| `currency` | string |
| `resource` | string |
| `purpose` | string |
| `termsDigest` | string |

### 3.2 ExecutionReceipt (domain-neutral)

| Field | Type |
|-------|------|
| `receiptId` | string |
| `capabilityId` | string |
| `recipient` | string |
| `resource` | string |
| `purpose` | string |
| `transaction` | string |
| `at` | number |
| `termsDigest` | string |

Payment receipts extend `ExecutionReceipt` with `amount` and `currency`.

The instruction MUST NOT contain credentials, keys, tokens, or raw secrets.

## 4. Burn-Before-Effect

Authority consumption MUST be persisted BEFORE any external effect:

- For payments: use is consumed and persisted before `executePayment` is called
- For disclosures: use is consumed and persisted before the presentation is delivered
- For general actions: consumption is persisted before `provider.submit`

A crash between consumption and effect burns a use instead of double-spending.

## 5. Exact-Term Binding

`executeAndReceipt` and `executeActionViaProvider` MUST deep-compare the instruction against the authorized operation:

- `recipient` MUST match exactly
- `amount` MUST match exactly (payment)
- `currency` MUST match exactly (payment)
- `resource` MUST match exactly
- `purpose` MUST match exactly
- `termsDigest` MUST match exactly
- `context` (for provider requests) MUST deep-equal the authorized args exactly
- Any extra effect-bearing key in context MUST fail closed

## 6. Domain Profiles

Profiles are conventions over the domain-neutral engine — never a policy
language and never new authority semantics:

- **Payment** (`/pay*`): ceilings via amount/currency bounds plus recipient
  pinning; receipts carry explicit `amount`/`currency`.
- **Travel** (`/travel/book`): ceilings via route/class/traveler-count/fare
  bounds (`travelBounds`) plus recipient pinning; receipts are
  domain-neutral `ExecutionReceipt` (no `amount`/`currency` fields — fare
  ceilings ride in authorized `context`, not in the receipt).

A third domain MUST follow the same pattern: context bounds + provider-seam
execution + secret-free receipt, with no core change.

## 7. Audit

The audit log MUST be append-only with hash chaining:

- Each entry contains `seq`, `prevHash`, `hash`
- `GENESIS` is the sentinel for the first entry's `prevHash`
- Hash is SHA-256 (unkeyed) or HMAC-SHA-256 (keyed)
- Sequentiality MUST be enforced: gaps or duplicates deny
- `detail` field MUST NOT contain secrets
