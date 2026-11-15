# ADR-0028: The capability subpath makes the payment path reachable

**Date:** 2026-11-15
**Status:** accepted
**Scope:** Public surface (amends ADR-0011); the `ptf/cap@0.1` envelope stays local (ADR-0009)

## Context

The curated root (`src/api.ts`) exports `executeAndReceipt`,
`executeViaProvider` and `providerAsExecutor`. All three take a `Redemption`,
and `requireBoundOperation` refuses a redemption that is not bound to the
exact authorized operation — so there is no way to satisfy them other than
with a real redemption.

The only producer of a `Redemption` is `Capabilities.redeem`. `Capabilities`
was internal: ADR-0011 placed the `ptf/cap@0.1` envelope in "internal (deep
paths only, never `api.ts`)", and ADR-0011's rule is that what is public is
decided by packaging. The `exports` map has no subpath for it, and a deep
import is refused with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

The consequence: a consumer who installed the package and imported it by
name could see three payment executors and had **no way to produce the value
they require**. The payment path was advertised and unreachable. The generic
route was not affected — the host kit's `createHostRedemptionChallenge` ships
on `./hostkit` and refuses `/pay` by design — which is why the defect was
invisible to the generic-action example that the package verifier runs
against the installed tarball.

`tests/exports.test.ts` asserted only that the exported names were
_callable_. A function can be callable and unusable.

## Decision

Add a `./capabilities` subpath: a curated facade over the local capability
envelope and the Ed25519 primitives the workflow cannot work without.

- The facade is `src/capabilities.ts`. It exposes `Capabilities`,
  `MapRevocationStore`, `MapUseLedger` and `leafCidHex`, the request and
  result types, and the Ed25519 helpers `generateEd25519Keypair`,
  `publicKeyFromRaw`, `privateKeyFromPkcs8`, `rawPublicKey`, `signBytes` and
  `verifyBytes`.
- **The curated root is unchanged.** ADR-0011's rule — later subpaths, not a
  wider root barrel — is preserved.
- **The envelope stays local.** `ptf/cap@0.1` remains `@internal` and never a
  wire format (ADR-0009). This ADR does not make it a protocol. A host keeps
  it in process and shows the agent only the `cidHex` it must sign.

### The stated deviation from ADR-0011

ADR-0011 lists "canonical/crypto machinery (`canonicalize`, `sha256Hex`,
`termsDigestOf`, key functions)" as internal. This ADR exposes the Ed25519
helpers on the `./capabilities` subpath only.

The reason is that the capability workflow is inert without them. A
`Capabilities` instance needs a signer and a `KeyResolver`; PTF's
`KeyResolver` speaks raw 32-byte keys, a PTF-specific representation that a
consumer would otherwise reimplement — along with the exact 64-byte Ed25519
signature encoding — at every call site. Exposing the primitives the
workflow cannot work without is the same rule `./vault` follows by shipping
its own store. `canonicalize` and `termsDigestOf` stay internal: the public
root already offers `digestForOperation`, which binds the same terms without
exposing the canonicalisation machinery.

### The envelope itself: an amendment, not only an exposure

ADR-0011 classified the `ptf/cap@0.1` envelope (`Capabilities`,
`SealedCapability`, `CapabilityPayload`, `Demand`, `Redemption`) as internal,
deep paths only, never `api.ts`. This ADR moves that classification to the
new public `./capabilities` subpath while keeping the envelope local-only and
never wire (ADR-0009). The decision recorded here therefore **amends
ADR-0011's internal/deep-path classification** for the capability envelope;
the curated-root rule it establishes (later subpaths, not a wider root
barrel) continues to hold.

## Alternatives Considered

### Export `Capabilities` from the curated root

- **Pros**: one import for a consumer who wants the payment path.
- **Cons**: widens the curated root against ADR-0011, which says "narrower is
  the point" and that extending the public surface needs an explicit
  decision. It also puts the envelope next to `Authority` in the same
  namespace, which ADR-0009 warns against.
- **Why not**: a subpath is the sanctioned mechanism, and it keeps the
  envelope a deliberate, named choice rather than an accident of the root.

### Remove the payment executors from the root

- **Pros**: the root would advertise only paths it can support.
- **Cons**: they are legitimate for a host that composes its own redemption;
  removing them hides a working path, breaks consumers, and makes the root
  smaller by subtraction rather than by design.
- **Why not**: the executors are fine. The missing piece was the producer.

### Point `./capabilities` straight at `core/capability.js`

- **Pros**: no new module; the subpath matches the `./providers` shape.
- **Cons**: `core/capability.ts` imports `Demand`, `Redemption` and the
  other contract types from `core/types.ts` but does not re-export them, so a
  TypeScript consumer could not name the values it must pass to `redeem`.
  The hole would reopen for every typed consumer while closing for
  JavaScript ones.
- **Why not**: the facade is what makes the subpath usable from TypeScript.

### Leave it as it is

- **Pros**: no change; the root stays exactly as curated.
- **Cons**: the published surface advertises a payment path that cannot be
  taken. A consumer's first attempt to use the documented executor fails with
  a package-resolution error.
- **Why not**: an unreachable advertised path is a defect, not a limitation.

## Consequences

- The payment path is reachable through package specifiers only. Two tests
  hold it there: `tests/exports.test.ts` drives the whole journey — grant,
  authority decision, digest, capability issue, redeem with a recipient
  proof, execute, receipt — resolving every step through the `exports` map;
  and `scripts/verify-package.mjs --install` repeats it from the installed
  tarball in a clean directory, so a consumer-side hole fails the package
  gate rather than a user's project.
- The root barrel is unchanged and still does not export the envelope.
- A consumer writes its own executor: the root ships no `Fake*` executor, and
  the new subpath does not add one.
- The envelope remains local. Nothing in this ADR makes `ptf/cap@0.1` a wire
  format, and the host kit's reserved-domain rule (`/pay` and `/disclose` are
  refused) is unchanged.
