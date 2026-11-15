/**
 * Curated capability API (ADR-0028, amends ADR-0011).
 *
 * ## Why this subpath exists
 *
 * `Capabilities` is the only producer of a `Redemption`. The curated root's
 * payment executors — `executeAndReceipt`, `executeViaProvider` and
 * `providerAsExecutor` — all require one, and `requireBoundOperation`
 * refuses a redemption that is not bound to the exact authorized operation.
 * But `Capabilities` lived only on the internal barrel (`src/index.ts`),
 * which the `exports` map does not expose: a consumer importing the package
 * by name could see the payment executors and had no way to produce the
 * value they need. The payment path was therefore unreachable from the
 * published surface. This subpath closes that hole without widening the
 * curated root, which is the rule ADR-0011 sets for every later subpath.
 *
 * ## The Ed25519 helpers are part of the contract
 *
 * A capability is only meaningful with a signer and a key resolver, and
 * PTF's `KeyResolver` speaks raw 32-byte keys — a PTF-specific
 * representation. Without `rawPublicKey`/`publicKeyFromRaw`/`signBytes` a
 * consumer would reimplement the JWK-to-raw conversion (and the exact
 * 64-byte Ed25519 signature encoding `node:crypto` produces) at every call
 * site. Exposing the primitives the workflow cannot work without is the
 * same rule `./vault` follows by shipping its own store.
 *
 * ## LOCAL ONLY — never wire
 *
 * The `ptf/cap@0.1` envelope is `@internal` and never a wire format
 * (ADR-0009). A host keeps it in process and shows the agent only the
 * `cidHex` it must sign (see `createHostRedemptionChallenge` on
 * `./hostkit`). Nothing here is a protocol; it is the local receipt
 * machinery that lets a host hold a secret-bearing right without handing it
 * to the agent.
 */
export {
  Capabilities,
  MapRevocationStore,
  MapUseLedger,
  leafCidHex,
} from "./core/capability.js";
export {
  generateEd25519Keypair,
  privateKeyFromPkcs8,
  publicKeyFromRaw,
  rawPublicKey,
  signBytes,
  verifyBytes,
} from "./core/crypto.js";
export type { AuthorizeOptions, IssueRequest } from "./core/capability.js";
export type { Ed25519Keypair } from "./core/crypto.js";
export type {
  AuthorizeResult,
  AuthorizedOperation,
  CapabilityChain,
  CapabilityPayload,
  CheckResult,
  DenyReason,
  Demand,
  KeyResolver,
  Redemption,
  RedemptionResult,
  RevocationStore,
  SealedCapability,
  UseLedger,
} from "./core/types.js";
