# Threat pointer (v0.1)

Canonical model: `THREATMODEL.md`. Reporting: `SECURITY.md`.
Research: `docs/research/2026-09-09-deep-*.md`. ADRs: `docs/adr/0001-0007`.

## Attackers in scope → where they die

| Attacker                                     | Gate                                                                                                                | Proof                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Prompt-injected agent (`pay attacker ₹100k`) | `Authority.evaluate` default-deny + citations; `recipient` fixed                                                    | `authority.test.ts`, `eval/` transcripts |
| Substituted recipient key                    | Identity Binding + Ed25519 proof over leaf CID                                                                      | `capability.test.ts`, `execute.test.ts`  |
| Replayed capability                          | `maxUses` subtree ledger + `exp` + nonce/TTL                                                                        | `capability.test.ts`, `eval/` properties |
| Mutated terms                                | `termsDigest` fixed across chain + approval binding; AP2 `transactionId==checkout_hash`; x402 asset/network binding | `security-fixes.test.ts`                 |
| Oversharing verifier                         | `requested ∩ available ∩ allowed`, per-recipient lists, holder binding, KB-downgrade rule                           | `disclosure.test.ts`, `oid4vp.test.ts`   |
| Poisoned tool / lying annotations            | WebMCP shape + origin + confirmation on declared hint; outputs typed `UntrustedText`; metadata distrust documented  | `webmcp.test.ts`, `architecture.md`      |
| Confused-deputy proxy token                  | MCP audience + distinct-token refusal + exact redirect registry                                                     | `mcp.test.ts`                            |
| Forged AgentCard / task replay               | Structure + all-signatures-verify + transition table + push-URL SSRF block; `jku` rejected                          | `a2a.test.ts`                            |
| SSRF via metadata/redirect/push              | `assertSafeUrl` (literal ranges + userinfo reject); DNS/redirect-following documented as fetcher duty               | `urls` via `mcp.test.ts`, `limits.md`    |
| Forged audit history                         | `ingest` recomputes hash + checks seq/prevHash; `FileAuditLog.open` verifies chain                                  | `security-fixes.test.ts`                 |
| Stolen disk                                  | Keystore scrypt+GCM, passphrase-from-env, `0600` tmp files                                                          | `keystore.test.ts`                       |
| Log scraper                                  | Receipt/audit fixed field sets, secretness sentinel tests                                                           | `execute.test.ts`                        |

## Out of scope (explicit)

Compromised OS/keychain, side-channels, HSMs, live mainnet funds,
multi-writer concurrency (single-writer ceiling), independent audit anchoring
(ADR-0006 notes HMAC mode only), full AP2 Human-Not-Present, universal DID
resolution, GNAP server, x509-chain/DID/attestation crypto, mdoc/mDL, nested
DCQL, full RFC 8785. See `limits.md`.
