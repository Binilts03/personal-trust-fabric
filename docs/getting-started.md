---
layout: default
title: Getting Started
nav_order: 1
permalink: /getting-started/
---

# Getting started

PTF is currently a **reference implementation**. These steps run a local
simulation: no live payment is made and no external service receives personal
data. The fastest way to evaluate it is to run the checked-in examples before
setting up an operator store.

**Requirements:** Node.js 22 or later, npm 10 or later, and Git. Commands
below use a fresh checkout; the installation is **not yet published to npm**.

## 1. Run an example first

From a terminal:

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
npm ci
npm run build
node examples/payment-disclosure.mjs
node examples/generic-protected-action.mjs
```

The first script exercises a bounded, synthetic payment using a fake executor and
a minimal data disclosure. No passphrase, external credentials, real money or
agent-host configuration is needed. See [use cases]({{ '/use-cases/' | relative_url }})
for other *offline* examples.

The `ptf` **operator CLI** is also available from this checkout:

```sh
node dist/src/cli.js --help
```

Use `node dist/src/cli.js` in the commands below. The `ptf` binary is
included in package metadata but you do not need a published npm package or
a global installation for this walkthrough.

## 2. Set up a local CLI store (optional)

The commands in this section simulate the operator granting bounded authority
to an agent named `shopper`. The recipient `shop` is a local identity. The
CLI's default payment executor is **fake**: `pay` returns a reference receipt,
not a real transfer.

**Choose one shell**. Do not execute both setup blocks against the same store.

### macOS / Linux / Bash

Create a private passphrase file **before** running `keygen` (the previous
quickstart omitted this step). The Node command uses exclusive file creation;
it refuses to overwrite an existing passphrase.

```sh
node -e 'const fs=require("node:fs");const os=require("node:os");const path=require("node:path");const {randomBytes}=require("node:crypto");const dir=path.join(os.homedir(),".ptf");fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,"passphrase"),randomBytes(32).toString("hex")+"\n",{flag:"wx",mode:0o600});'
unset PTF_PASSPHRASE
export PTF_PASSPHRASE_FILE="$HOME/.ptf/passphrase"
```

Then initialize and run the simulation:

```sh
node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
SHOP_LINE="$(node dist/src/cli.js --dir ./ptf-store keygen --alias shop)"
SHOP_KEY="${SHOP_LINE#shop: }"
node dist/src/cli.js --dir ./ptf-store recipient --alias shop --key "$SHOP_KEY"
node dist/src/cli.js --dir ./ptf-store grant --id g1 --principal you --cmd /pay --agent shopper --amount-max 2000 --currency INR --recipient shop
node dist/src/cli.js --dir ./ptf-store pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes
node dist/src/cli.js --dir ./ptf-store audit --verify
```

### Windows PowerShell

Run this from the same checkout. The generated passphrase is local to your
Windows account; Windows file permissions are controlled by ACLs rather than
Unix `chmod` modes.

```powershell
node -e 'const fs=require("node:fs");const os=require("node:os");const path=require("node:path");const {randomBytes}=require("node:crypto");const dir=path.join(os.homedir(),".ptf");fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(dir,"passphrase"),randomBytes(32).toString("hex")+"\n",{flag:"wx",mode:0o600});'
Remove-Item Env:PTF_PASSPHRASE -ErrorAction SilentlyContinue
$env:PTF_PASSPHRASE_FILE = Join-Path $HOME '.ptf/passphrase'

node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
$shopLine = node dist/src/cli.js --dir ./ptf-store keygen --alias shop
$shopKey = $shopLine -replace '^shop: ', ''
node dist/src/cli.js --dir ./ptf-store recipient --alias shop --key $shopKey
node dist/src/cli.js --dir ./ptf-store grant --id g1 --principal you --cmd /pay --agent shopper --amount-max 2000 --currency INR --recipient shop
node dist/src/cli.js --dir ./ptf-store pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes
node dist/src/cli.js --dir ./ptf-store audit --verify
```

**Expected behavior:** `init` creates a store; `keygen` prints a public key
as `shop: <hex>`; the grant is recorded; `pay` prints a synthetic JSON
receipt; and `audit --verify` checks the hash chain. The `shop` private
key and principal key remain in the local encrypted keystore. The example
`--yes` skips a CLI confirmation prompt; do not treat it as permission
from a real user or a security review.

Keep `$HOME/.ptf/passphrase` **outside** the PTF store, repository and
backups. Do not commit it, share it with an agent, or lose it: losing the
passphrase prevents you from opening the encrypted keystore. Prefer a
dedicated disposable development store for experimentation.

If the exclusive-create command reports `EEXIST`, the passphrase file
already exists. **Do not overwrite it** to resolve an error. Reuse it for a
store encrypted with it, or intentionally create a separate passphrase and
store. An existing `./ptf-store` is likewise intentionally not overwritten
by `init`.

## 3. Verify and continue

To run the repository's checks:

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
npm run verify:package -- --install
```

These validate the local code and package shape; they do not establish
production security or real-world compliance. Run them **from the checkout**.
The repo's required CI jobs additionally exercise code, documentation and
secret-scanning gates.

- [CLI reference]({{ '/cli-reference/' | relative_url }}) — supported
  operator commands and options.
- [MCP contract]({{ '/mcp-contract/' | relative_url }}) — connecting a local
  agent host (an additional setup step, not automatic in the CLI walkthrough).
- [Host kit]({{ '/host-kit/' | relative_url }}) — integrating protected
  effects and testing an adopting host.
- [Known limits]({{ '/audit/limits/' | relative_url }}) — single-writer
  topology, reference executors and other explicit restrictions.

The optional DPDP-informed scenario remains an [offline use case]({{ '/use-cases/' | relative_url }}),
**not** a complete compliance workflow or a live clinic/lab demonstration.

**Generic SDK example:** `node examples/generic-protected-action.mjs` exercises an offline, bounded `/email/send` effect with a real local recipient-signature challenge and a fake provider. It does **not** send a message or enable arbitrary MCP execution.
