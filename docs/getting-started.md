---
layout: default
title: Getting Started
nav_order: 1
permalink: /getting-started/
---

# Getting Started

Requires Node 22+.

## Install

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
npm install
```

## Verify

```sh
npm run typecheck && npm test && npm run eval
```

All three must pass. The gate runs: strict TypeScript, 297+ unit tests, 9 eval/property tests, brand check, zero-dependency core check, public-seam test check.

## Quick Decision (3 steps)

```ts
import { Authority, paymentBounds } from "personal-trust-fabric";
import { recipientBounds } from "personal-trust-fabric/profiles/payment";

const authority = new Authority();
authority.addGrant({
  id: "groceries",
  principal: "did:example:you",
  actor: { kind: "exact", id: "did:example:agent" },
  action: { name: "/pay" },
  bounds: [
    ...paymentBounds({ amountMax: 2000, currency: "INR" }),
    ...recipientBounds(["did:example:shop"]),
  ],
});

const decision = authority.evaluate(
  {
    action: { name: "/pay" },
    resource: { type: "invoice", id: "invoice:inv-1" },
    context: { amount: 1790, currency: "INR", recipient: "did:example:shop" },
    purpose: "groceries",
  },
  {
    id: "did:example:agent",
    principal: "did:example:you",
    source: "local-registration",
    proofRef: "example",
  }
);
if (!decision.allow) throw new Error("denied");
// decision.citations[0].authorityId === "groceries"
```

## Operator Quickstart (Real Use)

```sh
export PTF_PASSPHRASE_FILE="$HOME/.ptf/passphrase" && chmod 600 "$HOME/.ptf/passphrase"
node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
node dist/src/cli.js --dir ./ptf-store keygen --alias shop
node dist/src/cli.js --dir ./ptf-store recipient --alias shop --key <hex-from-keygen>
node dist/src/cli.js --dir ./ptf-store grant --id g1 --principal you --cmd /pay --agent shopper --amount-max 2000 --currency INR --recipient shop
node dist/src/cli.js --dir ./ptf-store pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes
node dist/src/cli.js --dir ./ptf-store audit --verify
node dist/src/cli.js --dir ./ptf-store backup --to ./backups/ptf-store
node dist/src/cli.js --dir ./ptf-restored restore --from ./backups/ptf-store
```

One CLI/MCP writer per store (optimistic revision control fails closed). Vault records persist AES-256-GCM-encrypted under a keystore DEK with freshness binding. Proposals persist per termsDigest file (restart-safe, idempotent). Backups are one unit plus an anchor checkpoint and refuse to merge vintages.

See [Operations](audit/operations) for container image, health signals, rotation, and restore drills.

## Next Steps

- Read [Architecture](architecture) for the four planes
- Browse [ADRs](adr) for design decisions
- Review [Audit docs](audit) for limits, threats, verification
- Explore [Research](research) for protocol deep-dives
