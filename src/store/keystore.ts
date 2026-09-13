import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { canonicalize } from "../core/canonical.js";

/**
 * Passphrase-encrypted keystore (prod-02). scrypt + AES-256-GCM, stdlib only.
 * The passphrase arrives from the environment and is never logged or stored.
 * One blob per file: a single GCM tag authenticates every entry at once.
 */

const VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export interface KeystoreFile {
  readonly version: 1;
  readonly kdf: {
    readonly name: "scrypt";
    readonly N: number;
    readonly r: number;
    readonly p: number;
    readonly saltHex: string;
  };
  readonly ivHex: string;
  readonly ctHex: string;
  readonly tagHex: string;
}

function passBytes(passphrase: string): Buffer {
  if (passphrase.length === 0) throw new Error("keystore: passphrase required");
  return Buffer.from(passphrase, "utf8");
}

function checkKdf(kdf: KeystoreFile["kdf"]): { salt: Buffer } {
  if (
    kdf.name !== "scrypt" ||
    kdf.N !== SCRYPT_N ||
    kdf.r !== SCRYPT_R ||
    kdf.p !== SCRYPT_P
  ) {
    throw new Error(
      `keystore: KDF parameters must be scrypt N=${SCRYPT_N} r=${SCRYPT_R} p=${SCRYPT_P}`
    );
  }
  if (typeof kdf.saltHex !== "string" || !/^[0-9a-fA-F]+$/.test(kdf.saltHex)) {
    throw new Error("keystore: salt corrupt");
  }
  const salt = Buffer.from(kdf.saltHex, "hex");
  if (salt.length !== SALT_BYTES) throw new Error("keystore: salt corrupt");
  return { salt };
}

export function sealKeystore(
  entries: Readonly<Record<string, Uint8Array>>,
  passphrase: string,
  saltHex?: string
): KeystoreFile {
  const names = Object.keys(entries);
  if (names.some((n) => n.length === 0))
    throw new Error("keystore: alias required");
  const salt =
    saltHex !== undefined
      ? Buffer.from(saltHex, "hex")
      : randomBytes(SALT_BYTES);
  if (salt.length < 8) throw new Error("keystore: salt too short");
  const key = scryptSync(passBytes(passphrase), salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  const iv = randomBytes(IV_BYTES);
  const plain: Record<string, string> = {};
  for (const [alias, raw] of Object.entries(entries)) {
    plain[alias] = Buffer.from(raw).toString("hex");
  }
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(canonicalize(plain), "utf8"),
    cipher.final(),
  ]);
  return {
    version: VERSION,
    kdf: {
      name: "scrypt",
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      saltHex: salt.toString("hex"),
    },
    ivHex: iv.toString("hex"),
    ctHex: ct.toString("hex"),
    tagHex: cipher.getAuthTag().toString("hex"),
  };
}

export function openKeystore(
  file: KeystoreFile,
  passphrase: string
): Record<string, Uint8Array> {
  if (typeof file !== "object" || file === null)
    throw new Error("keystore: malformed file");
  if ((file as { version?: unknown }).version !== VERSION) {
    throw new Error("keystore: unsupported version");
  }
  const { salt } = checkKdf(file.kdf);
  const key = scryptSync(passBytes(passphrase), salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  for (const [field, want] of [
    ["ivHex", IV_BYTES * 2],
    ["tagHex", 16 * 2],
  ] as const) {
    const v = (file as unknown as Record<string, unknown>)[field];
    if (
      typeof v !== "string" ||
      v.length !== want ||
      !/^[0-9a-fA-F]+$/.test(v)
    ) {
      throw new Error("keystore: file corrupt");
    }
  }
  if (
    typeof file.ctHex !== "string" ||
    file.ctHex.length === 0 ||
    file.ctHex.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(file.ctHex)
  ) {
    throw new Error("keystore: file corrupt");
  }
  let plain: string;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(file.ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(file.tagHex, "hex"));
    plain =
      decipher.update(Buffer.from(file.ctHex, "hex"), undefined, "utf8") +
      decipher.final("utf8");
  } catch {
    throw new Error(
      "keystore: decryption failed (wrong passphrase or tampered file)"
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plain) as unknown;
  } catch {
    throw new Error("keystore: payload corrupt");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("keystore: payload corrupt");
  }
  const out: Record<string, Uint8Array> = {};
  for (const [alias, hex] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (typeof hex !== "string") throw new Error("keystore: payload corrupt");
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
      throw new Error("keystore: payload corrupt");
    }
    out[alias] = new Uint8Array(Buffer.from(hex, "hex"));
  }
  return out;
}
