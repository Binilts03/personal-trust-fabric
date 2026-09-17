#!/usr/bin/env node
// PTF end-to-end: vault + agent contract + protected provider.
// Run: npm run build && node examples/vault-protected-action.mjs
//
// Puts general + sensitive + secret records, reads the allowed claim
// holder-signed (names only), uses the secret in-host (receipt only, value
// never leaves), dry-runs requestData/requestExecution, moves value through
// a Fake provider (submit + verify + receipt), and shows one deny case.
// Values never print: outputs carry ids/names/digests/receipts only.
import {
  Authority,
  VaultStore,
  claimsSubset,
  digestForOperation,
  makeFakeProviders,
  executeViaProvider,
  paymentBounds,
  readForPurpose,
  requestData,
  requestExecution,
  useCredential,
} from "../dist/src/api.js";
import {
  Disclose,
  generateEd25519Keypair,
} from "../dist/src/index.js";

const NOW = Math.floor(Date.now() / 1000);
const P = "did:example:you";
const A = "did:example:agent";
const V = "did:example:verifier";
const M = "did:example:shop";
const SECRET = "PAN-SECRET-4111-never-leaves-host";

const holder = generateEd25519Keypair();
const auth = new Authority({ nowSec: () => NOW });
auth.addGrant({
  id: "g-disclose",
  principal: P,
  actor: { kind: "exact", id: A },
  action: { name: "/disclose" },
  bounds: claimsSubset(["email", "phone"]),
  exp: NOW + 3600,
});
auth.addGrant({
  id: "g-use",
  principal: P,
  actor: { kind: "exact", id: A },
  action: { name: "/use" },
  bounds: [{ path: ".context.claim", op: "==", value: "pan" }],
  exp: NOW + 3600,
});
auth.addGrant({
  id: "g-pay",
  principal: P,
  actor: { kind: "exact", id: A },
  action: { name: "/pay" },
  bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
  exp: NOW + 3600,
});

const vault = new VaultStore(() => NOW);
vault.putRecord({
  id: "r-email",
  owner: P,
  type: "email",
  value: "owner@example.com",
  sensitivity: "general",
  source: "user",
  allowedPurposes: ["support"],
  allowedAgents: [A],
  expiresAt: null,
});
vault.putRecord({
  id: "r-phone",
  owner: P,
  type: "phone",
  value: "+91-999",
  sensitivity: "sensitive",
  source: "user",
  allowedPurposes: ["support"],
  allowedAgents: [A],
  expiresAt: null,
});
vault.putRecord({
  id: "r-pan",
  owner: P,
  type: "pan",
  value: SECRET,
  sensitivity: "secret",
  source: "issuer",
  allowedPurposes: ["pay"],
  allowedAgents: [A],
  expiresAt: null,
});
console.log("vault-put: r-email (general), r-phone (sensitive), r-pan (secret)");

const ingress = {
  id: A,
  principal: P,
  source: "local-registration",
  proofRef: "example",
};

// Allowed read: general claim via Authority (/disclose) + purpose/agent filter.
const pres = readForPurpose(vault, {
  ingress,
  purpose: "support",
  requested: ["email"],
  verifier: V,
  nonce: `n-${NOW}`,
  nowSec: NOW,
  authority: auth,
  holder: { id: P, privateKey: holder.privateKey },
});
console.log("vault-read:", pres.disclosures.map((d) => d.name).join(","));
const checked = Disclose.verify(pres, {
  holderKey: holder.publicKeyRaw,
  expectedAud: V,
  nowSec: NOW,
});
console.log("vault-verify:", checked.ok ? "ok" : `denied (${checked.reason})`);

// Secret path: in-host use only — the caller gets a receipt, never the value.
let seenInHost = null;
const used = await useCredential(vault, {
  ingress,
  recordId: "r-pan",
  purpose: "pay",
  authority: auth,
  nowSec: NOW,
  use: async (instr) => {
    seenInHost = instr.value;
    return { receipt: "host-receipt-1", names: ["pan"] };
  },
});
if (seenInHost !== SECRET) throw new Error("in-host callback saw wrong value");
if (JSON.stringify(used).includes(SECRET)) throw new Error("secret leaked!");
console.log("vault-use receipt:", used.receipt);

// Agent contract dry-runs (no uses consumed, no authority minted).
const data = requestData(
  auth,
  ingress,
  {
    purpose: "support",
    resourceId: "credential:issuer-1",
    claims: ["email"],
    verifier: V,
  },
  { nowSec: NOW }
);
console.log(
  "requestData:",
  data.decision.allow ? `allowed ${data.digest.slice(0, 16)}…` : "denied"
);
const exec = requestExecution(
  auth,
  ingress,
  {
    action: "/pay",
    purpose: "widgets",
    resourceType: "ptf-resource",
    resourceId: "order:7",
    context: { amount: 425, currency: "INR", recipient: M },
  },
  { nowSec: NOW }
);
console.log(
  "requestExecution:",
  exec.decision.allow ? `allowed ${exec.digest.slice(0, 16)}…` : "denied"
);
if (!data.decision.allow || !exec.decision.allow) {
  throw new Error("dry-runs should allow");
}

// Protected provider: handles only, verify pins terms, receipt reuses Receipt.
const fakes = makeFakeProviders({ nowSec: () => NOW });
const payDigest = digestForOperation({
  principal: P,
  actor: A,
  action: { name: "/pay" },
  resource: { type: "ptf-resource", id: "order:7" },
  context: { amount: 425, currency: "INR", recipient: M },
  purpose: "widgets",
});
const req = {
  capabilityId: "cid-demo-vault-1",
  termsDigest: payDigest,
  action: "/pay",
  recipient: M,
  resource: "order:7",
  purpose: "widgets",
  context: { amount: 425, currency: "INR" },
};
const sub = await fakes.payment.submit(req);
const pin = fakes.payment.verify(sub, {
  capabilityId: req.capabilityId,
  termsDigest: req.termsDigest,
});
if (!pin.ok) throw new Error(`provider verify denied: ${pin.reason}`);
const receipt = await executeViaProvider(
  fakes.payment,
  req,
  { ok: true, chainId: req.capabilityId },
  NOW
);
console.log("provider receipt:", receipt.transaction, "->", receipt.recipient);

// Deny case: over-limit pay dry-run fails closed (no authority created).
const over = requestExecution(
  auth,
  ingress,
  {
    action: "/pay",
    purpose: "widgets",
    resourceType: "ptf-resource",
    resourceId: "order:7",
    context: { amount: 9999, currency: "INR", recipient: M },
  },
  { nowSec: NOW }
);
console.log(
  "deny case (over-limit):",
  over.decision.allow ? "UNEXPECTED-ALLOW" : `denied as expected (${over.decision.reason})`
);
if (over.decision.allow) throw new Error("over-limit pay must deny");
