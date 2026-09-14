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
 * - recipient pinning via `recipientBounds(recipients)` (bound
 *   `.context.recipient in [...]`). Safe grants combine
 *   `paymentBounds` + `recipientBounds`; merchant-agnostic grants (no
 *   recipient bound) require explicit intent — they allow payment to any
 *   recipient and must be audited as deliberate.
 *
 * No new logic here — re-exports of the engine helpers plus the small
 * recipient-bound helper below.
 */

import type { AttributeBound } from "../core/authority.js";

export { paymentBounds, claimsSubset } from "../core/authority.js";

/**
 * Recipient-bound payment grants: the demanded `.context.recipient` must be
 * a member of `recipients`. Combine with `paymentBounds` for safe grants:
 * `[...paymentBounds({ amountMax, currency }), ...recipientBounds([...])]`.
 * Merchant-agnostic (no recipient bound) requires explicit intent.
 */
export function recipientBounds(
  recipients: readonly string[]
): AttributeBound[] {
  if (recipients.length === 0) {
    throw new Error("recipientBounds: recipients must be non-empty");
  }
  for (const r of recipients) {
    if (typeof r !== "string" || r.length === 0) {
      throw new Error("recipientBounds: recipients must be non-empty strings");
    }
  }
  return [{ path: ".context.recipient", op: "in", value: [...recipients] }];
}
