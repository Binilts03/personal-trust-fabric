# Architecture brief (v0.1 + prod slice)

## Authority flow

```
proposal → Authority.evaluate(grants, approvals, policies)
  → allow-with-citation | deny
  → Capabilities.issue (root, Ed25519, nonce, revocationId)
  → Capabilities.attenuate* (child ≤ parent on cmd, pol, exp, nbf,
     maxUses, purpose, resource, recipient, termsDigest, amountMax,
     currency, claims)
  → Capabilities.authorize(chain, demand, {consume, proof})
     [shape → sigs → chain → expiry → revocation → cmd/pol →
      amount/currency/claims → recipient → termsDigest → uses → proof]
  → executeAndReceipt(executor, instruction, {ok:true, chainId})
     [chainId === capabilityId, else throw]
  → Audit.append → FileAuditLog (JSONL, canonical, hash-chained, opt HMAC)
```

`*` attenuation is `issue(parent, childReq)` with narrowing checks; there is
no lateral delegation.

## Modules

- `core/types`: `ptf/cap@0.1` payload (local-only `@internal` per ADR-0009 — never wire; interop uses the standards edge), `AuthorizeResult` (`ok+chainId` binds
  execution to redemption), no logic.
- `core/canonical`: sorted-key JSON, plain-objects only (Date/class/symbol
  rejected), finite numbers. All digests/CIDs derive from it.
- `core/crypto`: Ed25519 sign/verify, `randomHex`; fail-closed on bad lengths.
- `core/policy`: AuthZEN-shaped offline eval, Cedar precedence (forbid wins,
  then cited permit, else deny). Policy narrows only (ADR-0002).
- `core/capability`: `issue/authorize/revoke`, subtree use-budget, cascade
  revocation via `revocationId` links, recipient Ed25519 proof over leaf CID.
- `core/authority`: grants + one-time digest-bound approvals + constraints,
  citations on every allow, `snapshot/restore` for durability.
- `core/approve`: pure `renderProposal/parseDecision`; `\r\n\t`→space,
  ANSI/C0 stripped, NaN-expiry safe.
- `core/disclose`: `requested ∩ available ∩ allowed`, `Object.hasOwn` (no
  prototype leak), holder-signed KB analog, nonce recorded only after sig
  verify, `maxAgeSec` default 300s.
- `core/execute`: `FakePaymentExecutor` (no money moves), `Audit` with
  `ingest` validating shape+seq+prevHash+hash (forgeries throw at load).
- `core/identity`: alias → live key + history; rotation is a hard cutover
  (re-issue before revoking old); revocation retires the alias.
- `adapters/*`: fail-closed parsers + verifiers (see `limits.md` for subsets).
- `store/files`: `atomicWrite` (tmp+random+0600+fsync-best-effort+rename),
  single-writer ceiling, corrupt→throw, audit chain verified on open.
- `store/keystore`: scrypt N=16384/r=8/p=1 + AES-256-GCM single blob,
  params pinned, strict hex, passphrase from caller only.
- `cli.ts`: wiring over tested modules (manual argv, stdin/stdout, `--help`
  / `--version`, unknown-flag rejection, `init` no-overwrite).
- `mcp-server.ts`: official SDK stdio; `propose` (dry-run, status `pending`),
  `check` (TTL), `redeem` (dry-run → challenge → authorize-first → consume
  authority → save authority before audit). No approve tool by design.
  In-memory proposals/challenges (lost on restart, fail-closed).

## Invariants (test-enforced)

Child ≤ parent; recipient + termsDigest fixed; `/`-top, powerline
(`iss≠sub` root), immortal (`exp` required) rejected; policy-never-creates;
holder-bound disclosure; chainId-bound execution; secretness (no raw secret
in receipt/log/audit — sentinel-tested).
