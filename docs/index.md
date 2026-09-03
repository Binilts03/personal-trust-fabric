# PTF v1 Documentation

Status: **Specification approved; implementation planning in progress.**

## Approved specification

- `spec/PTF-V1-APPROVAL.md` — exact approval/lifecycle record.
- `spec/PTF-V1-PROPOSED.md` — immutable reviewed specification blob identified by the approval record.

## Non-normative terminology

- `../CONTEXT-MAP.md`

## Accepted ADRs

- `adr/0001-dual-source-authority-and-personal-state-separation.md`
- `adr/0002-plan-bound-execution-and-enforcement-map.md`
- `adr/0003-local-subjects-and-validated-identity-bindings.md`
- `adr/0004-plural-custody-and-protected-executors.md`
- `adr/0005-external-protocols-are-adapters-not-authority.md`
- `adr/0006-preserve-repository-history-rewrite-implementation.md`

## Planning

- `superpowers/plans/` — master rewrite roadmap and bounded executable subplans.

## Review history

- `review/2026-09-03-critical-review-remediation.md`

## Preservation

The synthetic WebMCP milestone is preserved on `legacy/webmcp-sandbox` at `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.

Immutable tag `webmcp-sandbox-v0.1` is still required at that same commit before any rewrite of `main`. The current ChatGPT GitHub connector cannot create Git tags, so this remains an execution-preflight blocker.
