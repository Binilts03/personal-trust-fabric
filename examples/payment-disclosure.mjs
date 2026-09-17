// PTF end-to-end example: one bounded payment + one minimal disclosure.
// Run: npm run build && node examples/payment-disclosure.mjs
import {
  Authority,
  Capabilities,
  Disclose,
  FakePaymentExecutor,
  digestForOperation,
  executeAndReceipt,
  generateEd25519Keypair,
  leafCidHex,
  paymentBounds,
  signBytes,
} from "../dist/src/index.js";
import { recipientBounds } from "../dist/src/profiles/payment.js";

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

// --- Payment: grant → evaluate (ingress-bound) → issue → prove → receipt ---
const auth = new Authority({ nowSec: () => NOW });
auth.addGrant({
  id: "groceries",
  principal: ids.p,
  actor: { kind: "exact", id: ids.a },
  action: { name: "/pay" },
  bounds: [
    ...paymentBounds({ amountMax: 2000, currency: "INR" }),
    ...recipientBounds([ids.m]),
  ],
  exp: NOW + 3600,
});
// Identity-free operation: no principal/actor/digest — the engine binds all
// three from the verified ingress (ADR-0013).
const operation = {
  action: { name: "/pay" },
  resource: { type: "invoice", id: "invoice:inv-1" },
  context: { amount: 1790, currency: "INR", recipient: ids.m },
  purpose: "groceries",
};
const ingress = {
  id: ids.a,
  principal: ids.p,
  source: "local-registration",
  proofRef: "example",
};
const decision = auth.evaluate(operation, ingress, {
  consume: true,
  nowSec: NOW,
});
if (!decision.allow) throw new Error(`payment denied: ${decision.reason}`);
// Capability binding derives from the same bound operation — never raw digests.
const digest = digestForOperation({
  ...operation,
  principal: ids.p,
  actor: ids.a,
});
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
