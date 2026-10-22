# Publishing to npm

The package is publishable: `npm pack` produces a tarball with the compiled
`dist`, the curated `exports` map, four binaries (`ptf`,
`personal-trust-fabric`, `ptf-mcp-server`, `ptf-pdp-server`), the README and
the LICENSE. At the 2026-10-22 check it was 269 kB (263 KiB), 161 files;
re-measure with `npm pack --dry-run --json` immediately before publishing.
The npm name `personal-trust-fabric` is unclaimed (verified with `npm view`,
which returns 404 for an unclaimed name); re-check the name too.

This runbook is the last mile. It needs one human with an npm account.

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
- Post the announcement. The draft is in
  [linkedin-post.md](linkedin-post.md); the demo behind it is in
  [demo-script.md](demo-script.md).

## Version policy

- `0.1.x`: the current reference surface. Patch releases fix behaviour;
  minors add a curated surface.
- A new curated export (a new symbol on a curated surface, a new subpath)
  is a minor release and needs an explicit public-surface decision in
  `docs/adr/0011-public-surface.md`.
- A breaking change to a curated surface is `1.0.0`, and it needs an ADR.
