/**
 * Shared edge guards for adapters (deduplicated).
 * `isRecord` is the standard plain-record check used across the edge;
 * `reqString` validates a value is a non-empty string, throwing generic
 * `Error` with the caller's message (callers preserve their `prefix: ...`
 * text at the call site so messages stay identical).
 */

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
