# Test / evidence index

Seam: `src/index.ts` only (harness-enforced for core). Style: fixed seeds,
hand-shaped fixtures, independent expected values — never recompute
expectations through the code under test.

## Unit suites (`tests/*.test.ts`, `npm test`)

| Suite                                                                   | Covers                                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authority`                                                             | grants, approvals, digest binding, expiry/uses/revocation, citations                                                                                  |
| `capability` + attenuation + revocation                                 | issue/narrow/redeem, child≤parent, cascade, pruning                                                                                                   |
| `disclosure`                                                            | intersection, allow-lists, holder binding, freshness                                                                                                  |
| `execute`                                                               | propose→approve→redeem→receipt→audit, replay/wrong-recipient, secretness                                                                              |
| `identity`                                                              | register/rotate/revoke, history, snapshot/restore                                                                                                     |
| `approve`                                                               | render all binding fields, ANSI/control stripping, decision parser                                                                                    |
| `x402`                                                                  | challenge parse, demand mapping, settlement, swapped-payTo fails at gate                                                                              |
| `ap2`                                                                   | mandate-pair verify, KB binding, constraint + payee + digest checks                                                                                   |
| `oid4vp`                                                                | DCQL→demand, nonce/aud/state/KB binding, downgrade rule                                                                                               |
| `authzen`                                                               | demand↔SARC round-trip, `evaluateAuthZen` allow/deny with citations                                                                                   |
| `oauth-agent`                                                           | `sub` fixed, `act` append-only, scope subset, exp clamp, sender `cnf`                                                                                 |
| `sd-jwt`                                                                | presentation → SD-JWT `_sd`/disclosures + KB-JWT binding (evidence-only)                                                                              |
| `audit-interop`                                                         | `AuditEntry` → interop record (`jti`), unkeyed verify, keyed opaque                                                                                   |
| `three-env`                                                             | one grant drives OAuth/MCP + browser/vault + AP2; approval + revoke                                                                                   |
| `anchor`, `challenges`, `persona`, `signing`, `settlement`, `hardening` | checkpoint proofs, durable challenges, capsules, signing, settlement, abuse hardening                                                                 |
| `mcp`, `webmcp`, `a2a`, `jws`                                           | edge guards, signatures, transitions, DER edges                                                                                                       |
| `store`, `keystore`                                                     | roundtrip, restart-reload, corrupt rejection, KDF/crypto                                                                                              |
| `cli`                                                                   | argv parsing, unknown-flag rejection                                                                                                                  |
| `mcp-server`                                                            | real-stdio list→propose→check→challenge→redeem→receipt                                                                                                |
| `hygiene`                                                               | core zero-dep, allowlisted deps, strict TS                                                                                                            |
| `vectors`                                                               | digest pins                                                                                                                                           |
| `security-fixes`                                                        | all post-audit regressions (canonical, injection, prototype, nonce, audit forgery, chainId, rotation, adapter strictness, KDF pin, digest separation) |

## Eval (`tests/eval/`, `npm run eval`)

- `golden attack transcripts`: replay, over-spend, expired, wrong-recipient,
  mutated digest, over-requested claims, token-passthrough, description
  poisoning — all denied.
- `capability invariants` (fast-check): randomized narrowing trees assert
  child≤parent; revocation cascades; earliest-expiry-wins.

## Evidence

- Live verifier runs are gitignored by design: `evidence/*.log`
  (e.g. `2026-09-12-security-fixes.log`). To reproduce:
  `npm run typecheck && npm test && npm run eval`, then drive
  `src/index.ts` per `verify.md`.
- `evidence/demo.log`: recorded CLI end-to-end (propose→yes→redeem→receipt,
  valid chain). Rots if not re-run — re-run per `verify.md`, do not trust
  stale logs.
