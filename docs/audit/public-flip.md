# Public-flip + publish checklist (verifiable actions)

Status: repo is `Binilts03/personal-trust-fabric` (private). Server-side
hardening below is free on public repos, blocked on free-private (proven
403s during setup). Flip to public first, then tick each box.

## 1. Flip to public

- [ ] GitHub → Settings → Danger Zone → Change visibility → Public.
- [ ] Verify: repo badge shows Public; `gh repo view` succeeds anonymously.

## 2. Branch protection (Settings → Branches → Add rule for `main`)

- [ ] Require PR before merging; require status checks: `gate`, `secrets`.
- [ ] Require linear history (or squash-merge only).
- [ ] Do not allow bypassing the above (include admins).
- [ ] Verify: `gh api repos/{owner}/{repo}/branches/main/protection` shows the rule.

## 3. Secret scanning

- [ ] Settings → Security → Enable secret scanning + push protection.
- [ ] Verify: push a fake sentinel in a scratch branch → blocked with 403.

## 4. Private vulnerability reporting

- [ ] Settings → Security → Enable private vulnerability reporting.
- [ ] Verify: Security tab shows “Report a vulnerability”.

## 5. Tag protection (`v*`)

- [ ] Settings → Tags → Add `v*` protection (deletion restricted).
- [ ] Verify: `git push --delete origin v0.0.0-test` refused.

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
