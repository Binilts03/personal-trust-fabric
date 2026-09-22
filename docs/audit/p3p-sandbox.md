# P3P sandbox runbook (manual, host-operated)

This is the live half of roadmap G2 that CI must never perform: a
Pine Labs UAT round-trip proving `PTF → P3P adapter → Pine Labs sandbox`
with real credentials. Everything secret stays in the operator's
environment and trusted backend; PTF handles only normalized challenges,
authority decisions, and receipt verification.

## Prerequisites

- Pine Labs Online UAT merchant (`https://pluraluat.v2.pinepg.in`):
  `PINELABS_CLIENT_ID` + `PINELABS_CLIENT_SECRET` (backend only).
- An active customer mandate for the rail under test
  (`RESERVE_PAY`, `OTM`, or `CARD`).
- Grantex hosted agent (`https://api.grantex.dev`): `GRANTEX_API_KEY` +
  agent id (`ag_...`), scopes `mpp:payment:initiate` and a concrete
  `mpp:payment:max_txn_paise:<cap>`; grant token stored server-side.
- Official SDKs on the host only: `p3p-client-sdk` / `p3p-server-sdk`
  (1.3.0 verified against). PTF never depends on them.

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
   challenge id + paise amount), retry with `P3P-Credential` +
   `X-Grantex-Token`, capture, and collect `Payment-Receipt`. The grant
   token and client secret never leave the backend process.
6. **Verify the receipt** with `verifyP3pReceipt` (amount, currency,
   resource, merchant, challenge id, expiry, replay set), then record the
   secret-free PTF receipt + audit entry. Mismatches fail closed and the
   run stops: investigate, do not retry blindly.

## Denial checklist (repeat per rail)

Amount over ceiling, wrong currency, wrong merchant, wrong resource,
expired grant, expired challenge, wrong agent, revoked grant, replayed
credential, replayed receipt, mutated challenge, terms changed after
CHECK, CHECK value presented for execution, receipt inconsistent with
the authorized operation. Every case must DENY with a named reason;
log the reasons alongside the receipts.

## Secret rules (non-negotiable)

`PINELABS_CLIENT_SECRET`, `GRANTEX_API_KEY`, grant tokens, one-time
payment tokens, PANs, and UPI credentials live in backend env/files
only. They must not appear in PTF inputs, agent-visible output,
receipts, `audit.jsonl`, logs, telemetry, error text, snapshots, or CI
output. The sentinel canary tests (`tests/p3p.test.ts`) enforce this on
every merge for the paths PTF owns; backend egress is operator duty.
