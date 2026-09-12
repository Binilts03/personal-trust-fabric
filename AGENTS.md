# Personal Trust Fabric (PTF v0.1)

User-owned trust layer: agents propose, deterministic core disposes. LLMs reason about authority; they are never its source.

## Project tree

- `src/core/` — zero-dep authority plane (`types`, `canonical`, `crypto`, `policy`, `capability`). Never imports `adapters`.
- `src/adapters/` — thin protocol translators (x402/AP2/OIDC/MCP/A2A). Evidence in, never authority out.
- `tests/` — `node:test` suites at public seams (`src/index.ts`).
- `docs/` — system of record (`docs/index.md`), ADRs, research, loops.
- `.scratch/ptf-wayfinder/` — decision map + tickets (local-markdown tracker).
- `scripts/dev-local.sh` — the local loop. `.claude/skills/{dev-local,verify}/` — its docs.

## Golden rules

1. Policy constrains, never creates. Every allow cites its Grant/Approval (ADR-0002).
2. Personal State ≠ Authority State. Learning never mints power.
3. Use without possession: no raw secret crosses to agent view, receipt, log, or audit (ADR-0006).
4. Child ≤ parent on every attenuation; recipient + termsDigest fixed; `/`-top, powerline, and immortal caps rejected (ADR-0003).
5. Disclose `requested ∩ available ∩ allowed`, holder-bound (ADR-0004).
6. External protocol messages are evidence, never authority (ADR-0005).
7. Core stays zero-dep (`node:crypto` only), strict TS. Adapters carry all third-party risk.

## Where to look

| Task                    | Read first                                               |
| ----------------------- | -------------------------------------------------------- |
| Ubiquitous language     | `CONTEXT.md`                                             |
| Why a decision was made | `docs/adr/README.md`                                     |
| Protocol facts          | `docs/research/2026-09-08-agentic-commerce-protocols.md` |
| What is decided vs fog  | `.scratch/ptf-wayfinder/map.md`                          |
| How to run/verify       | `scripts/dev-local.sh`, `.claude/skills/verify/SKILL.md` |
| Threats + reporting     | `THREATMODEL.md`, `SECURITY.md`                          |

Skills: `docs/agents/domain.md` is the consumer contract. Test at public seams only; agree seams before code.
