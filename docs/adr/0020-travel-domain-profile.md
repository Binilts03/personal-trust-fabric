# ADR-0020: Travel as a second domain profile (M7)

**Date**: 2026-09-21
**Status**: accepted
**Deciders**: PTF maintainer

## Context

M7 requires one non-payment domain over the generic `ExecutionReceipt` to
prove PTF is not a payment system with extra steps. Travel booking
(`/travel/book`) is the smallest domain that exercises route, class,
traveler-count, fare-ceiling, and date bounds plus provider-seam execution
without payment-shaped receipt fields.

## Decision

Add `src/profiles/travel.ts` as conventions only (same pattern as
`src/profiles/payment.ts`):

- `travelBounds` builds `AttributeBound[]` over `.context` (exact route /
  class / currency / depart date, `<=` traveler count and fare ceiling).
  Date windows are deliberately exact-match: `AttributeBound` `<=`/`>=`
  apply to finite numbers only, so a string range bound would never match.
- `TravelDemand` documents the `/travel/book` demand shape; execution goes
  through the existing `executeActionViaProvider` with a `travel`
  `ProtectedProvider`, returning a domain-neutral `ExecutionReceipt`.
- No core change, no new receipt type, no new adapter.

## Alternatives Considered

### Alternative 1: Email instead of travel

- **Pros**: Simpler bounds (recipient + template).
- **Cons**: Proves less (no numeric ceilings, no date handling).
- **Why not**: Travel exercises more of the bound vocabulary; email stays
  future work behind the same seam.

### Alternative 2: Travel-specific receipt with fare fields

- **Pros**: Receipt shows what was booked.
- **Cons**: Leaks authorized terms into a new receipt shape; repeats the
  payment-profile mistake the engine was generalized to avoid.
- **Why not**: Rejected — fare ceilings ride in authorized context;
  receipts stay domain-neutral per ADR-0018.

## Consequences

### Positive

- Generality proved without engine change (proof: `tests/travel.test.ts`
  — grant allows exact trip, denies five mutations, executes with a
  payment-field-free receipt).
- Spec records the profile pattern for the third domain
  (`docs/spec/execution.md` §6).

### Negative / limits

- Single-leg exact-date only; multi-leg, window search, and availability
  stay provider-side evidence (see `docs/audit/limits.md` travel row).
