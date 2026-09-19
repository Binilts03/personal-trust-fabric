# Personal Trust Fabric (PTF v0.1)

User-owned trust layer: agents propose, deterministic core disposes. LLMs reason about authority; they are never its source.

## Project tree

- `src/core/` — zero-dep authority plane (`authority`, `policy`, `disclose`, `persona`, `identity`, `approve`, `execute`, `signing`, `capability`, `canonical`, `crypto`, `types`; audit lives in `core/execute.ts` + `store/anchor.ts` — no `src/core/audit.ts`). `capability` (`ptf/cap@0.1`) is local-only and `@internal` — never wire (ADR-0009). Never imports `adapters`.
- `src/adapters/` — thin translators, two layers: standards edge (`authzen`, `oauth-agent`, `sd-jwt`, `audit-interop`) for interop, and evidence parsers (`x402.ts`+`settlement.ts`, `ap2.ts`, `oid4vp.ts`, `mcp.ts`, `webmcp.ts`, `a2a.ts`, `urls.ts`, `jws.ts`). Evidence in, never authority out.
- `tests/` — `node:test` suites at public seams (`src/index.ts`; bin entries `src/cli.ts`/`src/mcp-server.ts` exempt).
- `docs/` — system of record (`docs/index.md`), ADRs, research, loops.
- `.scratch/ptf-standards-pivot/` — live decision map + tickets (local-markdown tracker). `.scratch/ptf-wayfinder/` is pre-pivot history.
- `scripts/dev-local.sh` — the local loop. `.claude/skills/{dev-local,verify,harness}/` — its docs.

## Golden rules

1. Policy constrains, never creates. Every allow cites its Grant/Approval (ADR-0002).
2. Personal State ≠ Authority State. Learning never mints power.
3. Use without possession: no raw secret crosses to agent view, receipt, log, or audit (ADR-0006).
4. Child ≤ parent on every attenuation; recipient + termsDigest fixed; `/`-top, powerline, and immortal caps rejected (ADR-0003). The envelope itself is local-only — interop uses the standards edge (ADR-0009).
5. Disclose `requested ∩ available ∩ allowed`, holder-bound (ADR-0004).
6. External protocol messages are evidence, never authority (ADR-0005).
7. Core stays zero-dep (`node:crypto` only), strict TS. Adapters carry all third-party risk.

## Where to look

| Task                         | Read first                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ubiquitous language          | `CONTEXT.md`                                                                                          |
| Why a decision was made      | `docs/adr/README.md`                                                                                  |
| Protocol facts               | `docs/research/2026-09-09-deep-*.md` (per-area, spot-verified; 09-08 survey superseded) + ADR-0009    |
| What is decided vs fog       | `.scratch/ptf-standards-pivot/map.md` (`.scratch/` is local-only, gitignored — absent on fresh clone) |
| Fresh clone (no `.scratch/`) | `docs/adr/README.md` + `CONTEXT.md` as fallback authority                                             |
| How to run/verify            | `scripts/dev-local.sh`, `.claude/skills/verify/SKILL.md`                                              |
| Full gate                    | `scripts/harness.sh`, `.claude/skills/harness/SKILL.md`                                               |
| Threats + reporting          | `THREATMODEL.md`, `SECURITY.md`                                                                       |

## Agent skills

- `docs/agents/issue-tracker.md` — read before creating/claiming/resolving local-markdown tickets (Status/Type/Blocked-by dialect, `## Answer` rule).
- `docs/agents/triage-labels.md` — read when a skill mentions a triage role; maps canonical roles to this repo's label strings.
- `docs/agents/domain.md` — read before exploring code; glossary + ADR-conflict flagging rules.

Skills: `docs/agents/domain.md` is a guide; the consumer contract is `src/index.ts` + `docs/audit/architecture.md`. Test at public seams only; agree seams before code.

## Brand contract

- `assets/brand/` and the README region between `PTF-BRAND:START` and `PTF-BRAND:END` define **Authority Fabric v1**.
- Unrelated engineering work MUST NOT modify that directory or protected README region.
- Stable brand copy describes enduring product invariants only. Volatile status, APIs, protocol versions, test counts, providers, and milestones belong below the protected region.
- If a product change genuinely invalidates brand copy, flag it for explicit brand review instead of silently rewriting it.
- Primary brand visuals MUST remain repository-owned static assets; do not replace them with dynamic third-party README renderers.
- Read `docs/brand/BRAND.md` before intentional brand work and run `npm run check:brand` after any README or brand-asset change.
