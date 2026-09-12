import { createHash } from "node:crypto";

/** Canonical JSON: sorted object keys, UTF-8, no whitespace. Maps/Sets rejected (non-canonical). */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value) as string;
  if (t === "number") {
    if (!Number.isFinite(value))
      throw new Error("canonical: non-finite number");
    return JSON.stringify(value) as string;
  }
  if (t === "boolean") return value ? "true" : "false";
  if (t === "undefined") throw new Error("canonical: undefined not allowed");
  if (typeof value === "bigint")
    throw new Error("canonical: bigint not allowed");
  if (value instanceof Uint8Array) {
    return JSON.stringify({
      "/": { bytes: Buffer.from(value).toString("base64") },
    });
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  }
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  throw new Error(`canonical: unsupported type ${t}`);
}

export function sha256Hex(data: string | Uint8Array): string {
  const h = createHash("sha256");
  h.update(
    typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)
  );
  return h.digest("hex");
}

/** Digest bound to an approval's exact terms. Any term change → different digest → new approval. */
export function termsDigestOf(terms: unknown): string {
  return sha256Hex(canonicalize(terms));
}

/** Content id of a capability payload (hex). Unique per nonce. */
export function payloadCid(canonicalPayload: string): string {
  return sha256Hex(canonicalPayload);
}
