# ADR 0001 — Dual-Source Authority and Personal-State Separation

Status: **Accepted**

## Context
PTF needs adaptive personal context without allowing inference, repeated behavior, or policy defaults to become execution authority.

## Decision
PTF recognizes only deliberate Standing Grants and Exact Human Approval as authority sources. Hard Policy may restrict but not create authority. Personal State has no automatic authority-creation edge.

## Consequences
The Agent can learn and personalize, but authorization behavior must be testably invariant to Personal-State-only changes except becoming more restrictive. See the normative conformance oracle in `docs/spec/PTF-V1-PROPOSED.md` and the exact approval record in `docs/spec/PTF-V1-APPROVAL.md`.
