# Changelog

All notable changes to this project are documented here, Keep-a-Changelog
flow: land work under `## [Unreleased]`, move it to a versioned section on
release day. This project adheres to Semantic Versioning.

## [Unreleased]

### Documentation

- Repaired onboarding and documentation regressions: the first-run path now starts from a source checkout rather than an unpublished registry package, creates the keystore passphrase file before using the operator CLI, supplies tested-against-source CLI flags and examples for Bash and PowerShell, and corrects stale CLI/MCP/host-kit help and verification links.

- Clarified that DPDP-informed processing is an optional PTF use case, not the product's identity. Added cross-domain use-case navigation; labelled reference scripts as synthetic and host CLI conformance as reference-only; removed stale launch-post navigation. No runtime or API change.

> Release state (honest): the `v0.1.0` tag (2026-09-12) predates
> `v0.1.0-rc.1` (2026-09-14); `main` is ahead of both and unpublished
> (npm returns 404). Everything below ships on `main` only. The next
> version cut reconciles tags + changelog after peer review.

### Added

- Consolidation candidate: explicit `createProtectedEffect` Host Kit path with optional, host-composed processing enforcement and a compatibility adapter for the existing privacy-required `createEffectBoundary`. Added a trusted-host local recipient-proof helper and a synthetic `/email/send` reference; examples now execute under smoke-tested proofs. Generic MCP effect redemption remains intentionally unsupported until journal-first recovery and host action registration can be verified.

- The host kit: `createEffectBoundary` is the one call that puts the authority and privacy gates around an effect in the right order (authority first and non-consuming, then the privacy preflight and the live recheck, then the evidence precommit, then the authority consumption and its durable CAS, then the privacy fence at the effect boundary, then the effect, then the finalisation as `SUCCEEDED`, `FAILED_FINAL`, or `OUTCOME_UNKNOWN`). `runHostConformance` is nine checks, each one a rule, each one observed against a real encrypted store, so a host can prove in CI that its own agent paths enforce the controls. `ptf host-conformance` runs the same suite from the operator surface and exits non-zero when a check fails. The kit ships on the `./hostkit` subpath.
- Two HTTP provider transports that speak real protocols: `createHttpProvider` signs a canonical JSON body and posts it to any REST endpoint (the credential stays in the host's `sign` callback), and `createX402Provider` speaks the x402 HTTP 402 flow at Protocol Version 2 (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`). The x402 amount is in the asset's atomic units and the core spec does not define the decimals, so the host supplies the exact authorised amount and the adapter compares it for equality and never converts units. It refuses before settling anything when the challenge asks for more than the user authorised, or when the network, scheme, or signed value differs from the approved terms. Both ship on the `./adapters/http` and `./adapters/x402` subpaths and are tested against a real local HTTP server.

- P3P wire-shape alignment (SDK 1.3.0): `normalizeP3pReceipt` maps real
  `decodeReceipt` output (`status`/`reference`/`settlement`/`challengeId`/
  `timestamp`/`paymentMethod`) to PTF terms, dropping `paymentGateway`
  and unknown fields; `verifyP3pReceipt` binds amount/currency/challenge
  plus method-when-present, with resource/merchant binding transitive via
  the server-issued `challengeId` (genuine receipts carry neither —
  comparing host-supplied copies was theater); `CREDIT_EMI` accepted,
  `Crypto` rejected; executor seam gains `paymentMethodReferenceId` and
  documents pending-poll + unknown-outcome duty. Runbook now maps exact
  SDK calls; README lists P3P on the protocol edge.
- PDP observability (G13): unauthenticated `GET /metrics` beside the
  health probes — in-memory decision counters (`allow` + per-reason
  `deny` keyed by the closed `AUTHORITY_DENY_REASONS` vocabulary, never
  caller content) plus a read-only execution-states/backlog scan. Probes
  log nothing and need no auth; counters reset on restart (signals, not
  audit). Sentinel-tested: caller canaries never surface in the body.
- Empirical benchmark harness (G14): `npm run bench` (`scripts/bench.mjs`,
  `--n`, default 100) reports env-stamped min/p50/p95/p99 rows for
  capability CHECK (sequential + x8 concurrent), REDEEM, receipt building,
  fake-provider round-trip, and authority persist. CI asserts row shape
  only (`tests/bench.test.ts`) — never thresholds; numbers are local
  same-box comparisons, not SLOs.
- Durable presentation-nonce replay protection (G11): `ptf_present_data`
  records every presentation nonce in the durable `FileReplay` set
  (`nonces.json`) and denies repeats as replay — restart no longer launders
  a replayed nonce. Check-then-record runs before vault/keys
  (burn-before-deliver: a crash between record and presentation burns the
  nonce, never grants a second presentation — retry with a fresh nonce);
  entries prune past a 600s window covering the verifier maxAge default.
- Human approval surface, slice 1 (G6): deterministic LLM-free operator
  loop over the MCP proposal queue — `ptf review [--digest]` (sanitized
  rendering via the existing approval presenter; terminal-control smuggling
  stripped), `ptf approve --digest [--ttl-s]` (mints one one-time
  exact-terms approval, `appr-<digest>`, one use, persisted + audited; the
  proposal stays pending so the agent flow continues against the new
  authority), `ptf deny --digest` (veto; mints nothing; refuses to stand
  next to a live approval and directs to `revoke`). No keys required;
  unknown/expired/corrupt/tampered proposals fail closed with distinct
  errors. Store `readRecord` now lets ENOENT propagate as absence instead
  of misreporting missing files as corrupt.
- Execution/authority crash integration (review High finding):
  `ptf_redeem` routes through `executeWithJournal` keyed on
  proposal-anchored identity (`termsDigest` + provider scope, surviving
  remints); crash between provider effect and proposal transition
  reconciles to the same receipt instead of resubmitting (proven by a
  red-then-green crash matrix incl. SIGKILL restart and revoke-remint
  deny); reconcile adoption passes provider attestation; reconcile
  queries are read-only by contract (one submit + N queries); journal
  capped at 5000 records with named repair.
- Authenticated multi-agent ingress (ADR-0023, Phase 5): operator-managed
  agent registry (`agents.json`, CAS-guarded, `ptf agent` CLI) plus
  claimant-bound challenge/response session proof (`ptf_authenticate`
  tool); MCP server keeps fixed-identity mode and adds registry mode
  (env actor verified against the registry, or signature-bound sessions
  with rotation-invalidating key pins; removal effective on the next
  call); redeem re-asserts proposal identity and re-derives the digest
  (no cross-agent redemption); replaceability proven over stdio (Agent B
  inherits the same grant after Agent A is removed, authority never
  copied); backup unit extended to agents/nonces/executions/SQLite;
  adversarial review findings fixed before merge.
- Transactional persistence decision (ADR-0022, Phase 4):
  `src/store/repositories.ts` (Authority/Proposal/Execution/Replay/Audit
  seams, file behavior as the shape contract) plus a bounded SQLite WAL
  experiment for the execution journal (`src/store/sqlite.ts`, built-in
  `node:sqlite`, no new dependency): conditional-UPDATE transitions,
  transactional file→SQLite migration and staged SQLite→file export
  (sources never deleted), parity suite running journal behavior against
  both backends; file stays the default, SQLite opt-in; adversarial
  review findings fixed before merge.
- Durable execution journal (ADR-0021, Phase 3): `src/store/execution.ts`
  (file-per-execution records, strict transition map, derived
  idempotency keys, key-idempotent create, persisted retry budget,
  explicit abort, restart recovery) plus journaled orchestrator
  `executeWithJournal` (re-entrant by key, idempotent replay, query-first
  reconcile to SUCCEEDED / safe same-key retry / RECONCILED quarantine,
  never blind retry; attestation failures reconcile rather than hide;
  fixed-vocabulary errors and bounded external refs); adversarial review
  findings fixed before merge.
- P3P review hardening: challenge expiry is now digest-bound
  (`p3pExpiresAt` in operation context) and re-enforced at demand mapping
  and receipt verification; adapter error strings and receipt failure
  reasons use fixed vocabulary (no caller-input echo, no exception-text
  sink); canaries extended to mutate-after-CHECK authorize denials and a
  full redeem→receipt→audit round-trip scanned for sentinels; Research
  navigation fully removed (page stays unlisted); host reference
  `examples/p3p-sandbox-host.mjs` verified against the real
  `p3p-client-sdk@1.3.0` shapes plus manual runbook
  `docs/audit/p3p-sandbox.md`; `docs` CI job now a required branch
  protection check alongside `gate`/`secrets`.
- Build hygiene: `prebuild` removes `dist/` before every `tsc` build so
  stale compiled tests from other branches can never pollute `npm test`
  (previously a dirty `dist/` ran phantom suites and failed the gate).
- P3P evidence-only adapter (ADR-0020, Phase 2): `src/adapters/p3p.ts`
  normalizes SDK-decoded challenges (paise amounts, route-path resources,
  `RESERVE_PAY`/`OTM`/`CARD`), maps them to identity-free `/pay` demands
  with challenge+method digest binding, and verifies `Payment-Receipt`
  bindings with replay/staleness guards; credentials stay behind the
  host's `P3pProtectedExecutor` (official SDK, trusted env only), proven
  by sentinel canary tests; full denial matrix green; live UAT runs are
  env-gated, never in CI.
- Production Architecture v1 ADR (ADR-0019, Phase 1): Personal Authority
  Node target with nine components (authority engine, protected state,
  ingress authentication, execution orchestrator, protocol adapters,
  provider connectors, audit/receipts, key provider, trusted human
  surface); core-ignorant edge, evidence-only adapters, verified-transport
  ingress, journal-before-rail ordering; SaaS explicitly deferred.
- Docs build stabilization (Phase 0): removed the custom
  `docs/assets/css/just-the-docs*.scss` cycle residue — the single stable
  docs configuration is now the `just-the-docs` theme gem with
  `color_scheme: dark` and no custom SCSS; dropped the dead `research`
  Jekyll collection and the removed-notebook links from `docs/research.md`
  and `docs/_data/navigation.yml`; normalized the docs product description;
  added a required `docs` CI job (`bundle exec jekyll build`) so
  docs-touching changes cannot merge on a broken site build.
- Public-surface minimization: removed internal research notebooks, vendor-specific coding-agent skills, local ticket/loop documentation, and internal audit/project journals; hardened ignore rules for operator state, credentials, generated evidence, and editor/agent state; public verification and audit docs are self-contained.

- Exact-operation authorization, hardened (ADR-0018): CHECK ≠ REDEEM ≠
  EXECUTE — `check()` dry-runs and can never execute (type-level and
  runtime); only `redeem()` yields an executable `Redemption`. Provider
  context must deep-equal authorized args (telemetry rides an explicit
  `metadata` bag); `executeProtectedAction` owns reload → consume → CAS
  save → use → execute for effectful secret use; vault records may carry
  resource addresses; `createApproval` folds external bindings;
  authority ids are global and immutable; x402/AP2 translators are
  identity-free; PDP keys reject duplicate secrets.
- Brand: Authority Manifest v1 (#22, separate session): protected README
  region + brand assets + `check:brand` gate (docs/brand/BRAND.md).
- Old-defect fixes: PDP hot-reload retains last-good keys, true IP-pinned
  connects, `expectedNonce` verification, strict exclusive→inclusive
  attenuation, same-type vault ambiguity fails closed, live-grants-only
  capabilities, staged-DEK rekey reuse, backup consistency-checkpoint
  wording.

- Production operations (#13, #14, previously unlisted): shippable runtime
  tarball (narrowed file set), container image (non-root, read-only),
  PDP per-key scopes with hot-reload rotation and the single-replica rule,
  health signals, install hygiene.
- Review hardening (#16): `VaultStore` raw reads private behind gated
  `disclose`/`useSecret`; `ptf_list_capabilities` filtered by fixed
  identity; `vault-put` file-only; explicit receipt terms; shared
  validators; `CONTEXT.md` Vault/Provider glossary.

- `ptf backup` / `ptf restore` (`src/store/backup.ts`): the operations
  runbook enforced in code — backup copies the store as one unit
  (authority, registry, vault, keystore, audit, proposals) plus an
  `anchor.json` checkpoint, refusing non-empty destinations, destinations
  inside the store, and passphrase files living inside the store; restore
  copies over a fresh directory only (never merges) and verifies chain,
  store loads, and anchor match. Missing anchors restore point-in-time
  with a warning.
- Encrypted Personal State vault (ADR-0016): `personal-state.json` is now an
  AES-256-GCM envelope (v2) under a keystore-held DEK (`ptf/vault-dek`).
  Legacy plaintext files are refused at load and save; one-time
  `ptf vault-migrate` seals them (destroy old plaintext backups by hand).
  `ptf vault-rekey` rotates the DEK; `ptf rekey` still rotates the
  passphrase. `audit --verify` needs the passphrase when a vault file
  exists. Backups hold ciphertext + DEK together — protect backup media.
- MCP disclosure delivery: new `ptf_present_data` (holder-signed
  presentation for a pending `/disclose` proposal; fresh 16+ nonce,
  single-present, verifier enforces nonce/freshness). `ptf_request_data`
  proposes, `ptf_present_data` delivers — the agent loop is now end to end.
- Secret-use orchestrator `executeWithCredential` (adapters/providers):
  `useCredential` + `executeViaProvider` in one receipt-bound step; built
  requests are scanned for distinctive secret renderings before submission,
  and receipts are leak-checked (short-scalar residual documented in
  `docs/audit/limits.md`).
- Durable Personal State vault (`src/store/vault.ts`, exported from
  `src/index.ts`): purpose/agent/expiry/sensitivity-scoped records in
  `ptf-store/personal-state.json` (encrypted envelope, revision CAS);
  authority-first reads (`readForPurpose` over `/disclose`) plus use-only
  secret path (`useCredential`, receipt-only, verbatim + canonical leak
  guard); raw record access is host-only `private`; audit carries ids only.
- General agent contract (`src/profiles/data.ts`): `requestData`
  (`/disclose` dry-run) and `requestExecution` (any `/-path` except
  `/disclose*`, dry-run, never consumes uses or mints authority).
- MCP tools `ptf_request_data`, `ptf_present_data`, `ptf_request_action`,
  `ptf_get_receipt`,
  `ptf_list_capabilities` (fixed-identity only: foreign-principal,
  other-agent, and revoked grants excluded), `ptf_revoke` (request-only,
  mutates nothing). `ptf_redeem` stays `/pay`-only and accepts any `/pay`
  proposal in the shared store. No approve tool (unchanged).
- Protected provider seam (`src/adapters/providers.ts`): per-kind fakes
  (`makeFakeProviders`, move nothing) plus `providerAsExecutor` /
  `executeViaProvider` with `chainId === capabilityId` and `termsDigest`
  binding; rail results stay evidence via the `x402`/`ap2` verifiers.
- Durable proposals (ADR-0017, amends ADR-0014): one file per termsDigest
  under `proposals/` (O_EXCL create, TTL GC, last-writer-wins transitions
  under single-writer topology) — restart preserves pending/denied/executed;
  the digest is the idempotency key
  (re-propose returns stored; executed immutable; denied re-opens on fresh
  allow). Recipient challenges stay in-memory (live key material).
- DPDP privacy-enforcement architecture (ADR-0024): privacy is a narrowing layer beside Authority, with Processing Basis Evidence kept separate from Personal/Authority State; PTF Principal is distinct from an opaque Privacy Data Principal Reference; legal sufficiency stays external evidence and privacy mode remains explicit/backward-compatible. Implementation proceeds in verified slices.
- DPDP privacy-enforcement mode (reference host): encrypted privacy state and Processing Events, operator CLI (`ptf privacy ...`), configured MCP gates for `ptf_request_data`, `ptf_present_data`, `/pay` propose/redeem, and fail-closed denial of generic `ptf_request_action`; retention holds and subject-bound exact-record erasure; rights summary with current consent state and record eligibility; operator correction evidence recorded after a versioned vault correction; offline recovery that adopts only journal-proven outcomes. The supported library surface is the curated `./privacy` subpath (`src/privacy/api.ts`); file-backed privacy stores remain internal and are covered by exact, file-scoped seam exemptions. Operator JSON is validated fail-closed (including `active`, basis kind, subject selector and recipient roles), and holds block matching records regardless of `--subject-ref`. Known boundaries remain documented in `docs/audit/limits.md` (notably the non-atomic withdrawal race, the 5,000-event file-store scan cap, missing event-store CAS, legacy unbound vault records, and operator CLI/provider adapters outside the reference host).
- Journal-first payment recovery (reference MCP host): a retry of the same exact `/pay` terms now consults the execution journal before any live-authority preview, challenge, or consumption. A conclusive `SUCCEEDED` record returns the same external receipt, finalizes the Processing Event idempotently (reconstructing a missing event from the still-valid privacy decision, reporting a terminal event conflict as `evidence_conflict`), and repairs the proposal to `executed` - no second effect, no second authority use, no new recipient proof. A live, reconciled, corrupt, or field-mismatched record is ambiguous: no challenge is issued, no authority is consumed, and the agent is told to reconcile the journal. `ptf_check` and `ptf_get_receipt` are journal-aware.

Backward-compatible in shape: the existing CLI/MCP surface and `src/api.ts`
keep their command set, tool set, and root exports. The behaviour changes in
this release are enumerated in `### Changed` below — they are not silent
additions, and each one is listed there with its trigger.

### Changed

- Privacy evidence now distinguishes attempt identity: `/pay` binds the terms digest, `/use` defaults to a fresh UUID with optional caller retry reference, and `/disclose` hashes the verifier nonce. A terminal Processing Event can no longer start a new external effect; the runtime refuses and points to journal reconciliation.
- Vault records can carry an immutable opaque `dataPrincipalRef` (`vault-put --subject-ref`). Erasure plans only records bound to the requested subject and marks legacy/unbound records `unscoped`; `erase apply` refuses unbound or held records and re-plans immediately before deletion. Summary reports `not-computed` rather than a false empty eligibility list when no owner/holds were supplied.
- Correction evidence now runs through the DPDP processing engine (`/correct` activity, active basis, subject/owner binding) and requires an opaque `--request-ref` plus `--previous-version` proof that the record version advanced by exactly one.
- `privacy events reconcile` now matches the journal on exact terms, action, resource, purpose and single destination, refuses duplicate terminal rows, no longer keys on caller-chosen attempt refs, and supports explicit `--include-unknown` revisiting. Each adopted outcome is individually audited.
- Reference MCP privacy mode now maps privacy-store/journal failures to a generic `privacy denied` (no store paths, DEK ids or journal detail), lists `ptf_request_action` as denied, and corrects the presentation notice to say it consumes one authority use.
- Backup restore now refuses a pre-release backup containing `privacy-events/` without a privacy-events manifest instead of restoring unmanifested events on trust.
- A `/pay` retry now recovers a journaled success before asking for a challenge: the receipt comes back directly, no authority use is spent, and no second recipient proof is required. An unsettled journal is reported as `outcome_unknown` before any challenge is issued, so a blind retry can no longer burn an authority use.
- MCP tool inputs are now bounded, **including when privacy mode is disabled**: `termsDigest` must be exactly 64 hex characters (previously any string of 16+ characters), `recipientKeyHex`/`recipientSigHex` must be exact-length hex, `purpose`/`resource`/`recipient` are capped at 500 characters, `currency` at 16, `claims` at 50 items, `nonce` at 512, and `ptf_request_action` context at 16 KiB. Valid terms, digests, keys, and signatures are unchanged; malformed or pathological agent input is now rejected at the schema instead of reaching the engine. Rationale and the "no new authority semantics" boundary are recorded in ADR-0024 and the design note in §7.6; the operator-visible contract is in `docs/mcp-contract.md`.
- The operator CLI now rejects `--path` for `ptf privacy ...`: the privacy subcommand is positional and validated up front, so a flag can no longer re-target a different operator action.
- The agent-facing payment vocabulary gains `not_submitted`: the execution journal shows a prepared but never submitted attempt, so no money moved, and the authority use for that attempt was already spent. The instruction asks for a new grant and new terms instead of silently retrying the same terms.
- Privacy processing is now fenced at the effect boundary: the disclosure, the protected use, and the payment re-read the privacy state immediately before the effect (after the authority use is burned), so a consent withdrawal that lands after the recheck stops the attempt instead of processing anyway. The attempt is a provable pre-effect failure - the evidence is `FAILED_FINAL`, no claim is released, and no provider is called.
- The encrypted Processing Event store is indexed: `findByKey` resolves the event file directly from the idempotency key, and `findByAttempt` uses a sealed attempt cache. A missing, stale, tampered, or rotated-away cache is a cache miss and the lookup falls back to the full scan, so the index can never hide an event. The 5,000-record ceiling and the per-record encryption are unchanged.
- The store layer now has one DEK resolution rule and one revision rule (`resolveSealedDek`, `nextStoreRevision`) instead of one copy per store. Behaviour, error vocabulary, and the file/SQLite parity suites are unchanged.
- ADR-0025 records the enforcement boundary: privacy enforcement is per-host, explicit, and composed at the effect boundary. PTF is a library, not an interceptor - a host that composes `PrivacyRuntime` is enforced for its own effects, a host that does not is uncovered (never compliant), and coverage is reported, never attested.

### Fixed

- The two HTTP provider transports, after an independent security review:
  the x402 transport now binds the challenged **asset** and **payee** to
  the authorised terms (`authorizedAsset`, `authorizedPayTo`, and the
  challenged `resource` are required options, a challenge naming another
  asset, payee, or resource is refused before anything is signed, and the
  wire payload always carries the authorised asset and payee rather than
  the server's), and the settlement is accepted fail-closed — `success`
  must be true, the transaction must be there, the network must be the
  authorised one, and the payer and amount must match when the server sent
  them — and is handed to the host through `onSettlement` for the
  independent `checkSettlement`. Both transports now apply the seam's own
  `checkRequest` on the direct-call path, refuse host headers that carry
  CR/LF, a colon in a name, an over-long name or value, `host`,
  `content-length`, `transfer-encoding`, `connection`, or a
  `content-type`, send `Idempotency-Key` (the terms digest by default),
  default to a 30s deadline with a 1 MiB response cap, require an `https:`
  endpoint unless the host sets `allowInsecureHttp`, strip control
  characters from server strings before they reach an error message, and
  accept a v1 challenge body (`paymentRequirements`, `maxAmountRequired`)
  without rewriting the version marker. `settle` signs and returns the
  authorization only — it never broadcasts and never moves value.
- Authority hardening (independent review batch B): `/pay*` standing grants
  now require one exact `.context.currency == "<ISO>"` bound alongside the
  amount ceiling (add-time throw; wrong-currency demands denied at
  evaluate; pre-guard currency-less snapshots throw at restore);
  capability `redeem()` fails closed when `resource`/`purpose` is absent
  (dry-run `check()` stays lenient by design); `revoke(policyId)` now
  throws instead of recording an unenforced revocation — policies retire
  via `disablePolicy()` (immediate, permanent, snapshot-audited, restore
  safe); `ptf_present_data` responses carry an explicit read-only /
  not-a-payment-authorization notice for display layers.

## [0.1.0-rc.1] - 2026-09-14

First release candidate: user-owned trust and delegated-authority layer
for the agentic web (PTF v0.1).

### Added

- Domain-neutral `Authority` engine (`evaluate(operation, ingress)` with
  `VerifiedIdentity`; digest by construction; `exact`/`set`/`any` actor
  selectors) — ADR-0010, ADR-0013.
- Standards edge: AuthZEN 1.0 evaluation profile, RFC 8693/9396/8707/9449
  OAuth-agent attenuation, SD-JWT/KB-JWT evidence translator, audit
  interop projection — ADR-0009.
- Operator surface: `ptf` CLI (init/keygen/rekey/recipient/grant/pay/
  disclose/audit/revoke), MCP stdio server (fixed identity, propose/check/
  redeem), production PDP bin (TLS-required, key allowlist, per-key rate
  limits, read-only evaluation).
- Durability: JSON stores with optimistic revision CAS, audit freshness
  binding against rollback, scrypt+AES-GCM keystore with passphrase
  sourcing (env/file/TTY) and rotation — ADR-0014, ADR-0015.
- Release automation: SLSA Build L3 provenance + CycloneDX SBOM on `v*`
  tags, Scorecard, TruffleHog verified-secrets scan.

### Security

- See `THREATMODEL.md` v2 (open gaps stated with mitigations) and
  `docs/audit/` (auditor entry). Report vulnerabilities privately via the
  GitHub Security tab, never in a public issue.

[Unreleased]: https://github.com/Binilts03/personal-trust-fabric/compare/v0.1.0-rc.1...HEAD
[0.1.0-rc.1]: https://github.com/Binilts03/personal-trust-fabric/releases/tag/v0.1.0-rc.1
