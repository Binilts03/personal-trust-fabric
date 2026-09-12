# Peer-review hygiene checklist (ticket 05)

Gates for every change. Checked by `tests/hygiene.test.ts` where mechanical, by reviewers where judgment is needed.

## Mechanical (test-enforced)

- [ ] `tsconfig.json` pins `strict: true` + `noUncheckedIndexedAccess: true`.
- [ ] `package.json` has no `dependencies` — authority plane ships zero runtime deps (`node:crypto` only). `devDependencies` only.
- [ ] No file under `src/core/` imports from `src/adapters/` (boundary direction is adapters → core only).
- [ ] `npm run typecheck && npm test && npm run eval` green.
- [ ] CI (`.github/workflows/ci.yml`) runs the full gate on push/PR.

## Reviewer judgment

- [ ] Secrets: no credential/key/token/PAN material in receipts, logs, audit, tests, or fixtures. Sentinels (`PAN_SENTINEL`) prove non-propagation on exercised paths.
- [ ] Invariants visible at the seam: child ≤ parent, recipient + termsDigest fixed, `/`-top / powerline / immortal caps rejected, policy-never-creates, holder-bound disclosure.
- [ ] New protocol surface maps to a deep-read file; single-source claims flagged, gaps written down.

## Release automation

- [ ] CI gate + TruffleHog verified-secrets scan on push/PR (`.github/workflows/ci.yml`).
- [ ] OpenSSF Scorecard SARIF on push/schedule (`.github/workflows/scorecard.yml`).
- [ ] SLSA Build L3 provenance + CycloneDX SBOM attached to GitHub releases on `v*` tags (`.github/workflows/release.yml`). First live run happens on the first pushed tag — verify the provenance artifact then.
- [ ] Pre-commit hooks (husky + lint-staged/prettier + typecheck + tests) installed via `prepare` script.
- [ ] GitHub hardening still manual at publication: branch protection on main, private vulnerability reporting, secret push protection, tag protection for `v*`.
