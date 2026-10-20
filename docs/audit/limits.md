# Known-limits register (honest boundaries)

These are deliberate v0.1 ceilings, not bugs. Each is documented in code and
tested at the boundary.

## Persistence (ADR-0022)

- File backend stays the default for every surface. SQLite WAL
  (`node:sqlite`, `<storeDir>/ptf.sqlite`) backs the execution journal
  only, opt-in, proven by a parity suite plus a loss-free migration
  round-trip — not by assertion. `node:sqlite` is experimental in
  Node 22 (warning noise, API-drift risk); mitigations are the parity
  suite, the retained file backend, and no core contact (store-only).
- SQLite ceilings: per-op open/close (no pooled handles — crash-safe but
  not high-throughput); O(n) key scans unchanged on files;
  cross-process same-key races and read-then-write transitions rely on
  the single-writer backstop on both backends; WAL+shm travel with the
  db file in backups (checkpoint-on-close keeps the unit coherent);
  5000-record journal cap on both backends (archive with backups, prune
  terminal records only after revoking/expiring authority); encrypted payloads
  declined (journal payloads are handles-only; vault stays file-based).
- Migration never discards: file→SQLite is one transaction
  (all-or-nothing, existing rows win); SQLite→file stages then atomically
  renames and refuses non-empty targets; sources are never deleted by
  the migrator — operators remove them only after verifying parity.

## Identity / ingress (ADR-0023)

- MCP fixed mode is unchanged (one env-pinned identity, schemas carry no
  identity fields). Registry mode binds evaluations to registry members:
  launcher-asserted env actors must be registered + active (rechecked per
  call) — membership proof, not possession proof: even a keyed agent in
  env mode never proves key possession; only `ptf_authenticate` sessions
  do. Keyless entries rely on launcher trust — spec-blessed for stdio,
  but a compromised local launcher can assert any registered keyless id
  (remote/multi-tenant hosts must use verified tokens instead — host
  duty, PDP Bearer keys are the reference).
- `ptf_authenticate` failures share one fixed message (no oracle);
  challenges are claimant-bound, single-use, 120s TTL, in-memory, capped
  at 128 pending (restart re-authenticates); rotation invalidates live
  sessions via key-equality recheck. Redeem re-asserts proposal identity
  and re-derives the terms digest (no cross-agent redemption, tampered
  files fail closed like present).
- Mode is fixed at server startup: a registry created later activates on
  restart; a deleted registry fails closed rather than downgrading.
  Removal/rotation take effect on the next tool call (per-call reload),
  not mid-call — operator-scale granularity by design.
- Agent ids are global + immutable; removal retires permanently
  (re-registering a retired id throws — use a new id, keeping citations
  unambiguous). Backup unit now covers agents/nonces/executions/SQLite
  with the same one-unit/never-merge/anchor rules.

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
- Presentation nonces are durable (`nonces.json` via `FileReplay`) and
  burn-before-deliver: a crash between nonce record and presentation burns
  the nonce without a presentation (safe direction — retry the pending
  proposal with a fresh nonce, never a second presentation for the first).
  Entries prune past 600s (verifier maxAge default 300s + margin); a
  verifier enforcing a longer window must prune less aggressively —
  host-configured duty, no knob yet.
- Benchmark numbers (`npm run bench`) are env-stamped local measurements
  for same-box comparison only — never SLOs, never cross-machine claims.
  CI asserts row shape, not timings (timing thresholds would flake).
- Human approval surface is CLI-only and partial: `review` (sanitized),
  `approve` (one one-time approval per proposal), `deny` (veto, mints
  nothing). No freeze switch, no WebAuthn/passkey step-up, no receipts
  browser — high-risk approvals stay terminal-careful operator duty.
  Withdrawing an approval is `revoke` duty (`deny` refuses to stand next
  to live authority and says so).
- Audit is tamper-evident (hash chain, opt HMAC), not independently anchored.
  Third-party verifiability needs external anchoring (ADR-0006).
- Rotation is a hard cutover: re-issue under the new key before revoking the
  old; in-flight caps bound to the old key fail closed.
- `executeAndReceipt` cannot prove freshness — consumption persists BEFORE
  executing in both bins (ticket 05), so a crash or failing rail between
  persist and execute burns a use without a receipt (safe direction: the
  retry denies `uses-exhausted`, it never double-spends). Redeem
  immediately before executing all the same; live rails stay host duty.
  The journaled path (`executeWithJournal`, ADR-0021) keeps the burn but
  records the outcome lifecycle (`PREPARED → … → SUCCEEDED /
SUBMITTED_UNKNOWN / RECONCILED`) with proposal-anchored idempotency keys
  (`termsDigest` + provider scope — remints reconcile, never fork) and
  query-first reconcile instead of blind retry; attestation failures
  route to reconcile (an effected rail with a bad confirmation must not
  hide behind a terminal state); adopted refs pass provider attestation
  before SUCCEEDED. MCP `ptf_redeem` runs this path, so a crash between
  provider effect and proposal transition reconciles to the same receipt.
  Journal ceilings: one file per execution, 5000-record cap with named
  repair (prune terminal records only after revoking/expiring authority);
  O(n) key lookup on files; single-writer topology —
  cross-process same-key races and read-then-write transitions rely on
  the single-writer backstop; `RECONCILED` needs a host provider query
  (which MUST be read-only — PTF calls it at most once per resume and
  never submits on effected/unknown paths, but cannot constrain what
  host code does inside it) plus manual completion; reconcile adoption
  trusts `provider.verify` — a verify that attests fiction adopts fiction,
  so production verifies must check rail evidence (signatures, ledger),
  never echo ids; hosts running multiple rails of one kind against one
  store MUST set distinct provider namespaces or one rail's outcome
  satisfies another's terms; `metadata`
  idempotency carriage and context secret-freedom stay host-reviewed
  conventions like the rest of the provider seam.
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

## Adapters (evidence-only subsets)

- x402: `scheme ∈ {exact, upto}`, atomic-unit amounts, `network` namespaced.
  `asset/network` must be folded into the caller's `termsDigest` (helper
  `requirementMatches` + `expectedAsset/Network/ResourceUrl`); authority has
  no asset/network columns. Settlement amount/asset expectations are opt-in
  per call — pass them.
  Production: implemented — evidence-only parsing + digest folding, no
  network fetch in this adapter (proof: `tests/x402.test.ts`,
  `tests/settlement.test.ts`).
- P3P: paise-integer amounts, `currency` 3-letter, route-path resources,
  `methods ⊆ {RESERVE_PAY, OTM, CARD, CREDIT_EMI}` (`Crypto` rejected);
  `p3pChallengeId`/`p3pMethod` folded
  into the caller's `termsDigest` (challenge/resource/currency/merchant/
  method mismatches throw before authority). Receipts are wire-faithful
  (`status`/`reference`/`settlement`/`challengeId`/`timestamp`/
  `paymentMethod` via `normalizeP3pReceipt`; `paymentGateway` and unknown
  fields dropped): upstream builds receipts, it does not sign them, so
  PTF binding (challenge/amount/currency/method + replay set) plus
  rail-side one-time-token binding is the trust — resource/merchant bind
  transitively via the server-issued `challengeId`, never from receipt
  fields that do not exist on the wire. The adapter normalizes
  host/SDK-decoded challenges and receipts only — challenge signing,
  token creation, capture, and receipt issuance stay in the official Pine
  Labs SDK behind
  the host's `P3pProtectedExecutor` (client secret, API keys, grant
  tokens, one-time credentials, PANs never enter PTF inputs/outputs;
  canary-tested; mandate/card rails additionally need the
  `paymentMethodReferenceId`, customer mobile stays host-resolved).
  Pending debits are not receipts: the host polls `getDebitStatus` to
  terminal, and poll timeouts are unknown-outcome (reconcile
  out-of-band). CI runs synthetic challenges + the full denial matrix
  only; live UAT round-trips are env-gated host runs
  (`PTF_P3P_LIVE=1`), never implicit. Host wiring reference:
  `examples/p3p-sandbox-host.mjs`; manual runbook:
  `docs/audit/p3p-sandbox.md` (proof: `tests/p3p.test.ts`).
- AP2: known open-constraint shapes enforced (`amount_range`,
  `allowed_payees`, `allowed_merchants`); any other constraint fails closed
  as `unresolved_constraint` → fall back to human-present. `checkout_jwt`
  requires `exp`. Autonomous requires `expectedNonce`. KB requires
  `typ:kb+jwt` + `iat`.
  Production: implemented — fail-closed shapes, keys via explicit params,
  nothing fetched or resolved (proof: `tests/ap2.test.ts`).
- OpenID4VP: `client_id` prefixes shape-checked only (x509/DID/attestation
  crypto deferred); `response_mode ∈ {fragment, direct_post}`; nonce min 16;
  top-level DCQL paths only; `claim_sets` rejected; mdoc rejected;
  `transaction_data_hashes` equality only when `expectedTransactionData`
  supplied; replay store is host-owned (nonces checked for equality here).
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

## DPDP privacy enforcement (experimental)

- A PTF Standing Grant is **not statutory data-processing consent**. Privacy Basis Evidence and Notice/Consent Evidence are independent operator assertions. PTF checks configured fields and runtime scope; it **does not decide whether a basis is legally valid** or prove compliance with the DPDP Act.
- A syntactically opaque `subject:` reference is not proof of pseudonymity or random generation. The trusted host must securely map references to individuals and must never write direct identifiers to privacy event metadata, logs or agent messages.
- The stdio reference host gates `ptf_request_data` and `ptf_present_data` disclosures, plus `/pay` proposals, challenge creation and protected payment execution when `PTF_MCP_PRIVACY_CONFIG` is set. Payment requires an operator-defined `actionCategories["/pay"]` map and an active matching Processing Activity/Basis. No legal-basis/controller/subject selector is accepted from an agent. Generic `ptf_request_action` is **denied** when privacy mode is configured because it has no safe pay/disclose binding; it is not silently passed through. Operator CLI payment/disclose flows, `ptf_request_action` outside the reference host, and independently invoked provider adapters remain **NOT globally privacy-enforced**. Hosts processing personal data through those paths must explicitly compose the privacy runtime; bypassing it remains possible to a compromised or non-integrating host.
- Operator-controlled privacy configuration and the keystore may be compromised; a compromised host can bypass the gate, fabricate evidence and access decrypted state. Local audit chaining cannot prove genuine external execution or independent legal review.
- Processing Events track PTF-mediated attempts, not enterprise-wide or processor-side processing. An `OUTCOME_UNKNOWN` event cannot be counted as confirmed processing or confirmed non-processing. External systems, backups and independent audit logs need separate retention/erasure controls.
- **Attempt identity:** `/pay` evidence binds the exact authorized terms digest (one proposal is one effect). `/use` gets a fresh UUID by default, or a caller-supplied retry reference; reusing a retry reference is how a host asks for the same attempt, not a new effect. `/disclose` hashes the verifier nonce into a bounded attempt reference. Correction evidence is derived from the request reference and record versions. A terminal event is never used to start a new external effect: the runtime refuses and directs the caller to journal reconciliation. A finalize failure after an effect leaves the event `PREPARED`/`OUTCOME_UNKNOWN` until a retry reconciles it from the execution journal, which remains the recovery oracle.
- **Journal-first payment recovery (reference MCP host only):** a retry of the same exact `/pay` terms reads the execution journal before any authority preview, challenge, or consumption, so recovery spends no authority use, mints no second capability, and needs no fresh recipient proof. Limits: the path covers the reference host's `/pay` route only (other hosts must compose the same order themselves); a Processing Event reconstructed after the fact records no authority citation ids when the grant is already spent (the journal receipt is the effect evidence); an unsettled, corrupt, or field-mismatched journal is reported as `outcome_unknown` and needs operator/provider reconciliation; a journal row that was written but never submitted (`PREPARED`/`AUTHORIZED`) is reported as `not_submitted` — the provider was provably never called, so no money moved, but the authority use for that attempt was already spent and cannot be reused, so the attempt needs a new grant and new terms; and because replay reads history rather than authorizing, a later revocation of the grant stops new effects but does not unmake a recorded one. The audit log is append-only and hash-chained, so a replay that lands its audit line and then fails the proposal transition can leave a second `redeem` line for the same transaction (visible duplication, not chain corruption).
- **Journal and event scan cost:** the journal replay resolves a record by an O(n) directory scan of `<storeDir>/executions` (every record is read, parsed, and validated), and the Processing Event lookup (`findByAttempt`) decrypts every event file. Both run on a `/pay` retry and on the read-only status tools for a non-terminal proposal; a terminal proposal short-circuits before the scan. The file event store has the same O(n) encrypted-scan shape (see the operational-capacity entry above). At the documented 5,000-record caps this is the dominant cost of those calls, so the status tools are not suitable for high-frequency polling; an indexed journal (key -> record) is a P4 item.

- Retention holds are operator asserted and do not create processing authority. PTF does not infer legal retention periods or automatically delete external copies/backups. DSAR coverage, breach detection/notification, processor contracts, transfers, children's verification, grievance handling, DPIA/independent audit and registered statutory Consent Manager obligations remain outside this subsystem.
- **Operational capacity / isolation:** the encrypted Processing Event store defaults to **5,000 files** (`maxRecords` is a constructor option for embedded hosts; the reference CLI/MCP does not expose it) and fails closed with "privacy event store full" on new attempts. `prepare()` scans/decrypts all existing events to enforce the cap; `findByKey()`, `listBySubject()` and recovery also scan/decrypt all event files. There is no event-store CAS or general multi-process transaction isolation; retain the single-writer discipline and do not use this store for high-throughput or multi-tenant services without a deliberately designed indexed repository.
- **Metadata side channel:** `privacy-events/pev-<digest-prefix>.json` uses a deterministic truncated content hash. Even though the payload is encrypted, a filesystem reader can infer file counts, file creation, ciphertext lengths and repeated attempt identity; backup manifests also disclose count/hash. File permissions and directory access control remain mandatory. The hash alone must not be presented as anonymisation.
- **Erasure limit:** `privacy erase apply` deletes only explicitly selected PTF-managed Vault records that are bound to the requested opaque `--subject-ref`. New records can carry a `dataPrincipalRef`; the binding is immutable once set. Records bound to another subject are never planned. Legacy/unbound records appear as `unscoped` and are refused, not guessed. Processing Events, audit logs, external processors, copied data, upstream records and older backup snapshots are **not** automatically erased; legal retention and disposal require operator processes. `retention-restricted` is reserved in the engine; holds currently narrow erasure eligibility, not runtime processing permission.
- **Hold scoping:** holds block every matching record/category regardless of the operator-supplied `--subject-ref` (fail closed). An active exact-record or category hold wins over `eligible`; PTF does not use a hold's own subject reference to narrow the block.
- **Keys / backup:** `ptf/privacy-dek` is a distinct AES-GCM data-encryption key stored in the local keystore. A partially completed rekey may leave older envelopes requiring staged old/new keys. Backup/restore must include privacy state, its event directory, matching keystore material and the backup anchor together. A matching local backup manifest is internal consistency evidence, not an independent tamper witness. See the legacy-manifest refusal **below**.
- **Recovery:** `privacy events reconcile --yes` requires **all processing writers to be stopped**. It adopts `SUCCEEDED`/`FAILED_FINAL` only when exactly one execution-journal row proves the same terms digest, action, resource, purpose and single destination, and that row is terminal. Duplicate terminal rows, action/resource/recipient mismatches and non-terminal rows are refused. `--include-unknown` explicitly revisits an earlier `OUTCOME_UNKNOWN`. `RECONCILED` journal rows are not adopted yet, and one corrupt journal file aborts the sweep. `privacy events resolve` requires an operator-supplied external evidence reference and explicit confirmation; the code does not independently attest provider outcomes or automatically reconcile at startup.
- **Rights summary:** `privacy summary` includes current notice/consent state and activity IDs. Record-level eligibility is reported as `not-computed` when `--owner` or holds are absent, rather than presenting an empty list as if no record were eligible. With an owner, the plan distinguishes eligible, held and unbound records.
- **Correction:** correction remains an operator-controlled `vault-put` (exact record versioning). `privacy correction` records the corresponding Processing Event after the fact. It requires a `/correct` Processing Activity, active matching basis, DPDP profile, record owner and opaque subject binding, and proof that the current record version is exactly `--previous-version + 1`. It never reads/prints the corrected value and does not re-verify legal sufficiency.
- **Backup legacy:** restore refuses an anchor/backup containing `privacy-events/` but no privacy-events manifest. Backups made by earlier pre-release builds with privacy events must be re-created with the current backup command; unmanifested events are not restored on trust.
- **Consent withdrawal race:** the privacy recheck is before consumption/effect, not an atomic transaction spanning privacy state, PTF Authority state and external provider. A concurrent withdrawal between the last recheck and the effect remains possible. Sensitive deployments require host serialization/transaction fencing or equivalent safeguards, and must not market this as strictly atomic consent withdrawal.
- **Children's processing:** supplying `subjectAssurance`/guardian evidence is a trusted-operator assertion. PTF does **not** independently perform Rule 10 verifiable parental-consent/guardian-identity checks, and does not implement all exceptions.
- **Enforcement diagnostics:** `privacy verify` can verify local encrypted stores and configured reference-host input, and reports gated, denied and uncovered paths. It cannot attest that a running external process is executing the privacy wrapper. Operators must prove the actual tool/provider boundary with end-to-end tests and deployment logs.

See [DPDP profile](../privacy/dpdp.md) for a precisely scoped operator setup and legal source links.
