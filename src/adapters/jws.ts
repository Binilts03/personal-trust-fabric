import { createPublicKey, verify, type KeyObject } from "node:crypto";

/**
 * Shared JWS utilities for the edge adapters (A2A cards today).
 * ES256 signatures are raw R||S (JWS style); node:crypto wants DER — converted here.
 */

export const b64uEncode = (data: Uint8Array | Buffer | string): string =>
  Buffer.from(data as Uint8Array).toString("base64url");

export const b64uDecode = (s: string): Buffer => Buffer.from(s, "base64url");

function rawToDer(raw: Buffer): Buffer {
  if (raw.length !== 64) throw new Error("jws: ES256 signatures are 64 bytes");
  const norm = (b: Buffer): Buffer => {
    const t = b[0] === 0 ? b.slice(1) : b;
    return t.length < 32 ? Buffer.concat([Buffer.alloc(32 - t.length), t]) : t;
  };
  const enc = (b: Buffer): Buffer =>
    b[0] !== undefined && b[0] >= 0x80
      ? Buffer.concat([Buffer.from([0]), b])
      : b;
  const r = enc(norm(raw.slice(0, 32)));
  const s = enc(norm(raw.slice(32, 64)));
  return Buffer.concat([
    Buffer.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length]),
    r,
    Buffer.from([0x02, s.length]),
    s,
  ]);
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
}): KeyObject {
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
