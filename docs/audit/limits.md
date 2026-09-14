# Known-limits register (honest boundaries)

These are deliberate v0.1 ceilings, not bugs. Each is documented in code and
tested at the boundary.

## Authority / execution

- `FakePaymentExecutor` moves no money. Real PSP wiring is out of scope.
- Single-writer discipline with enforced CAS: authority/registry files carry
  a `revision` bumped atomically with the data; a stale handle's save fails
  closed ("changed under us — reload and retry") instead of last-write-wins,
  so concurrent redeems cannot double-spend. Fresh instances may only create
  a missing store, never overwrite one they never loaded. One server per
  store is still the supported topology; the CAS is the backstop, and audit
  forks (concurrent appends) fail loudly at next chain verify, never silently.
- In-memory MCP proposals/challenges: lost on restart (fail-closed →
  `unknown`, propose again). Receipts survive in `audit.jsonl`.
- Audit is tamper-evident (hash chain, opt HMAC), not independently anchored.
  Third-party verifiability needs external anchoring (ADR-0006).
- Rotation is a hard cutover: re-issue under the new key before revoking the
  old; in-flight caps bound to the old key fail closed.
- `executeAndReceipt` cannot prove freshness — redeem immediately before
  executing (documented at the function).
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

## Adapters (evidence-only subsets)

- x402: `scheme ∈ {exact, upto}`, atomic-unit amounts, `network` namespaced.
  `asset/network` must be folded into the caller's `termsDigest` (helper
  `requirementMatches` + `expectedAsset/Network/ResourceUrl`); authority has
  no asset/network columns. Settlement amount/asset expectations are opt-in
  per call — pass them.
- AP2: known open-constraint shapes enforced (`amount_range`,
  `allowed_payees`, `allowed_merchants`); any other constraint fails closed
  as `unresolved_constraint` → fall back to human-present. `checkout_jwt`
  requires `exp`. Autonomous requires `expectedNonce`. KB requires
  `typ:kb+jwt` + `iat`.
- OpenID4VP: `client_id` prefixes shape-checked only (x509/DID/attestation
  crypto deferred); `response_mode ∈ {fragment, direct_post}`; nonce min 16;
  top-level DCQL paths only; `claim_sets` rejected; mdoc rejected;
  `transaction_data_hashes` equality only when `expectedTransactionData`
  supplied; replay store is host-owned (nonces checked for equality here).
- MCP: audience + token-separation + redirect-registry only. Per-client
  consent, PKCE, single-use state, cookie binding, minimal scopes are host
  duties. `register` is operator-privileged.
- WebMCP: `consequentialHint` is self-attested — a lying tool can omit it.
  Hosts must gate irreversible effects independently. Private-literal origins
  blocked; DNS-pinning still required for names.
- A2A: JCS subset (plain JSON, safe integers, lone surrogates rejected; full
  RFC 8785 normalization beyond that rejected). `jku` rejected. Card/key
  expiry + revocation + HTTPS-fetch are host `resolve` duties.
- URLs: hostname-string checks only. DNS-rebinding and redirect-to-private
  require fetcher-side pinning + no-follow-or-recheck + egress proxy.
- JWS: strict-b64 helper available (`b64uDecodeStrict`); legacy lenient
  decode retained where verification uses decoded bytes (fail-closed).

## Crypto / platform

- `atomicWrite` fsyncs best-effort; Windows rename is not atomic-replace.
  Torn-write window is minimized, not eliminated — keep backups of
  `ptf-store/` for high-value deployments.
- `scryptSync` blocks the event loop per open; MCP `load()` does it per call.
  Fine for operator scale, not for high-throughput servers.
- Secrets are never zeroed in-memory (JS cannot guarantee it); passphrase
  lives in env only, never argv/logs.
