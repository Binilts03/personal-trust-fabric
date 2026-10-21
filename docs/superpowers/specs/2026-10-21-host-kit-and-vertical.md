# Host kit, real provider adapters, and the DPDP consent-gateway vertical

**Status:** approved design. Three parallel workstreams, one pull request each.

**Why now.** PTF ships the privacy-enforcement plane (ADR-0024) and the
per-host enforcement boundary (ADR-0025). A host that wants enforcement must
today wire `PrivacyRuntime`, the event repository, the execution journal and
the authority CAS **by hand, in the right order**. That is the adoption tax,
and it is the reason the capability is under-used. The host kit removes the
tax; the adapters make the effect real; the vertical proves the whole thing
end to end on a DPDP-shaped workload.

**Non-goals.** No new plane, no new protocol, no compliance claim, no
"global enforcement" (ADR-0025 decides that PTF is a library, not an
interceptor). The kit is one call plus one conformance suite.

---

## 1. The host kit (`src/hostkit/`, new subpath `./hostkit`)

### 1.1 One-call effect boundary

```ts
// src/hostkit/boundary.ts
export interface HostEffect {
  readonly action: `/${string}`;
  readonly resource: { readonly type: string; readonly id: string };
  readonly purpose: string;
  /** Effect-bearing terms. Extra keys are not allowed (ADR-0018). */
  readonly context: Readonly<Record<string, unknown>>;
  /** The privacy processing context. Required when privacy is configured. */
  readonly processing?: TrustedProcessingContext;
  /** Capability proof. With it, the effect is journalled and attested. */
  readonly redemption?: Redemption;
  /** A plain effect. With a provider + redemption, the kit journals it. */
  readonly execute?: (ctx: {
    readonly context: Readonly<Record<string, unknown>>;
    readonly idempotencyKey: string;
  }) => Promise<{
    readonly externalRef: string;
    readonly detail?: Readonly<Record<string, unknown>>;
  }>;
  /** Stable retry reference (defaults to the terms digest). */
  readonly attemptRef?: string;
  /** Idempotency key for a journalled effect (defaults to the terms digest). */
  readonly idempotencyKey?: string;
}

export interface EffectBoundaryOptions {
  readonly dir: string;
  readonly authority: Authority;
  readonly ingress: VerifiedIdentity;
  readonly keys: Record<string, Uint8Array>;
  readonly now?: () => number;
  readonly audit?: FileAuditLog;
  /** Privacy configuration. Omit it and the host is a legacy (unenforced) host. */
  readonly privacy?: McpPrivacyConfig;
  /** The provider rail, when the effect is journalled and attested. */
  readonly provider?: ProtectedProvider;
}

export interface HostEffectReceipt {
  readonly externalRef: string;
  readonly at: number;
  readonly termsDigest: string;
  readonly state: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN";
  /** The Processing Event id, when privacy is configured. */
  readonly eventId?: string;
  /** Non-secret detail for the operator. Never a secret, never a subject id. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface EffectBoundary {
  /** Decide without any effect: the operator dry-run surface. */
  check(effect: HostEffect): Promise<{
    readonly allowed: boolean;
    readonly reason?: string;
  }>;
  /** Run the effect under the full gate. */
  run(effect: HostEffect): Promise<HostEffectReceipt>;
}

export function createEffectBoundary(
  opts: EffectBoundaryOptions
): EffectBoundary;
```

### 1.2 The order the kit must implement (this IS the contract)

1. **Authority first, non-consuming.** `authority.evaluate(op, ingress, { consume: false })`.
   Deny → no privacy read, no event, no effect. An unauthorized caller must not
   learn whether privacy state exists (ADR-0024 §5.11).
2. **Privacy preflight** (when configured): `runtime.preflight(gate)` → deny.
3. **Privacy live recheck**: `runtime.recheck(first, gate)` → deny.
4. **Evidence precommit**: `runtime.prepareEvent(live, gate, attemptRef)` -
   durable and secret-free, written **before** any consumption or effect.
5. **Consume authority**: `authority.evaluate(op, ingress, { consume: true })`
   → deny means a provable pre-effect failure (`FAILED_FINAL`), never a
   silent success.
6. **Persist the authority CAS** (`saveAuthority`) - burn before effect.
7. **Privacy fence** (when configured): `runtime.fence(live, gate)` - the
   privacy state is re-read at the effect boundary (P4-1). A withdrawal that
   landed after the recheck stops the effect. The fence failure is a
   pre-effect failure.
8. **The effect**: through `executeWithJournal` when a provider + redemption
   are supplied (idempotent, attested, attested receipt), otherwise through the
   supplied `execute` callback.
9. **Finalize the evidence**: `runtime.finalizeEvent(...)` with `SUCCEEDED`,
   `FAILED_FINAL` (pre-effect) or `OUTCOME_UNKNOWN` (post-effect ambiguity,
   ADR-0024).

Order is the product. A kit that reorders these is wrong even if the tests
pass.

### 1.3 Generic privacy gate construction

`src/privacy/mcp-host.ts` currently owns the store wiring under an MCP
name. The host kit needs the same wiring without the MCP coupling, so:

- add `src/privacy/host.ts` with
  `privacyForHostOperation({ dir, keys, auth, ingress, demand, config, now })`
  returning `{ runtime, gate }`, and
- make `src/privacy/mcp-host.ts` delegate to it (no duplicated wiring), and
- add `makeHostPrivacyGate(config, ingress, demand)`: `/pay` uses the payment
  gate, `/disclose` uses the disclosure gate, every other action is denied
  ("privacy denied") unless the host composes its own gate.

### 1.4 The conformance suite (`src/hostkit/conformance.ts`)

A host proves it enforces by running the kit's checks against its own
boundary. Export:

```ts
export interface ConformanceResult {
  readonly id: string;
  readonly title: string;
  /** The rule the check proves (cite the ADR or DPDP section). */
  readonly requirement: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface ConformanceOptions {
  readonly boundary: EffectBoundary;
  readonly now?: () => number;
  /** Extra checks the host wants to run alongside the kit's. */
  readonly extra?: readonly ConformanceCheck[];
}

export interface ConformanceCheck {
  readonly id: string;
  readonly title: string;
  readonly requirement: string;
  readonly run: () => Promise<void> | void; // throw to fail
}

export function hostConformanceChecks(): readonly ConformanceCheck[];
export async function runHostConformance(
  opts: ConformanceOptions
): Promise<readonly ConformanceResult[]>;
```

The kit's checks (each is a _test_, not a slogan):

| id                             | proves                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `authority-first`              | an authority-denied operation performs no effect, writes no Processing Event, and reads no privacy state |
| `privacy-denies-without-basis` | with privacy configured and no active basis, no effect and no event                                      |
| `exact-terms`                  | the effect's context is exactly the authorized context (no widening, no extra keys)                      |
| `evidence-before-effect`       | a failing effect leaves a `FAILED_FINAL` event, not a missing one                                        |
| `withdrawal-fence`             | a withdrawal between the check and the effect stops the effect                                           |
| `no-double-effect-on-retry`    | the same idempotency key produces one effect                                                             |
| `secret-free-evidence`         | neither the receipt nor the event contains a secret or a direct subject identifier                       |
| `coarse-failure`               | the agent-facing failure does not carry the internal deny reason                                         |
| `opaque-identifiers`           | the event id and attempt reference are opaque, and carry no direct subject identifier                    |

### 1.5 The operator surface

`ptf host-conformance --dir D [--privacy-config FILE]` runs the kit against
the configured store and prints a pass/fail table (one line per check, the
requirement, and the failure detail). Exit code 0 only when every check
passes, so it can be a CI gate.

---

## 2. Real provider adapters (`src/adapters/`)

The reference providers move no money. Two adapters that speak real protocols
over real HTTP, both testable against a local HTTP server, both usable
against a live endpoint with credentials:

### 2.1 `src/adapters/http-provider.ts` - signed JSON over HTTP

```ts
export interface HttpProviderOptions {
  readonly kind: ProviderKind;
  readonly url: string;
  /** Sign the canonical request body; returns the auth headers. */
  readonly sign: (body: Readonly<Record<string, unknown>>) =>
    | Record<string, string>
    | Promise<Record<string, string>>;
  /** Map the provider's response into a submission. Throwing = a failed effect. */
  readonly interpret: (
    response: Readonly<Record<string, unknown>>,
    status: number
  ) => { readonly externalRef: string; readonly detail?: ... };
  /** Verify the response attests the exact terms (optional but recommended). */
  readonly verifyAttestation?: (
    response: Readonly<Record<string, unknown>>,
    expected: { readonly capabilityId: string; readonly termsDigest: string }
  ) => { readonly ok: true } | { readonly ok: false; readonly reason: string };
  readonly headers?: Readonly<Record<string, string>>;
  readonly method?: "POST" | "PUT";
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly nowSec?: () => number;
}

export function createHttpProvider(opts: HttpProviderOptions): ProtectedProvider;
```

Rules: the body carries the _authorized_ terms plus the capability id and the
terms digest (never a secret); a non-2xx response is a failed effect (the
journal records it); a missing/unparsable body is a failed effect; the
response is never logged with its body by default (a host may opt in).

### 2.2 `src/adapters/x402-provider.ts` - the HTTP 402 agent-payment flow

```ts
export interface X402ProviderOptions {
  readonly url: string;
  /** Pay a 402 challenge. Called only after the server asks for payment. */
  readonly settle: (challenge: X402Challenge) => Promise<X402Payment>;
  readonly resource?: string;
  readonly description?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly nowSec?: () => number;
}

export function createX402Provider(
  opts: X402ProviderOptions
): ProtectedProvider;
```

Flow: POST → `402 Payment Required` with the `X402` challenge (accepts
header listing scheme/network/max amount) → `settle(challenge)` → retry once
with the `X-PAYMENT` header → the response must echo the payment reference
and the expected terms.

Both adapters must be covered by tests against a **real local HTTP server**
(`node:http`), including: the request carries the exact terms, a 500 is a
failed effect, a 402 without a challenge header is a failed effect, a
challenge for a larger amount than authorized is refused, and no secret ever
appears in the request body.

---

## 3. The vertical: `examples/dpdp-consent-gateway.mjs`

A DPDP-shaped workload that a real builder can copy: a clinic (Data
Fiduciary) shares a patient's diagnostic summary with a lab (Data Processor),
and every step produces the evidence a DPO needs.

The script must run end to end with `node examples/dpdp-consent-gateway.mjs`
and print a legible narrative:

1. `ptf privacy init` equivalent: notice + consent + basis + activity, and a
   vault record bound to an opaque subject reference.
2. A disclosure through the **host kit boundary** - only the minimised claim
   set leaves, and a Processing Event is written.
3. The evidence: the Processing Event, the operator summary
   (`summarizeProcessing`), and the audit trail.
4. A **withdrawal** after the fact, then a second disclosure attempt - the
   fence stops it, and the evidence says so.
5. The rights surface: the erasure plan and the exact, subject-bound erasure.
6. A closing table mapping each step to the DPDP Act 2025 / DPDP Rules 2025
   section it exercises (notice, consent, purpose limitation, processing
   evidence, withdrawal, erasure).

The walkthrough lives in `docs/verticals/dpdp-consent-gateway.md` with the
_real_ transcript, and the README links it.

---

## 4. What "a real user can use it" means for this batch

- `npm pack` produces a tarball that installs and runs (the package is
  publish-ready; publishing stays a human step with one command).
- The README's quickstart works from a clean clone (`npm install && npm test`),
  and the new `./hostkit` subpath is documented.
- The vertical runs with one command and needs no credentials.
- The conformance suite is runnable in a host's CI (`ptf host-conformance`).
