# Test / evidence index

Seam: `src/index.ts` only (harness-enforced for core). Style: fixed seeds,
hand-shaped fixtures, independent expected values — never recompute
expectations through the code under test.

## Unit suites (`tests/*.test.ts`, `npm test`)

| Suite                                                                                 | Covers                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authority`                                                                           | grants, approvals, digest binding, expiry/uses/revocation, citations                                                                                  |
| `capability` + attenuation + revocation                                               | issue/narrow/redeem, child≤parent, cascade, pruning                                                                                                   |
| `disclosure`                                                                          | intersection, allow-lists, holder binding, freshness                                                                                                  |
| `execute`                                                                             | propose→approve→redeem→receipt→audit, replay/wrong-recipient, secretness                                                                              |
| `identity`                                                                            | register/rotate/revoke, history, snapshot/restore                                                                                                     |
| `approve`                                                                             | render all binding fields, ANSI/control stripping, decision parser                                                                                    |
| `x402`                                                                                | challenge parse, demand mapping, settlement, swapped-payTo fails at gate                                                                              |
| `ap2`                                                                                 | mandate-pair verify, KB binding, constraint + payee + digest checks                                                                                   |
| `p3p`                                                                                 | challenge normalize (paise), expiry gate, Grantex evidence gate, demand mapping, receipt check, grant→redeem→execute end-to-end, denial matrix + canaries |
| `oid4vp`                                                                              | DCQL→demand, nonce/aud/state/KB binding, downgrade rule                                                                                               |
| `authzen`                                                                             | demand↔SARC round-trip, `evaluateAuthZen` allow/deny with citations                                                                                   |
| `oauth-agent`                                                                         | `sub` fixed, `act` append-only, scope subset, exp clamp, sender `cnf`                                                                                 |
| `sd-jwt`                                                                              | presentation → SD-JWT `_sd`/disclosures + KB-JWT binding (evidence-only)                                                                              |
| `audit-interop`                                                                       | `AuditEntry` → interop record (`jti`), unkeyed verify, keyed opaque                                                                                   |
| `three-env`                                                                           | one grant drives OAuth/MCP + browser/vault + AP2; approval + revoke                                                                                   |
| `anchor`, `challenges`, `persona`, `signing`, `settlement`, `hardening`               | checkpoint proofs, durable challenges, capsules, signing, settlement, abuse hardening                                                                 |
| `mcp`, `webmcp`, `a2a`, `jws`                                                         | edge guards, signatures, transitions, DER edges                                                                                                       |
| `store`, `keystore`                                                                   | roundtrip, restart-reload, corrupt rejection, KDF/crypto                                                                                              |
| `vault`                                                                               | durable + encrypted vault: purpose/agent/expiry filter, secret use-only, CAS, ids-only audit, AEAD, legacy refusal, migration, rotation               |
| `agent-contract`                                                                      | `requestData`/`requestExecution` dry-runs, MCP tools, filtered capabilities, revoke request-only, durable proposal lifecycle                          |
| `present-path`                                                                        | holder-signed delivery over MCP, nonce/audience binding, single-present, secret absent, restart durability                                            |
| `providers`                                                                           | fakes move nothing, chainId/termsDigest binding, explicit terms, secret-use orchestrator without leaks                                                |
| `proposals` durability (in `agent-contract`, `present-path`)                          | restart remembers, idempotent re-propose/re-redeem, denied re-opens, corrupt-distinct-from-unknown                                                    |
| `backup`                                                                              | one-unit backup + anchor, clean restore, tamper/non-empty/passphrase-in-store refusals, CLI round-trip                                                |
| `host-network`, `operations`, `pdp-fronting`, `pdp-http`, `pdp-prod`, `three-process` | pinned fetch, backup/restore drill, PDP scopes/rotation/replicas/redaction, TLS + rate limits, separate-process authority                             |
| `cli`                                                                                 | argv parsing, unknown-flag rejection                                                                                                                  |
| `mcp-server`                                                                          | real-stdio list→propose→check→challenge→redeem→receipt                                                                                                |
| `hygiene`                                                                             | core zero-dep, allowlisted deps, strict TS                                                                                                            |
| `vectors`                                                                             | digest pins                                                                                                                                           |
| `security-fixes`                                                                      | all post-audit regressions (canonical, injection, prototype, nonce, audit forgery, chainId, rotation, adapter strictness, KDF pin, digest separation) |

## Eval (`tests/eval/`, `npm run eval`)

- `golden attack transcripts`: replay, over-spend, expired, wrong-recipient,
  mutated digest, over-requested claims, token-passthrough, description
  poisoning — all denied.
- `capability invariants` (fast-check): randomized narrowing trees assert
  child≤parent; revocation cascades; earliest-expiry-wins.

## Verification evidence

Live verifier output is intentionally not committed. Reproduce the public gate with:

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
```

Then drive the changed public seam as described in `verify.md`. Pull requests should contain the necessary verification summary, not generated logs or local store contents.
