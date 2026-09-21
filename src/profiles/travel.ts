/**
 * Travel profile (M7). Conventions over the domain-neutral authority engine
 * and the ProtectedProvider seam — a small helper set for travel bookings.
 *
 * Travel operations use `/travel/book` as the canonical command. The
 * `ProtectedProvider` seam handles execution; this profile defines:
 *
 * - `travelBounds`: ceiling constraints for travel bookings (traveler count,
 *   exact depart date, route/class, fare ceiling with currency)
 * - `recipientBounds` (re-exported from payment profile): pin the travel
 *   provider as the sole recipient
 * - `TravelDemand`: the shape of a travel booking demand
 *
 * Travel is a non-payment action — receipts are `ExecutionReceipt` (no
 * `amount`/`currency`). Amounts, if applicable, ride in `context` as
 * authorized terms (e.g. fare ceiling), not as receipt fields.
 */

import type { AttributeBound } from "../core/authority.js";

export { recipientBounds } from "./payment.js";

/**
 * Travel booking demand shape for use with `Authority.evaluate`.
 */
export interface TravelDemand {
  /** Action: `/travel/book` */
  readonly action: { readonly name: "/travel/book" };
  /** Resource: the booking to be made. */
  readonly resource: { readonly type: "flight" | "hotel" | "car" | "train"; readonly id: string };
  /** Authorized travel context. */
  readonly context: {
    /** Origin airport/city code (IATA). */
    readonly origin?: string;
    /** Destination airport/city code (IATA). */
    readonly destination?: string;
    /** Departure date (ISO 8601). */
    readonly departDate?: string;
    /** Return date (ISO 8601, optional for one-way). */
    readonly returnDate?: string;
    /** Number of travelers. */
    readonly travelers?: number;
    /** Fare class (economy, business, first). */
    readonly class?: string;
    /** Maximum fare in atomic units (optional ceiling). */
    readonly fareMax?: number;
    /** Currency for fare ceiling (optional). */
    readonly currency?: string;
    /** Traveler identity. */
    readonly traveler?: string;
    /** Provider identity. */
    readonly recipient?: string;
    /** Free-text notes (non-effectful, host review). */
    readonly notes?: string;
  };
  /** Purpose binding. */
  readonly purpose: string;
}

/**
 * Travel booking bounds: constrains a travel operation to specific routes,
 * exact depart date, traveler counts, fare ceilings, and classes.
 *
 * @example
 * ```ts
 * const bounds = travelBounds({
 *   origin: "BLR",
 *   destination: "DEL",
 *   class: "economy",
 *   travelersMax: 2,
 *   fareMax: 50000,
 *   currency: "INR",
 * });
 * auth.addGrant({
 *   id: "g-travel",
 *   principal: P,
 *   actor: { kind: "exact", id: AGENT },
 *   action: { name: "/travel/book" },
 *   bounds,
 *   exp: NOW + 86400,
 * });
 * ```
 */
export function travelBounds(opts: {
  readonly origin?: string;
  readonly destination?: string;
  readonly class?: string;
  readonly travelersMax?: number;
  readonly fareMax?: number;
  readonly currency?: string;
  /**
   * Exact departure-date match (ISO 8601). A range comparison is
   * deliberately NOT offered: `AttributeBound` `<=`/`>=` apply to finite
   * numbers only, so a string `<=` bound would never match (fail-closed
   * but confusing). Hosts needing a window authorize one exact date per
   * grant or gate the window in provider review.
   */
  readonly departDate?: string;
}): AttributeBound[] {
  const nonEmpty = (v: string | undefined, name: string): void => {
    if (v !== undefined && (typeof v !== "string" || v.length === 0)) {
      throw new Error(`travelBounds: ${name} must be a non-empty string`);
    }
  };
  nonEmpty(opts.origin, "origin");
  nonEmpty(opts.destination, "destination");
  nonEmpty(opts.class, "class");
  nonEmpty(opts.currency, "currency");
  nonEmpty(opts.departDate, "departDate");
  if (
    opts.travelersMax !== undefined &&
    (!Number.isSafeInteger(opts.travelersMax) || opts.travelersMax < 1)
  ) {
    throw new Error("travelBounds: travelersMax must be an integer >= 1");
  }
  if (
    opts.fareMax !== undefined &&
    (typeof opts.fareMax !== "number" ||
      !Number.isFinite(opts.fareMax) ||
      opts.fareMax < 0)
  ) {
    throw new Error(
      "travelBounds: fareMax must be a non-negative finite number"
    );
  }
  if (opts.fareMax !== undefined && opts.currency === undefined) {
    throw new Error(
      "travelBounds: currency required with fareMax (unambiguous ceiling)"
    );
  }
  const bounds: AttributeBound[] = [];
  if (opts.origin !== undefined) {
    bounds.push({ path: ".context.origin", op: "==", value: opts.origin });
  }
  if (opts.destination !== undefined) {
    bounds.push({ path: ".context.destination", op: "==", value: opts.destination });
  }
  if (opts.class !== undefined) {
    bounds.push({ path: ".context.class", op: "==", value: opts.class });
  }
  if (opts.travelersMax !== undefined) {
    bounds.push({ path: ".context.travelers", op: "<=", value: opts.travelersMax });
  }
  if (opts.fareMax !== undefined) {
    bounds.push({ path: ".context.fareMax", op: "<=", value: opts.fareMax });
  }
  if (opts.currency !== undefined) {
    bounds.push({ path: ".context.currency", op: "==", value: opts.currency });
  }
  if (opts.departDate !== undefined) {
    bounds.push({ path: ".context.departDate", op: "==", value: opts.departDate });
  }
  return bounds;
}
