# Prod-ready decision trail (vendored from `.scratch/prod-ready/`)

`.scratch/` is gitignored, so this file is the fresh-clone record of the
production-readiness loop (spec `ready-for-agent`, 2026-09-14): what was
decided, where it landed, what residual the owner accepted. Per-ticket
deliberation stays in local scratch; this is the durable part.

| #   | Decision                                               | Landed                                                                  | Residual (owner-accepted)                        |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------ |
| 01  | Land tickets 13–17 as one slice (interdependent)       | `b30dcd4`                                                               | —                                                |
| 02  | Optimistic revision CAS, not lockfiles                 | `4280680` (PR-track: 201/201 + 9/9)                                     | Audit forks alarm at next verify; Windows rename |
| 03  | Audit freshness binding (revs in entries, ADR-0015)    | `9ba2712` (204/204 + 9/9)                                               | Full-dir rollback needs anchor (ticket 12)       |
| 04  | Harden file custody; external signers proof-only       | `81c024f` (210/210 + 9/9)                                               | HSM/KMS stays host seam; yearly review           |
| 05  | Persist-before-execute; injectable executor            | `3013857` (212/212 + 9/9)                                               | True 2PC needs rail participation                |
| 06  | Public flip, no approval-count (solo maintainer)       | `17f86fd` via PR #9                                                     | Revisit at second maintainer                     |
| 07  | `v0.1.0-rc.1` → tarball + SBOM + SLSA L3, verified     | `727f122` + `b4115f2` (PRs #10, #11)                                    | npm Trusted Publisher needs one browser step     |
| 08  | `verify.md` rewritten to the ingress API               | `189e57b` via PR #12                                                    | Counts grow; CI is source of truth               |
| 09  | Tarball 299 files/1.2 MB → 75 files/414 KB             | `1ce72c5` via PR #13                                                    | `.map` files dropped deliberately                |
| 10  | PDP fronting: scopes, hot-reload rotation, one replica | working tree (234/234 + 9/9; rotation/replica/redaction tests)          | Shared limiter stays host duty past one replica  |
| 11  | Pinned fetch path; OIDC cut to `redirect_uri`-only     | working tree (234/234 + 9/9, verifiers 5/5 + 3/3; review follow-ups in) | Egress proxy accepted-risk (single-operator)     |
| 12  | Operations pack (this loop's close)                    | working tree (see `operations.md`; final gate 234/234)                  | Image unsigned until owner enables Sigstore      |

Loop rulebook: `AGENTS.md` golden rules, `CONTEXT.md` language,
`docs/adr/` (esp. ADR-0009, ADR-0013, ADR-0015), per-area
`docs/research/2026-09-09-deep-*.md`. Threat posture: `THREATMODEL.md`
v2; honest ceilings: `limits.md` (each adapter row carries a Production
disposition since ticket 11).
