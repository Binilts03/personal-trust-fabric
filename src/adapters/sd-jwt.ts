import { canonicalize } from "../core/canonical.js";
import type { Presentation } from "../core/disclose.js";
import { isRecord } from "./guards.js";
import { b64uEncode, sha256b64uUtf8 } from "./jws.js";

/**
 * SD-JWT / KB-JWT disclosure translator (ADR-0009, evidence-only).
 * Projects a PTF `Presentation` into standard SD-JWT shapes (RFC9901) without
 * new crypto or trust roots:
 * - disclosure string: `b64u(JSON [salt, name, value])` (RFC9901 §4.2.1 array)
 * - `_sd` digest: `b64u(sha256(ascii(disclosure string)))` (RFC9901 §4.2.3)
 * - KB-JWT claims: `{iss: holder, aud: verifier, nonce, iat, sd_hash}`
 *   where `sd_hash` covers the SD payload below (local-first simplification;
 *   when the host mints real compact JWS it binds the compact serialization
 *   per RFC9901 §4.3.1).
 * PTF's own hex digest is carried as trace-only `ptf_digest` — verifiers
 * MUST recompute the standard digests and never trust it.
 * Issuance and trust registries stay host-side; x509/DID/mdoc validation is
 * out of scope (consistent with `adapters/oid4vp.ts` documented limits).
 *
 * Key confirmation (corrected 2026-09-13 — prior docs wrongly claimed RFC7800
 * defines no `kid` inside `cnf`): `cnf:{kid}` FOLLOWS RFC7800 §3.4
 * (key-ID confirmation; the recipient resolves the key from the ID), and
 * `cnf:{jwk}` is the richer by-value path (RFC7800 §3.2, RFC9901 §4.1.2
 * suggests `jwk`). Both shapes are standards-shaped; the PTF-local choice is
 * WHICH default to use: `presentationToSdJwt` defaults to `{kid: holder}`
 * (compat; holder DID as the key ID, resolved via PTF identity) and takes
 * `{holderJwk}` for standard `{jwk}`. Keep the `holderJwk` option.
 *
 * HOST OBLIGATIONS (this module verifies NO signatures, keeps NO replay
 * cache): the host MUST verify Issuer-JWT and KB-JWT signatures with its own
 * keys and MUST enforce nonce replay rejection (cf. `Disclose.verify`
 * `usedNonces` pattern). `verifySdProjection` is structural + digest binding
 * only — a passing result without host signature + replay checks is NOT a
 * complete verification.
 *
 * DEVIATIONS (every remaining non-standard item is PTF-local with reason;
 * standards-shaped behavior is labeled as such):
 * 1. PTF-local default: `cnf` defaults to `{kid: holder}` where the holder
 *    DID string is used as the key ID. Reason: compat fallback; shape follows
 *    RFC7800 §3.4 but the VALUE convention (DID as kid, resolved via PTF
 *    identity rather than a key registry) is PTF-local. Pass `{holderJwk}`
 *    for the richer `cnf:{jwk}` path.
 * 2. PTF-local: `sd_hash` covers PTF-canonical JSON of the SD payload, NOT
 *    the standard compact `IssuerJWT~D1~...` serialization (RFC9901 §4.3.1).
 *    Reason: local-first simplification. Hosts minting real compact JWS MUST
 *    recompute `sd_hash` over the compact serialization; ours binds the
 *    local projection only.
 * 3. Standards-shaped: KB-JWT signing input is ASCII `b64u(header).b64u(payload)`
 *    via `kbJwsSigningInput` with header `{typ:"kb+jwt",alg}` (RFC9901 §4.3).
 *    The PTF-local canonical-bytes input was removed.
 * 4. PTF-local fallback: KB `iat` defaults to payload `iat`
 *    (credential/presentation time). Reason: compat. The standard requires
 *    presentation time (RFC9901 §4.3 `iat`) — callers MUST pass `{nowSec}`
 *    to `sdPayloadToKbClaims`.
 * 5. PTF-local subset: only 3-element `[salt, name, value]` disclosures
 *    supported (RFC9901 §4.2.1). 2-element array-element disclosures
 *    `[salt, value]` (RFC9901 §4.2.2) are NOT supported and fail closed
 *    (`digest-mismatch` on verify). Reason: object-claim scope only.
 * 6. Standards-shaped with note: hashing uses UTF-8 bytes of the disclosure
 *    string (RFC9901 §4.2.3 says US-ASCII bytes of the b64u value; UTF-8
 *    matches ASCII for ASCII inputs, and disclosure strings are ASCII-only
 *    b64u so digests match RFC9901 vectors; payload `sd_hash` over Unicode
 *    canonical JSON uses UTF-8 — pre-fix code used ASCII).
 * 7. PTF-local verification policy: `iss`/`sub` are shape-checked always,
 *    verified against expectations ONLY when `expectedIss`/`expectedSub`
 *    are passed (mismatch → `issuer`). Reason: lets hosts opt into issuer
 *    pinning without forcing it in tests.
 * 8. Shared edge guards live in `adapters/guards.ts` (core stays zero-dep).
 */

export interface SdDisclosure {
  /** Standard disclosure string. */
  readonly disclosure: string;
  /** Standard `_sd` digest for this disclosure. */
  readonly digest: string;
  readonly name: string;
  /** Trace-only PTF hex digest. Never a trust input. */
  readonly ptf_digest: string;
}

export interface SdPayload {
  readonly iss: string;
  readonly sub: string;
  readonly cnf: Readonly<Record<string, unknown>>;
  readonly iat: number;
  /** Present when the credential had one. */
  readonly exp?: number;
  readonly _sd: readonly string[];
  readonly _sd_alg: "sha-256";
}

export interface KbClaims {
  readonly iss: string;
  readonly aud: string;
  readonly nonce: string;
  readonly iat: number;
  readonly sd_hash: string;
}

export class SdJwtError extends Error {
  constructor(reason: string) {
    super(`sd-jwt: ${reason}`);
  }
}

function b64uJson(value: unknown): string {
  return b64uEncode(Buffer.from(JSON.stringify(value), "utf8"));
}

function reqString(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new SdJwtError(`${what} must be a non-empty string`);
  }
  return v;
}

function reqFiniteNumber(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SdJwtError(`${what} must be a finite number`);
  }
  return v;
}

/** Project one PTF disclosure to its standard SD-JWT form. */
export function toSdDisclosure(d: {
  readonly name: string;
  readonly value: unknown;
  readonly salt: string;
  readonly digest: string;
}): SdDisclosure {
  if (!isRecord(d)) throw new SdJwtError("disclosure must be an object");
  const salt = reqString(d["salt"], "salt");
  const name = reqString(d["name"], "name");
  reqString(d["digest"], "digest");
  if (
    d["value"] === undefined ||
    typeof d["value"] === "function" ||
    typeof d["value"] === "symbol" ||
    typeof d["value"] === "bigint"
  ) {
    throw new SdJwtError(
      "disclosure value must be JSON-serializable (undefined/function/symbol/bigint would stringify to null or throw)"
    );
  }
  let disclosure: string;
  try {
    disclosure = b64uJson([salt, name, d["value"]]);
  } catch {
    throw new SdJwtError("disclosure value is not JSON-serializable");
  }
  return {
    disclosure,
    digest: sha256b64uUtf8(disclosure),
    name,
    ptf_digest: d["digest"] as string,
  };
}

/**
 * Project a PTF presentation to SD-JWT payload + disclosure list.
 * Default `cnf` is `{kid: holder}` (shape per RFC7800 §3.4 key-ID
 * confirmation; the DID-as-kid value convention is PTF-local compat).
 * Pass `{holderJwk}` for the richer `cnf:{jwk}` path (RFC7800 §3.2).
 */
export function presentationToSdJwt(
  pres: Presentation,
  opts: {
    readonly holderJwk?: Readonly<Record<string, unknown>>;
  } = {}
): {
  readonly payload: SdPayload;
  readonly disclosures: readonly SdDisclosure[];
} {
  if (!isRecord(pres as unknown))
    throw new SdJwtError("presentation must be an object");
  const holder = reqString(
    (pres as unknown as Record<string, unknown>)["holder"],
    "holder"
  );
  const issuer = reqString(
    (pres as unknown as Record<string, unknown>)["issuer"],
    "issuer"
  );
  const subject = reqString(
    (pres as unknown as Record<string, unknown>)["subject"],
    "subject"
  );
  reqFiniteNumber((pres as unknown as Record<string, unknown>)["iat"], "iat");
  const rawDisclosures = (pres as unknown as Record<string, unknown>)[
    "disclosures"
  ];
  if (!Array.isArray(rawDisclosures)) {
    throw new SdJwtError("disclosures must be an array");
  }
  const disclosures = (
    rawDisclosures as readonly {
      readonly name: string;
      readonly value: unknown;
      readonly salt: string;
      readonly digest: string;
    }[]
  ).map(toSdDisclosure);
  const rawCredExp = (pres as unknown as Record<string, unknown>)["credExp"];
  if (rawCredExp !== undefined) {
    reqFiniteNumber(rawCredExp, "credExp");
  }
  let cnf: Readonly<Record<string, unknown>>;
  if (opts.holderJwk !== undefined) {
    if (!isRecord(opts.holderJwk) || Object.keys(opts.holderJwk).length === 0) {
      throw new SdJwtError("holderJwk must be a non-empty object");
    }
    cnf = { jwk: opts.holderJwk };
  } else {
    // PTF-local compat default: shape per RFC7800 §3.4 ({kid}); richer
    // cnf:{jwk} via {holderJwk}.
    cnf = { kid: holder };
  }
  return {
    payload: {
      iss: issuer,
      sub: subject,
      cnf,
      iat: pres.iat,
      ...(pres.credExp !== undefined ? { exp: pres.credExp } : {}),
      _sd: disclosures.map((d) => d.digest),
      _sd_alg: "sha-256",
    },
    disclosures,
  };
}

/**
 * KB-JWT claims binding the SD payload to verifier + nonce. Host signs these.
 * Pass `{nowSec}` for presentation time (standard). Default `iat` falls back
 * to payload `iat` — documented non-standard fallback for compat.
 * With standard `cnf:{jwk}` payloads the holder id is NOT recoverable from
 * the payload — callers MUST pass `{holder}`; with `{kid}` payloads `holder`
 * is optional but must match `cnf.kid` when both are present.
 */
export function sdPayloadToKbClaims(
  sd: { readonly payload: SdPayload },
  opts: {
    readonly verifier: string;
    readonly nonce: string;
    readonly nowSec?: number;
    readonly holder?: string;
  }
): KbClaims {
  if (!isRecord(sd as unknown)) throw new SdJwtError("sd must be an object");
  const payload = (sd as unknown as Record<string, unknown>)["payload"];
  if (!isRecord(payload)) throw new SdJwtError("sd.payload must be an object");
  reqFiniteNumber(payload["iat"], "sd.payload.iat");
  if (payload["exp"] !== undefined) {
    reqFiniteNumber(payload["exp"], "sd.payload.exp");
  }
  const verifier = reqString(opts.verifier, "verifier");
  const nonce = reqString(opts.nonce, "nonce");
  let iat: number;
  if (opts.nowSec !== undefined) {
    iat = reqFiniteNumber(opts.nowSec, "nowSec");
  } else {
    // Documented non-standard fallback: credential/presentation time.
    iat = payload["iat"] as number;
  }
  const cnf = payload["cnf"];
  if (!isRecord(cnf)) throw new SdJwtError("sd.payload.cnf must be an object");
  const kid = cnf["kid"];
  const jwk = cnf["jwk"];
  let holder: string;
  if (opts.holder !== undefined) {
    holder = reqString(opts.holder, "holder");
    if (typeof kid === "string" && kid.length > 0 && kid !== holder) {
      throw new SdJwtError("holder differs from cnf.kid");
    }
  } else if (typeof kid === "string" && kid.length > 0) {
    holder = kid;
  } else if (isRecord(jwk)) {
    throw new SdJwtError(
      "holder required with cnf.jwk (standard path carries no kid)"
    );
  } else {
    throw new SdJwtError("cnf.kid must be a non-empty string");
  }
  let sdHash: string;
  try {
    sdHash = sha256b64uUtf8(canonicalize(payload));
  } catch {
    throw new SdJwtError("sd.payload is not canonicalizable");
  }
  return {
    iss: holder,
    aud: verifier,
    nonce,
    iat,
    sd_hash: sdHash,
  };
}

/**
 * Standard KB-JWT signing input: ASCII `b64u(header).b64u(payload)` with
 * header `{typ:"kb+jwt", alg}`. The caller MUST pass the real `alg` matching
 * the host key (`EdDSA` default is a placeholder, not a negotiation).
 */
export function kbJwsSigningInput(
  claims: KbClaims,
  header: { readonly typ?: string; readonly alg?: string } = {}
): Uint8Array {
  if (!isRecord(claims as unknown))
    throw new SdJwtError("claims must be an object");
  const rec = claims as unknown as Record<string, unknown>;
  reqString(rec["iss"], "claims.iss");
  reqString(rec["aud"], "claims.aud");
  reqString(rec["nonce"], "claims.nonce");
  reqFiniteNumber(rec["iat"], "claims.iat");
  reqString(rec["sd_hash"], "claims.sd_hash");
  const typ = header.typ ?? "kb+jwt";
  const alg = header.alg ?? "EdDSA";
  reqString(typ, "header.typ");
  reqString(alg, "header.alg");
  let h: string;
  let p: string;
  try {
    h = b64uJson({ typ, alg });
    p = b64uJson(claims);
  } catch {
    throw new SdJwtError("claims/header are not JSON-serializable");
  }
  return new Uint8Array(Buffer.from(`${h}.${p}`, "ascii"));
}

export type SdVerifyReason =
  | "audience"
  | "nonce"
  | "stale"
  | "expired"
  | "holder"
  | "issuer"
  | "digest-mismatch"
  | "sd-hash-mismatch";

/**
 * Verify an SD-JWT projection against the request it answers.
 * Recomputes every standard digest independently; PTF digests ignored.
 * Verifies NO signatures and checks NO replay cache — host obligations
 * (see module header). Never throws on malformed input; structural failures
 * map fail-closed: time-shape → `stale` (expiry-shape → `expired`), holder /
 * cnf-shape → `holder`, iss/sub-shape or `expectedIss`/`expectedSub`
 * mismatch → `issuer`, `_sd`/disclosure-shape or digest failures →
 * `digest-mismatch`, `sd_hash` failures → `sd-hash-mismatch`.
 */
export function verifySdProjection(
  sd: {
    readonly payload: SdPayload;
    readonly disclosures: readonly SdDisclosure[];
  },
  kb: KbClaims,
  opts: {
    readonly expectedAud: string;
    readonly expectedNonce: string;
    readonly expectedHolder: string;
    readonly expectedIss?: string;
    readonly expectedSub?: string;
    readonly maxAgeSec?: number;
    readonly nowSec: number;
  }
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SdVerifyReason } {
  if (!isRecord(sd as unknown)) return { ok: false, reason: "digest-mismatch" };
  if (!isRecord(kb as unknown)) return { ok: false, reason: "digest-mismatch" };
  if (!isRecord(opts as unknown))
    return { ok: false, reason: "digest-mismatch" };
  const payload = (sd as unknown as Record<string, unknown>)["payload"];
  if (!isRecord(payload)) return { ok: false, reason: "digest-mismatch" };
  const kbRec = kb as unknown as Record<string, unknown>;
  const optRec = opts as unknown as Record<string, unknown>;

  if (kbRec["aud"] !== optRec["expectedAud"])
    return { ok: false, reason: "audience" };
  if (kbRec["nonce"] !== optRec["expectedNonce"])
    return { ok: false, reason: "nonce" };

  const kbIat = kbRec["iat"];
  const nowSec = optRec["nowSec"];
  const maxAgeRaw = optRec["maxAgeSec"];
  const maxAge = maxAgeRaw === undefined ? 300 : maxAgeRaw;
  if (
    typeof kbIat !== "number" ||
    !Number.isFinite(kbIat) ||
    typeof nowSec !== "number" ||
    !Number.isFinite(nowSec) ||
    typeof maxAge !== "number" ||
    !Number.isFinite(maxAge)
  ) {
    return { ok: false, reason: "stale" };
  }
  if (
    nowSec < (kbIat as number) - 60 ||
    nowSec > (kbIat as number) + (maxAge as number)
  ) {
    return { ok: false, reason: "stale" };
  }
  const exp = payload["exp"];
  if (exp !== undefined) {
    if (typeof exp !== "number" || !Number.isFinite(exp)) {
      return { ok: false, reason: "expired" };
    }
    if ((nowSec as number) > (exp as number) + 60) {
      return { ok: false, reason: "expired" };
    }
  }
  if (kbRec["iss"] !== optRec["expectedHolder"])
    return { ok: false, reason: "holder" };
  const cnf = payload["cnf"];
  if (!isRecord(cnf)) return { ok: false, reason: "holder" };
  if (isRecord(cnf["jwk"])) {
    // Standard cnf:{jwk} path: holder binding already checked via kb.iss;
    // JWK contents (thumbprint) are a host signature-check obligation.
  } else if (cnf["kid"] !== optRec["expectedHolder"]) {
    return { ok: false, reason: "holder" };
  }
  const iss = payload["iss"];
  const sub = payload["sub"];
  if (typeof iss !== "string" || iss.length === 0) {
    return { ok: false, reason: "issuer" };
  }
  if (typeof sub !== "string" || sub.length === 0) {
    return { ok: false, reason: "issuer" };
  }
  const expectedIss = optRec["expectedIss"];
  if (expectedIss !== undefined && iss !== expectedIss) {
    return { ok: false, reason: "issuer" };
  }
  const expectedSub = optRec["expectedSub"];
  if (expectedSub !== undefined && sub !== expectedSub) {
    return { ok: false, reason: "issuer" };
  }
  const sdList = payload["_sd"];
  const disclosures = (sd as unknown as Record<string, unknown>)["disclosures"];
  if (
    !Array.isArray(sdList) ||
    !sdList.every((x) => typeof x === "string") ||
    !Array.isArray(disclosures)
  ) {
    return { ok: false, reason: "digest-mismatch" };
  }
  const digests = new Set(sdList as readonly string[]);
  for (const d of disclosures as readonly unknown[]) {
    if (!isRecord(d)) return { ok: false, reason: "digest-mismatch" };
    if (
      typeof d["disclosure"] !== "string" ||
      typeof d["digest"] !== "string"
    ) {
      return { ok: false, reason: "digest-mismatch" };
    }
    const disclosure = d["disclosure"] as string;
    const digest = d["digest"] as string;
    if (sha256b64uUtf8(disclosure) !== digest) {
      return { ok: false, reason: "digest-mismatch" };
    }
    // Structural check: must decode to 3-element [salt, name, value].
    // 2-element array disclosures are unsupported (fail closed here).
    try {
      const decoded = JSON.parse(
        Buffer.from(disclosure, "base64url").toString("utf8")
      ) as unknown;
      if (
        !Array.isArray(decoded) ||
        decoded.length !== 3 ||
        typeof decoded[0] !== "string" ||
        typeof decoded[1] !== "string"
      ) {
        return { ok: false, reason: "digest-mismatch" };
      }
    } catch {
      return { ok: false, reason: "digest-mismatch" };
    }
    if (!digests.has(digest)) return { ok: false, reason: "digest-mismatch" };
  }
  let expectedSdHash: string;
  try {
    expectedSdHash = sha256b64uUtf8(canonicalize(payload));
  } catch {
    return { ok: false, reason: "sd-hash-mismatch" };
  }
  if (
    typeof kbRec["sd_hash"] !== "string" ||
    kbRec["sd_hash"] !== expectedSdHash
  ) {
    return { ok: false, reason: "sd-hash-mismatch" };
  }
  return { ok: true };
}
