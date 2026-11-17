# npm developer prerelease — release procedure (executed)

**Status:** The candidate package surface shipped as the experimental npm prerelease **`personal-trust-fabric@0.2.0-rc.1`** — published (public, dist-tag `next`, registry shasum `fdcdc7dc70700c3a6168f2613f0a1ad084c0fd89`) from release commit `f09d145`, after the full release gate sequence passed at that commit and external consumer verification installed `personal-trust-fabric@next` in a fresh project.

A GitHub release, a successful `npm pack`, and local installed-tarball tests are **not** an npm registry release. This is a review checklist; later release gates (staging, tagging, deploying) remain owner-gated.

## What the package contains

The `personal-trust-fabric` package declares Node.js 22+ and exports the curated root Authority entry point plus `./hostkit`, `./mcp`, `./providers`, `./privacy` and adapter subpaths (including `./adapters/github-issues`). CLI bins include `ptf`, `ptf-mcp-server` and `ptf-pdp-server`.

CI packs and installs a tarball into an isolated consumer for its public entry points. No live provider operation, independent host deployment or production-security certification follows from this check.

## Gate 1 — validate name, ownership and version

From a connected environment, check registry state and your account authorization:

```sh
npm view personal-trust-fabric versions dist-tags --json
npm whoami
```

A historical 404 does **not** reserve a package name. If another owner controls the name, stop and choose an authorized package name. If the package already has a version, reconcile SemVer before changing or publishing anything. Match the package version and package-lock root entry; ensure that the historical GitHub tags do not claim the new implementation.

The current repository contains an automatic **GitHub release asset workflow triggered by `v*` tag pushes**. Do not push a tag for this preparation task.

## Gate 2 — test the exact source and tarball

On a clean checkout pinned to the intended release commit:

```sh
npm ci
npm run check:brand
npm run typecheck
npm test
npm run test:examples
npm run eval
node scripts/check-seams.mjs
npm run verify:package -- --install
npm pack --dry-run
npm audit --omit=dev
```

Inspect the actual file list, binary targets, public exports, license, dependencies and any accidental secrets or fixtures. Record the exact commit and test outcomes. The historical 236 kB tarball measurement is not evidence of current contents. Check the CycloneDX SBOM created by the existing GitHub tagged-release workflow. Release gates must be evaluated on the actual candidate; do not extrapolate an earlier green CI run.

## Gate 3 — first publication requires an owner-controlled bootstrap

**npm trusted publishing requires the package to already exist on the registry.** Do not create a GitHub OIDC publishing job and assume it can claim an unregistered package name.

After explicit owner approval and tarball review, an npm account holder with two-factor authentication may initialize the first public prerelease using a controlled manual `npm publish --access public --tag next`. npm also supports `npm stage publish` (npm CLI 11.15+), which creates a placeholder for a new package and requires an explicit 2FA approval to release the staged version. Check npm's live requirements before choosing a bootstrap path.

Neither action is performed automatically or by this runbook. **Never store a long-lived npm publishing token in this repository or a GitHub Actions secret as a shortcut.**

## Gate 4 — set up trusted publishing for subsequent versions

Once the package exists, configure npm Trusted Publishing for the exact owner, repository and approved workflow. GitHub-hosted runners require `id-token: write` and least-privilege read permissions. npm OIDC trusted publishing requires Node >=22.14 and npm CLI >=11.5.1; staged publishing and dist-tag management have additional CLI requirements.

Use a restricted release workflow and explicit maintainer approvals. Prefer publishing a prerelease under a nondefault dist-tag such as `next`; do not change `latest`. After verified OIDC publishing, restrict traditional token-based publishing access. npm provenance attests source/workflow origin, **not** package safety or live integration.

Official references: [Trusted publishing](https://docs.npmjs.com/trusted-publishers/) · [Staged publishing](https://docs.npmjs.com/staged-publishing/) · [Provenance](https://docs.npmjs.com/generating-provenance-statements/).

## Gate 5 — external consumer verification after publication

From a fresh project **outside this repository**:

```sh
npm init -y
npm install personal-trust-fabric@next
node -e "import('personal-trust-fabric').then(m => console.log(typeof m.Authority))"
node -e "import('personal-trust-fabric/mcp').then(m => console.log(typeof m.createPtfServer))"
```

Verify `./hostkit` and `./adapters/github-issues` imports, package integrity and provenance, and a public synthetic flow that makes **no real provider call**. Record the actual registry version, dist-tag, hash and resolved source commit: version `0.2.0-rc.1`, dist-tag `next`, shasum `fdcdc7dc70700c3a6168f2613f0a1ad084c0fd89`, resolved from source commit `f09d145`. Only then put `npm install personal-trust-fabric@next` into the README and operator onboarding guide; the install line has been added there and the registry candidate is published.

A prerelease can invite developer feedback **without** asserting live provider acceptance, distributed exactly-once execution, independently audited security, multi-tenant custody or comprehensive privacy compliance.

## Version policy

`0.2.0-rc.1` is the candidate for the newer package-exported Host Kit and MCP interfaces; it is not a published version merely because `package.json` carries the number. The planned changes were retained under `Unreleased` until the owner approved the release, which then shipped as the published candidate `0.2.0-rc.1` (dist-tag `next`, registry shasum `fdcdc7dc70700c3a6168f2613f0a1ad084c0fd89`). Retain subsequent planned changes in `Unreleased` until the owner approves an actual release.
