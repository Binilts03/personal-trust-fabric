# Domain Documentation Convention

Status: **Active planning convention for PTF v1.**

## Canonical domain sources

PTF deliberately does not create a second domain model under `docs/agents/`.

- Normative requirements and invariants: `docs/spec/PTF-V1-PROPOSED.md`, exact approved blob identified by `docs/spec/PTF-V1-APPROVAL.md`.
- Non-normative terminology and bounded-context glossary: `CONTEXT-MAP.md`.
- Accepted hard-to-reverse decisions: `docs/adr/`.
- Executable sequencing and implementation interfaces: `docs/superpowers/plans/`.

If any lower-level document conflicts with the approved specification, the approved specification wins.

## Context boundaries

The implementation must preserve the approved semantic separation of:

1. Personal State;
2. Identity and Trust;
3. Authority;
4. Planning;
5. Protected Execution;
6. Protocol Integration;
7. Audit and Conformance.

Cross-cutting product areas remain Trusted Surface, Portability/Sync/Revocation/Recovery, Developer Platform, Security/Operations, and Governance/Versioning.

Do not collapse these contexts merely because the reference implementation later uses a monorepo or common language/runtime.

## Documentation placement

- A new domain term or invariant belongs in the approved specification review process, not in an implementation plan alone.
- A hard-to-reverse architecture choice belongs in an ADR.
- A protocol-specific fact/evidence belongs in `docs/research/` or the relevant adapter documentation.
- A testable build sequence belongs in `docs/superpowers/plans/`.
- Operational runbooks and assurance evidence belong in their owning `docs/` area once Plan 06 creates them.

## Anti-duplication rule

Do not create `CONTEXT.md`, per-package domain copies, or agent-local summaries that restate canonical PTF invariants. Package READMEs may explain ownership and public interfaces, but must link back to the approved specification/context map instead of creating competing definitions.

## Change rule

If implementation evidence shows the approved domain model is wrong or incomplete, stop the affected task and open a spec/ADR review. Do not resolve semantic conflicts by introducing protocol-specific conditionals into canonical core types.
