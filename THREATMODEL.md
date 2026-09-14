# Threat model — v2 (supersedes v0.1 skeleton)

## Assets

Principal secrets (payment instruments, signing keys, credentials), Authority State (grants/approvals), Personal State, capabilities in flight.

## Trust boundaries

1. Agent (untrusted, possibly injected) ↔ PTF authority plane (trusted, deterministic).
2. PTF ↔ recipient (authenticated via Identity Binding + Ed25519 proof before execution).
3. PTF ↔ external protocol (x402/AP2/OpenID4VP/MCP/A2A treated as evidence, never authority).
4. PTF ↔ human approver (digest-bound proposal; any term change = new approval).
5. Standards edge (`authzen`/`oauth-agent`/`sd-jwt`/`audit-interop` projections) ↔ `Authority.evaluate`: projections are evidence in, decision in `Authority.evaluate`.

## Attackers in scope

Prompt-injected agent requesting `pay attacker ₹100k`; malicious tool description / WebMCP output; substituted recipient key; replayed capability; oversharing verifier; compromised adapter; log scraper; `act` chain confusion; `aud` widening; trusting `ptf_digest` without recompute.

## Out of scope for v0.1 (partially SUPERSEDED by v2 below)

v0.1-skeleton language superseded: "Compromised OS/keychain" is now modeled in v2
(host-compromise blast radius: PTF guarantees nothing once the host falls).
Still out of scope: side-channels, independent audit anchoring (noted in ADR-0006), full AP2 Human-Not-Present flows.

## Must-hold properties

Default-deny; policy never creates authority; Personal State ≠ Authority State; child ≤ parent; expiry + maxUses enforced at redemption; `requested ∩ available ∩ allowed` disclosure; no secrets to agent or logs.

## Abuse cases to encode as regression evals

Replay, over-spend, expired use, wrong-recipient redeem, mutated termsDigest, verifier requesting 10 claims but allowed 2, MCP token-passthrough attempt, WebMCP description poisoning.
v0.1-skeleton language superseded where this file claimed skeleton/out-of-scope: the v2 sections below are now the record.

## v2 — host and store adversaries

- Local malicious process reading store files. Capability: same-uid process dumps `authority.json`/`registry.json`/keystore blobs. Mitigation: `atomicWrite` tmp+rename with `0o600`, corrupt/missing fails closed, keystore sealed with scrypt+AES-GCM. Gap: no at-rest ACL beyond file mode; any reader learns grants/approvals metadata and offline-attacks the keystore.
- `PTF_PASSPHRASE` extraction from environment. Capability: `/proc` scrape, crash dump, or child-process env inherit. Mitigation: passphrase lives in env only, never argv/logs; secrets never zeroed in-memory is documented. Gap: env is not a vault — any same-host reader or core dump recovers it, then unseals the whole keystore.
- Symlink/path attacks on store paths and file-CAS tmp files. Capability: pre-planted symlink at `authority.json` or predictable tmp name to redirect writes/reads. Mitigation: per-write random tmp suffix (`pid`+16 hex), `mkdir -p` on parent, fail-closed parse. Gap: no `O_NOFOLLOW`/`O_EXCL` or dir-fsync discipline; a writer following an attacker symlink can clobber an arbitrary path, Windows rename is not atomic-replace.
- Rollback of `authority.json`/keystore (replay of revoked grants, resurrected uses). Capability: restore yesterday's file to un-revoke or reset `used` counters. Mitigation: `used`/`revoked` persist in the snapshot and audit hash-chain shows the fork. Gap: no monotonic counter or external anchor — rollback is undetectable to a fresh loader, revoked grants and exhausted uses come back alive.
- Concurrent redemption races. Capability: two writers redeem the same single-use approval/cap simultaneously. Mitigation: optimistic revision CAS on authority/registry files — data + revision commit atomically, a stale handle's save throws fail-closed before any receipt, and fresh instances cannot overwrite stores they never loaded (`src/store/files.ts`, ticket 02; race tests in `tests/store.test.ts`). Residual: audit concurrent-appends fork loudly at next chain verify (never silently); Windows rename is not atomic-replace, so keep backups.
- TOCTOU between `Authority.evaluate` and `executeAndReceipt`. Capability: revoke/expire/pre-spend in the gap after allow, before money moves. Mitigation: documented "redeem immediately before executing"; consume-on-evaluate for single-use. Gap: no atomic evaluate-and-consume-and-execute primitive — freshness cannot be proven, only narrowed.

## v2 — client, snapshot, and leakage adversaries

- Malicious MCP client (oversized inputs, unknown proposals, challenge spam). Capability: giant payloads, unknown proposal ids, challenge-oracle polling. Mitigation: fail-closed `unknown` on missing proposals/challenges, in-memory proposals lost on restart, audience + token-separation checks. Gap: no size caps, rate limits, or per-client quotas in-core — DoS and store-growth are host duties.
- Stale authority snapshots restored after revoke. Capability: keep a pre-revoke `snapshot()` and `Authority.restore()` it later to decide. Mitigation: restore revalidates through live add-gates (bad bounds/actors still throw). Gap: revocation/usage live outside the snapshot — a stale copy decides as if the revoke never happened; freshness needs the live store, not a copy.
- Backup/log leakage (audit detail secret-freedom is a host obligation). Capability: backups, log shippers, or `audit.jsonl` copies exfiltrated. Mitigation: core never emits raw secrets to agent view/receipt/log; tamper-evident hash chain (+opt HMAC). Gap: `detail` strings and contexts are host-supplied — one interpolated PAN/key/secret poisons every copy; redaction is unenforced convention, and HMAC without anchoring still trusts the host clock/store.
- Host compromise blast radius (what PTF still guarantees: nothing). Capability: full host/RAM/file control post-compromise. Mitigation: none claimed — deterministic core gives no independent root of trust once the operator falls. Gap: total — grants minted, revokes suppressed, audit rewritten (absent external anchor), keys exported; recovery is re-provision from clean backups, not a PTF property.

## v2 — adapter-confusion attacks

- AuthZEN context smuggling (`termsDigest` echo, unknown keys). Capability: PEP stuffs `context.termsDigest` or colliding keys to forge binding. Mitigation: recovery strips the reserved echo and recomputes via `digestForOperation`; unknown envelope metadata (`subject.type`) ignored. Gap: every new context key is a future collision candidate — translators must keep the reserved-key list exact or smuggling recurs.
- OAuth `aud` widening. Capability: replay a token at a second resource server. Mitigation: v0.1 identical-only `aud` (any change throws), `scope` subset + depth/cycle caps. Gap: single-string `aud` with no audience registry — a host that skips `checkAudience` or shares one `aud` across services silently widens every token.
- SD-JWT `ptf_digest` trust without recompute. Capability: present a valid holder signature over tampered disclosed claims. Mitigation: verifier must recompute `ptf_digest` over the canonical disclosed set; mismatch fails closed. Gap: any verifier that compares the digest string instead of recomputing, or ignores salt/claim-set binding, accepts forged disclosures.
- AP2/x402 demand-shape mismatches. Capability: AP2 mandate or x402 requirement whose amount/asset/payee shape does not map 1:1 to a PTF demand (e.g. `ap2-payment` vs `flight` resource, `upto` vs `exact`, unconstrained payee lists). Mitigation: evidence-only adapters — unresolved constraints fail closed (`unresolved_constraint`), asset/network folded into caller's `termsDigest`. Gap: every new protocol shape is a silent-deny or, worse, a loose mapping that narrows less than the mandate — shape coverage is the audit surface.
- Reference HTTP PDP abused as production (dev-only `examples/pdp-server.mjs`). Capability: operator exposes the loopback reference without TLS, with a weak/shared API key, or against a multi-writer store. Mitigation: binds 127.0.0.1 only, refuses to start without ≥16-char key, per-request store reload, 1 MiB body cap. Gap: single API key with no rotation/scope, no rate limiting, no TLS in-process, last-write-wins races — production needs host-owned TLS, real PEP auth, and locking.
- Production PDP bin abused across instances (`src/pdp-server.ts`). Capability: stolen bearer key replayed at any replica, TLS mis-terminated (plaintext/CIDR-wide bind) exposing keys, request-body echo smuggling secrets into decision logs, RPM bypass by rotating across key ids. Mitigation: mandatory in-process TLS (plaintext needs an explicit flag), per-key timing-safe allowlist, per-request read-only reload (no consume, no writes), decision logs carry key id/reason/authorityId only — never bodies/keys/secrets — plus per-key token buckets with Retry-After. Gap: buckets are per-process (N replicas ≈ N×RPM), no key rotation/scope, and log/rotation discipline stays host duty — a shared limiter + key lifecycle belongs in front of this bin.
