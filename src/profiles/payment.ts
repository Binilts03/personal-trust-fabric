/**
 * Payment profile (ticket 09; ADR-0010 engine, ADR-0011 surface). Conventions
 * over the domain-neutral Authority engine — a small helper set, not a policy
 * language:
 *
 * - `context.amount`: number in the asset's ATOMIC (minor) units. No decimal
 *   shifting inside PTF — shifting silently changes value. x402 flows parse
 *   atomic-unit integer strings at the adapter edge (`parseAtomicAmount`)
 *   before values reach the engine.
 * - `context.currency`: currency/asset code pinned by `paymentBounds`
 *   (e.g. "INR", "USDC").
 * - `context.recipient`: recipient key id, fixed across attenuation.
 * - `resource`: the domain object being paid for
 *   (e.g. `{ type: "invoice", id: "invoice:1" }`).
 * - ceilings via `paymentBounds({ amountMax, currency })` (bounds
 *   `.context.amount <=` + `.context.currency ==`); disclosure allow-lists
 *   via `claimsSubset(allowed)` (bound `.context.claims subset`).
 *
 * No new logic here — re-exports of the engine helpers.
 */

export { paymentBounds, claimsSubset } from "../core/authority.js";
