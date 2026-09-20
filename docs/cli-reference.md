---
layout: default
title: CLI Reference
nav_order: 5
permalink: /cli-reference/
---

# CLI Reference

```sh
node dist/src/cli.js --help
```

All commands require `--dir <store-path>` (default `./ptf-store`).

## Store Management

| Command                 | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `init`                  | Initialize new store (keystore, vault, audit, proposals) |
| `audit --verify`        | Verify hash-chained audit integrity                      |
| `backup --to <path>`    | Full backup + anchor checkpoint                          |
| `restore --from <path>` | Restore from backup (refuses vintage merge)              |

## Keys & Recipients

| Command                                | Description                                             |
| -------------------------------------- | ------------------------------------------------------- |
| `keygen --alias <name>`                | Generate ED25519 keypair, store in keystore             |
| `recipient --alias <name> --key <hex>` | Register recipient public key for capability redemption |

## Grants & Authority

| Command                                                                                                                                                      | Description                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `grant --id <id> --principal <alias> --cmd <name> --agent <alias> [--amount-max <n>] [--currency <CCY>] [--recipient <alias>] [--expiry <iso>] [--uses <n>]` | Add standing grant                            |
| `approve --grant <id> --principal <alias> --agent <alias> --action <name> --resource <type:id> --context <json> --purpose <id>`                              | One-time approval (exact terms, digest-bound) |
| `revoke --grant <id> --principal <alias>`                                                                                                                    | Revoke grant (request-only via MCP)           |

## Payments & Execution

| Command                                                                                                                  | Description                               |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `pay --principal <alias> --agent <alias> --recipient <alias> --amount <n> --currency <CCY> --resource <type:id> [--yes]` | Execute payment (requires grant/approval) |
| `execute --principal <alias> --agent <alias> --action <name> --resource <type:id> --context <json> --purpose <id>`       | Execute any authorized action             |

## Disclosure

| Command                                                                    | Description                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------- |
| `disclose --principal <alias> --agent <alias> --request <json>`            | Request disclosure (returns minimal approved claim) |
| `present --principal <alias> --agent <alias> --claim <json> --nonce <hex>` | Present holder-signed claim (consumes one use)      |

## Common Flags

| Flag           | Description                             |
| -------------- | --------------------------------------- |
| `--dir <path>` | Store directory (default `./ptf-store`) |
| `--json`       | Output JSON instead of human-readable   |
| `--yes`        | Skip confirmation prompts               |
| `--help`       | Show help for command                   |

## Exit Codes

- `0` — Success
- `1` — User error (bad args, missing grant, denied)
- `2` — System error (store corruption, IO, crypto)
- `3` — Verification failed (audit, backup anchor)

## Examples

```sh
# Initialize and set up keys
export PTF_PASSPHRASE_FILE="$HOME/.ptf/passphrase"
node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
node dist/src/cli.js --dir ./ptf-store keygen --alias shop
node dist/src/cli.js --dir ./ptf-store recipient --alias shop --key <hex>

# Grant authority
node dist/src/cli.js --dir ./ptf-store grant --id g1 --principal you --cmd /pay --agent shopper --amount-max 2000 --currency INR --recipient shop

# Execute
node dist/src/cli.js --dir ./ptf-store pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes

# Verify
node dist/src/cli.js --dir ./ptf-store audit --verify
```
