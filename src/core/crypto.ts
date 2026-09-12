import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

function b64uEncode(raw: Uint8Array): string {
  return Buffer.from(raw).toString("base64url");
}

export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export interface Ed25519Keypair {
  readonly publicKey: KeyObject;
  readonly privateKey: KeyObject;
  readonly publicKeyRaw: Uint8Array;
}

export function generateEd25519Keypair(): Ed25519Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (typeof jwk.x !== "string") throw new Error("ed25519: missing public x");
  return {
    publicKey,
    privateKey,
    publicKeyRaw: new Uint8Array(Buffer.from(jwk.x, "base64url")),
  };
}

export function publicKeyFromRaw(raw32: Uint8Array): KeyObject {
  if (raw32.length !== 32)
    throw new Error("ed25519: public key must be 32 bytes");
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: b64uEncode(raw32) } as never,
    format: "jwk",
  });
}

/** Rebuild a private key from PKCS#8 DER (the keystore wire form). */
export function privateKeyFromPkcs8(der: Uint8Array): KeyObject {
  return createPrivateKey({
    key: Buffer.from(der),
    format: "der",
    type: "pkcs8",
  });
}

/** Derive the public KeyObject from a private one (no keygen needed). */
export function publicKeyFromPrivate(priv: KeyObject): KeyObject {
  return createPublicKey(priv);
}

/** Raw 32 bytes of an Ed25519 public key. */
export function rawPublicKey(pub: KeyObject): Uint8Array {
  const jwk = pub.export({ format: "jwk" }) as { x?: string };
  if (typeof jwk.x !== "string") throw new Error("ed25519: missing public x");
  return new Uint8Array(Buffer.from(jwk.x, "base64url"));
}

export function signBytes(privateKey: KeyObject, data: Uint8Array): Uint8Array {
  return new Uint8Array(sign(null, Buffer.from(data), privateKey));
}

export function verifyBytes(
  publicKeyRaw: Uint8Array,
  data: Uint8Array,
  sig: Uint8Array
): boolean {
  if (sig.length !== 64) return false;
  try {
    return verify(
      null,
      Buffer.from(data),
      publicKeyFromRaw(publicKeyRaw),
      Buffer.from(sig)
    );
  } catch {
    return false;
  }
}
