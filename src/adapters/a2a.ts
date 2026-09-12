import type { KeyObject } from "node:crypto";
import { sign } from "node:crypto";
import { signBytes, verifyBytes } from "../core/crypto.js";
import { b64uEncode, esDerToRaw, verifyEs256Key } from "./jws.js";
import { assertSafeUrl } from "./urls.js";

/**
 * A2A edge guards — card structure, signed-card verification, task states, push URLs.
 * Field inventory follows the deep read
 * (`docs/research/2026-09-09-deep-interop-mcp-webmcp-a2a.md`).
 *
 * JCS subset (documented limit): plain JSON values only (objects with string keys,
 * arrays, strings, safe-integer numbers, booleans, null). `undefined` fields are
 * dropped as defaults. Full RFC 8785 number/unicode edge cases are rejected
 * rather than mis-encoded. Signatures cover raw canonical bytes.
 */

export class A2aError extends Error {
  constructor(reason: string) {
    super(`a2a: ${reason}`);
  }
}

const KNOWN_SCHEMES = new Set([
  "apiKey",
  "httpAuth",
  "oauth2",
  "openIdConnect",
  "mtls",
]);
const KNOWN_FLOWS = new Set([
  "authorizationCode",
  "clientCredentials",
  "deviceCode",
]);

function reqString(
  obj: Record<string, unknown>,
  field: string,
  what: string
): string {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0)
    throw new A2aError(`${what}: missing ${field}`);
  return v;
}

function reqStringArray(
  obj: Record<string, unknown>,
  field: string,
  what: string
): string[] {
  const v = obj[field];
  if (
    !Array.isArray(v) ||
    v.length === 0 ||
    !v.every((e) => typeof e === "string")
  ) {
    throw new A2aError(`${what}: ${field} must be a non-empty string array`);
  }
  return v as string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural validation. Says nothing about trust — pair with signature verification. */
export function checkAgentCard(card: unknown): void {
  if (!isRecord(card)) throw new A2aError("card must be an object");
  reqString(card, "name", "card");
  reqString(card, "description", "card");
  reqString(card, "version", "card");
  const ifaces = card["supportedInterfaces"];
  if (!Array.isArray(ifaces) || ifaces.length === 0)
    throw new A2aError("card: supportedInterfaces required");
  for (const [i, entry] of ifaces.entries()) {
    if (!isRecord(entry))
      throw new A2aError(`card: interface ${i} must be an object`);
    assertSafeUrl(
      reqString(entry, "url", `card: interface ${i}`),
      `card: interface ${i} url`
    );
    reqString(entry, "protocolBinding", `card: interface ${i}`);
    reqString(entry, "protocolVersion", `card: interface ${i}`);
  }
  const provider = card["provider"];
  if (!isRecord(provider)) throw new A2aError("card: provider required");
  reqString(provider, "organization", "card: provider");
  if (provider["url"] !== undefined) {
    assertSafeUrl(
      reqString(provider, "url", "card: provider"),
      "card: provider url"
    );
  }
  for (const field of ["documentationUrl", "iconUrl"] as const) {
    if (card[field] !== undefined) {
      assertSafeUrl(reqString(card, field, "card"), `card: ${field}`);
    }
  }
  const capabilities = card["capabilities"];
  if (capabilities !== undefined && !isRecord(capabilities)) {
    throw new A2aError("card: capabilities must be an object");
  }
  reqStringArray(card, "defaultInputModes", "card");
  reqStringArray(card, "defaultOutputModes", "card");
  const skills = card["skills"];
  if (!Array.isArray(skills) || skills.length === 0)
    throw new A2aError("card: skills required");
  for (const [i, skill] of skills.entries()) {
    if (!isRecord(skill))
      throw new A2aError(`card: skill ${i} must be an object`);
    reqString(skill, "id", `card: skill ${i}`);
    reqString(skill, "name", `card: skill ${i}`);
    reqString(skill, "description", `card: skill ${i}`);
  }
  const schemes = card["securitySchemes"];
  if (schemes !== undefined) {
    if (!isRecord(schemes))
      throw new A2aError("card: securitySchemes must be an object");
    for (const [name, scheme] of Object.entries(schemes)) {
      if (!isRecord(scheme))
        throw new A2aError(`card: scheme ${name} must be an object`);
      const type = reqString(scheme, "type", `card: scheme ${name}`);
      if (!KNOWN_SCHEMES.has(type))
        throw new A2aError(`card: unknown scheme ${type}`);
      const flows = scheme["flows"];
      if (flows !== undefined) {
        if (!Array.isArray(flows))
          throw new A2aError(`card: scheme ${name} flows must be an array`);
        for (const flow of flows) {
          if (typeof flow !== "string" || !KNOWN_FLOWS.has(flow)) {
            throw new A2aError(
              `card: scheme ${name} uses deprecated/unknown flow`
            );
          }
        }
      }
    }
  }
}

/** JCS-subset canonicalization: sorted keys, no whitespace, safe integers only. */
export function canonicalJcs(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value) as string;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new A2aError("JCS subset: numbers must be safe integers");
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJcs(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJcs(v)}`).join(",")}}`;
  }
  throw new A2aError("JCS subset: unsupported value");
}

export type CardKey =
  | { readonly alg: "ES256"; readonly key: KeyObject }
  | { readonly alg: "EdDSA"; readonly key: Uint8Array };

export interface CardSignature {
  readonly protected: {
    readonly alg: string;
    readonly kid: string;
    readonly typ?: string;
    readonly jku?: string;
  };
  readonly signature: string;
}

function utf8(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "utf8"));
}

/** Sign a card (minus `signatures`) for distribution. Hosts use this to publish. */
export function signAgentCard(
  card: Record<string, unknown>,
  kid: string,
  key: { readonly alg: "ES256" | "EdDSA"; readonly privateKey: KeyObject }
): CardSignature {
  const canonical = canonicalJcs(card);
  const sig =
    key.alg === "ES256"
      ? esDerToRaw(
          sign("sha256", Buffer.from(canonical, "utf8"), key.privateKey)
        )
      : Buffer.from(signBytes(key.privateKey, utf8(canonical)));
  return {
    protected: { alg: key.alg, kid, typ: "JOSE" },
    signature: b64uEncode(sig),
  };
}

/**
 * Verify card signatures over the canonical form minus `signatures`.
 * Every listed signature must verify — a forged entry fails the set, since a
 * mixed set signals tampering, not redundancy. Unknown kids, alg mismatches,
 * and non-allowlisted algorithms throw. Returns the count of valid signatures.
 */
export function verifyCardSignatures(
  card: Record<string, unknown> & {
    readonly signatures?: readonly CardSignature[];
  },
  resolve: (kid: string) => CardKey | null
): { readonly verified: number } {
  const sigs = card.signatures;
  if (!Array.isArray(sigs) || sigs.length === 0)
    throw new A2aError("unsigned card");
  const { signatures, ...rest } = card;
  void signatures;
  const canonical = canonicalJcs(rest);
  let valid = 0;
  for (const sig of sigs) {
    const alg = sig.protected.alg;
    const kid = sig.protected.kid;
    if (
      typeof alg !== "string" ||
      typeof kid !== "string" ||
      kid.length === 0
    ) {
      throw new A2aError("signature missing alg/kid");
    }
    if (alg !== "ES256" && alg !== "EdDSA")
      throw new A2aError(`unsupported card algorithm ${alg}`);
    const found = resolve(kid);
    if (found === null) throw new A2aError(`unknown signing key ${kid}`);
    if (found.alg !== alg) throw new A2aError(`algorithm mismatch for ${kid}`);
    const sigBytes = Buffer.from(sig.signature, "base64url");
    const ok =
      found.alg === "ES256"
        ? verifyEs256Key(found.key, canonical, sigBytes.toString("base64url"))
        : verifyBytes(found.key, utf8(canonical), new Uint8Array(sigBytes));
    if (!ok) throw new A2aError(`invalid card signature from ${kid}`);
    valid += 1;
  }
  if (valid === 0) throw new A2aError("no valid card signature");
  return { verified: valid };
}

export type TaskState =
  | "SUBMITTED"
  | "WORKING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "INPUT_REQUIRED"
  | "REJECTED"
  | "AUTH_REQUIRED";

const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  SUBMITTED: [
    "WORKING",
    "REJECTED",
    "CANCELED",
    "INPUT_REQUIRED",
    "AUTH_REQUIRED",
  ],
  WORKING: [
    "WORKING",
    "COMPLETED",
    "FAILED",
    "CANCELED",
    "INPUT_REQUIRED",
    "AUTH_REQUIRED",
  ],
  INPUT_REQUIRED: ["WORKING", "CANCELED"],
  AUTH_REQUIRED: ["WORKING", "CANCELED"],
  COMPLETED: [],
  FAILED: [],
  CANCELED: [],
  REJECTED: [],
};

const STATES = new Set(Object.keys(TRANSITIONS));

/** Terminal states are immutable; anything else follows the transition table. */
export function checkTaskTransition(from: string, to: string): void {
  if (!STATES.has(from) || !STATES.has(to))
    throw new A2aError(`unknown task state ${from} → ${to}`);
  const allowed = TRANSITIONS[from as TaskState] ?? [];
  if (!(allowed as readonly string[]).includes(to)) {
    throw new A2aError(`illegal task transition ${from} → ${to}`);
  }
}

/** Push endpoints obey the same safety rules as any fetched URL. No loopback delivery. */
export function checkPushUrl(url: string): void {
  assertSafeUrl(url, "push", false);
}
