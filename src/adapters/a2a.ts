import type { KeyObject } from "node:crypto";
import { sign } from "node:crypto";
import { canonicalize, utf8Bytes } from "../core/canonical.js";
import { signBytes, verifyBytes } from "../core/crypto.js";
import { isRecord, reqString } from "./guards.js";
import { b64uEncode, esDerToRaw, verifyEs256Key } from "./jws.js";
import { assertSafeUrl, fetchWithPinning } from "./urls.js";
import type { PinnedFetchOptions } from "./urls.js";

/**
 * A2A edge guards — card structure, signed-card verification, task states, push URLs.
 * Field inventory follows the deep read
 * (`docs/research/2026-09-09-deep-interop-mcp-webmcp-a2a.md`).
 *
 * JCS subset (documented limit): plain JSON values only (objects with string keys,
 * arrays, strings, safe-integer numbers, booleans, null). `undefined` fields are
 * dropped as defaults. Lone surrogates are rejected (JSON.stringify would pass
 * them through); other unicode is preserved as-is. Full RFC 8785 number
 * normalization beyond safe-integers is rejected rather than mis-encoded.
 * Signatures cover raw canonical bytes. `jku` is rejected — keys arrive via
 * explicit `resolve`, never by URL. Card/key expiry and revocation must be
 * checked by the host (`resolve` MUST use HTTPS and refuse expired/revoked
 * keys); this module checks structure + signatures only.
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

function reqStringArray(
  obj: Record<string, unknown>,
  field: string,
  what: string
): string[] {
  const v = obj[field];
  if (
    !Array.isArray(v) ||
    v.length === 0 ||
    !v.every((e) => typeof e === "string" && (e as string).length > 0)
  ) {
    throw new A2aError(`${what}: ${field} must be a non-empty string array`);
  }
  return v as string[];
}

/** Structural validation. Says nothing about trust — pair with signature verification. */
export function checkAgentCard(card: unknown): void {
  if (!isRecord(card)) throw new A2aError("card must be an object");
  if ("jku" in card)
    throw new A2aError("card must not carry jku (resolve keys explicitly)");
  reqString(card["name"], "a2a: card: missing name");
  reqString(card["description"], "a2a: card: missing description");
  reqString(card["version"], "a2a: card: missing version");
  const ifaces = card["supportedInterfaces"];
  if (!Array.isArray(ifaces) || ifaces.length === 0)
    throw new A2aError("card: supportedInterfaces required");
  for (const [i, entry] of ifaces.entries()) {
    if (!isRecord(entry))
      throw new A2aError(`card: interface ${i} must be an object`);
    assertSafeUrl(
      reqString(entry["url"], `a2a: card: interface ${i}: missing url`),
      `card: interface ${i} url`
    );
    reqString(
      entry["protocolBinding"],
      `a2a: card: interface ${i}: missing protocolBinding`
    );
    reqString(
      entry["protocolVersion"],
      `a2a: card: interface ${i}: missing protocolVersion`
    );
  }
  const provider = card["provider"];
  if (!isRecord(provider)) throw new A2aError("card: provider required");
  reqString(
    provider["organization"],
    "a2a: card: provider: missing organization"
  );
  if (provider["url"] !== undefined) {
    assertSafeUrl(
      reqString(provider["url"], "a2a: card: provider: missing url"),
      "card: provider url"
    );
  }
  for (const field of ["documentationUrl", "iconUrl"] as const) {
    if (card[field] !== undefined) {
      assertSafeUrl(
        reqString(card[field], `a2a: card: missing ${field}`),
        `card: ${field}`
      );
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
    reqString(skill["id"], `a2a: card: skill ${i}: missing id`);
    reqString(skill["name"], `a2a: card: skill ${i}: missing name`);
    reqString(
      skill["description"],
      `a2a: card: skill ${i}: missing description`
    );
  }
  const schemes = card["securitySchemes"];
  if (schemes !== undefined) {
    if (!isRecord(schemes))
      throw new A2aError("card: securitySchemes must be an object");
    for (const [name, scheme] of Object.entries(schemes)) {
      if (!isRecord(scheme))
        throw new A2aError(`card: scheme ${name} must be an object`);
      const type = reqString(
        scheme["type"],
        `a2a: card: scheme ${name}: missing type`
      );
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
  validateJcs(value);
  return canonicalize(value);
}

function validateJcs(value: unknown): void {
  if (value === null) return;
  if (typeof value === "string") {
    if (/[\uD800-\uDFFF]/.test(value)) {
      throw new A2aError("JCS subset: lone surrogates rejected");
    }
    return;
  }
  if (typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new A2aError("JCS subset: numbers must be safe integers");
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) validateJcs(v);
    return;
  }
  if (typeof value === "object") {
    if (
      value instanceof Uint8Array ||
      value instanceof Map ||
      value instanceof Set
    ) {
      throw new A2aError("JCS subset: unsupported value");
    }
    for (const [, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) validateJcs(v);
    }
    return;
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

/** Sign a card (minus `signatures`) for distribution. Hosts use this to publish. */
export function signAgentCard(
  card: Record<string, unknown>,
  kid: string,
  key: { readonly alg: "ES256" | "EdDSA"; readonly privateKey: KeyObject }
): CardSignature {
  const { signatures, ...unsigned } = card;
  if (signatures !== undefined) {
    throw new A2aError("signAgentCard: card must not already carry signatures");
  }
  const canonical = canonicalJcs(unsigned);
  const sig =
    key.alg === "ES256"
      ? esDerToRaw(
          sign("sha256", Buffer.from(canonical, "utf8"), key.privateKey)
        )
      : Buffer.from(signBytes(key.privateKey, utf8Bytes(canonical)));
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
  // `jku` must never ride along: keys arrive via explicit resolve, never by URL.
  if ("jku" in rest) {
    throw new A2aError("card must not carry jku (resolve keys explicitly)");
  }
  const canonical = canonicalJcs(rest);
  let valid = 0;
  for (const entry of sigs) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new A2aError("malformed card signature entry");
    }
    const rec = entry as Record<string, unknown>;
    const prot = rec["protected"];
    if (typeof prot !== "object" || prot === null || Array.isArray(prot)) {
      throw new A2aError("signature missing alg/kid");
    }
    if ("jku" in (prot as Record<string, unknown>)) {
      throw new A2aError("signature must not carry jku");
    }
    const alg = (prot as Record<string, unknown>)["alg"];
    const kid = (prot as Record<string, unknown>)["kid"];
    const sigB64 = rec["signature"];
    if (
      typeof alg !== "string" ||
      typeof kid !== "string" ||
      kid.length === 0 ||
      typeof sigB64 !== "string" ||
      sigB64.length === 0
    ) {
      throw new A2aError("signature missing alg/kid");
    }
    if (alg !== "ES256" && alg !== "EdDSA")
      throw new A2aError(`unsupported card algorithm ${alg}`);
    const found = resolve(kid);
    if (found === null) throw new A2aError(`unknown signing key ${kid}`);
    if (found.alg !== alg) throw new A2aError(`algorithm mismatch for ${kid}`);
    let sigBytes: Buffer;
    try {
      sigBytes = Buffer.from(sigB64, "base64url");
    } catch {
      throw new A2aError(`malformed card signature from ${kid}`);
    }
    if (sigBytes.length === 0)
      throw new A2aError(`malformed card signature from ${kid}`);
    const ok =
      found.alg === "ES256"
        ? verifyEs256Key(found.key, canonical, sigBytes.toString("base64url"))
        : verifyBytes(
            found.key,
            utf8Bytes(canonical),
            new Uint8Array(sigBytes)
          );
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

/**
 * Pinned-HTTPS key-fetch guard (ticket 11, host-owned).
 * Card/key bytes MUST arrive over pinned HTTPS fetched via
 * `fetchWithPinning` — never http, never a private-range host, never
 * `jku`-directed. Expiry + revocation are host-checked here so a stale
 * or retired key fails closed before any signature verifies.
 */
export function assertKeyFetchUrl(raw: string): URL {
  return assertSafeUrl(raw, "a2a key", false);
}

export interface CardKeyPolicy {
  /** Lowercased-host allowlist. Absent = any public-https host. */
  readonly allowedHosts?: readonly string[];
  /** Host revocation callback. True = retired, fail closed. */
  readonly isRevoked?: (kid: string) => boolean;
  /** Epoch-ms expiry for the resolved key. Absent = no expiry claim. */
  readonly expiresAtMs?: number;
  readonly nowMs?: number;
}

export function checkCardKeyPolicy(
  kid: string,
  rawUrl: string,
  policy?: CardKeyPolicy
): URL {
  if (kid.length === 0) throw new A2aError("key policy: missing kid");
  const url = assertKeyFetchUrl(rawUrl);
  const allowed = policy?.allowedHosts;
  if (allowed !== undefined && !allowed.includes(url.hostname.toLowerCase())) {
    throw new A2aError(`key host not pinned: ${url.hostname}`);
  }
  if (policy?.isRevoked?.(kid) === true) {
    throw new A2aError(`revoked signing key ${kid}`);
  }
  const expiresAt = policy?.expiresAtMs;
  if (expiresAt !== undefined) {
    const now = policy?.nowMs ?? Date.now();
    if (!Number.isFinite(now) || !Number.isFinite(expiresAt)) {
      throw new A2aError("key policy: non-finite time");
    }
    if (now > expiresAt) throw new A2aError(`expired signing key ${kid}`);
  }
  return url;
}

export interface PinnedKeySource {
  /** Host mapping from key id to its fetch URL (never `jku`-directed). */
  readonly urlForKid: (kid: string) => string;
  readonly policy?: CardKeyPolicy;
  /** Passed through to `fetchWithPinning` (lookup/fetchFn injectable). */
  readonly fetch?: PinnedFetchOptions;
}

/**
 * Fetch one card key's bytes over the pinned path (review follow-up — the
 * guard above had no caller). Policy first (https, host, revocation,
 * expiry), then `fetchWithPinning` (DNS + redirect re-check, no-follow
 * by default). Parsing the bytes into a `CardKey` stays host duty:
 * feed them to `verifyEs256Key`/Ed25519 verification behind the host's
 * own trust root.
 */
export async function fetchCardKeyBytes(
  kid: string,
  source: PinnedKeySource
): Promise<{ readonly url: string; readonly text: string }> {
  const url = checkCardKeyPolicy(kid, source.urlForKid(kid), source.policy);
  const res = await fetchWithPinning(url.toString(), {
    ...source.fetch,
    what: "a2a key",
  });
  return { url: url.toString(), text: await res.text() };
}
