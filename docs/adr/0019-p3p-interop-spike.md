# ADR-0019: P3P interop as thin evidence adapter (M5A spike)

**Date**: 2026-09-21
**Status**: accepted
**Deciders**: PTF maintainer

## Context

Pine Labs P3P already provides payment-domain machinery PTF must not
recreate: upfront mandate consent, Grantex delegated grant JWTs with
`mpp:payment:initiate` / `mpp:payment:max_txn_paise:<n>` scopes, `402`
challenge → `P3P-Credential` retry → server capture → verifiable
`Payment-Receipt`, over UPI ReservePay / OTM / Card rails. PTF's seat is
the vendor-neutral, user-owned authority layer above it (PTF Standing
Grant → external Grantex grant + Pine mandate → P3P → rail).

## Decision

Add `src/adapters/p3p.ts` as a thin evidence translator (same pattern as
`x402.ts` / `ap2.ts`):

- Host-decoded challenge OBJECT → `parseP3PChallenge` (paise integer
  strings, `/`-path or http(s) resource, RESERVE_PAY/OTM/CARD, fail-closed)
  → `toP3PPaymentDemand` (identity-free `/pay` operation, rail/method/
  mandate refs folded into context, exact resource/currency match).
- Grantex scopes via `grantexScopeAllows` as a citation helper ONLY — a
  PTF Standing Grant is still required; external scopes never mint local
  authority (ADR-0002, ADR-0005).
- Recorded receipts via `checkP3PReceipt` (success + transaction required,
  amount/currency/method/idempotency opt-in). Independent Pine
  debit-status confirmation stays host duty before trusting value movement.
- No `p3p-client-sdk` dependency, no network in-adapter, no new core
  binding scheme: idempotency folding into the digest via a new
  `VerifiedExternalBinding` scheme is deferred to M6 semantics work.

## Alternatives Considered

### Alternative 1: Depend on the P3P SDKs inside PTF

- **Pros**: End-to-end demo in one package.
- **Cons**: New runtime dependency (needs ADR + supply-chain review),
  secret-handling inside the trust layer, SDK drift inside the core.
- **Why not**: Rejected — live SDK wiring is host duty behind the
  existing `ProtectedProvider` seam; the adapter stays parse-and-verify.

### Alternative 2: New PTF payment protocol (PTF-Pay)

- **Pros**: Full control of the wire.
- **Cons**: Forks AP2/P3P/x402; zero adoption; less credible.
- **Why not**: Rejected — PTF projects universal authority semantics
  onto existing rails.

## Consequences

### Positive

- M5A proves PTF is not a closed authorization universe: Standing Grant
  → redeem → `FakeProvider("payment")` with P3P context → recorded
  receipt (proof: `tests/p3p.test.ts`).
- Core untouched (zero-dep, no new binding scheme); public surface
  unchanged (`src/api.ts` narrow per ADR-0011; adapter on the test barrel
  + deep paths only).

### Negative / limits

- Spike only: no sandbox capture, no live `402` retry benchmark, no
  mandate-balance lookup (ReservePay-only upstream), no header-string
  parser (host decodes the challenge object). Each is recorded in
  `docs/audit/limits.md` and remains host duty.
- Pine docs disagree on live rails (overview: ReservePay + Cards;
  SDK page: + OTM). Adapter accepts all three and fails closed on
  anything else; rail liveness is evidence to re-check per challenge.
