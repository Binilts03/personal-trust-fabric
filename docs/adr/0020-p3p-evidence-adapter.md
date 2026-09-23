# ADR-0020: P3P evidence-only adapter (sandbox first)

**Date**: 2026-09-21
**Status**: accepted
**Deciders**: PTF maintainer

## Context

Roadmap G2 requires real P3P interoperability: Pine Labs' HTTP-native
paid-resource flow (request → `402` + `WWW-Authenticate: Payment
<challenge>` → one-time payment credential → retry with `P3P-Credential`

- `X-Grantex-Token` → capture → `Payment-Receipt`), with Grantex supplying
  delegated authorization (agent id, scopes such as
  `mpp:payment:initiate` + `mpp:payment:max_txn_paise:<cap>`, grant JWT).
  Official TypeScript SDKs exist (`p3p-client-sdk` / `p3p-server-sdk`
  1.3.0); the payment-gateway UAT base is
  `https://pluraluat.v2.pinepg.in` with `POST /api/auth/v1/token`
  (client_credentials), amounts in paise.

The risk is making Grantex or P3P the source of PTF authority, or letting
provider secrets (client secret, API keys, grant tokens, one-time payment
tokens, PANs) flow through PTF outputs. ADR-0019 already constrains the
edge to be evidence-only with a core-ignorant boundary.

## Decision

`src/adapters/p3p.ts` is a thin, zero-dependency, SDK-agnostic adapter:

- **Normalize, don't decode wire**: the adapter validates a
  host/SDK-decoded challenge (`normalizeP3pChallenge`) instead of parsing
  vendor-signed bytes. Challenge signing (HMAC from `PINELABS_CLIENT_SECRET`),
  token creation (`POST /mpp/v1/token`), capture, and receipt issuance stay
  in the official SDK, called from the protected executor (host duty,
  trusted environment only).
- **Canonical mapping**: `toP3pPaymentDemand` yields an identity-free
  `/pay` operation (recipient = merchant, amount = paise, currency,
  `p3pChallengeId` + `p3pMethod` folded into context so the PTF-derived
  terms digest covers them) plus capability args. Challenge/resource/
  currency/merchant/method mismatches throw before authority is involved.
- **Receipt verification**: `verifyP3pReceipt` checks success,
  transaction presence, and exact amount/currency/resource/merchant/
  challenge binding, with host-owned replay set and staleness window.
- **Secret boundary by construction**: adapter inputs/outputs have no
  fields capable of carrying credentials; unknown extra fields are ignored
  and never echoed. The executor seam (`P3pProtectedExecutor`) takes the
  normalized challenge, the selected method, the grant scope NAME (never
  the grant token), and a stable idempotency key, and returns external
  refs as evidence. Sentinel canary tests prove non-propagation.
- **No new runtime dependency**: PTF does not depend on the P3P SDKs.
  Depending on a payment SDK in the authority path would couple release,
  audit, and supply-chain posture to a PSP vendor; the SDK lives where
  rails live — behind the host's protected executor.
- **Sandbox first**: live round-trips are env-gated
  (`PTF_P3P_LIVE=1` + host-held credentials) and skipped otherwise; CI
  never touches money movement. The full denial matrix (amount, currency,
  merchant, resource, expiry, agent, revocation, replay, mutation,
  CHECK-misuse, inconsistent provider response) runs against synthetic
  challenges and fails closed.

## Alternatives Considered

### Depend on p3p-client-sdk / p3p-server-sdk directly

- **Pros**: less host wiring; challenge decode for free.
- **Cons**: PSP-vendor code enters PTF's dependency closure and audit
  surface; SDK credential handling (clientSecret in-process) would sit
  inside PTF instead of behind the host boundary; version churn in a
  payment SDK forces PTF releases.
- **Why not**: rails stay host duty (ADR-0018 scope note, ADR-0019).

### Reimplement challenge/token/receipt crypto in PTF

- **Pros**: no host work for the first demo.
- **Cons**: duplicates vendor security-critical code; any drift from the
  server SDK silently breaks or, worse, weakly verifies.
- **Why not**: PTF must never own rail cryptography. Evidence-only means
  the vendor SDK remains the wire authority.

### Protocol-aware core (P3P fields in Authority bounds)

- **Pros**: shorter adapter.
- **Cons**: re-opens the engine per protocol; breaks the G7 generality test.
- **Why not**: rejected by ADR-0019 constraint 1.

## Consequences

- `src/index.ts` barrel exports the adapter (evidence adapters stay out
  of curated `src/api.ts` per ADR-0011); tests import the barrel.
- `docs/audit/limits.md` records the adapter ceiling: synthetic
  challenges only in CI, SDK-owned wire, host-owned credentials and
  live sandbox runs.
- Live UAT proving (real mandate + sandbox capture + receipt) remains a
  documented manual runbook step (`docs/audit/p3p-sandbox.md`, host
  reference `examples/p3p-sandbox-host.mjs` — verified against the real
  `p3p-client-sdk@1.3.0` export shapes `decodeChallenge`,
  `extractAmountPaise`, `decodeReceipt`), tracked under roadmap G2 —
  this ADR + adapter does not claim it.

## Addendum 2026-09-23: receipt wire-shape alignment

Re-reading the published `p3p-client-sdk@1.3.0` types showed the
`P3pReceipt` contract did not match the wire: genuine receipts carry
`status`/`reference`/`settlement`/`timestamp`/`paymentMethod?` and NO
`resource`/`merchant`/`transactionId`/`amountPaise` top-level fields.
`normalizeP3pReceipt` now maps the wire shape (dropping `paymentGateway`
and unknown fields); `verifyP3pReceipt` binds amount/currency/challenge
plus method-when-present, with resource/merchant binding transitive via
the server-issued `challengeId` — the old receipt-side comparisons
compared host-supplied copies of fields the rail never sends, which
proved nothing. `CREDIT_EMI` joined the accepted methods (`Crypto`
stays rejected); the executor seam gained `paymentMethodReferenceId`
for mandate/card rails. No architectural change: still thin,
SDK-agnostic, evidence-only.
