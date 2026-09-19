# Architecture brief (v0.1 + prod slice)

PTF is a personal authority and protected-use layer for agentic systems:
a secure vault, authority engine, selective-disclosure broker, and protected
execution layer that lets agents complete tasks without possessing the user's
secrets. PTF is the source of truth for a person's authority and protected
agent access — not for external facts (balances, availability, settlement),
which stay authoritative in provider systems (ADR-0005 evidence, never
authority).

Three flows: (1) data disclosure — agent requests claims, PTF returns only
approved minimal values; (2) protected execution — agent requests payment/use,
PTF consumes authority + uses the instrument internally, agent gets a receipt;
(3) human approval — agent proposes exact terms, person approves/denies,
terms digest-bound.

## Authority flow

```
proposal → Authority.evaluate(grants, approvals, policies)
  → allow-with-citation | deny
  → Capabilities.issue (root, Ed25519, nonce, revocationId)
  → Capabilities.attenuate* (child ≤ parent on cmd, pol, exp, nbf,
     maxUses, purpose, resource, recipient, termsDigest, amountMax,
     currency, claims)
  → Capabilities.check(chain, demand) (dry-run: shape → sigs → chain →
     expiry → revocation → cmd/pol → amount/currency/claims → recipient →
     termsDigest → uses; no consumption, no proof, no chainId)
  → Capabilities.redeem(chain, demand, {proof}) (proof verify + consume →
     Redemption: chainId + exact operation echo + consumed + proofVerified)
  → executeAndReceipt(executor, instruction, redemption)
     [redemption flags + deep-compare instruction === authorized operation,
      else throw]
  → Audit.append → FileAuditLog (JSONL, canonical, hash-chained, opt HMAC)
```

`*` attenuation is `issue(parent, childReq)` with narrowing checks; there is
no lateral delegation.

## Modules

- `core/types`: `ptf/cap@0.1` payload (local-only `@internal` per ADR-0009 — never wire; interop uses the standards edge), `CheckResult` (dry-run, no chainId) vs `RedemptionResult` (consumed + proofVerified + exact operation echo — the only executable value), no logic.
- `core/canonical`: sorted-key JSON, plain-objects only (Date/class/symbol
  rejected), finite numbers. All digests/CIDs derive from it.
- `core/crypto`: Ed25519 sign/verify, `randomHex`; fail-closed on bad lengths.
- `core/policy`: AuthZEN-shaped offline eval, Cedar precedence (forbid wins,
  then cited permit, else deny). Policy narrows only (ADR-0002).
- `core/capability`: `issue`/`check`/`redeem`, subtree use-budget, cascade
  revocation via `revocationId` links, recipient Ed25519 proof over leaf CID.
  CHECK ≠ REDEEM ≠ EXECUTE (ADR-0018): `check` dry-runs (no consumption, no
  proof, no chainId) and can never execute; only `redeem` yields an
  executable `Redemption` (consumed + proofVerified + exact operation echo).
- `core/authority`: grants + one-time digest-bound approvals + constraints,
  citations on every allow, `snapshot/restore` for durability (revision CAS
  - audit freshness binding per ADR-0015).
- `core/approve`: pure `renderProposal/parseDecision`; `\r\n\t`→space,
  ANSI/C0 stripped, NaN-expiry safe.
- `core/disclose`: `requested ∩ available ∩ allowed`, `Object.hasOwn` (no
  prototype leak), holder-signed KB analog, nonce recorded only after sig
  verify, `maxAgeSec` default 300s.
- `core/execute`: `FakePaymentExecutor` (no money moves), `Audit` with
  `ingest` validating shape+seq+prevHash+hash (forgeries throw at load).
- `core/identity`: alias → live key + history; rotation is a hard cutover
  (re-issue before revoking old); revocation retires the alias.
- `core/persona`: `PersonalState` → task-scoped `PersonaCapsule` allow-list
  projection + `AgentView` (capsule + proposals + receipts, never raw state).
- `core/signing`: `SigningExecutor` parity with payment execution — bound
  redemption, receipt without key material.
- `adapters/*`: fail-closed parsers + verifiers (see `limits.md` for subsets).
- `store/files`: `atomicWrite` (tmp+random+0600+fsync-best-effort+rename),
  optimistic revision CAS (stale-handle saves fail closed, fresh instances
  may only create), corrupt→throw, audit chain verified on open.
- `store/backup`: `backupStore`/`restoreStore` — one-unit copies plus
  `anchor.json` checkpoints; never merges; passphrase-in-store refused.
- `store/challenges`: durable proposals, one file per termsDigest (O_EXCL
  create, TTL GC; ADR-0017).
- `store/anchor`: Merkle-root checkpoints + O(log n) inclusion proofs over
  the audit log (local anchor file, no witness network).
- `store/keystore`: scrypt N=16384/r=8/p=1 + AES-256-GCM single blob,
  params pinned, strict hex, passphrase from env/file/TTY-prompt only
  (`readPassphrase`), rotation via `resealKeystore`/`ptf rekey`,
  best-effort `zeroize` (JS erasure limits documented).
- `store/vault`: durable Personal State (`personal-state.json`, revision CAS):
  purpose/agent/expiry/sensitivity/resource-scoped records; `disclose` evaluates
  authority before selecting non-secret claims; protected secret use is available only
  through the gated use path and store-backed execution orchestration.
- `profiles/data`: general agent contract (`requestData` for `/disclose`,
  `requestExecution` for actions) — thin over `evaluate` + derived digest +
  `renderProposal`; never mints authority.
- `profiles/payment`: payment conventions + helpers (`paymentBounds`,
  `recipientBounds`), no policy language, no I/O.
- `adapters/providers`: protected provider seam (payment/travel/retail/email/
  identity fakes + `providerAsExecutor`/`executeViaProvider`); PTF owns policy,
  consent, secret-handling, receipts — rails stay host duty.
- `cli.ts`: wiring over tested modules (manual argv, stdin/stdout, `--help`
  / `--version`, unknown-flag rejection, `init` no-overwrite).
- `mcp-server.ts`: official SDK stdio; `propose` (dry-run, status `pending`),
  `check` (digest), `redeem` (check → challenge → proof-verified redeem → persist consumed
  authority before effect; `/pay`-only) plus the general
  contract (`request_data`/`request_action` dry-runs, `present_data`
  holder-signed delivery, `get_receipt` by digest,
  `list_capabilities` read-only, `revoke` request-only). No approve tool by
  design. Proposals durable per termsDigest file (ADR-0017, idempotent,
  immutable executed); recipient challenges in-memory (lost on restart,
  fail-closed).
- `pdp-server.ts`: reference HTTP PDP bin over loopback/TLS (scopes,
  hot-reload rotation, single-replica rule, redaction-tested decision logs).
- `api.ts` / `index.ts`: curated named-entry vs full barrel (ADR-0011);
  tests import the barrel, bins are exempt.

## Invariants (test-enforced)

Child ≤ parent; recipient + termsDigest fixed; `/`-top, powerline
(`iss≠sub` root), immortal (`exp` required) rejected; policy-never-creates;
holder-bound disclosure; exact-operation execution (CHECK ≠ REDEEM ≠
EXECUTE; instruction deep-equals authorized terms); secretness (no raw secret
in receipt/log/audit — sentinel-tested).
