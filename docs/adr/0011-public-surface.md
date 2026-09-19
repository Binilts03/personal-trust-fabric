# ADR-0011: Curated public surface, internal by packaging

**Date**: 2026-09-13
**Status**: accepted
**Deciders**: PTF maintainer + standards-pivot loop (ticket 09)

## Context

ADR-0009 made the capability envelope local-only by convention (`@internal`
JSDoc). Conventions leak: any importer of the barrel (`src/index.ts`) still
sees `Capabilities`, `canonicalize`, and the stores next to `Authority`.
Ticket 09 makes the boundary structural — what is public is decided by
packaging (`src/api.ts` + the `exports` map), not by comments.

## Decision

- Public entry `src/api.ts` (explicit named re-exports only): the Authority
  engine (`Authority`, request/grant/approval/policy types, `paymentBounds`,
  `claimsSubset`, `digestForOperation`); the human-approval presenter
  (`renderProposal`, `parseDecision`, `ProposalView`); agent-view shaping
  (`assembleCapsule`, `renderAgentView` + types); receipt-bound execution
  (`executeAndReceipt` / `signAndReceipt`, receipt + executor/instruction
  types — never the `Fake*` executors); the recipient registry
  (`RecipientRegistry`).
- Three subpaths: `./authzen` (AuthZEN PDP seam), `./oauth` (RFC8693
  attenuation), `./profiles/payment` (payment conventions + helpers).
  Package `main`/`types` point at `api`; the full barrel (`src/index.ts`)
  stays untouched for tests and deep-path hosts.
- Internal (deep paths only, never `api.ts`): the `ptf/cap@0.1` envelope
  (`Capabilities`, `SealedCapability`, `CapabilityPayload`),
  canonical/crypto machinery (`canonicalize`, `sha256Hex`, `termsDigestOf`,
  key functions), disclosure internals, and host stores (`store/*`).
- Custody/execution ownership: the file keystore and the
  recorded/ledger/x402 settlement executors are REFERENCE host
  implementations (dev/test) — PTF calls external rails, it never
  facilitates, settles, or moves value itself.
  Production custody is OS keychain / Enclave /
  1Password / Bitwarden / HSM / KMS behind `KeyProvider` / `Signer`;
  production execution is the host's rail behind `PaymentExecutor` /
  `SigningExecutor` (`PaymentProvider` / `CredentialProvider` supply
  evidence). PTF decides, external systems execute, PTF verifies results.

## Consequences

- Narrower is the point: when unsure, a symbol stays out of `api.ts`.
  Extending the public surface needs an ADR.
- `src/index.ts` keeps every export (tests import `../src/index.js`); no
  test file changes in this ticket. `tests/hygiene.test.ts` still pins
  `main`/`types` at `index` — the main session updates it to `api`.
