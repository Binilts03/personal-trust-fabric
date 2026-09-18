# Operations pack (ticket 12) — run it without the author in the room

Single-operator production surface: image, health signals, audit shipping +
retention, backup/restore with the ticket-03 freshness check, install
hygiene. Proved by `tests/operations.test.ts` (PDP probes, full drill,
hygiene contract) and the fresh-host drill below.

## Container image

`Dockerfile` (multi-stage): build on `node:22-bookworm-slim` (`npm ci` +
`npm run build`), runtime ships `dist/` + prod `node_modules` + `LICENSE` +
`README.md` only. Runtime runs as the unprivileged `node` user; the
filesystem is read-only except the store volume and `/tmp`:

```sh
docker build -t ptf:0.1.0 .
docker run --read-only -v ptf-store:/data ptf:0.1.0 dist/src/cli.js --dir /data audit --verify
# MCP stdio server / PDP bin are the same image with another entry arg:
docker run --read-only -v ptf-store:/data -e PTF_STORE_DIR=/data -e PTF_MCP_PRINCIPAL=did:op:o -e PTF_MCP_ACTOR=did:op:a -i ptf:0.1.0 dist/src/mcp-server.js
docker run --read-only -v ptf-store:/data -v ptf-tls:/tls:ro -e PTF_PDP_STORE_DIR=/data -e PTF_PDP_KEYS_FILE=/data/pdp-keys.json -e PTF_PDP_TLS_KEY=/tls/key.pem -e PTF_PDP_TLS_CERT=/tls/cert.pem -p 127.0.0.1:3000:3000 ptf:0.1.0 dist/src/pdp-server.js
```

Host-composed probes (no baked `HEALTHCHECK` — the CLI exits after one
command, so there is nothing to probe on a CLI container):

```yaml
# compose: one-shot chain check as the health test for CLI-sidecars
healthcheck:
  test:
    ["CMD", "node", "dist/src/cli.js", "--dir", "/data", "audit", "--verify"]
  interval: 60s
# k8s: PDP Deployments probe the bins over HTTPS (or plain HTTP on loopback)
livenessProbe: { httpGet: { path: /healthz, port: 3000, scheme: HTTPS } }
readinessProbe: { httpGet: { path: /readyz, port: 3000, scheme: HTTPS } }
```

`.nvmrc` pins `22` (matches `engines: >=22`); `.dockerignore` keeps
`.scratch/`, `evidence/`, and the store out of the build context. Record
the built image digest next to the release that produced it
(`docs/audit/public-flip.md` §7). Residual: no image signing yet — sign
with the same Sigstore flow as the release when the owner enables it.

## PDP front door (ticket 10) — scopes, rotation, one replica

`compose.yml` is the deploy config: a single PDP replica (`replicas: 1`
is load-bearing — buckets are per-process, so a second replica doubles
every key's RPM cap). The replica id (`PTF_PDP_REPLICA_ID`, default
`hostname:pid`) rides on every decision log, 429, and `/readyz`: two ids
in one log stream prove a duplicate — kill one. Outgrowing one replica
means a shared limiter (gateway quota / Redis cell) in front (host duty).

Per-key scopes live in the keys file (`[{id, key, principal, actor,
scopes?}]`): the only scope is `"evaluate"`. Unknown scopes fail
startup; absent scopes are legacy full access; `"scopes": []` parks a
key (auth passes, evaluate 403s) without deleting its id. Scope checks
run before rate limiting and log nothing.

Zero-downtime rotation (keys file hot-reloads on change, buckets keyed
by key id so limits survive rotation):

```sh
cp pdp-keys.json pdp-keys.json.bak
# 1. add the new key alongside the old (atomic rewrite, e.g. via sponge or write+rename)
# 2. prove it — old and new both 200, zero restarts:
curl -sk -H "Authorization: Bearer <NEW>" https://127.0.0.1:3000/access/v1/evaluation -d @eval.json
# 3. drop the old key, prove the cutover:
curl -sk -H "Authorization: Bearer <OLD>" https://127.0.0.1:3000/access/v1/evaluation -d @eval.json  # → 401
```

A malformed rewrite keeps last-good keys (availability) and fails the
next deploy instead of wedging service — fix the file, the next request
picks it up. Exercised without restarts in `tests/pdp-fronting.test.ts`.

## Health signals (what "healthy" means per process)

- `ptf` CLI: `ptf --dir <store> audit --verify` exits 0 with
  `audit chain: valid`. It loads authority + registry first, so a rolled
  back store fails closed (nonzero) instead of reporting a valid chain
  over stale state. Use it as the CLI health probe and as step 3 of the
  restore drill.
- MCP stdio server (`ptf-mcp-server`): there is no socket to probe. Healthy
  = process alive (supervisor-tracked) + `ptf audit --verify` green on its
  store + no `unknown`-proposal storms in stderr. Proposals are durable
  files (ADR-0017) shared by all tools under the same no-approve invariant;
  recipient challenges stay in-memory (lost on restart — redeem phase 1
  again). Receipts additionally survive in `audit.jsonl`. The
  general-contract tools (`ptf_request_data`,
  `ptf_request_action`, `ptf_get_receipt`, `ptf_list_capabilities`,
  `ptf_revoke`, `ptf_present_data`) share the same durable proposal store
  and the same no-approve invariant.
- Vault (`personal-state.json`): revision CAS + `vaultRev` freshness binding
  like authority/registry. `audit --verify` covers the chain plus
  authority/registry/vault freshness (loads the vault when present);
  `loadVault`/`saveVault` fail closed on corrupt/missing/CAS mismatch
  (`changed under us` / `never loaded` / `store missing` / `predates audit
history`). A consistently-old full-directory restore passes `--verify`
  and is caught only by recomputing the anchor checkpoint over the restored
  `audit.jsonl` and comparing root/count (restore step 3).
- PDP bin (`ptf-pdp-server`): `GET /healthz` is liveness — 200
  `{ ok: true, version }` without touching the store, no auth, nothing
  logged. `GET /readyz` is readiness — 200 `{ ready: true }` when the
  authority store loads, 503 `{ ready: false }` otherwise; also
  unauthenticated and unlogged (probes carry no credentials, and a log
  line always means a decision happened). Wire the load balancer to
  `/readyz`, the supervisor to `/healthz`.

## Audit shipping + retention

`audit.jsonl` is append-only canonical JSON over a hash chain (opt HMAC);
`ptf audit --verify` checks it without any passphrase. Ship it with a
file-tailer (vector / fluent-bit / systemd-journal sidecar) — never by
copying the live file mid-line; tailers retry, copies tear. Retain every
line until an external anchor checkpoint covers it (`store/anchor.ts`
`checkpoint` / `verifyConsistency`; the drill stamps one per backup),
minimum 400 days for dispute windows, compressed after 30. `detail` and
context strings are host-supplied and can smuggle secrets into every copy
(ADR-0006): the redaction rule is "no PAN/key/token/PAN material in
`detail`" — the secretness regression test enforces it on exercised
paths, the shipper must enforce it on the rest. Decision logs (PDP
stdout) are safe by construction — `{at, keyId, replica, decision,
reason?, authorityId?}` only, bodies/keys/secrets never logged
(regression-tested with sentinel secrets in `tests/pdp-fronting.test.ts`)
— ship them with the same collector and keep them ≥400 days like the
audit trail. HMAC without an external
anchor still trusts the host clock/store; third-party verifiability needs
independent anchoring (out of scope, ADR-0006).

## Backup / restore runbook (freshness-checked)

Back up the whole `ptf-store/` directory (authority.json, registry.json,
personal-state.json once the vault is used, keystore, audit.jsonl) as one
unit, plus an anchor checkpoint. Backup honesty: `personal-state.json` is
ciphertext, but the keystore holding its DEK ships in the same unit — anyone
holding a backup can decrypt the vault. Encrypt backup media at rest,
restrict who may hold it, and rotate (`ptf vault-rekey` + `ptf rekey`) if a
backup is ever exposed. For DEK/media separation, replace the file keystore
with the `KeyProvider` host seam (HSM/KMS duty, see `limits.md`).

```sh
cp -a ptf-store "backups/ptf-store-$(date -u +%F)"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { checkpoint } from './dist/src/index.js';
const lines = readFileSync('ptf-store/audit.jsonl', 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
console.log(JSON.stringify(checkpoint(lines, Math.floor(Date.now() / 1000))));" \
  > "backups/ptf-store-$(date -u +%F)/anchor.json"
```

Minimal honest checkpoint today: record `sha256` of `audit.jsonl` and its
line count next to the backup; the mechanized form is
`checkpoint(entries, at)` / `verifyConsistency` from `store/anchor.ts`
(proved in the drill). Restore:

1. Stop writers (single-writer topology, ticket 02).
2. Copy the backup over a fresh directory — never merge files across
   backups (mixed vintages trip the freshness check on purpose). The unit
   includes `personal-state.json` when present; same no-merge rule applies.
   `proposals/` joins the backup unit when present (durable proposals,
   ADR-0017); restored proposals re-evaluate live authority at use time, so
   stale demands fail closed rather than resurrect.
3. `ptf --dir <restored> audit --verify` — must print `audit chain: valid`
   with exit 0. A stale `authority.json`/`registry.json` against newer
   `audit.jsonl` fails closed here ( `predates audit history — suspected
partial rollback`); a full-directory rollback to consistently-old
   files (including the vault, which carries no per-entry freshness
   binding) passes this check and is caught by recomputing the checkpoint
   over the restored `audit.jsonl` (same one-liner as backup) and
   comparing root/count against the recorded `anchor.json`.
4. Point the MCP/PDP processes at the restored dir; `/readyz` must go 200.

The drill in `tests/operations.test.ts` performs exactly this: backup,
revoke, stale-restore alarms (load + CLI refuse), clean-restore verifies
(chain valid, checkpoint root matches, CLI exit 0).

## Install hygiene

- `prepare` is `husky || true`: contributors get hooks on `npm install`,
  consumers never break on a missing `husky` binary (registry tarballs
  skip `prepare` entirely; git-dependency installs tolerate it). The
  shipped tarball is allow-listed (`dist`, `LICENSE`, `README.md`) so
  hooks and sources never reach consumers (proved in
  `tests/operations.test.ts`).
- `lint-staged` is scoped per area (`src/**`, `tests/**`, `**/*.{json,md}`)
  — the old bare `*` also formatted stray staged files.

## Accepted risks awaiting owner sign (merge checklist)

Single-operator accepted risks from tickets 11–12. Merging the release
signs all four; unchecking one blocks the release:

- [ ] Egress proxy deferred — direct fetch with per-hop DNS + redirect
      re-checks (`fetchWithPinning`); proxy recommended for high-value hosts
      (`limits.md` URLs row).
- [ ] OIDC nonce replay store is host-persisted, not in-core
      (`limits.md` OpenID4VP row); x509/DID/attestation cut by default,
      re-openable only via `allowUnverifiedClientIdPrefixes` with verified
      validation behind a host flag.
- [ ] MCP per-client OAuth duties (consent, PKCE, state, cookies, scopes)
      are host duties outside single-operator v0.1 (`limits.md` MCP row).
- [ ] WebMCP `consequentialHint` is self-attested — host gates
      irreversible effects independently (`limits.md` WebMCP row).
- [ ] Image digest recorded at release time is the pin; image unsigned
      until the owner enables Sigstore for images.

## Decision-trail visibility (the `.scratch/` question)

`.scratch/` is gitignored by design (local working notes), so a fresh
clone loses the per-ticket deliberation. Decision: vendor the durable
part — the auditable record of what was decided and why —
into `docs/audit/decisions.md` (prod-ready tickets 01–12 with
commit/PR pointers), linked from `docs/audit/README.md`. Raw scratch
notes stay local. Revisit if a future audit demands the full threads.
