/**
 * Internal privacy helpers. This module is deliberately NOT re-exported by
 * the curated `./privacy` surface: adding a symbol to that surface is a
 * public-surface decision (ADR-0011), and these helpers do not earn one.
 */

/** True when every requested item is present in the allowed set. */
export function isSubset(
  requested: readonly string[],
  allowed: readonly string[]
): boolean {
  return requested.every((item) => allowed.includes(item));
}
