# How to verify (from scratch, no archaeology)

Requires Node 22+, npm 10+.

```sh
git clone <this-repo> && cd personal-trust-fabric
npm ci
npm run typecheck && npm test && npm run eval
npm pack --dry-run
```

Expected: typecheck clean; unit 95+ green; eval 9 green; tarball contains
`package.json`, `README.md`, `LICENSE`, `dist/` (bins `ptf`,
`ptf-mcp-server`).

## Drive the seam (fresh verifier, 5 minutes)

```js
import {
  Authority,
  Capabilities,
  FakePaymentExecutor,
  executeAndReceipt,
  generateEd25519Keypair,
  leafCidHex,
  signBytes,
  termsDigestOf,
} from "./dist/src/index.js";
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
  agent: "a",
  cmd: "/pay",
  amountMax: 2000,
  currency: "INR",
  exp: NOW + 600,
});
const digest = termsDigestOf({ invoice: "inv-1", amount: 100 });
const d = auth.evaluate(
  {
    principal: "p",
    agent: "a",
    cmd: "/pay",
    purpose: "p",
    resource: "r",
    recipient: "m",
    amount: 100,
    currency: "INR",
    termsDigest: digest,
  },
  { consume: true }
);
console.assert(d.allow, "grant should allow");
const caps = new Capabilities({
  resolveKey: (id) => keys.get(id) ?? null,
  nowSec: () => NOW,
});
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

Then the operator loop:

```sh
export PTF_PASSPHRASE='test-pass-123'
node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
node dist/src/cli.js --dir ./ptf-store keygen --alias shop
SHOPKEY=$(node -e "console.log('paste hex from: ptf keygen output')")
node dist/src/cli.js --dir ./ptf-store recipient --alias shop --key <hex-from-keygen>
node dist/src/cli.js --dir ./ptf-store grant --id g1 --principal you --cmd /pay --amount-max 2000 --currency INR
node dist/src/cli.js --dir ./ptf-store pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes
node dist/src/cli.js --dir ./ptf-store audit --verify
```

Save output to `evidence/<date>-<slug>.log` (gitignored). Paste the 5-line
tail + test summary into the PR. No proof, no merge (`/verify` skill).
