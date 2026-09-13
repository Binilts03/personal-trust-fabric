import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from "node:crypto";

/**
 * Shared JWS utilities for the edge adapters (A2A cards today).
 * ES256 signatures are raw R||S (JWS style); node:crypto wants DER — converted here.
 */

export const b64uEncode = (data: Uint8Array | Buffer | string): string =>
  Buffer.from(data as Uint8Array).toString("base64url");

export function b64uDecodeStrict(s: string, what = "jws"): Buffer {
  if (s.length === 0 || !/^[A-Za-z0-9_-]*={0,2}$/.test(s) || /[\s]/.test(s)) {
    throw new Error(`jws: ${what} is not base64url`);
  }
  return Buffer.from(s, "base64url");
}

export const b64uDecode = (s: string): Buffer => Buffer.from(s, "base64url");

/** Single sha256(utf8) → base64url helper (deduplicated from sd-jwt/ap2). UTF-8 matches ASCII for ASCII inputs. */
export function sha256b64uUtf8(s: string): string {
  return createHash("sha256").update(s, "utf8").digest().toString("base64url");
}

/** Raw R||S to DER. Exported for unit-testing the minimal-encoding edge cases. */
export function rawToDer(raw: Buffer): Buffer {
  if (raw.length !== 64) throw new Error("jws: ES256 signatures are 64 bytes");
  // Reduce to minimal form FIRST: strip leading zeros only while the next
  // byte's top bit is clear (otherwise the value would turn negative).
  // Padding back to 32 and then encoding naively emits `02 20 00...` for
  // 31-byte values, which strict DER parsers reject.
  const minimal = (b: Buffer): Buffer => {
    let v = b;
    while (v.length > 1 && v[0] === 0 && (v[1] as number) < 0x80) {
      v = v.slice(1);
    }
    return v;
  };
  const enc = (b: Buffer): Buffer => {
    const v = minimal(b);
    const p =
      v[0] !== undefined && v[0] >= 0x80
        ? Buffer.concat([Buffer.from([0]), v])
        : v;
    return Buffer.concat([Buffer.from([0x02, p.length]), p]);
  };
  const r = enc(raw.slice(0, 32));
  const s = enc(raw.slice(32, 64));
  const total = r.length + s.length;
  const totalEnc =
    total < 128 ? Buffer.from([total]) : Buffer.from([0x81, total]);
  return Buffer.concat([Buffer.from([0x30]), totalEnc, r, s]);
}

export interface ParsedCompactJws {
  readonly header: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
  readonly signingInput: string;
  readonly sigB64u: string;
}

export function parseCompactJws(
  compact: string,
  what: string
): ParsedCompactJws {
  const segs = compact.split(".");
  if (segs.length !== 3) throw new Error(`jws: ${what} is not compact JWS`);
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(
      b64uDecode(segs[0] as string).toString("utf8")
    ) as Record<string, unknown>;
    payload = JSON.parse(
      b64uDecode(segs[1] as string).toString("utf8")
    ) as Record<string, unknown>;
  } catch {
    throw new Error(`jws: ${what} has malformed JSON`);
  }
  return {
    header,
    payload,
    signingInput: `${segs[0]}.${segs[1]}`,
    sigB64u: segs[2] as string,
  };
}

export function verifyEs256Key(
  pub: KeyObject,
  signingInput: string,
  sigB64u: string
): boolean {
  try {
    return verify(
      "sha256",
      Buffer.from(signingInput, "ascii"),
      pub,
      rawToDer(b64uDecode(sigB64u))
    );
  } catch {
    return false;
  }
}

export function publicKeyFromP256Jwk(jwk: {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: unknown;
}): KeyObject {
  if ((jwk as Record<string, unknown>)["d"] !== undefined) {
    throw new Error("jws: private material must never enter the verifier");
  }
  return createPublicKey({ key: jwk as never, format: "jwk" });
}

/** DER (node:crypto) → raw R||S (JWS). Lengths use short or long form. */
export function esDerToRaw(der: Buffer): Buffer {
  let o = 0;
  if (der[o] !== 0x30) throw new Error("jws: bad DER sequence");
  o += 1;
  let len = der[o] as number;
  o += 1;
  if (len >= 0x80) {
    const count = len - 0x80;
    o += count;
  }
  const readInt = (): Buffer => {
    if (der[o] !== 0x02) throw new Error("jws: bad DER integer");
    const ilen = der[o + 1] as number;
    const v = der.slice(o + 2, o + 2 + ilen);
    o += 2 + ilen;
    const t = v[0] === 0 ? v.slice(1) : v;
    return t.length < 32 ? Buffer.concat([Buffer.alloc(32 - t.length), t]) : t;
  };
  return Buffer.concat([readInt(), readInt()]);
}
