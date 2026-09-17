/**
 * Shared guards (deduplicated leaf: no imports, safe for adapters, profiles,
 * and stores to share).
 * `isRecord` is the standard plain-record check used across the edge;
 * `reqString` validates a value is a non-empty string, throwing generic
 * `Error` with the caller's message (callers preserve their `prefix: ...`
 * text at the call site so messages stay identical).
 */

/** Non-empty-string predicate shared by vault, contract, and providers. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Plain-object record check (arrays rejected). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Non-empty-string check. `what` is the full error text (prefix included). */
export function reqString(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(what);
  }
  return v;
}
