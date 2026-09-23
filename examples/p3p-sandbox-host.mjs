#!/usr/bin/env node
// P3P sandbox host reference: official SDK ↔ PTF authority boundary.
// Run offline dry-run: npm run build && node examples/p3p-sandbox-host.mjs
// Run live decode:     PTF_P3P_LIVE=1 PTF_P3P_CHALLENGE="Payment <...>" ... node examples/p3p-sandbox-host.mjs
//
// What this proves:
//  - Phase A (always, offline): a host-decoded challenge maps to an
//    identity-free PTF /pay demand, evaluates under a standing grant
//    (allow + cited, deny on mutation), and a receipt verifies against
//    the authorized operation. Synthetic values only, no network.
//  - Phase B (env-gated): the REAL p3p-client-sdk decodes an operator-
//    supplied 402 challenge (decodeChallenge), converts major→minor units
//    (extractAmountPaise), and the result feeds the same PTF path as
//    Phase A. No token creation, no money movement: the client secret is
//    never read here — token creation + capture stay in the operator's
//    trusted backend (see docs/audit/p3p-sandbox.md).
// Values never print: outputs carry ids/digests/decisions/receipt refs.
import {
  Authority,
  normalizeP3pChallenge,
  normalizeP3pReceipt,
  paymentBounds,
  toP3pPaymentDemand,
  verifyP3pReceipt,
} from "../dist/src/index.js";

const NOW = Math.floor(Date.now() / 1000);
const P = "did:example:you";
const A = "did:example:agent";
const MERCHANT = "did:example:merchant";

const auth = new Authority({ nowSec: () => NOW });
auth.addGrant({
  id: "g-p3p-sandbox",
  principal: P,
  actor: { kind: "exact", id: A },
  action: { name: "/pay" },
  purpose: "sandbox-probe",
  resource: { type: "p3p-payment", id: "/api/weather" },
  bounds: [
    ...paymentBounds({ amountMax: 10000, currency: "INR" }),
    { path: ".context.recipient", op: "in", value: [MERCHANT] },
  ],
  exp: NOW + 600,
});
const ingress = {
  id: A,
  principal: P,
  source: "local-registration",
  proofRef: "p3p-sandbox-host-example",
};

function decide(label, normalized, ctx) {
  const { operation } = toP3pPaymentDemand(normalized, ctx, { nowSec: NOW });
  const d = auth.evaluate(operation, ingress, { nowSec: NOW });
  console.log(
    label,
    d.allow ? `ALLOW via ${d.citations[0]?.authorityId}` : `DENY (${d.reason})`
  );
  return { operation, decision: d };
}

// ---- Phase A: synthetic host-decoded challenge (offline) ----
const synthetic = normalizeP3pChallenge(
  {
    challengeId: "ch_sandbox_probe_001",
    amountPaise: 10000,
    currency: "INR",
    resource: "/api/weather",
    merchant: MERCHANT,
    expiresAt: NOW + 300,
    paymentMethods: ["RESERVE_PAY"],
  },
  NOW
);
const ctx = {
  purpose: "sandbox-probe",
  resource: "/api/weather",
  currency: "INR",
  expectedMerchant: MERCHANT,
};
const { operation } = decide("synthetic", synthetic, ctx);
const mutated = {
  ...operation,
  context: { ...operation.context, amount: 10001 },
};
const denied = auth.evaluate(mutated, ingress, { nowSec: NOW });
console.log(
  "mutated-amount",
  denied.allow ? "ALLOW (BUG)" : `DENY (${denied.reason})`
);
const normalizedReceipt = normalizeP3pReceipt({
  status: "success",
  reference: "txn-sandbox-probe",
  settlement: { amount: "10000", currency: "INR" },
  challengeId: "ch_sandbox_probe_001",
  timestamp: new Date(NOW * 1000).toISOString(),
  paymentMethod: "RESERVE_PAY",
});
const receiptCheck = verifyP3pReceipt(
  // Wire shape mirrors decodeReceipt output (status/reference/settlement);
  // resource/merchant never ride the receipt — bound via the challenge.
  normalizedReceipt,
  {
    amountPaise: 10000,
    currency: "INR",
    challengeId: "ch_sandbox_probe_001",
    method: "RESERVE_PAY",
  },
  // Staleness wiring: the receipt's own timestamp bounds acceptance.
  { capturedAt: normalizedReceipt.receivedAt, maxReceiptAgeSec: 300 }
);
console.log(
  "receipt",
  receiptCheck.ok ? "BOUND" : `REJECTED (${receiptCheck.reason})`
);

// ---- Phase B: real SDK decode of an operator-supplied 402 (env-gated) ----
if (process.env["PTF_P3P_LIVE"] !== "1") {
  console.log(
    "live-decode skipped (set PTF_P3P_LIVE=1 with PTF_P3P_CHALLENGE)"
  );
  process.exit(0);
}
let sdk;
try {
  sdk = await import("p3p-client-sdk");
} catch {
  console.error(
    "live-decode needs the official SDK: npm i p3p-client-sdk (host only)"
  );
  process.exit(2);
}
const header = process.env["PTF_P3P_CHALLENGE"] ?? "";
if (!header.startsWith("Payment ")) {
  console.error("PTF_P3P_CHALLENGE must be the raw WWW-Authenticate value");
  process.exit(2);
}
// Vendor wire → PTF normalized challenge. Amount conversion is the SDK's
// job (extractAmountPaise, major→minor); PTF validates the integer.
const sdkChallenge = sdk.decodeChallenge(header);
const live = normalizeP3pChallenge(
  {
    challengeId: sdkChallenge.id,
    amountPaise: sdk.extractAmountPaise(sdkChallenge),
    currency: sdkChallenge.request.currency,
    resource: sdkChallenge.request.resource,
    merchant: MERCHANT, // merchant binding comes from host config, not the wire
    expiresAt: Math.floor(Date.parse(sdkChallenge.expires) / 1000),
    paymentMethods: sdkChallenge.request.availablePaymentMethods,
  },
  NOW
);
decide("live-challenge", live, ctx);
