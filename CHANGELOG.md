# Changelog

All notable changes to this project are documented here, Keep-a-Changelog
flow: land work under `## [Unreleased]`, move it to a versioned section on
release day. This project adheres to Semantic Versioning.

## [Unreleased]

> Release state (honest): the `v0.1.0` tag (2026-09-12) predates
> `v0.1.0-rc.1` (2026-09-14); `main` is ahead of both and unpublished
> (npm returns 404). Everything below ships on `main` only. The next
> version cut reconciles tags + changelog after peer review.

### Added

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

Backward-compatible, additive only: no breaking API changes to the existing
CLI/MCP surface or `src/api.ts` — except the documented behavior change
that proposals now survive restarts (ADR-0017; previously check → unknown
after restart).

### Fixed

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
