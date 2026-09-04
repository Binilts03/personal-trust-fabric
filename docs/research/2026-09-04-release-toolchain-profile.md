# PTF v1 Release Toolchain Provenance — September 4, 2026

Status: **PRIMARY-SOURCE VERIFIED PLANNING INPUT**

This note records the exact first-party GitHub refs used by Plan 06 release/security workflow planning. It is not itself a release attestation. Workflow files must still be reviewed and their actual referenced SHAs verified before release.

## Verified GitHub Action pins

The following refs were resolved directly from the official GitHub repositories on September 4, 2026.

| Action | Reviewed release/tag | Exact commit SHA | Primary source |
|---|---|---|---|
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | https://api.github.com/repos/actions/checkout/git/ref/tags/v7.0.1 |
| `actions/setup-python` | `v7.0.0` | `5fda3b95a4ea91299a34e894583c3862153e4b97` | https://api.github.com/repos/actions/setup-python/git/ref/tags/v7.0.0 |
| `actions/setup-node` | `v7.0.0` | `820762786026740c76f36085b0efc47a31fe5020` | https://api.github.com/repos/actions/setup-node/git/ref/tags/v7.0.0 |
| `astral-sh/setup-uv` | `v10.0.1` | `20cfd1bf945f4377ade1205e4dbc17946fc9a30d` | https://api.github.com/repos/astral-sh/setup-uv/git/ref/tags/v10.0.1 |
| `pypa/gh-action-pip-audit` | `v1.1.0` | `1220774d901786e6f652ae159f7b6bc8fea6d266` | https://api.github.com/repos/pypa/gh-action-pip-audit/git/ref/tags/v1.1.0 |
| `gitleaks/gitleaks-action` | `v3` / `v3.0.0` | `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` | https://api.github.com/repos/gitleaks/gitleaks-action/git/ref/tags/v3 |
| `actions/upload-artifact` | `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | https://api.github.com/repos/actions/upload-artifact/git/ref/tags/v7.0.1 |
| `actions/download-artifact` | `v8.0.1` | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` | https://api.github.com/repos/actions/download-artifact/git/ref/tags/v8.0.1 |
| `actions/cache` | `v6.1.0` | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | https://api.github.com/repos/actions/cache/git/ref/tags/v6.1.0 |

### Gitleaks runtime and binary facts

The official `gitleaks/gitleaks-action` v3.0.0 release states that v3 migrates the action runtime from Node 20 to Node 24 without changing its public inputs/outputs/behavior. The reviewed v3 action source at commit `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` uses Gitleaks binary version `8.24.3` when `GITLEAKS_VERSION` is not supplied. PTF sets `GITLEAKS_VERSION=8.24.3` explicitly so the binary version cannot drift independently of the pinned Action commit.

Primary sources:

- https://github.com/gitleaks/gitleaks-action/releases/tag/v3.0.0
- https://github.com/gitleaks/gitleaks-action/blob/e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e/src/index.js

## Reviewed CLI/package pins

| Tool | Pin | Verified source fact |
|---|---|---|
| `pip-audit` | `2.10.1` | official `pypa/pip-audit` documentation/repository identifies `v2.10.1` as the reviewed package hook/version used by this plan |
| Gitleaks binary | `8.24.3` | exact binary default in the reviewed `gitleaks-action` v3 source; PTF pins it explicitly in workflow environment |
| Syft | `1.51.0` | official annotated tag `v1.51.0` resolves to commit `2293641e3bd628a01bb37639318d62c0ebe89b39` |

Syft primary sources:

- https://api.github.com/repos/anchore/syft/git/ref/tags/v1.51.0
- https://api.github.com/repos/anchore/syft/git/tags/57260929138ad516dd4999a5cc43b4a295d2461f

## Binding workflow policy

1. Release/security workflows must reference third-party GitHub Actions by full 40-character commit SHA, with the reviewed release/tag only in a comment.
2. A mutable major tag such as `@v3`, `@v7`, or `@main` is not acceptable in a release workflow.
3. If a workflow needs a GitHub Action not listed above, planning/review must resolve and record its exact first-party tag/ref and full commit SHA before the workflow task is accepted.
4. Updating an Action or CLI pin is a reviewed supply-chain change. The version/tag, exact SHA/digest, reason, and verification evidence must be updated together.
5. Vulnerability-feed or package-registry unavailability is not evidence of safety. A release security gate that cannot complete its vulnerability scan is `UNAVAILABLE/FAIL`, never PASS.
6. Release artifact upload occurs only after registered canary/private-key scans pass. Artifact Actions themselves do not determine what is safe to upload.
7. `GITLEAKS_VERSION` must be set to `8.24.3` in the reviewed v3 workflow; do not use `latest`.

## Workflow examples

Use exact SHAs in YAML:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
- uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0
- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
- uses: astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d # v10.0.1
- uses: pypa/gh-action-pip-audit@1220774d901786e6f652ae159f7b6bc8fea6d266 # v1.1.0
- uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e # v3.0.0
  env:
    GITLEAKS_VERSION: "8.24.3"
- uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
```

The implementer must not replace these with floating tags merely for convenience.