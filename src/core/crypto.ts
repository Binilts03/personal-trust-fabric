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

export function keypairFromSeed(seed32: Uint8Array): Ed25519Keypair {
  if (seed32.length !== 32) throw new Error("ed25519: seed must be 32 bytes");
  const privateKey = createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", d: b64uEncode(seed32) } as never,
    format: "jwk",
  });
  const publicKey = createPublicKey(privateKey);
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
