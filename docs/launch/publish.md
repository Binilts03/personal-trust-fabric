# Publishing to npm

PTF is publish-ready: `npm pack` produces a 236 kB tarball with the compiled
`dist`, the curated `exports` map, the `ptf` / `ptf-mcp-server` /
`ptf-pdp-server` binaries, the README and the LICENSE. The npm name
`personal-trust-fabric` is unclaimed (verified with `npm view`, which returns
404 for an unclaimed name).

This runbook is the last mile. It needs one human with an npm account.

## Before you publish

1. The working tree is clean and `main` is green:

   ```sh
   npm run typecheck && npm test && npm run eval
   node scripts/check-seams.mjs
   bash scripts/harness.sh
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
npm login            # or: npm token create --registry=https://registry.npmjs.org
npm publish          # publishConfig in package.json sets access=public + provenance
```

`publishConfig.provenance` is already set, so npm will attach a provenance
statement if the publish runs from a CI job with the npm provenance
credentials. From a laptop, npm publishes without provenance. If you want the
statement, publish from GitHub Actions with `NODE_AUTH_TOKEN` and
`id-token: write`.

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

- Tag the release: `git tag -a v0.1.0 -m "..." && git push origin v0.1.0`.
- Add the install line to the README status section (it currently says
  "npm pending" for the first release only).
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
