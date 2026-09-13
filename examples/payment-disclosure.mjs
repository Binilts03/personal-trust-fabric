// PTF end-to-end example: one bounded payment + one minimal disclosure.
// Run: npm run build && node examples/payment-disclosure.mjs
import {
  Authority,
  Capabilities,
  Disclose,
  FakePaymentExecutor,
  executeAndReceipt,
  generateEd25519Keypair,
  leafCidHex,
  signBytes,
  termsDigestOf,
} from "../dist/src/index.js";

const NOW = Math.floor(Date.now() / 1000);
const principal = generateEd25519Keypair();
const merchant = generateEd25519Keypair();
const ids = {
  p: "did:example:you",
  a: "did:example:agent",
  m: "did:example:shop",
};
const keys = new Map([
  [ids.p, principal.publicKeyRaw],
  [ids.a, principal.publicKeyRaw],
  [ids.m, merchant.publicKeyRaw],
]);

// --- Payment: grant → approve → issue → prove → receipt ---
const auth = new Authority({ nowSec: () => NOW });
auth.addGrant({
  id: "groceries",
  principal: ids.p,
  agent: ids.a,
  cmd: "/pay",
  amountMax: 2000,
  currency: "INR",
  exp: NOW + 3600,
});
const digest = termsDigestOf({
  invoice: "inv-1",
  amount: 1790,
  currency: "INR",
});
const decision = auth.evaluate(
  {
    principal: ids.p,
    agent: ids.a,
    cmd: "/pay",
    purpose: "groceries",
    resource: "invoice:inv-1",
    recipient: ids.m,
    amount: 1790,
    currency: "INR",
    termsDigest: digest,
  },
  { consume: true, nowSec: NOW }
);
if (!decision.allow) throw new Error(`payment denied: ${decision.reason}`);
const caps = new Capabilities({
  resolveKey: (id) => keys.get(id) ?? null,
  nowSec: () => NOW,
});
const cap = caps.issue(
  null,
  {
    iss: ids.p,
    aud: ids.a,
    sub: ids.p,
    cmd: "/pay",
    pol: [["<=", ".amount", 1790]],
    purpose: "groceries",
    resource: "invoice:inv-1",
    recipient: ids.m,
    amountMax: 1790,
    currency: "INR",
    exp: NOW + 300,
    maxUses: 1,
    termsDigest: digest,
  },
  principal.privateKey
);
const cid = leafCidHex(cap);
const redeemed = caps.authorize(
  [cap],
  {
    cmd: "/pay",
    args: { amount: 1790, currency: "INR" },
    recipient: ids.m,
    termsDigest: digest,
  },
  {
    consume: true,
    proof: {
      key: merchant.publicKeyRaw,
      sig: signBytes(merchant.privateKey, Buffer.from(cid, "hex")),
    },
  }
);
if (!redeemed.ok) throw new Error(`redeem denied: ${redeemed.reason}`);
const receipt = await executeAndReceipt(
  new FakePaymentExecutor(),
  {
    capabilityId: cid,
    recipient: ids.m,
    amount: 1790,
    currency: "INR",
    resource: "invoice:inv-1",
    purpose: "groceries",
  },
  redeemed,
  NOW
);
console.log(
  "payment receipt:",
  receipt.receiptId,
  "->",
  receipt.recipient,
  receipt.amount,
  receipt.currency
);

// --- Disclosure: only the allowed claim leaves the credential ---
const holder = generateEd25519Keypair();
const pres = Disclose.present(
  {
    issuer: "did:example:ca",
    subject: ids.p,
    claims: { ca_status: "active", income: 900000 },
    cnf: ids.p,
  },
  {
    verifier: ids.m,
    nonce: `nonce-${NOW}`,
    requested: ["ca_status", "income"],
  },
  { recipient: ids.m, allowed: ["ca_status"] },
  { id: ids.p, privateKey: holder.privateKey },
  NOW
);
console.log("disclosed:", pres.disclosures.map((d) => d.name).join(","));
const check = Disclose.verify(pres, {
  holderKey: holder.publicKeyRaw,
  expectedAud: ids.m,
  nowSec: NOW,
});
console.log(
  "verify:",
  check.ok ? `ok (${check.disclosed.join(",")})` : `denied (${check.reason})`
);
