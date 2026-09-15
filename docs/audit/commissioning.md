# Third-party audit — commissioning brief (draft for the owner)

The audit pack is ready; this brief is what to send firms. The owner
commissions it (budget, signature, remediation window) — nothing here
substitutes for that step.

## Scope (PTF v0.1, single-operator)

- Authority plane (`src/core/`, zero-dep, `node:crypto` only): standing
  grants + one-time approvals → `Authority.evaluate` → attenuated
  capabilities (`ptf/cap@0.1`, local-only) → recipient-authenticated
  redemption → protected execution → secret-free receipt + hash-chained
  audit.
- Edge adapters (`src/adapters/`): x402 v2, AP2, OpenID4VP, MCP/WebMCP,
  A2A, JWS, URL safety + pinned fetch, OAuth-agent attenuation, SD-JWT
  projection. Evidence in, never authority out.
- Operator surface: file stores with revision CAS + audit freshness
  binding (`src/store/`), `ptf` CLI, MCP stdio server, PDP bin
  (`src/pdp-server.ts`: read-only, TLS-mandatory, per-key buckets,
  scopes, hot-reload rotation, single-replica).
- Release + supply chain: `release.yml` (tarball + CycloneDX SBOM + SLSA
  L3), Scorecard, branch protection, secret scanning.

## Inputs to hand the auditors

`docs/audit/README.md` (start here) → `architecture.md`, `verify.md`
(reproduces the green gate from a fresh clone), `THREATMODEL.md` v2,
`limits.md` (honest ceilings + Production dispositions), `threats.md`,
`tests.md`, `operations.md`, `decisions.md`, `public-flip.md`.

## Ask (suggested statement of work)

1. **Authorization bypass**: grant/approval/capability confusion —
   replay, over-spend, expiry, wrong-recipient, mutated termsDigest,
   `act`-chain confusion, `aud` widening, `ptf_digest` trust-without-recompute.
2. **Execution integrity**: evaluate→execute TOCTOU, concurrent-redeem
   races, rollback resurrection (single-file and full-directory),
   store symlink/path attacks, Windows rename non-atomicity.
3. **Edge confusion**: AP2/x402 shape mismatches, AuthZEN context
   smuggling, OAuth descriptor vs JWT-wire divergences, SD-JWT `sd_hash`
   binding, JWS lenient-decode paths, DNS-rebinding/redirect-to-private
   around (not just through) `fetchWithPinning`, A2A key-fetch trust.
4. **Secrets**: keystore (scrypt+AES-GCM) offline attack cost,
   passphrase-sourcing paths, heap/log/audit/backup leakage of key
   material, PDP bearer-key handling, MCP token separation.
5. **Supply chain**: tarball scope (75 files), SBOM accuracy, SLSA
   verification, Scorecard findings, dependency allowlist.

## Deliverables to require

Report with severity-rated findings, each with a working PoC against
the tagged release commit, the exact violated property, and a retest
after fixes. No-live-funds rule: auditors get test rails and fixtures
only (`tests/fixtures/` are test-only by construction).

## RFP questions for firms

- Which findings in `THREATMODEL.md` v2 would you dispute, and what did
  we miss? (Tests whether they read it or pattern-match.)
- Show one past authorization-layer audit with a logic-flaw find, not
  just dependency CVEs.
- How do you test single-operator file-store systems (rollback, CAS
  races) beyond unit tests?
- Fixed price for scope above + one retest cycle; timeline; sample report.
