# ADR-0001: Runtime authority and release profiles

**Date**: 2026-09-02
**Status**: proposed
**Deciders**: Human Principal required for acceptance
**Requirements**: U-01, U-02, U-04, U-05, U-21, U-23; P2, P14, P18; S-01, S-05, S-10

## Context

Fresh review compared a device-sovereign node, hosted custodial broker, and device-authoritative core with hosted relay/ciphertext services. A generic “hybrid” does not identify which component authorizes, consumes one-time state, or wins revocation conflicts. M0 needs no-install judgeability but synthetic hosted custody is not production security evidence.

## Proposed decision

Use one device-sovereign runtime as the production reference authority. Optional hosted services may relay safe requests/status and encrypted state but cannot authorize or access production plaintext. Permit a hosted synthetic M0 sandbox that shares the same domain schemas, policy/capability behavior, receipts, and contract tests while carrying an explicit weaker-assurance label.

## Alternatives considered

- Hosted custodial broker: best judgeability and central atomicity; rejected as the production default because operator/runtime compromise becomes a universal plaintext/authority dependency and recovery may flatten custody.
- Undifferentiated hybrid: rejected because split authority creates replay, partition, stale-revocation, and profile-drift failure modes.
- Device-only with no hosted profile: strongest clarity; rejected for M0 because a companion install would materially reduce judgeability.

## Security and trust effect

One authoritative executor bounds atomic use and revocation. Hosted M0 validates contracts and generality only; it cannot support claims about OS keystores, device isolation, loss, or operator-blind recovery.

## Operational effect

The complete product eventually needs native distribution/update and optional relay/sync operations. M0 can deploy independently with synthetic data.

## Test obligations

- Identical core contract/adversarial suites for device and hosted profiles.
- Profile/assurance label on every safe view, plan, approval, and receipt.
- Partition, rollback, device-pinning, stale revocation, export/import, and profile-drift tests before hosted services join production.

## Consequences and residual risks

Recovery actors, primary platform, authoritative approval surface, acceptable irrecoverability, and revocation propagation bounds are unresolved security-sensitive Human choices.

## Revisit trigger

Human selects the production platform/recovery model, or a primary-source platform constraint disproves device-sovereign execution.
