# Known-limits register (honest boundaries)

These are deliberate v0.1 ceilings, not bugs. Each is documented in code and
tested at the boundary.

## Authority / execution

- `FakePaymentExecutor` moves no money. Real PSP wiring is out of scope.
- Single-writer discipline with enforced CAS: authority/registry files carry
  a `revision` bumped atomically with the data; a stale handle's save fails
  closed ("changed under us — reload and retry") instead of last-write-wins.
  The CAS stops concurrent redeems from double-spending while uses remain
  to burn through (bounded grants / one-time approvals); under
  unlimited-use grants both racers can execute — single-writer topology,
  bounded grants, and single-use redeem capabilities are the mitigations,
  in that order (see the agent-contract row). Fresh instances may only create
  a missing store, never overwrite one they never loaded. One server per
  store is still the supported topology; the CAS is the backstop, and audit
  forks (concurrent appends) fail loudly at next chain verify, never silently.
- Durable MCP proposals (ADR-0017): one file per termsDigest under
  `proposals/` (O_EXCL create, TTL GC) — restart preserves
  pending/denied/executed; recipient challenges stay in-memory (lost on
  restart, fail-closed → redeem phase 1 again).
- Audit is tamper-evident (hash chain, opt HMAC), not independently anchored.
  Third-party verifiability needs external anchoring (ADR-0006).
- Rotation is a hard cutover: re-issue under the new key before revoking the
  old; in-flight caps bound to the old key fail closed.
- `executeAndReceipt` cannot prove freshness — consumption persists BEFORE
  executing in both bins (ticket 05), so a crash or failing rail between
  persist and execute burns a use without a receipt (safe direction: the
   retry denies `uses-exhausted`, it never double-spends). Redeem
   immediately before executing all the same; live rails stay host duty.
   For consequential actions use the durable journal instead
   (`src/store/execution.ts`): `runExecution` persists SUBMITTING under a
   stable idempotency key and a throw persists SUBMITTED_UNKNOWN, so
   restart + provider reconcile decides (effect / no-effect retry with the
   same key / quarantine) instead of burning authority on an unknown
   outcome (proof: `tests/execution.test.ts`). Bare `executeAndReceipt`
   remains the reference path with the burn-a-use residual above.
   Journal review findings: a persisted SUBMITTING reloads as
   SUBMITTED_UNKNOWN (a crash between persist and submit is
   indistinguishable from a crash mid-submit); terminal records never
   prune themselves — operators prune them on a schedule
   (`pruneTerminal`; the audit log is the permanent history); `error` /
   `note` / `providerRef` are host-supplied free text (keep them
   secret-free, same duty as audit `detail`).
- Exact-operation binding (ADR-0018): `authorize` echoes the verified
  demand and every execute path deep-compares its instruction against the
  echo — bare `{ok, chainId}` redemptions fail closed, as does any mutated
  recipient/amount/currency/resource/purpose/digest. CHECK ≠ REDEEM ≠
  EXECUTE: `check()` dry-runs (no consumption, no proof, no chainId) and
  can never execute — type-level and runtime; only `redeem()` (proof
  verified, use consumed) yields an executable `Redemption`. In-process
  forgery by hostile host code is out of model (the host owns everything);
  the enforced boundary is agent-facing seams, which build both sides from
  the same stored demand (proof: `tests/execute.test.ts` mutation matrix,
  `tests/signing.test.ts`, `tests/providers.test.ts`).
- Authority ids are global and immutable across grants, approvals, and
  policies: re-registering an id throws (revoke first) — revocation,
  usage, and citations stay unambiguous (proof: `tests/authority.test.ts`).
  Snapshots reusing one id across entries fail closed at restore with a
  repair instruction (assign distinct ids by hand).
- `createApproval` accepts verified external bindings and folds them into
  the digest; evaluation without (or with a different) binding fails on
  terms (proof: `tests/authority.test.ts`).
- Unbounded `/pay*` standing grants rejected at `addGrant` (soft guard) — add
  a `.context.amount` ceiling or use a one-time exact-terms approval.
- Rollback is detected, not prevented: every audit entry commits to the
  post-save store revisions, and loads fail closed when the files predate
  recorded history (single-step and partial rollbacks alarm). A
  full-directory rollback to consistently-old files is undetectable without
  an external anchor — export `store/anchor.ts` checkpoints and verify them
  on restore (runbook duty). In-memory restored copies still decide from
  their copy but can never persist over newer state (revision CAS).
- Audit/detail secret-freedom is host-enforced — core never emits raw secrets,
  but host-supplied `detail`/context strings can leak into backups/logs.
- PDP keys hot-reload retains last-good on malformed rewrite (availability); the broken file fails the next deploy instead of killing the process — startup `loadKeys` still exits 2 (proof: `src/pdp-server.ts:160`, `tests/pdp-fronting.test.ts:258`).
- Policy attenuation is strict on exclusive→inclusive bounds: parent `x < v` + child `x <= w` narrows only when `w < v` (equal admits `v` on the child side); all other `<`/`<=` combos keep `w <= v` (proof: `src/core/policy.ts:198`, `tests/authority.test.ts:529`).
- Agent ingress (Phase 5): registered Ed25519 key + single-use 120s
  challenge-response (`src/store/agents.ts`). The actor derives from the
  verified key — request fields carry no identity. Registry
  (`agents.json`) is durable with revision CAS; retired aliases stay
  retired; revocation is immediate. Challenges are in-memory with a
  100-pending anti-fill cap (restart loses them: fail-closed, challenge
  again). The fixed stdio identity stays the local reference (the MCP spec
  directs stdio servers to environment credentials, not OAuth).
  Proof: `tests/agents.test.ts` (key-bound actor, A/B handoff, deny
  matrix, durability, CAS).
- Travel profile (M7): single-leg exact-date only (`departDate ==`; no
  window search — `<=`/`>=` apply to numbers only and a string range bound
  would never match). Multi-leg, availability, and fare honesty stay
  provider-side evidence; `notes` free text is authorized-exact like all
  context (host must review it as non-effectful, same class as `metadata`).
  Proof: `tests/travel.test.ts`. `travelBounds({})` is intentionally allowed
  (explicit open grant, audit-visible like `{ kind: "any" }` actors) — do not
  mistake an empty bounds list for a missing check.

## Adapters (evidence-only subsets)

- x402: `scheme ∈ {exact, upto}`, atomic-unit amounts, `network` namespaced.
  `asset/network` must be folded into the caller's `termsDigest` (helper
  `requirementMatches` + `expectedAsset/Network/ResourceUrl`); authority has
  no asset/network columns. Settlement amount/asset expectations are opt-in
  per call — pass them.
  Production: implemented — evidence-only parsing + digest folding, no
  network fetch in this adapter (proof: `tests/x402.test.ts`,
  `tests/settlement.test.ts`).
- AP2: known open-constraint shapes enforced (`amount_range`,
  `allowed_payees`, `allowed_merchants`); any other constraint fails closed
  as `unresolved_constraint` → fall back to human-present. `checkout_jwt`
  requires `exp`. Autonomous requires `expectedNonce`. KB requires
  `typ:kb+jwt` + `iat`.
  Production: implemented — fail-closed shapes, keys via explicit params,
  nothing fetched or resolved (proof: `tests/ap2.test.ts`).
- P3P (M5A spike, ADR-0019): `paymentMethod ∈ {RESERVE_PAY, OTM, CARD}`,
  paise integer-string amounts, `/`-path or http(s) resource, INR (or other
  caller-pinned currency — demand must equal challenge currency).
  Challenge expiry enforced at mapping (`nowSec` required, skew-bounded).
  Host decodes the `WWW-Authenticate` challenge object (no header-string
  parser in-adapter); Grantex scopes are citation-only (`grantexScopeAllows`
  requires `mpp:payment:initiate` + a concrete `max_txn_paise` cap ≥ amount,
  PTF grant still required); receipts are recorded-only (`checkP3PReceipt`
  needs success + transaction, rest opt-in — independent `getDebitStatus`
  until terminal SUCCESS/FAILED stays host duty). No SDK dependency, no
  network fetch, no sandbox capture, no `402` retry benchmark in this spike.
  Production: spike only — evidence-only parsing + demand folding via
  `FakeProvider("payment")` (proof: `tests/p3p.test.ts`).
- OpenID4VP: `client_id` prefixes shape-checked only (x509/DID/attestation
  crypto deferred); `response_mode ∈ {fragment, direct_post}`; nonce min 16;
  top-level DCQL paths only; `claim_sets` rejected; mdoc rejected;
  `transaction_data_hashes` equality only when `expectedTransactionData`
   supplied; replay store is host-owned (nonces checked for equality here —
   use the durable `NonceStore` in `src/store/replay.ts`, not a bare
   `Set`, or restart resets protection; proof: `tests/replay.test.ts`).
  Production: CUT to `redirect_uri`-only by default in
  `requestToDisclosureDemand` — x509/DID/attestation/federation fail
  closed unless the host passes `allowUnverifiedClientIdPrefixes` with
  real verification behind its own flag (`parseClientIdProduction` /
  `PRODUCTION_OID4VP_PREFIXES` is the explicit helper) — proof:
  `tests/host-network.test.ts`; mdoc / nested paths / `claim_sets` CUT
  with rejection tests (same file); nonce replay store
  accepted-risk — host must persist used nonces (single-operator duty,
  owner sign in `operations.md`); `Disclose.verify expectedNonce` binds the presentation nonce to the verifier challenge fail-closed `replay` (proof: `src/core/disclose.ts:136`, `tests/disclosure.test.ts:190`).
- MCP: audience + token-separation + redirect-registry only. Per-client
  consent, PKCE, single-use state, cookie binding, minimal scopes are host
  duties. `register` is operator-privileged.
  Production: implemented for audience / token-separation / exact-match
  registry (proof: `tests/mcp.test.ts`); per-client consent/PKCE/state/
  cookie/scopes accepted-risk — host OAuth duties outside single-operator
  v0.1 (documented in `src/adapters/mcp.ts`, owner sign in `operations.md`).
- WebMCP: `consequentialHint` is self-attested — a lying tool can omit it.
  Hosts must gate irreversible effects independently. Private-literal origins
  blocked; DNS-pinning still required for names.
  Production: implemented for origin + registration guards (proof:
  `tests/webmcp.test.ts`) and DNS/redirect via `fetchWithPinning`
  (proof: `tests/host-network.test.ts`); `consequentialHint` trust
  accepted-risk — host gates irreversible effects independently
  (owner sign in `operations.md`).
- A2A: JCS subset (plain JSON, safe integers, lone surrogates rejected; full
  RFC 8785 normalization beyond that rejected). `jku` rejected. Card/key
  expiry + revocation + HTTPS-fetch are host `resolve` duties.
  Production: implemented — `assertKeyFetchUrl` (pinned https) +
  `checkCardKeyPolicy` (host allowlist, revocation, expiry) +
  `fetchCardKeyBytes` (policy first, then key bytes over `fetchWithPinning`;
  revocation fails before any fetch) — proof:
  `tests/host-network.test.ts`; JCS-subset/`jku` rejections unchanged
  (proof: `tests/a2a.test.ts`). Parsing bytes into a `CardKey` stays host
  duty behind the host's own trust root.
- URLs: hostname-string checks only. DNS-rebinding and redirect-to-private
  require fetcher-side pinning + no-follow-or-recheck + egress proxy.
  Production: implemented via `fetchWithPinning` — single per-hop DNS resolution reused for an IP-pinned connect (`fetchViaPinnedIp` preserves SNI + Host + cert-hostname binding) + `isBlockedIp` fail-closed + manual-redirect re-check, no-follow by default (proof: `src/adapters/urls.ts:207`, `tests/host-network.test.ts:147`); egress proxy accepted-risk, and injected `fetchFn` that ignores `init.pinnedIp` reintroduces TOCTOU — hosts must honour it (owner sign in `operations.md`).
- JWS: strict-b64 helper available (`b64uDecodeStrict`); legacy lenient
  decode retained where verification uses decoded bytes (fail-closed).
  Production: implemented — strict helper for new paths, lenient retained
  only where verified bytes are compared (proof: `tests/jws.test.ts`).

## Vault / agent contract / providers (P0 slices 1–3)

- Vault (`src/store/vault.ts`, ADR-0016): `personal-state.json` is an
  AES-256-GCM envelope (v2) over the canonical snapshot — ciphertext only on
  disk, in backups, and in container layers. The 32-byte DEK lives in the
  passphrase-sealed keystore under `ptf/vault-dek`, so `ptf rekey`
  (passphrase rotation) re-wraps the DEK without touching vault data, and
  `ptf vault-rekey` (DEK rotation) re-seals vault data without touching the
  passphrase. All record fields (owner, id, type, revision, sensitivity,
  values) sit inside the authenticated plaintext plus a `ptf-vault/v2`
  domain separator; wrong DEK or tamper fails closed (`decryption failed`),
  malformed envelopes fail closed (`bad envelope`). Legacy plaintext files are refused at load and
  save — one-time `ptf vault-migrate` seals them, then the operator must
  destroy old plaintext backups by hand (migration cannot reach backup
  media). Revision CAS + `vaultRev` audit freshness binding unchanged
  (stale restores alarm; full-directory rollback needs the anchor).
  Audit is ids-only — `vault.put`/`vault.put.persisted`/`vault.read`/
  `vault.use`/`vault.migrated`/`vault.rekeyed` carry id/type/revision,
  never values (proof: `tests/vault.test.ts`).
  `readForPurpose` evaluates `Authority.evaluate(/disclose)` first, then
  owner/purpose/agent/expiry filtering, and drops `secret` records entirely.
  Reads and uses CONSUME authority (ADR-0018): dry-run/proposal evaluation
  does not, actual disclosure and secret use do — one-time approvals cover
  exactly one presentation/use, and hosts must persist authority state
  after success (burn-before-deliver; MCP present and CLI vault-read do).
  For effectful secret use, persistence must precede the external effect:
  `useCredential` offers `onConsumed`, and `executeProtectedAction`
  owns reload → consume → CAS save → use → execute (a CAS conflict fails
  closed before the secret is touched). The vault evaluates the
  caller-supplied resource, so proposal and execution authorize the
  identical canonical operation (present re-derives the digest and requires
  it to equal the proposal key); resource-addressed records are selected
  only by their resource. Same-type
  ambiguity fails closed (re-put under one id or retire the stale record).
  `useCredential` is the sole in-host path for `secret` (receipt-only return;
  a receipt echoing a distinctive secret fails closed instead of minting;
  short scalars such as PINs cannot be told apart from legitimate receipt
  fields and stay uncovered — keep them out of string-typed receipts).
  Raw record access (`VaultStore` internals) is host-only by construction —
  the embedding host already possesses the vault file; the enforced boundary
  is MCP/CLI, which expose only evaluate-first reads and receipt-only use.
  Backup honesty: a whole-directory backup holds ciphertext AND the DEK
  (keystore lives in the store dir), so anyone holding a backup can decrypt
  it — protect backup media accordingly. For DEK/file separation (DEK in
  OS keychain / KMS, ciphertext on disk), implement the `KeyProvider` host
  seam instead of the file keystore; HSM/KMS custody stays a host seam
  (same residual as the keystore row above). DEK and plaintext buffers are
  best-effort unzeroed (`Buffer.from(dek)` copies on every seal/open, plus
  immutable strings and GC relocation — treat heap as sensitive).
  Vault carries `vaultRev` freshness binding like authority/registry:
  `loadVault` fails closed when the file predates audit history and
  `audit --verify` loads the vault when present; a full-directory rollback
  to consistently-old files is still undetectable without an external
  anchor: recompute the `store/anchor.ts` checkpoint on
  restore (runbook duty, `operations.md`). Nonce is required on every vault
  read, but replay storage is host-owned (`Disclose.verify usedNonces` set;
  without it, replay inside the freshness window is possible — same duty as
  the OpenID4VP row).
- Agent contract (`src/profiles/data.ts` + MCP tools): `requestData`
  (`/disclose` only) and `requestExecution` (any `/-path` except
  `/disclose*`) are dry-run `Authority.evaluate` without consume — they never
  add grants/approvals, never consume uses, never revoke, never expose keys
  or envelopes. `ptf_list_capabilities` shows only grants matching the fixed
  server identity (principal + covering actor selector); revoked and
  foreign-principal grants are excluded. `ptf_redeem` stays `/pay`-only
  (other actions propose only) and accepts
  any `/pay` proposal in the shared store regardless of originating propose
  tool; disclosures deliver via `ptf_present_data`. Proposals are durable files now (ADR-0017, one per termsDigest =
  idempotency key; executed immutable, denied re-opens on fresh allow).
  Digest-keying is deliberate, not a missing ID column: identical terms ARE
  the same proposal (re-propose returns stored instead of duplicating), and
  TTL expiry only permits a NEW proposal that still needs FRESH authority
  (a spent one-time approval denies). Permanent execution identity lives in
  `audit.jsonl` (`receiptId`), not in the live-intent store. Recipient challenges stay in-memory (lost on restart — redeem phase 1
  again; they carry live key material by design). Pending lives 600s,
  denied 120s; reads GC expired records; distinct-digest proposes are
  capped at 1000 files (fail-closed beyond — anti-fill bound, not a quota).
  Replaying executed history returns the stored receipt without
  re-evaluating — same exposure as reading `audit.jsonl`, by design, not a
  resurrection path (pending demands always re-evaluate live). Concurrent
  same-digest redeems under unlimited-use grants can both execute before
  either transition lands; mitigations in order: single-writer topology,
  maxUses-bounded grants / one-time approvals, single-use redeem
  capabilities. Redeem-only flows anchor authority/registry revisions; vault-anchored
  entries come from vault operations. `ptf_revoke` is request-only — returns
  `requested:true` + `ptf revoke --grant <id>` and leaves authority untouched
  (proof: `tests/agent-contract.test.ts`).
- Providers (`src/adapters/providers.ts`): `FakeProvider` /
  `makeFakeProviders` (payment/travel/retail/email/identity) move nothing —
  canned `fake-<kind>-` refs plus a call log for assertions. Real rails are
  host duty (`ProtectedProvider.submit` / `PaymentExecutor`).
  `providerAsExecutor` / `executeViaProvider` / `executeActionViaProvider`
  require a `Redemption` (consumed + proofVerified — dry-run checks fail
  closed) with binding (`chainId === capabilityId`) plus `termsDigest`
  verify before any receipt;
  `provider.verify` is provider-attested, so independent rail settlement
  checks stay host duty (see ADR-0005 line below). Provider context must
  deep-equal authorized args exactly — extra effect-bearing keys fail
  closed; non-effectful telemetry rides in the explicit `metadata` bag
  (never compared, never receipted; hosts must ensure it cannot alter the
  external effect). Receipts reuse fixed fields with amount/currency taken
  explicitly from context for payments (`Receipt`) and omitted for generic
  actions (`ExecutionReceipt`), so free-text context handles never leak
  (proof: `tests/providers.test.ts`). Rail results are
  evidence, never authority (ADR-0005): hosts must run the `x402`
  (`checkSettlement`) / `ap2` (`verifyMandatePair`) verifiers on provider
  output before trusting it for value movement.

## Crypto / platform

- `atomicWrite` fsyncs best-effort; Windows rename is not atomic-replace.
  Torn-write window is minimized, not eliminated — keep backups of
  `ptf-store/` for high-value deployments.
- `scryptSync` blocks the event loop per open; MCP `load()` does it per call.
  Accepted at operator scale (a decrypted-key cache would trade
  confidentiality for latency — the wrong direction for a trust layer);
  revisit if a high-throughput server path ever needs it.
- Secrets get best-effort `zeroize` after KDF/rotation, but JS cannot
  guarantee erasure (copies inside `scryptSync`, immutable strings, GC
  relocation) — treat heap as sensitive. Passphrase sourcing avoids env
  where possible (`PTF_PASSPHRASE_FILE`, TTY prompt); env remains supported
  legacy, and HSM/KMS custody stays a host seam (issuance needs the private
  key in-process — external signers cover proof-signing only).
