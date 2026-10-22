---
layout: default
title: CLI Reference
nav_order: 5
permalink: /cli-reference/
---

# CLI reference

Run the CLI from a **built repository checkout**:

```sh
node dist/src/cli.js --help
```

The installed package declares a `ptf` binary, but the npm release is not
yet available. The walkthrough below therefore uses the executable in the
checkout rather than a global or unpublished package.

The store path is optional: `--dir <path>` defaults to `./ptf-store`.
Supply it before or after a command (for example `--dir ./ptf-store init`).
Start with the [Getting Started guide]({{ '/getting-started/' | relative_url }})
for the passphrase file, key generation, recipient registration and a
self-contained **fake-payment** example.

## Store and keys

| Command | What it does |
| --- | --- |
| `init` | Initialize a new store; refuses to overwrite an existing store |
| `keygen --alias NAME` | Generate an Ed25519 keypair in the encrypted local keystore; prints its public key |
| `recipient --alias NAME --key HEX` | Register a recipient's 32-byte public key (64 hexadecimal characters) |
| `rekey` | Rotate the encrypted keystore passphrase |
| `audit [--verify]` | Inspect or verify the audit chain |
| `backup --to DIR` | Back up the store and a consistency checkpoint; stop writers first |
| `restore --from DIR` | Restore a backup into a fresh store directory |
| `agent --register ID [--key HEX]` | Register an agent identity |
| `agent --remove ID` | Retire an agent identity |
| `agent --rotate ID --key HEX` | Rotate an agent key |
| `agent --list` | List registered agents |

## Grants and human decisions

| Command | What it does |
| --- | --- |
| `grant --id ID --principal P --cmd /pay --agent A [--amount-max N] [--currency CCY] [--recipient R] [--exp-in SECONDS] [--max-uses N]` | Create an actor-bound standing grant |
| `review [--digest HEX]` | List or inspect pending proposals |
| `approve --digest HEX [--ttl-s SECONDS]` | Issue an exact-terms, one-use approval for a pending proposal |
| `deny --digest HEX` | Deny a pending proposal |
| `revoke --grant ID` | Revoke a standing grant |
| `revoke --recipient ALIAS` | Revoke a recipient mapping |

For `grant`, exactly **one** of `--agent A`, `--actor-set A,B`, or
`--any-agent` is required; `--any-agent` is a deliberate broad wildcard.
Other optional grant flags include `--purpose`, `--resource`,
`--resource-type` and `--allowed-claims`. The accepted expiry and
use-limit flags are `--exp-in` and `--max-uses` (**not**
`--expiry` and `--uses`).

## Protected operations and vault

| Command | What it does |
| --- | --- |
| `pay --principal P --agent A --recipient R --amount N --currency CCY --resource R [--purpose T] [--yes]` | Execute the built-in **fake** payment path and return a synthetic receipt |
| `disclose --holder H --verifier V --claims a,b --credential JSON [--allowed a,b] [--yes]` | Run the CLI disclosure flow |
| `vault-put` | Store a scoped, encrypted record; obtain value from `--value-file`, never argv |
| `vault-read` | Request a scope-constrained disclosure from the vault |
| `vault-migrate` | Migrate a legacy plaintext vault |
| `vault-rekey` | Rotate the vault encryption key |

Run `node dist/src/cli.js --help` for the full `vault-put` and
`vault-read` option lists. The operator CLI **does not implement**
`execute` or `present` commands; use the supported `pay`, `disclose`
and vault operations, or the host integration APIs instead.

`--yes` is supported only on commands that explicitly allow it. It
bypasses the CLI prompt; it is not an independent authorisation decision.
The built-in `pay` command uses a `FakePaymentExecutor`; it never
transfers funds.

## Privacy and host integration (optional)

| Command | What it does |
| --- | --- |
| `privacy <subcommand>` | Configure or examine consent/notice/basis/activity evidence, summaries, exact vault erasure and recovery |
| `host-conformance --privacy-config FILE` | Run nine reference-boundary checks using scratch data, with no network effect |

`privacy` uses positional subcommands such as `privacy init`,
`privacy consent withdraw --id ID`, `privacy verify`, and
`privacy events reconcile --yes`. Consult `ptf help` and
[DPDP privacy profile]({{ '/privacy/dpdp/' | relative_url }}) before
mutating privacy state.

The `host-conformance` command requires an initialized store, a keystore,
initialized privacy state and a valid host privacy-config JSON file. Its
results cover the **reference boundary**, not a separately running MCP
host or custom adopter implementation. See [Host Kit]({{ '/host-kit/' | relative_url }}).

## Environment and common options

- `PTF_PASSPHRASE_FILE`: private file containing the keystore passphrase;
  created by the [Getting Started guide]({{ '/getting-started/' | relative_url }}).
- `PTF_PASSPHRASE`: legacy direct-secret environment variable, which **takes
  precedence** over `PTF_PASSPHRASE_FILE` when set. Avoid it for normal
  operator use.
- `--dir PATH`: select a store; defaults to `./ptf-store`.
- `--help`/`-h`: display supported commands; `--version`/`-V`: version.
- There is **no general-purpose `--json` CLI flag**. Some commands
  already print JSON as their normal output.

Run your experiments against a disposable development store, keep the
passphrase outside the store and repository, and follow the
[known-limits register]({{ '/audit/limits/' | relative_url }}) before
integrating a real provider.
