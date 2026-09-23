# P3P sandbox runbook (manual, host-operated)

This is the live half of roadmap G2 that CI must never perform: a
Pine Labs UAT round-trip proving `PTF → P3P adapter → Pine Labs sandbox`
with real credentials. Everything secret stays in the operator's
environment and trusted backend; PTF handles only normalized challenges,
authority decisions, and receipt verification.

## Prerequisites

- Pine Labs Online UAT merchant (`https://pluraluat.v2.pinepg.in`):
  `PINELABS_CLIENT_ID` + `PINELABS_CLIENT_SECRET` (backend only).
  Production is `https://api.pluralpay.in` — same wire, different host.
- An active customer mandate for the rail under test
  (`RESERVE_PAY`, `OTM`, or `CARD`; `CREDIT_EMI` also exists in the
  current payload contract). Mandates are created with
  `createMandate`/`createPreAuthorization` and polled with `getMandate`
  to `ACTIVE` before any paid request.
- Grantex agent: `GRANTEX_API_KEY` + agent id (`ag_...`), scopes
  `mpp:payment:initiate` and a concrete
  `mpp:payment:max_txn_paise:<cap>`; grant token stored server-side.
  Confirm the Grantex host against your environment (UAT vs production
  hosts differ; examples have used `https://api.grantex.dev`). The
  Grantex `agentDid` authorized here must equal the PTF `actor` the
  demand is evaluated under — enforce that mapping in the backend.
- Official SDKs on the host only: `p3p-client-sdk` / `p3p-server-sdk`
  (1.3.0 verified against; registry `latest` is also 1.3.0 as of
  2026-09-23). PTF never depends on them.
- Merchant pinning: the P3P challenge wire carries NO merchant field —
  bind `expectedMerchant` to your own merchant config, never to
  caller-supplied data (the reference host does this; see
  `examples/p3p-sandbox-host.mjs`).

## Procedure

1. **Dry run (offline, no credentials).**
   ```sh
   npm run build && node examples/p3p-sandbox-host.mjs
   ```
   Expect: `synthetic ALLOW via g-p3p-sandbox`, `mutated-amount DENY`,
   `receipt BOUND`, `live-decode skipped`.
2. **Create bounded authority.** Standing grant (or exact approval)
   covering merchant, amount ceiling in paise, `INR`, resource route,
   purpose, expiry, and maxUses. Record the grant id.
3. **Request the paid resource** through the operator backend. On `402`,
   capture the raw `WWW-Authenticate` value.
4. **Live decode (no token creation).**
   ```sh
   PTF_P3P_LIVE=1 PTF_P3P_CHALLENGE="Payment <...>" \
     node examples/p3p-sandbox-host.mjs
   ```
   Expect: `live-challenge ALLOW via g-p3p-sandbox` (or a named DENY).
   This exercises the real `decodeChallenge` + `extractAmountPaise` wire
   shapes against the PTF path. The client secret is not read here.
5. **Paid execution (trusted backend only).** With the same challenge,
   create the one-time token (`client.methods.createToken` with the
   challenge id + paise amount + payment method; mandate/card rails
   additionally need the active `paymentMethodReferenceId`, and the
   customer mobile number is resolved inside the backend — it must
   never cross PTF), retry with `P3P-Credential` +
   `X-Grantex-Token`, capture via `POST /mpp/v1/debit` with an
   `Idempotency-Key` derived from the PTF terms digest, and collect
   `Payment-Receipt`. On `202`, poll `getDebitStatus` to a terminal
   state — pending is not a receipt, and a poll timeout is UNKNOWN
   outcome (money may have moved): never report it as success, and
   reconcile out-of-band. The grant
   token and client secret never leave the backend process.
6. **Verify the receipt** with `normalizeP3pReceipt` (wire
   `status`/`reference`/`settlement`/`challengeId`/`timestamp`/
   `paymentMethod` → PTF terms; `paymentGateway` and unknown fields
   dropped) then `verifyP3pReceipt` (amount, currency, challenge id,
   method when both sides carry it, expiry, replay set), then record the
   secret-free PTF receipt + audit entry. Mismatches fail closed and the
   run stops: investigate, do not retry blindly.

## Denial checklist (repeat per rail)

Amount over ceiling, wrong currency, wrong merchant, wrong resource,
expired grant, expired challenge, wrong agent, revoked grant, replayed
credential, replayed receipt, mutated challenge, terms changed after
CHECK, CHECK value presented for execution, receipt inconsistent with
the authorized operation. Every case must DENY with a named reason;
log the reasons alongside the receipts.

## Upstream notes (verified 2026-09-23 against p3p-client-sdk 1.3.0 types)

- Wire amounts are minor-unit strings (`settlement.amount`,
  challenge `amount`); the SDK converts, PTF validates integers.
- Receipts are built, not cryptographically verified, upstream —
  PTF binding (challenge/amount/currency/method + replay set) is the
  trust, plus rail-side one-time-token binding. No P3P webhook exists;
  refunds go through the gateway refund API (confirm behavior with the
  integration owner before relying on it).
- Live rails: `RESERVE_PAY`, `OTM`, `CARD`; `CREDIT_EMI` in the
  payload contract; `Crypto` rejected. UAT simulates by amount range
  (about INR 100–50k success, higher bands pending/failed — see the
  test-card details page when planning runs).

## Secret rules (non-negotiable)

`PINELABS_CLIENT_SECRET`, `GRANTEX_API_KEY`, grant tokens, one-time
payment tokens, PANs, and UPI credentials live in backend env/files
only. They must not appear in PTF inputs, agent-visible output,
receipts, `audit.jsonl`, logs, telemetry, error text, snapshots, or CI
output. The sentinel canary tests (`tests/p3p.test.ts`) enforce this on
every merge for the paths PTF owns; backend egress is operator duty.
