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
interceptor). The kit is one boundary plus one conformance suite.

---

## 1. The host kit (`src/hostkit/`, new subpath `./hostkit`)

### 1.1 The effect boundary (shipped surface)

The host composes the boundary once, after it has built its `PrivacyRuntime`
and its `PrivacyGateRequest`. The boundary takes those objects directly; it
does not read the privacy configuration or the keystore itself.

```ts
// src/hostkit/boundary.ts
export interface HostEffectDecision {
  readonly allow: boolean;
  readonly reason?: "authority-denied" | "privacy-denied" | "terms-mismatch";
  readonly termsDigest?: string;
}

export interface HostEffectReceipt {
  readonly receiptId: string;
  readonly action: string;
  readonly resource: string;
  readonly purpose: string;
  readonly termsDigest: string;
  readonly at: number;
  readonly authorityId?: string;
  readonly capabilityId?: string;
  /** The provider's external reference. Evidence, never authority. */
  readonly transaction?: string;
  readonly eventId?: string;
}

export interface HostEffectContext {
  /** The authorized operation. Its context equals the authorized context. */
  readonly operation: AuthorityOperation;
  readonly termsDigest: string;
  readonly attemptRef: string;
  /** Equal to attemptRef: a retry can dedupe on it. */
  readonly idempotencyKey: string;
  /** A callback that starts an effect MUST call this first. */
  markEffectStarted(): void;
}

export interface HostEffectBoundary {
  /** The dry run: no effect, no event, no consumption. */
  check(): Promise<HostEffectDecision>;
  /** Run the effect under the nine-step order below. */
  run(): Promise<HostEffectReceipt>;
}

export interface HostEffectBoundaryOptions {
  readonly dir: string;
  readonly auth: Authority;
  readonly ingress: VerifiedIdentity;
  /** The runtime and gate the host built with privacyForHostOperation. */
  readonly runtime: PrivacyRuntime;
  readonly gate: PrivacyGateRequest;
  readonly now: () => number;
  /** The exact context the authority covered. */
  readonly authorizedContext?: Readonly<Record<string, unknown>>;
  /** Journaled provider path. Requires redemption. */
  readonly provider?: ProtectedProvider;
  readonly redemption?: Redemption;
  /** Host effect path. Used when no provider is supplied. */
  readonly execute?: (
    ctx: HostEffectContext
  ) => Promise<ExecutionReceipt | void>;
  /** Durable authority persistence; may be asynchronous and is awaited. */
  readonly persistAuthority?: (auth: Authority) => void | Promise<void>;
  /** Stable attempt identity; defaults to the terms digest. */
  readonly attemptRef?: string;
}

export function createEffectBoundary(
  opts: HostEffectBoundaryOptions
): HostEffectBoundary;

export function hostTermsDigest(
  operation: AuthorityOperation,
  ingress: VerifiedIdentity
): string;
```

The receipt projects the **authorized** action, resource, purpose and terms
digest. A host callback can report its own receipt id and transaction
reference; it cannot make the receipt describe a different operation.

### 1.2 The order the kit must implement (this IS the contract)

1. **Terms binding.** The effect context deep-equals `authorizedContext`. A
   mismatch is a coarse `terms-mismatch` denial before anything else.
2. **Authority first, non-consuming.** `auth.evaluate(op, ingress, { consume: false })`.
   Deny → no privacy read, no event, no effect. An unauthorized caller must not
   learn whether privacy state exists (ADR-0024).
3. **Privacy preflight.** `runtime.preflight(gate)` → deny.
4. **Privacy live recheck.** `runtime.recheck(first, gate)` → deny.
5. **Evidence precommit.** `runtime.prepareEvent(live, gate, attemptRef)` -
   durable and secret-free, written **before** any consumption or effect. The
   attempt reference defaults to the terms digest; a terminal attempt conflicts
   instead of starting a second effect.
6. **Consume authority and persist the CAS.** `auth.evaluate(op, ingress, {
consume: true })`, then `persistAuthority(auth)` (defaults to
   `saveAuthority`). The call is awaited, so a host with a database-backed
   authority gets the same burn-before-effect order. A denial is a
   `FAILED_FINAL` pre-effect failure; a persistence failure stops the attempt
   before the effect.
7. **Privacy fence.** `runtime.fence(live, gate)` - the privacy state is
   re-read at the effect boundary. A withdrawal that landed after the recheck
   stops the effect. The fence failure is a pre-effect failure.
8. **The effect.** Through `executeWithJournal` when a provider + redemption
   are supplied (idempotent, attested), otherwise through the supplied
   `execute` callback. A callback that starts an external effect must call
   `ctx.markEffectStarted()` first; after that call, a failure is an unknown
   outcome, never a proven pre-effect failure. `ctx.idempotencyKey` equals
   `ctx.attemptRef`.
9. **Finalize the evidence.** `runtime.finalizeEvent(...)` with `SUCCEEDED`,
   `FAILED_FINAL` (pre-effect) or `OUTCOME_UNKNOWN` (post-effect ambiguity).
   A finalize failure after the effect is best-effort marked
   `OUTCOME_UNKNOWN`; it never turns a completed effect into a denial.

Denials that reach the agent are coarse: `PrivacyPreEffectError("authority
denied")` or `PrivacyPreEffectError("privacy denied")`. The internal deny
reason stays in operator evidence. Order is the product. A kit that reorders
these is wrong even if the tests pass.

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

A host checks the composition it gives the suite by running the kit's checks
against its own boundary factory. The suite builds each scenario store itself
(a scratch directory under `tmpDir`), seeds the operator's controller, opaque
subject reference and recipient roles, and observes the durable state. It
does not prove that a path the host did not route through the boundary is
covered.

```ts
export interface HostConformanceResult {
  readonly id: string;
  readonly title: string;
  /** The rule the check proves (cite the ADR or DPDP section). */
  readonly requirement: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export type HostConformanceBoundaryFactory = (
  scenario: HostConformanceScenario
) => HostEffectBoundary;

export interface HostConformanceOptions {
  /** The operator's privacy configuration. */
  readonly config: HostPrivacyConfig;
  /** The scratch root for the scenario stores. */
  readonly tmpDir: string;
  /** The boundary under test. Defaults to the reference composition. */
  readonly boundary?: HostConformanceBoundaryFactory;
}

export function buildHostConformanceScenario(
  options: HostConformanceScenarioOptions
): HostConformanceScenario;

export function referenceHostBoundary(
  scenario: HostConformanceScenario
): HostEffectBoundary;

export function runHostConformance(
  options: HostConformanceOptions
): Promise<HostConformanceResult[]>;
```

`HostConformanceScenario` exposes the store, authority, ingress, operation,
demand, runtime, gate, event repository, provider, redemption, the observing
effect callback, the persistence callback and the observations. A host with a
different composition passes `boundary: (scenario) => createEffectBoundary({...})`
(or its own implementation); it does not need a second suite.

The kit's ten checks (each is a _test_, not a slogan):

| id                                      | proves                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `authority-first`                       | an authority-denied run makes zero privacy reads, writes no Processing Event, burns no authority use, and runs no effect |
| `dry-run-has-no-effect`                 | `check()` neither consumes authority nor writes an event nor runs the effect                                             |
| `privacy-denial-fails-closed`           | a privacy denial is a coarse pre-effect failure: no consumption, no effect, no event leak                                |
| `evidence-precommit-before-consumption` | the durable Processing Event exists before the authority use is burned                                                   |
| `consumption-before-effect`             | the durable authority use is on disk before the effect starts                                                            |
| `no-double-effect-on-retry`             | a retry of the same attempt is refused as an existing attempt and runs the effect once                                   |
| `fence-stops-late-withdrawal`           | a withdrawal between the recheck and the effect stops the effect                                                         |
| `terms-binding-is-exact`                | the effect context must deep-equal the authorized context, and a mismatch consumes nothing                               |
| `failure-classification`                | a failure before the effect is `FAILED_FINAL`; a failure after `markEffectStarted()` is `OUTCOME_UNKNOWN`                |
| `receipt-and-evidence-are-secret-free`  | the receipt and event carry no secret, no direct subject identifier, and an opaque attempt reference                     |

The checks fold the spec's earlier `coarse-failure` and `opaque-identifiers`
properties into the denial and secret-free checks; they are asserted, not
given separate ids. `HostConformanceObservations` exposes `effectRuns`,
`privacyReads`, `attemptRef` and the ordering flags the checks assert.

The suite is a scenario factory, not a module-loaded test: a host with a custom
composition passes its factory in process. There is no dynamic module-loading
flag and no `extra` hook in this release.

### 1.5 The operator surface

`ptf host-conformance --dir D --privacy-config FILE` runs the kit against
the **reference composition** and prints one line per check plus the failure
detail. Exit code 0 only when all ten checks pass, so it can be a CI gate.

`--privacy-config` is required. The command needs an initialised store
(`ptf init`, `ptf keygen`, `ptf privacy init`) and a
`PTF_PASSPHRASE`/`PTF_PASSPHRASE_FILE` for the keystore. It reads the
operator's store and creates its scenario stores in a scratch directory; it
does not write the operator's store.

The command tests the reference composition and prints
`boundary: reference composition`. A host with its own composition calls
`runHostConformance({ config, tmpDir, boundary: factory })` from its own test
harness; the CLI does not load a host module dynamically.

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
  /**
   * Sign the request body; returns the auth headers. The second argument is
   * the canonical JSON of the body — the bytes that go on the wire.
   */
  readonly sign: (
    body: Readonly<Record<string, unknown>>,
    canonical: string
  ) => Record<string, string> | Promise<Record<string, string>>;
  /** Map the provider's response into a submission. Throwing = a failed effect. */
  readonly interpret: (
    response: Readonly<Record<string, unknown>>,
    status: number
  ) => {
    readonly externalRef: string;
    readonly detail?: Readonly<Record<string, unknown>>;
  };
  /** Verify the response attests the exact terms (optional but recommended). */
  readonly verifyAttestation?: (
    response: Readonly<Record<string, unknown>>,
    expected: { readonly capabilityId: string; readonly termsDigest: string }
  ) => { readonly ok: true } | { readonly ok: false; readonly reason: string };
  readonly headers?: Readonly<Record<string, string>>;
  /** Sent as a header, never in the body. Defaults to the terms digest. */
  readonly idempotencyKey?: string;
  /** Allow a local `http:` test server. Off by default. */
  readonly allowInsecureHttp?: boolean;
  readonly method?: "POST" | "PUT";
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly nowSec?: () => number;
  /** Rail scope for journal keying. Defaults to the kind. */
  readonly namespace?: string;
  /** Opt-in diagnostics. Status only: never a body, never a header. */
  readonly onDiagnostic?: (event: HttpProviderDiagnostic) => void;
}

export function createHttpProvider(
  opts: HttpProviderOptions
): ProtectedProvider;
```

Rules: the body carries the _authorized_ terms plus the capability id and the
terms digest (never a secret); a non-2xx response is a failed effect (the
journal records it); a missing/unparsable body is a failed effect; the
response is never logged with its body by default (a host may opt in).

### 2.2 `src/adapters/x402-provider.ts` - the HTTP 402 agent-payment flow

**Protocol version 2** (the x402 Foundation spec, `x402-specification-v2.md`
and `transports-v2/http.md`, retrieved 2026-10-21). The v1 header names are
superseded and must not be used.

The three headers, none of them `X-` prefixed, none of them
`WWW-Authenticate`:

| Header              | Direction        | Carries                     |
| ------------------- | ---------------- | --------------------------- |
| `PAYMENT-REQUIRED`  | server to client | base64 `PaymentRequired`    |
| `PAYMENT-SIGNATURE` | client to server | base64 `PaymentPayload`     |
| `PAYMENT-RESPONSE`  | server to client | base64 `SettlementResponse` |

Shapes:

```jsonc
// PaymentRequired
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": { "url": "...", "description": "...", "mimeType": "application/json" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",   // CAIP-2
      "amount": "10000",           // atomic units, as a string
      "asset": "0x036CbD...",
      "payTo": "0x209693...",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "version": "2" }
    }
  ]
}

// PaymentPayload (v2 moved scheme/network into "accepted")
{
  "x402Version": 2,
  "resource": { "url": "..." },
  "accepted": { "scheme": "exact", "network": "eip155:84532", "amount": "10000", "asset": "...", "payTo": "...", "maxTimeoutSeconds": 60 },
  "payload": {
    "signature": "0x2d6a75...",
    "authorization": {
      "from": "0x857b...", "to": "0x209693...", "value": "10000",
      "validAfter": "1740672089", "validBefore": "1740672154",
      "nonce": "0xf374..."
    }
  }
}

// SettlementResponse
{ "success": true, "transaction": "0x1234...", "network": "eip155:84532", "payer": "0x857b..." }
```

The amount is in **atomic units of the asset** and the core spec does not
define the decimals. The host therefore supplies the exact atomic amount it
authorised; the adapter never guesses a unit conversion and refuses a
challenge it cannot compare exactly.

```ts
export interface X402Challenge {
  readonly accepted: PaymentRequirement;
  readonly accepts: readonly PaymentRequirement[];
  readonly resource: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface X402Payment {
  /** The signed authorization (the v2 PaymentPayload `payload` object). */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly extensions?: Readonly<Record<string, unknown>>;
  /** If present, must equal the authorised terms. */
  readonly amount?: string;
  readonly network?: string;
  readonly asset?: string;
  readonly reference?: string;
}

export interface X402ProviderOptions {
  readonly url: string;
  /** The exact amount the host authorised, in atomic units. */
  readonly authorizedAmount: string;
  /** The authorised CAIP-2 network, e.g. "eip155:84532". */
  readonly authorizedNetwork: string;
  /** The authorised asset (token contract or fiat code). */
  readonly authorizedAsset: string;
  /** The authorised payee. */
  readonly authorizedPayTo: string;
  /** The authorised scheme. Defaults to "exact". */
  readonly authorizedScheme?: string;
  /** The payer the host authorised, when it knows one. */
  readonly authorizedPayer?: string;
  /** The exact resource URL the host expects to be challenged for. */
  readonly resource: string;
  readonly settle: (challenge: X402Challenge) => Promise<X402Payment>;
  readonly description?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly nowSec?: () => number;
  readonly namespace?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  readonly allowInsecureHttp?: boolean;
  readonly onDiagnostic?: (event: X402ProviderDiagnostic) => void;
}

export function createX402Provider(
  opts: X402ProviderOptions
): ProtectedProvider;
```

Flow: POST the request. On `402 Payment Required`, read the challenge from
the `PAYMENT-REQUIRED` header (base64) and fall back to the JSON body (the
v1 shape); prefer the header. Check the challenge's `resource` URL against
`opts.resource`. Select the entry from `accepts` that matches the authorised
amount, scheme, network, asset and payee **exactly**. Call
`opts.settle(challenge)` to obtain the signed payload, then retry ONCE with
the `PAYMENT-SIGNATURE` header.

Refuse (throw, no effect, nothing paid) when: the challenge amount differs
from the authorised atomic amount (higher or lower), the network, scheme,
asset or payee does not match, the resource URL does not match, no `accepts`
entry matches, the signed payload names other terms, the response after
payment is not 2xx, the response carries no usable transaction, the
settlement's network/payer/amount does not match, or the server never
challenged. The `PAYMENT-RESPONSE` header, when present, is decoded and
checked; the body is the fallback. The adapter never broadcasts or submits a
payment itself: `settle` signs, the adapter sends the signed payload once.

Both adapters must be covered by tests against a **real local HTTP server**
(`node:http`), including: the request carries the exact terms, a 500 is a
failed effect, a 402 without a challenge header is a failed effect, a
challenge for a different amount (higher or lower) is refused, a challenge
on a different network or asset or payee is refused, and no secret ever
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
6. A closing table mapping each step to the DPDP Act 2023 / DPDP Rules 2025
   provision it exercises.

**Map only to obligations that actually exist.** Verified against the
primary sources (the Act, and the Rules PDF G.S.R. 846(E) of 13 November
2025):

- Act s.5 notice; s.6 consent, its withdrawal (s.6(4) to s.6(6)), and the
  **burden of proof on consent (s.6(10))**, which is conditioned on a
  question arising **in a proceeding**: the Data Fiduciary must then be able
  to prove that a notice was given and that consent was given. The notice and
  consent records are that evidence; a Processing Event chains to them and
  records the attempt.
- Act s.7 "certain legitimate uses" (voluntary provision, state functions,
  legal obligation, medical emergency, and the rest). "Legal obligation" is
  s.7(d), an obligation to disclose information **to the State**, not any
  contractual duty.
- Act s.8(4) to s.8(5): technical and organisational measures, and reasonable
  security safeguards. Erasure is **s.8(7)**; breach notification is **s.8(6)**
  and is not exercised here. s.8(7)'s proviso excuses erasure only where
  retention is necessary for compliance with law.
- Act s.11 access, s.12 correction and erasure, s.13 grievance.
- Rules 3 (notice content), 6(1)(c) (access logging) and 6(1)(e) (one-year
  retention of logs and data), 7 (breach intimation), 8(1)-(2) (inactivity
  erasure for the Third Schedule classes only), 8(3) (one-year retention
  floor for every Data Fiduciary), 14 (rights requests, and a grievance
  response within a period not exceeding ninety days).
- Rule 4 with the First Schedule Part B: the **registered Consent Manager**
  record (consents given, denied and withdrawn, the notices, and sharing with
  a transferee Data Fiduciary) kept for at least seven years and exportable
  **in machine-readable form on the Data Principal's request**. Part B item
  3(c) covers a transferee Data Fiduciary, not disclosure to a Data Processor.

Do **not** claim that DPDP imposes a general record-of-processing-activities
obligation. It does not: the string does not appear in the Act, and a record
of processing activities is a GDPR Art. 30 idea. The evidence this vertical
produces is a machine-readable processing record that is the **nearest
analogue** to the Consent Manager schedule, though it covers processor
disclosures where Part B covers transfers to a transferee Data Fiduciary.
That obligation becomes enforceable on 13 November 2026. No general ROPA duty
does not mean no logging duties: r.6(1)(c) requires access logging, and
r.6(1)(e) and r.8(3) require one year of logs/data.

Dates worth stating once, not everywhere. The **Act** brings ss.1(2), 2,
18-26, 35, 38-43 and 44(1),(3) into force on 13 November 2025; s.6(9) and
s.27(1)(d) on 13 November 2026; and ss.3-17 (including ss.5-8, 11-13 and 16),
s.27 (except (1)(d)), ss.28-34, 36, 37 and 44(2) on 13 May 2027. The
**Rules** phase in from 13 November 2025 (the Board), 13 November 2026
(Consent Managers) and 13 May 2027 (the substantive Data Fiduciary
obligations). Every Act section in the mapping table is out of force today;
the table records design intent, not current enforceability.

Never write "compliant", "DPDP compliant", or any claim of compliance: the
script demonstrates controls, it does not certify anything.

The walkthrough lives in `docs/verticals/dpdp-consent-gateway.md` with the
_real_ transcript, and the README links it.

---

## 4. What "a real user can use it" means for this batch

- `npm pack` produces a tarball that installs and runs (the package is
  publish-ready; publishing stays a human step with one command).
- The README's quickstart works from a clean clone (`npm install && npm test`),
  and the new `./hostkit` subpath is documented.
- The vertical runs with one command and needs no credentials.
- The conformance suite is runnable in a host's CI (`ptf host-conformance` for
  the reference composition; `runHostConformance({ boundary })` for a host's
  own composition).
