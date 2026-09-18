# ADR-0018: Exact-operation authorization and consumption

**Date**: 2026-09-18
**Status**: accepted
**Deciders**: PTF maintainer + independent review (3 BLOCKERs: unbound
execution terms, reusable one-time vault authority, proposal/execution
resource mismatch)

## Context

`Capabilities.authorize` returned `{ok, remaining, chainId}` and execute
paths checked only `chainId`. A caller could pair an authorization with
mutated terms (different recipient, amount, resource, purpose). Vault reads
and secret uses evaluated authority without consuming, so one-time
approvals were reusable. And disclosure proposals authorized one resource
(`credential:*`) while the vault re-authorized another (`vault:*`),
breaking the exact-terms model.

## Decision

`authorized_operation === executed_operation`, enforced in depth:

- `authorize` echoes the exact verified demand (`AuthorizedOperation`:
  cmd, args, recipient, resource, purpose, termsDigest) and binds
  demand resource/purpose against the leaf when present. Execute paths
  (`executeAndReceipt`, `signAndReceipt`, provider seam) deep-compare
  their instruction against the echo — bare `{ok, chainId}` redemptions
  fail closed. In-process forgery by hostile host code stays out of model
  (the host owns everything); the enforced boundary is agent-facing
  seams, which build both sides from the same stored demand.
- Actual disclosure and secret use consume uses; dry-run/proposal
  evaluation does not. Hosts persist authority state after success
  (burn-before-deliver, ticket 05 ordering).
- Proposal and execution operate on the identical canonical operation:
  the vault evaluates the caller-supplied resource (MCP passes the stored
  demand's), and present re-derives the terms digest and requires it to
  equal the proposal key.
- `ExecutionReceipt` is the domain-neutral receipt; payment `Receipt`
  extends it. Payment stays one domain profile in `profiles/payment` —
  PTF is not becoming a payment platform (see scope note below).

## Alternatives Considered

### Bearer capability passing (chainId-only, status quo ante)

- **Pros**: smaller diff.
- **Cons**: permits the mutated middle the review demonstrated.
- **Why not**: it was the defect.

### Merging authorize+execute into one call

- **Pros**: no seam to mutate at all.
- **Cons**: destroys dry-run/propose flows and the challenge/response
  redeem UX; host executors need the two-phase shape.
- **Why not**: the echo + deep-compare achieves the invariant with the
  existing UX intact.

## Scope note

PTF owns authority, policy, protected state, approval, secret mediation,
execution authorization, portable semantics, and audit evidence. It does
NOT own rails, settlement, PSP functionality, wallets, or merchant
acquiring. Payment is one optional domain profile alongside travel,
email, signing, and identity — M7 ("live rail reference, payment first")
is removed from the roadmap accordingly.

## Consequences

- `PaymentInstruction`/`SignInstruction` require `termsDigest`;
  `Receipt`/`SignReceipt` carry it. Tests that manufactured redemptions
  now authorize for real.
- Same-type vault ambiguity fails closed (re-put under one id or retire
  the stale record); `list_capabilities` shows live grants only
  (principal, actor, revocation, validity window, remaining uses).
- Short-scalar leak-guard and host-callback trust residuals unchanged
  (documented in `docs/audit/limits.md`).
