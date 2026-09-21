# Verify PTF from a fresh clone

Requires Node 22+ and npm 10+.

```sh
git clone https://github.com/Binilts03/personal-trust-fabric
cd personal-trust-fabric
npm ci
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
npm pack --dry-run
```

Docs changes must also keep the site build green (same steps as the
required `docs` CI job; needs Ruby 3.3 + bundler):

```sh
(cd docs && bundle install && bundle exec jekyll build --destination _site)
```

Do not rely on a pinned test count in documentation. The current GitHub Actions run is the source of truth.

## Exercise the authority seam

The important distinction is CHECK ≠ REDEEM ≠ EXECUTE. A dry-run check verifies terms but carries no executable redemption. Redemption requires recipient proof and consumes a use.

```js
import {
  Authority,
  Capabilities,
  generateEd25519Keypair,
  leafCidHex,
  paymentBounds,
  signBytes,
  termsDigestOf,
} from "./dist/src/index.js";
import { recipientBounds } from "./dist/src/profiles/payment.js";

const NOW = 1_700_000_000;
const principal = generateEd25519Keypair();
const recipient = generateEd25519Keypair();
const keys = new Map([
  ["p", principal.publicKeyRaw],
  ["a", principal.publicKeyRaw],
  ["m", recipient.publicKeyRaw],
]);

const authority = new Authority({ nowSec: () => NOW });
authority.addGrant({
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
  purpose: "personal",
};
const ingress = {
  id: "a",
  principal: "p",
  source: "local-registration",
  proofRef: "verify",
};

const decision = authority.evaluate(operation, ingress, { consume: true });
console.assert(decision.allow);

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
    purpose: "personal",
    resource: "invoice:inv-1",
    recipient: "m",
    amountMax: 100,
    currency: "INR",
    exp: NOW + 300,
    maxUses: 1,
    termsDigest: digest,
  },
  principal.privateKey
);

const demand = {
  cmd: "/pay",
  args: { amount: 100, currency: "INR" },
  recipient: "m",
  resource: "invoice:inv-1",
  purpose: "personal",
  termsDigest: digest,
};

const checked = caps.check([cap], demand);
console.assert(checked.ok);
console.assert(!("chainId" in checked));

const bad = caps.check([cap], { ...demand, termsDigest: "00".repeat(32) });
console.assert(!bad.ok);

const cid = leafCidHex(cap);
const redeemed = caps.redeem([cap], demand, {
  proof: {
    key: recipient.publicKeyRaw,
    sig: signBytes(recipient.privateKey, Buffer.from(cid, "hex")),
  },
});
console.assert(redeemed.ok && redeemed.chainId === cid);
console.assert(redeemed.ok && redeemed.consumed && redeemed.proofVerified);
```

For operator-level verification, follow the quickstart in `README.md` and finish with:

```sh
node dist/src/cli.js --dir ./ptf-store audit --verify
```

Keep local stores, logs, credentials, and verifier output outside Git. Put only the necessary verification summary in the pull request.
