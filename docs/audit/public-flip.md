# Public-flip + publish checklist (verifiable actions)

Status (2026-09-14, ticket 06): repo `Binilts03/personal-trust-fabric` is
PUBLIC. §1–§5 done via `gh`/API with outputs below; §6–§8 are ticket 07.

## 1. Flip to public

- [x] `gh repo edit --visibility public` (2026-09-14).
- [x] Verify: anonymous `api.github.com/repos/...` → `private: false`,
      `visibility: public`; repo page HTTP 200 unauthenticated.

## 2. Branch protection (`main`, via API — ticket 06)

- [x] Strict required status checks `gate` + `secrets`; linear history;
      force-push + deletion blocked; no bypass, admins included.
- [x] Verify: `branches/main/protection` GET shows all of the above.
- [x] Deliberate deviation recorded: NO required-approval count. A
      single-maintainer repo deadlocks on `required_approving_review_count ≥ 1`
      (self-approval never counts, no bypass allowed) — revisit when a second
      maintainer joins. Status checks + linear history + no-bypass still gate
      every merge.

## 3. Secret scanning

- [x] API PATCH: `secret_scanning` + `secret_scanning_push_protection`
      `enabled` (GET-verified).
- [x] Live-fire verified: after ~20 min propagation, a Stripe-shaped fake
      secret on scratch branch `probe/push-protection-test` was refused with
      `remote: error: GH013 … Push cannot contain secrets`. (Earlier AWS/`ghp_`
      fakes landed — pattern nuances/propagation, not a bypass; the GH013 hit
      is the proof.) Branch deleted locally + remotely afterwards; commits held
      fake (invalid) values only.

## 4. Private vulnerability reporting

- [x] Enabled via REST (`PUT
/repos/{owner}/{repo}/private-vulnerability-reporting` → GET
      `{"enabled":true}`; discovered via docs — there is no
      `security_and_analysis` key for it).
- [x] Verify: advisories page does not render the button anonymously
      (expected — reporting requires login); API state is the proof.

## 5. Tag protection (`v*`)

- [x] Legacy `tags/protection` endpoint is retired (404 — removed Aug
      2024); implemented as an active repository ruleset instead:
      `protect-release-tags` (id 23345306), target `tag`,
      `refs/tags/v*`, rules `deletion` + `non_fast_forward`, zero bypass
      actors (admins included).
- [ ] Verify: `git push --delete origin v0.0.0-test` refused — runs in
      ticket 07 after the first real tag push (nothing to delete yet).

## 6. Scorecard + SLSA (already wired, verify live after flip)

- [ ] `.github/workflows/scorecard.yml` first run green (needs public repo for
      code-upload; SARIF via run artifacts until then).
- [ ] Remove any Scorecard PAT if added as a workaround (public needs none).
- [ ] Push tag `v0.1.0-rc.1` → `release.yml` builds tarball + CycloneDX SBOM +
      SLSA L3 provenance → GitHub Release has all three assets.
- [ ] Verify: `npm audit signatures` / Sigstore verify on the provenance.

## 7. npm publish (OIDC trusted publishing, no long-lived token)

- [ ] npmjs.com → package `personal-trust-fabric` → Settings → Trusted
      Publishers → GitHub Actions (`Binilts03/personal-trust-fabric`,
      workflow `release.yml` or a dedicated `publish.yml`).
- [ ] `npm pack --dry-run` lists exactly: `package.json`, `README.md`,
      `LICENSE`, `dist/` (+ bins `ptf`, `ptf-mcp-server`).
- [ ] Publish: `npm publish --access public` from a tagged CI run
      (provenance auto-attached for public packages). Never `npm publish`
      from a laptop with a stored token.
- [ ] Verify: `npm view personal-trust-fabric dist.attestations` shows
      provenance; `npm install` in a blank dir + `node -e
  "import('personal-trust-fabric')"` resolves via `exports`.
- [ ] Revoke any classic `NPM_TOKEN` after the first OIDC publish.

## 8. Post-publish hygiene

- [ ] `CHANGELOG.md` entry for v0.1.0 (Keep-a-Changelog `## [Unreleased]` flow).
- [ ] `SECURITY.md` contact updated from “maintainer directly” to the live
      advisory URL.
- [ ] Announce with the audit pack link (`docs/audit/README.md`), not a
      feature list.
