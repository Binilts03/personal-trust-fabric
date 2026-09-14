# How to verify (from scratch, no archaeology)

Requires Node 22+, npm 10+.

```sh
git clone https://github.com/Binilts03/personal-trust-fabric && cd personal-trust-fabric
npm ci
npm run typecheck && npm test && npm run eval
npm pack --dry-run
```

Expected (2026-09-14; CI is the source of truth as counts grow):
typecheck clean; unit 212 green across 42 suites; eval 9 green; tarball
contains `package.json`, `README.md`, `LICENSE`, `dist/` (bins `ptf`,
`ptf-mcp-server`, `ptf-pdp-server`).

## Drive the seam (fresh verifier, 5 minutes)

Identity binds from a host-verified ingress — never from the request body
(ADR-0013). The operation below carries no principal, actor, or digest;
the engine binds and derives all three.

```js
import {
  Authority,
  Capabilities,
  FakePaymentExecutor,
  executeAndReceipt,
  generateEd25519Keypair,
  leafCidHex,
  paymentBounds,
  signBytes,
  termsDigestOf,
} from "./dist/src/index.js";
import { recipientBounds } from "./dist/src/profiles/payment.js";
const NOW = 1_700_000_000;
const p = generateEd25519Keypair(),
  m = generateEd25519Keypair();
const keys = new Map([
  ["p", p.publicKeyRaw],
  ["a", p.publicKeyRaw],
  ["m", m.publicKeyRaw],
]);
const auth = new Authority({ nowSec: () => NOW });
auth.addGrant({
  id: "g1",
  principal: "p",
  actor: { kind: "exact", id: "a" },
  action: { name: "/pay" },
  bounds: [
    ...paymentBounds({ amountMax: 2000, currency: "INR" }),
    ...recipientBounds(["m"]),
  ],
  exp: NOW + 600,
});
const operation = {
  action: { name: "/pay" },
  resource: { type: "invoice", id: "inv-1" },
  context: { amount: 100, currency: "INR", recipient: "m" },
  purpose: "p",
};
const ingress = {
  id: "a",
  principal: "p",
  source: "local-registration",
  proofRef: "verify",
};
const d = auth.evaluate(operation, ingress, { consume: true });
console.assert(d.allow, "grant should allow");
// Same demand, wrong ingress: denies (identity comes from the ingress,
// never the body).
const spoof = auth.evaluate(operation, { ...ingress, id: "attacker" });
console.assert(!spoof.allow, "wrong ingress must deny");
const caps = new Capabilities({
  resolveKey: (id) => keys.get(id) ?? null,
  nowSec: () => NOW,
});
const digest = termsDigestOf({ invoice: "inv-1", amount: 100 });
const cap = caps.issue(
  null,
  {
    iss: "p",
    aud: "a",
    sub: "p",
    cmd: "/pay",
    pol: [["<=", ".amount", 100]],
    purpose: "p",
    resource: "r",
    recipient: "m",
    amountMax: 100,
    currency: "INR",
    exp: NOW + 300,
    maxUses: 1,
    termsDigest: digest,
  },
  p.privateKey
);
const cid = leafCidHex(cap);
const r = caps.authorize(
  [cap],
  {
    cmd: "/pay",
    args: { amount: 100, currency: "INR" },
    recipient: "m",
    termsDigest: digest,
  },
  {
    consume: true,
    proof: {
      key: m.publicKeyRaw,
      sig: signBytes(m.privateKey, Buffer.from(cid, "hex")),
    },
  }
);
console.assert(r.ok && r.chainId === cid, "redeem binds chainId");
// abuse: must fail
const bad = caps.authorize(
  [cap],
  {
    cmd: "/pay",
    args: { amount: 100, currency: "INR" },
    recipient: "m",
    termsDigest: "00".repeat(32),
  },
  { consume: false }
);
console.assert(!bad.ok, "mutated digest must deny");
```

Then the operator loop (mirrors `README.md` quickstart — the two must stay
identical; `tests/cli.test.ts` executes every line through `parseArgs`):

```sh
export PTF_PASSPHRASE='test-pass-123'
node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
node dist/src/cli.js --dir ./ptf-store keygen --alias shop
node dist/src/cli.js --dir ./ptf-store recipient --alias shop --key <hex-from-keygen>
node dist/src/cli.js --dir ./ptf-store grant --id g1 --principal you --cmd /pay --agent shopper --amount-max 2000 --currency INR --recipient shop
node dist/src/cli.js --dir ./ptf-store pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes
node dist/src/cli.js --dir ./ptf-store audit --verify
```

Save output to `evidence/<date>-<slug>.log` (gitignored). Paste the 5-line
tail + test summary into the PR. No proof, no merge (`/verify` skill).
