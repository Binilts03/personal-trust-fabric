# ADR 0001 — Dual-Source Authority and Personal-State Separation

Status: Accepted  
Date: 2026-09-03

## Context

PTF must let Agents act autonomously within deliberate human authority while also supporting one-time human-present actions. Earlier designs risked treating policy, behavior, persona inference, capabilities, or protocol mandates as interchangeable sources of authority. That creates authority creep and makes repeated behavior or an LLM inference capable of acquiring security meaning it was never deliberately given.

A purely Standing-Grant-first model makes one-off credential disclosures and human-present actions unnecessarily stateful. A pure policy-first model cannot represent explicit continuing delegation cleanly and fits autonomous AP2-style authority poorly.

## Decision

PTF recognizes exactly two deliberate authority sources:

1. **Standing Grant** — deliberately created continuing authority; and
2. **Exact Human Approval** — authority for one exact selected Execution Plan.

Hard Policy constrains authority but never creates or expands it.

Personal State — including Observations, Claims, Preferences, inferences, repeated behavior, and model confidence — may inform reversible decisions but cannot automatically create Hard Policy, Standing Grants, Exact Human Approval, or Execution Grants.

Execution Grants are derived from the deliberate authority basis and are narrow, immutable, transaction/plan-bound, and short-lived.

Separate grants cannot be unioned to manufacture authority that no individual grant provides.

## Consequences

- Approve-once and create-standing-authority must be distinct user decisions.
- Repeated approvals do not silently create future authority.
- One-time exceptions do not modify Standing Grants.
- Persona learning can improve recommendation quality without becoming a security authority channel.
- Autonomous actions require one applicable Standing Grant that independently covers the action.
- Human-present actions can proceed without creating durable Standing Grant state.
- Tests must explicitly attack Personal-State-to-authority escalation and grant-unioning behavior.
