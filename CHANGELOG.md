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

- Travel domain profile (M7, ADR-0020): `src/profiles/travel.ts`
  (`travelBounds` + `/travel/book` conventions over
  `executeActionViaProvider`, domain-neutral receipts; exact-date only —
  string ranges would never match numeric `<=`). Exported at
  `personal-trust-fabric/profiles/travel`. Proof: `tests/travel.test.ts`.
- P3P interop (M5A, ADR-0019): thin `src/adapters/p3p.ts`
  evidence translator (host-decoded challenge → identity-free `/pay`
  demand in paise; challenge expiry enforced at mapping with required
  `nowSec`; Grantex scopes as citation-only evidence; recorded
  receipt check). No SDK dependency, no network in-adapter, no core
  change; live sandbox capture + `402` retry benchmark stay host duty.
  Full denial matrix (over-grant, expired grant/challenge, wrong agent,
  revoked, mutated terms, CHECK-misuse, credential replay, tampered
  challenge, inconsistent receipt) plus secret-canary boundary tests.
  Proof: `tests/p3p.test.ts` (13 tests).
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
- Docs CI stabilization (Phase 0): removed the custom
  `docs/assets/css/just-the-docs*.scss` cycle residue (theme default +
  `color_scheme: dark` is now the single stable docs configuration);
  dropped the dead `research` Jekyll collection and the removed-notebook
  links from `docs/research.md`; normalized the docs product description;
  added a required `docs` CI job (`bundle exec jekyll build`) so
  docs-touching changes cannot merge on a broken site build.
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
