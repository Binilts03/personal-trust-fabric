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
- `executeAndReceipt` cannot prove freshness — consumption persists BEFORE
  executing in both bins (ticket 05), so a crash or failing rail between
  persist and execute burns a use without a receipt (safe direction: the
  retry denies `uses-exhausted`, it never double-spends). Redeem
  immediately before executing all the same; live rails stay host duty.
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
  owner sign in `operations.md`).
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
  Production: implemented via `fetchWithPinning` — per-hop DNS lookup +
  `isBlockedIp` fail-closed + manual-redirect re-check, no-follow by
  default (proof: `tests/host-network.test.ts`); egress proxy
  accepted-risk — single-operator direct fetch with reputable DNS,
  proxy recommended for high-value hosts (owner sign in `operations.md`);
  lookup-then-connect TOCTOU residual stated in code.
- JWS: strict-b64 helper available (`b64uDecodeStrict`); legacy lenient
  decode retained where verification uses decoded bytes (fail-closed).
  Production: implemented — strict helper for new paths, lenient retained
  only where verified bytes are compared (proof: `tests/jws.test.ts`).

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
