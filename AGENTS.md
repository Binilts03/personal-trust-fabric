# Personal Trust Fabric — coding-agent guide

PTF is a user-owned authority and protected-use layer. Agents may reason about authority; they are never its source.

## Architecture

- `src/core/` — deterministic authority plane. Keep it zero-dependency except `node:crypto`; it never imports adapters.
- `src/adapters/` — standards/evidence translators and provider seams. External protocol messages are evidence, never authority.
- `src/store/` — durable local state, keystore, vault, backup, proposals, and audit support.
- `src/profiles/` — domain conventions over the generic authority model.
- `tests/` — public-seam, abuse, and regression tests.
- `docs/adr/` — architecture decisions.
- `docs/audit/` — public architecture, limits, verification, operations, and threat evidence.

## Non-negotiable invariants

1. Policy constrains; it never creates authority.
2. Personal State is not Authority State.
3. Use without possession: raw secrets never cross to an agent, receipt, log, or audit.
4. Authority attenuates only: child ≤ parent, exact recipient/terms binding, bounded expiry/uses.
5. Disclosure is requested ∩ available ∩ allowed.
6. External protocols are evidence or requests, never authority.
7. CHECK ≠ REDEEM ≠ EXECUTE. Dry-run values are not executable.
8. Effect-bearing provider context must exactly equal the authorized operation.
9. Durable authority consumption happens before an external effect.
10. Honest limits belong in `docs/audit/limits.md`; do not hide them.

## Verification

Before proposing a change:

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
```

Tests use `src/index.ts` as the public seam; CLI/MCP/PDP bin tests may import their bin entry points. Architecture changes require an ADR. User-visible changes require a changelog entry.

## Brand contract

`assets/brand/` and the README region between `PTF-BRAND:START` and `PTF-BRAND:END` define **Authority Manifest v1**.

Unrelated engineering work must not modify them. Read `docs/brand/BRAND.md` before intentional brand changes and run `npm run check:brand`.
