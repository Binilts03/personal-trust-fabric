# Threat model — v3 (supersedes v2; matches ADR-0016 + ADR-0017)

Scope: the CURRENT architecture — encrypted vault, durable proposals, present
flow, file-keystore DEK custody, backup/anchor semantics, fixed-identity stdio
MCP. v2 sections below are retained where still accurate; stale claims
(in-memory proposals lost on restart; "no size caps" as a blanket gap) are
removed. Residuals mirror `docs/audit/limits.md`, not contradict it.

## Assets

Principal secrets (vault `secret` records, signing keys, keystore DEK),
Authority State (grants/approvals/uses), encrypted Personal State at rest
(ciphertext + DEK), durable proposals + in-memory challenges, backups +
`anchor.json`, disclosures/presentations in flight, capabilities in flight,
audit chain.

## Actors

| Actor                                                  | Capability                                        | Example                          |
| ------------------------------------------------------ | ------------------------------------------------- | -------------------------------- |
| Prompt-injected agent                                  | Calls MCP tools with attacker-chosen terms        | `pay attacker` via `ptf_propose` |
| Malicious MCP client                                   | Oversized inputs, unknown digests, challenge spam | Giant payloads, oracle polling   |
| Oversharing / replaying verifier                       | Requests extra claims, replays a presentation     | 10 claims where 2 allowed        |
| Substituted recipient                                  | Swaps recipient key, replays capability           | Forged recipient proof           |
| Store reader (same-host / stolen disk / backup holder) | Reads files, offline-attacks keystore             | Dumps store dir or backup media  |
| Malicious `buildRequest` / `use` callback author       | Runs in-host with plaintext secret in scope       | Leaks value into context/logs    |
| Rollback operator / crash                              | Restores old files, kills mid-rotation            | Full-dir rollback, power loss    |
| Compromised adapter / tool description                 | Smuggles context, lies about effects              | `termsDigest` echo, missing hint |
| Log scraper / backup shipper                           | Reads audit, logs, backup copies                  | Exfiltrated `audit.jsonl`        |
| Host-compromised adversary                             | Full host/RAM/file control                        | Total — nothing claimed (see B9) |

## Trust boundaries

| #   | Boundary                                            | Trusted side                                          | Untrusted side                                   |
| --- | --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| B1  | Agent ↔ authority plane                             | `Authority.evaluate`, deterministic core              | Agent / MCP caller                               |
| B2  | Agent ↔ host secret callbacks                       | `useCredential` receipt-only return                   | `use` / `buildRequest` author + host egress      |
| B3  | Vault file at rest                                  | AES-256-GCM envelope, keystore                        | Disk/backup readers                              |
| B4  | DEK rotation window                                 | Stage-then-seal-then-promote ordering                 | Crash / out-of-order operator                    |
| B5  | Proposal files                                      | Digest re-derivation, TTL/cap, executed-immutable     | File tamperer, filler, racer                     |
| B6  | Backup media + anchor                               | Whole-unit copy, anchor recompute                     | Rollback / tamperer                              |
| B7  | Disclosure delivery (present flow)                  | Verifier/nonce binding, single-present, audit         | Replayer, double-presenter                       |
| B8  | MCP stdio fixed identity                            | Pinned principal/actor, no approve tool               | Remote caller (no story here)                    |
| B9  | Store concurrency / snapshots / logs                | CAS, freshness bindings, fail-closed loads            | Racer, snapshot restorer, log shipper            |
| B10 | PTF ↔ recipient / protocol / human / standards edge | Proofs, evidence-only adapters, digest-bound approval | Substituted keys, protocol messages as authority |

## B1 — Agent ↔ authority plane

- Attacks: injected `pay attacker`; mutated terms; wrong-recipient redeem;
  replayed/expired capability; `act` chain confusion; trusting `ptf_digest`
  without recompute; dry-run `check()` passed to an execute path; extra
  effect-bearing keys smuggled alongside authorized args; binding-stripped
  replay (evaluate without the AP2 binding the approval was minted under);
  id re-registration making revocation/usage/citations ambiguous.
- Mitigations: default-deny `evaluate` + citations; policy constrains, never
  creates (ADR-0002); digest derived server-side from normalized operation +
  fixed ingress (never caller-supplied); child ≤ parent attenuation with
  recipient + termsDigest fixed (`src/core/authority.ts`,
  `src/core/capability.ts`); expiry + maxUses enforced at redemption;
  `requested ∩ available ∩ allowed`, holder-bound disclosure; CHECK ≠ REDEEM
  ≠ EXECUTE — `check()` dry-runs (no consumption, no proof, no chainId) and
  can never execute (type-level: no `consumed`/`proofVerified` flags; runtime:
  `requireRedemption` rejects); only `redeem()` (proof verified, use
  consumed) yields an executable `Redemption` (`src/core/capability.ts`
  check()/redeem(), `src/adapters/providers.ts` requireRedemption);
  `createApproval` folds verified external bindings (scheme + value) into the
  digest — evaluation without (or with a different) binding fails closed on
  terms; authority ids global + immutable across grants/approvals/policies —
  re-registering throws, revoke first (fail-closed at add/restore).
- Residuals: none claimed beyond B9 races (unlimited-use concurrent redeem);
  in-process forgery by hostile host code out of model (host owns everything)
  — enforced boundary is agent-facing seams building both sides from the same
  stored demand.

## B2 — Host callbacks receive PLAINTEXT secrets (new, explicit)

`useCredential` hands the secret value to the in-host `use` callback;
`executeWithCredential` hands the full `SecretInstruction` (including `value`)
to `buildRequest` (`src/store/vault.ts`, `src/adapters/providers.ts`).

- Attacks: callback places the value in provider `context`, receipt, logs, or
  egress; callback retains/copies the heap value.
- Mitigations: built request scanned for the distinctive secret rendering
  (verbatim strings; canonical form ≥ 16 chars) before submission; receipt
  echoing a distinctive secret fails closed instead of minting; requests carry
  handles only; audit carries ids only; raw record access (`getRecord` /
  `listRecords`) is private host-only — MCP/CLI expose only evaluate-first
  `disclose` and receipt-only `useSecret`; burn-before-effect — `useSecret`
  consumes authority then runs `onConsumed` BEFORE the secret reaches the
  callback, and `executeProtectedAction` owns reload → consume → CAS save →
  use → execute (`src/store/vault.ts`, `src/adapters/providers.ts`); a CAS
  conflict fails closed before the secret is touched.
- Residuals (mirror `limits.md` vault row): PTF prevents AGENT possession, NOT
  host misuse. Review `buildRequest`/`use` like provider code, with
  logging/egress controls (host duty). Short scalars (PINs, flags) are
  indistinguishable from legitimate receipt fields and stay uncovered — keep
  them out of string-typed receipt fields. Heap copies are best-effort
  unzeroed — treat heap as sensitive. Persisting after success is too late —
  without `onConsumed`/protected action a crash between use and persist
  resurrects one-time authority; single-writer CAS is the backstop (see B9),
  not multi-writer.

## B3 — Encrypted Personal State at rest (ADR-0016)

`personal-state.json` is an AES-256-GCM v2 envelope over the canonical
snapshot (AAD `ptf-vault/v2`, `kidHex` selects the DEK). The 32-byte DEK lives
in the passphrase-sealed file keystore under `ptf/vault-dek`; passphrase
rotation re-wraps the DEK, DEK rotation re-seals data. Legacy plaintext files
are refused at load AND save (`vault-migrate` seals once).

- Attacks: stolen disk / backup reader (offline scrypt attack on keystore);
  envelope tamper / wrong DEK (GCM auth fails closed: `decryption failed`);
  malformed envelope (fails closed: `bad envelope`).
- Mitigations: ciphertext-only at rest, in backups, in container layers;
  revision CAS + `vaultRev` freshness binding unchanged (stale restores alarm);
  `0600` file modes; passphrase via file > TTY > env-legacy.
- Residuals: a whole-directory backup holds ciphertext AND the DEK (keystore
  lives in the store dir) — anyone holding a backup can decrypt it. Protect
  backup media; rotate on exposure. DEK/file separation needs the
  `KeyProvider` host seam (OS keychain / KMS) — HSM/KMS custody stays a host
  seam. `authority.json` / `registry.json` metadata remain plaintext to local
  readers (only the vault is encrypted).

## B4 — DEK rotation crash windows (`ptf vault-rekey` ordering)

- Protocol: stage new DEK under `ptf/vault-dek-next` and persist the keystore
  BEFORE re-sealing vault data, then promote to `ptf/vault-dek`. Loads resolve
  the opening DEK by envelope `kidHex` across aliases, so every crash prefix
  keeps a matching DEK on disk.
- Attacks / failures: power loss between stage / re-seal / promote; operator
  calling `rotateVaultDek` bare (persist-after) — bricks on a reseal-then-crash
  window; incomplete rotation surfaces as `no DEK matches envelope kid …
re-run vault-rekey` (fail-closed, recoverable — never silent).
- Residual: rotation is a hard cutover per file; concurrent writers during
  rekey still serialize on the vault revision CAS.

## B5 — Durable proposal files (ADR-0017; v2 "lost on restart" SUPERSEDED)

One file per termsDigest under `<storeDir>/proposals` (O_EXCL create, TTL GC:
pending 600s, denied 120s; 1000-file distinct-digest anti-fill cap,
fail-closed beyond). The digest is the idempotency key; `executed` is
immutable history (re-propose/re-redeem returns the stored receipt, never
re-executes); `denied` re-opens to pending when live authority now allows.
Every propose/redeem re-evaluates live authority — durability never substitutes
for a fresh decision. Pending recipient challenges stay IN MEMORY with short
TTLs (lost on restart → redeem phase 1 again): they carry live key material
that must never touch disk.

- Attacks: tampered proposal file → fail-closed (`proposal terms changed:
propose again` via digest re-derivation; present-but-unreadable →
  `proposal store corrupt`, never treated as unknown); expired → propose
  again; unknown → propose first; store-fill (cap fails closed); concurrent
  same-digest redeems.
- Mitigations: digest re-derivation at redeem/present; corrupt/expired/unknown
  distinguished; executed immutability; burn-before-execute persist ordering
  (ticket 05); single-use redeem capabilities (`maxUses: 1` per challenge).
- Residuals: the file does NOT gate spending — under unlimited-use grants,
  concurrent same-digest redeems can both execute before either transition
  lands (last-writer-wins). Mitigations in order: single-writer topology (one
  server per store), maxUses-bounded grants / one-time approvals, single-use
  redeem capabilities. Restored proposals re-evaluate live authority, so stale
  demands fail closed rather than resurrect.

## B6 — Backup / restore + anchor semantics (`src/store/backup.ts`)

Whole-unit copy (authority/registry/vault/keystore/audit/proposals),
never-merge: non-empty destination refused, destination-inside-source refused,
passphrase-file-inside-store refused, vault restore without key material
refused. Every backup carries `anchor.json` (Merkle root + count over
`audit.jsonl`); restore recomputes and refuses mismatch; restored stores reload
under revision-CAS freshness (mixed vintages fail closed at load).

- Attacks: partial rollback (mixed vintages) → fails closed at load;
  tampered/rolled-back log → anchor mismatch fails closed; passphrase smuggled
  into the store → backup refused.
- Semantics (do not over-read): the anchor proves consistency WITHIN a backup
  (restored log == backed-up log), NOT external freshness. A full-directory
  rollback to consistently-old files WITH its matching anchor verifies clean.
  Live-history freshness comes from revision/`vaultRev` bindings at load;
  independent external witnessing is a NON-GOAL (ADR-0006).

## B7 — MCP disclosure delivery (`ptf_present_data`)

Pending `/disclose` proposal + caller nonce (≥ 16 chars) → holder-signed
presentation over `requested ∩ allowed` (secrets excluded; ambiguous same-type
claims fail closed; proposal identity re-asserted against the fixed ingress;
tampered terms fail closed before the vault is touched). Resource-addressed
records (ADR-0018): a record carrying `resource` is selected ONLY on exact
type+id match — the requested resource determines data selection, not just
authorization; unaddressed records match any resource (back-compat). The vault
evaluates the caller-supplied resource so proposal and execution authorize the
identical canonical operation; present re-derives the digest and requires it
to equal the proposal key.

- Attacks: nonce replay; double-present; oversharing verifier; tampered
  proposal smuggled into present.
- Mitigations: verifier + nonce binding (`Disclose.verify`: `maxAgeSec`
  default 300, `expectedNonce` equality fails closed `replay`); consumed use
  persisted BEFORE delivery (burn-before-deliver — a crash burns a use, never
  double-presents); `executed` transition makes re-present fail closed
  (`already presented/denied`); `vault.read` audit entry (purpose / verifier /
  claims / rev, never values).
- Residuals: nonce-uniqueness + freshness enforcement are VERIFIER duty
  (`usedNonces` set is host-owned — without it, replay inside the freshness
  window is possible). Present is a read and consumes nothing extra by design
  beyond the one approval use (ADR-0018 ordering).

## B8 — MCP fixed-identity stdio scope (no remote auth story)

The server speaks for ONE fixed identity (`PTF_MCP_PRINCIPAL` /
`PTF_MCP_ACTOR` → `source: "local-registration"`,
`proofRef: "stdio:<storeDir>"`). Tool inputs carry NO identity fields
(self-certification impossible). 9 tools: `ptf_propose`, `ptf_check`,
`ptf_redeem` (/pay only), `ptf_request_data`, `ptf_present_data`,
`ptf_request_action`, `ptf_get_receipt`, `ptf_list_capabilities`,
`ptf_revoke`. There is deliberately NO approve tool: approval happens
human-side (CLI) or ahead of time (standing grants) — the server only spends
what already exists. `ptf_revoke` is request-only (returns `requested:true` +
the human command; authority untouched). `ptf_list_capabilities` shows only
fixed-identity-visible grants (revoked / foreign / expired / exhausted
excluded).

- Attacks: remote caller impersonation — NO remote auth story in this bin;
  remote/multi-tenant hosts MUST derive per-caller ingress from a verified
  token (OAuth/DPoP/mTLS) and pass it to `Authority.evaluate` (host duty, not
  this file). Malicious client (oversized inputs, unknown digests, challenge
  spam) → fail-closed `unknown` / `expired` / `corrupt` messages.
- Residuals: no in-core size caps, rate limits, or per-client quotas — DoS and
  store-growth are host duties (the 1000-file proposal cap is an anti-fill
  bound, not a quota; per-key buckets live in the PDP bin, per-process).

## B9 — Store concurrency / snapshots / leakage (retained v2)

- Local malicious process reading store files → `0600` tmp+rename, fail-closed
  parse, scrypt+AES-GCM keystore. Residual: grants/approvals metadata readable;
  keystore offline-attackable.
- `PTF_PASSPHRASE` extraction (`/proc`, dumps, child env) → 0600 file >
  no-echo TTY > env-legacy; best-effort `zeroize`. Residual: heap/env copies
  recoverable same-host; HSM/KMS stays a host seam.
- Symlink/path attacks on store paths → per-write random tmp suffix, parent
  mkdir, fail-closed parse. Residual: no `O_NOFOLLOW`/`O_EXCL`/dir-fsync
  discipline on the file-CAS tmp path (proposal create IS O_EXCL); Windows
  rename is not atomic-replace.
- Rollback of authority/keystore → revision CAS + audit freshness binding fail
  closed at load (ADR-0015); full-directory rollback needs the anchor (B6).
- Concurrent redemption races → optimistic revision CAS fails the loser closed
  before any receipt while uses remain; audit concurrent-appends fork loudly
  at next chain verify. Residual: unlimited-use racers can both execute (B5).
- TOCTOU evaluate→execute → re-evaluation at redeem + burn-before-effect
  ordering (reload fresh → consume → CAS save → use/execute via `onConsumed` /
  `executeProtectedAction`): a CAS conflict fails closed before the secret or
  rail is touched; crash/failing rail burns a use (denied retry), never
  double-spends. True atomicity with an external rail needs rail participation
  (2PC — host duty). Limits (mirror `limits.md`): single-writer topology (one
  server per store) is the mitigation, CAS is the backstop; under
  unlimited-use grants racers can both execute while uses remain to burn —
  bound uses (maxUses-bounded grants / one-time approvals / single-use redeem
  capabilities) close it, in that order.
- Stale snapshots restored after revoke → restore revalidates add-gates, but
  revocation/usage live outside the snapshot: freshness needs the live store.
- Backup/log leakage → core never emits raw secrets; tamper-evident chain
  (+opt HMAC). Residual: `detail`/context strings are host-supplied — one
  interpolated secret poisons every copy; redaction is unenforced convention.
- Host compromise blast radius: PTF guarantees NOTHING once the host falls
  (grants minted, revokes suppressed, audit rewritten absent external anchor).
  Recovery is re-provision from clean backups, not a PTF property.

## B10 — Recipient / protocol / human / standards edge (retained v2)

- Substituted recipient key → Identity Binding + Ed25519 proof before
  execution; `provider.verify` pins capabilityId + termsDigest (provider-
  attested — independent `checkSettlement` / `verifyMandatePair` stay host
  duty; rail results are evidence, never authority, ADR-0005).
- Provider mutated/extra context → exact context equality
  (`src/adapters/providers.ts` authorizedTermsCover): authorized args must
  deep-equal request `context` EXACTLY (action/recipient/resource/purpose/
  digest + canonical args == context) — any extra effect-bearing key fails
  closed; dry-run `check()` can never execute (`requireRedemption` needs
  `consumed` + `proofVerified` + `chainId === capabilityId`). `metadata` is
  non-effect by rule only: never compared, never receipted — hosts must ensure
  in review it cannot alter the external effect. Residual: metadata
  effectfulness is unenforced convention (same class as `detail`/context
  secret-freedom in B9); hostile host forgery out of model.
- AuthZEN context smuggling → reserved-echo stripping + digest recompute;
  unknown envelope metadata ignored. Residual: new context keys are future
  collision candidates.
- OAuth `aud` widening → identical-only `aud`, scope subset, depth/cycle caps.
  Residual: single-string `aud`, no registry — skipping `checkAudience` widens
  silently.
- SD-JWT `ptf_digest` without recompute → verifier MUST recompute over the
  canonical disclosed set.
- AP2/x402 shape mismatches → fail-closed `unresolved_constraint`; asset /
  network folded into the caller's termsDigest. Identity-free adapters
  (`src/adapters/x402.ts` toX402PaymentDemand, `src/adapters/ap2.ts`
  toAp2PaymentDemand): outputs carry NO identity and NO digest — terms only
  (purpose/resource/currency + expectations); host binds verified ingress at
  `evaluate` (ADR-0013); AP2 transactionId travels as `VerifiedExternalBinding`,
  never in `operation.context`. Approval binding coverage
  (`src/core/authority.ts` createApproval): verified external bindings
  (scheme + value, e.g. AP2 transaction id) fold into the digest; evaluation
  without (or with a different) binding fails closed on terms. Residual: loose
  mappings are the audit surface.
- Reference HTTP PDP (`examples/pdp-server.mjs`, dev-only) → loopback-only,
  ≥16-char key, per-request reload, 1 MiB cap. Residual: single key, no
  rotation/scope/TLS/rate-limit — never expose as production.
- Production PDP bin (`src/pdp-server.ts`) → mandatory in-process TLS,
  per-key timing-safe allowlist + scopes, hot reload (dropped key 401s),
  read-only reload, secret-free decision logs, per-key buckets + Retry-After,
  single-replica topology; duplicate key ids AND duplicate key values both
  fail the keys file (fail-closed at startup; hot-reload retains last-good —
  availability, broken file fails next deploy; message names the id only,
  never the secret). Residual: buckets per-process (duplicates
  detectable via replica id, not prevented); no rotation history; log shipping
  host duty.

## NON-GOALS (plainly)

1. NOT a PSP / wallet / settlement service. `FakePaymentExecutor` moves no
   money; real rails, settlement verification, and rail atomicity are host
   duty.
2. NO HSM / KMS custody. File keystore + `KeyProvider` seam; heap and host
   compromise are outside PTF's power.
3. NO multi-tenant remote service. Single-writer, one server per store, fixed
   stdio identity; remote caller authentication/mapping is host duty.
4. NO external witness. `anchor.json` is a consistency checkpoint, not a
   witness; third-party verifiability needs external anchoring (ADR-0006).

## Out of scope

Side-channels; independent audit anchoring; full AP2 Human-Not-Present flows;
universal DID resolution; GNAP server; x509-chain/DID/attestation crypto;
mdoc/mDL; nested DCQL; `claim_sets`; full RFC 8785; live mainnet funds;
multi-writer clustering (SQLite deferred, ADR-0008); per-client OAuth consent /
PKCE / state / cookies / minimal scopes (host duties); DNS-rebinding beyond
fetcher-side pinning; egress proxying.

## Must-hold properties

Default-deny; policy never creates authority; Personal State ≠ Authority
State; child ≤ parent; expiry + maxUses at redemption; `requested ∩ available
∩ allowed`; no secrets to agent, receipt, log, or audit; CHECK ≠ REDEEM ≠
EXECUTE (dry-run values unexecutable by type + runtime); authorized ≡
executed (context deep-equals args exactly; `metadata` never compared, never
receipted, must not alter effect); burn-before-execute AND burn-before-deliver
AND burn-before-effect (`onConsumed` / `executeProtectedAction`: CAS conflict
fails before secret/rail; crashes burn uses, never double-spend/present);
executed proposals immutable; authority ids global + immutable; every allow
cites its Grant/Approval.

## Abuse cases to encode as regression evals

Replay; over-spend; expired use; wrong-recipient redeem; mutated termsDigest;
verifier requesting 10 claims but allowed 2; MCP token-passthrough attempt;
WebMCP description poisoning; proposal-file tamper → exact fail-closed
message; expired/corrupt/unknown proposal distinguished; double-present
refused; nonce replay without verifier cache; `buildRequest` leaking a
distinctive secret into context; short-scalar receipt accepted-risk;
bare `rotateVaultDek` brick warning; anchor mismatch on tampered restore;
full-directory rollback WITH matching anchor verifying clean (documents the
non-goal); unlimited-use concurrent redeem double-execution; dry-run `check()`
passed to execute refused (type + runtime); extra effect-bearing context key
refused (metadata-only bypass refused); binding-stripped evaluate denied on
terms; resource-mismatched record not selected; ambiguous same-type claim
refused; CAS conflict fails before secret touched; duplicate authority id
re-register throws; duplicate PDP key id/value fails file.
