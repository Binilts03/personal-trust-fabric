# Publishing to npm

The package is publishable: `npm pack` produces a tarball with the compiled
`dist`, the curated `exports` map, four binaries (`ptf`,
`personal-trust-fabric`, `ptf-mcp-server`, `ptf-pdp-server`), the README and
the LICENSE. At the 2026-10-22 check it was 269 kB (263 KiB), 161 files;
re-measure with `npm pack --dry-run --json` immediately before publishing.
The npm name `personal-trust-fabric` is unclaimed (verified with `npm view`,
which returns 404 for an unclaimed name); re-check the name too.

This runbook is the last mile. It needs one human with an npm account.

## Technical preview gate (before npm)

The LinkedIn draft is a technical preview, not the npm launch. Do not post it,
or send its link to reviewers, until every item below passes.

1. **Make the exact commit reachable.** A local branch is not a preview. Push
   the branch (with approval) or merge it, then use a link that resolves to the
   commit named in the post. Do not link `main` while `main` is behind, and do
   not use a link that points at a branch you may rewrite.
2. **Clean-clone that exact commit and run the demo.**

   ```sh
   git clone --branch verify/2026-10-22-hardening https://github.com/Binilts03/personal-trust-fabric.git ptf-preview
   cd ptf-preview
   git rev-parse HEAD
   npm ci
   npm run build
   node examples/payment-disclosure.mjs
   node examples/dpdp-consent-gateway.mjs
   export PTF_PASSPHRASE="ptf-demo-only-change-me"
   node dist/src/cli.js --dir ./ptf-store init
   node dist/src/cli.js --dir ./ptf-store keygen --alias you
   node dist/src/cli.js --dir ./ptf-store privacy init
   node dist/src/cli.js --dir ./ptf-store host-conformance --privacy-config ./examples/privacy-config.example.json
   ```

   Both examples must exit 0 and the last command must print
   `10/10 checks passed`. Record the commit hash and date with the result.
   If the branch has been merged, replace the branch with the release tag or
   pinned commit.

3. **Make the install line true.** Until npm publication, use the git URL with
   the branch or commit, not the bare package name:

   ```sh
   npm install github:Binilts03/personal-trust-fabric#verify/2026-10-22-hardening
   ```

   `npm install personal-trust-fabric` is not available until the package is
   published.

4. **Keep the framing honest.** Say technical preview, request for comment, or
   preview. Do not say launch, release, shipped, or landed unless the linked
   commit is on the public default branch.
5. **Keep the limits and the ask.** Do not add compliance claims, unverified
   counters, or "DPDP compliant." Ask for three to five technical reviewers,
   not signups.

The preview is ready when the link, the clean-clone result, the install command
and the post all describe the same commit.

## Before you publish

1. The working tree is clean and `main` is green:

   ```sh
   npm run typecheck && npm run build && npm test && npm run eval
   node scripts/check-seams.mjs
   bash scripts/harness.sh
   npm run verify:package
   npm run check:brand
   ```

2. The CHANGELOG has an entry for everything in the release, and the version
   in `package.json` matches the release you intend to cut.

3. The tarball is what you think it is:

   ```sh
   npm pack --dry-run
   ```

   Read the file list. `dist/tests/**` and the source maps are excluded on
   purpose.

## Publish

```sh
npm login
npm publish
```

`publishConfig.provenance` is `true`. npm 10.9.8 refuses a laptop publish with
`EUSAGE: Automatic provenance generation not supported for provider: ...`.
Publish from GitHub Actions with `id-token: write` and `NODE_AUTH_TOKEN`, or
remove `publishConfig.provenance` for a local publish and say provenance is
skipped. Do not tell the operator that a laptop publish silently attaches a
provenance statement.

## Verify the published package

From a clean directory, not the repo:

```sh
mkdir ptf-consumer && cd ptf-consumer
npm init -y
npm install personal-trust-fabric
node -e "import('personal-trust-fabric').then(m => console.log(typeof m.Authority))"
npx ptf --help
```

`npx ptf` works because npm resolves a bin by the name you type, as long as
the package is installed in the project. The package also ships a
`personal-trust-fabric` bin that is the same CLI, so
`npx personal-trust-fabric` works from a bare shell.

## After publishing

- Tag the release. `v0.1.0` already exists at `a6d20ad` (2026-09-12) and
  `v0.1.0-rc.1` at `727f122`; do not reuse either tag. Cut the next tag
  (`v0.1.1` unless the release plan says otherwise) on the commit that was
  published.
- Add the install line to the README status section (it currently says "The
  first release is not on npm yet" for the first release only).
- If the technical preview has not been posted yet, post it now with the npm
  install line. If it was already posted, update the install line and the
  pinned preview link to the published package. The draft is in
  [linkedin-post.md](linkedin-post.md); the demo behind it is in
  [demo-script.md](demo-script.md).

## Version policy

- `0.1.x`: the current reference surface. Patch releases fix behaviour;
  minors add a curated surface.
- A new curated export (a new symbol on a curated surface, a new subpath)
  is a minor release and needs an explicit public-surface decision in
  `docs/adr/0011-public-surface.md`.
- A breaking change to a curated surface is `1.0.0`, and it needs an ADR.
