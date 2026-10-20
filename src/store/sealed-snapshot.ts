import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { canonicalize, sha256Hex } from "../core/canonical.js";

const DEK_BYTES = 32;
const IV_BYTES = 12;
const TAG_HEX_LENGTH = 32;

export interface SealedSnapshotOptions {
  readonly version: number;
  readonly aad: string;
  readonly kidBytes?: number;
  readonly errorPrefix: string;
}

export interface SealedEnvelope {
  readonly version: number;
  readonly kidHex: string;
  readonly ivHex: string;
  readonly ctHex: string;
  readonly tagHex: string;
}

export function assertSealedDek(
  dek: unknown,
  errorPrefix: string
): asserts dek is Uint8Array {
  if (!(dek instanceof Uint8Array) || dek.length !== DEK_BYTES) {
    throw new Error(`${errorPrefix}: DEK must be 32 bytes`);
  }
}

export function sealedDekFingerprint(
  dek: Uint8Array,
  opts: Pick<SealedSnapshotOptions, "kidBytes" | "errorPrefix">
): string {
  assertSealedDek(dek, opts.errorPrefix);
  const kidBytes = opts.kidBytes ?? 8;
  if (!Number.isInteger(kidBytes) || kidBytes < 4 || kidBytes > 32) {
    throw new Error(`${opts.errorPrefix}: kidBytes must be an integer 4..32`);
  }
  return sha256Hex(Buffer.from(dek)).slice(0, kidBytes * 2);
}

/**
 * Resolve the key that opens a sealed snapshot. One rule for every sealed
 * store: when the envelope names a kid, the key whose fingerprint matches
 * that kid opens it (a partial rotation resumes); otherwise the store's
 * alias entry does.
 */
export function resolveSealedDek(
  keys: Record<string, Uint8Array>,
  opts: {
    readonly alias: string;
    readonly kidHex?: string | null;
    readonly bytes: number;
    readonly kidBytes: number;
    readonly errorPrefix: string;
    readonly missingHint: string;
  }
): Uint8Array {
  if (opts.kidHex !== undefined && opts.kidHex !== null) {
    for (const candidate of Object.values(keys)) {
      if (
        candidate instanceof Uint8Array &&
        candidate.length === opts.bytes &&
        sealedDekFingerprint(candidate, {
          kidBytes: opts.kidBytes,
          errorPrefix: opts.errorPrefix,
        }) === opts.kidHex
      ) {
        return candidate;
      }
    }
    throw new Error(
      `${opts.errorPrefix}: no DEK matches envelope kid ${opts.kidHex}${opts.missingHint}`
    );
  }
  const current = keys[opts.alias];
  if (current instanceof Uint8Array && current.length === opts.bytes) {
    return current;
  }
  throw new Error(
    `${opts.errorPrefix}: no DEK under ${opts.alias}${opts.missingHint}`
  );
}

/** The envelope shape check the kid reader and the opener share. */
function assertSealedEnvelope(
  parsed: unknown,
  opts: SealedSnapshotOptions,
  path: string
): Record<string, unknown> {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== opts.version
  ) {
    throw new Error(
      `${opts.errorPrefix} store corrupt: ${path} (bad envelope)`
    );
  }
  return parsed as Record<string, unknown>;
}

export function readSealedEnvelopeKid(
  parsed: unknown,
  opts: SealedSnapshotOptions,
  path: string
): string {
  const kidBytes = opts.kidBytes ?? 8;
  const env = assertSealedEnvelope(parsed, opts, path);
  const kid = env["kidHex"];
  if (
    typeof kid !== "string" ||
    kid.length !== kidBytes * 2 ||
    !/^[0-9a-fA-F]+$/.test(kid)
  ) {
    throw new Error(
      `${opts.errorPrefix} store corrupt: ${path} (bad envelope)`
    );
  }
  return kid;
}

export function sealSnapshotEnvelope<T>(
  payload: T,
  dek: Uint8Array,
  opts: SealedSnapshotOptions
): SealedEnvelope {
  assertSealedDek(dek, opts.errorPrefix);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(dek), iv);
  cipher.setAAD(Buffer.from(opts.aad, "utf8"));
  const ct = Buffer.concat([
    cipher.update(canonicalize(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    version: opts.version,
    kidHex: sealedDekFingerprint(dek, opts),
    ivHex: iv.toString("hex"),
    ctHex: ct.toString("hex"),
    tagHex: cipher.getAuthTag().toString("hex"),
  };
}

export function openSnapshotEnvelope<T>(
  parsed: unknown,
  dek: Uint8Array,
  opts: SealedSnapshotOptions,
  path: string,
  validate: (value: unknown) => T
): T {
  assertSealedDek(dek, opts.errorPrefix);
  const kidBytes = opts.kidBytes ?? 8;
  const env = assertSealedEnvelope(parsed, opts, path);
  const kidHex = env["kidHex"];
  const ivHex = env["ivHex"];
  const ctHex = env["ctHex"];
  const tagHex = env["tagHex"];
  if (
    typeof kidHex !== "string" ||
    kidHex.length !== kidBytes * 2 ||
    !/^[0-9a-fA-F]+$/.test(kidHex) ||
    typeof ivHex !== "string" ||
    ivHex.length !== IV_BYTES * 2 ||
    !/^[0-9a-fA-F]+$/.test(ivHex) ||
    typeof tagHex !== "string" ||
    tagHex.length !== TAG_HEX_LENGTH ||
    !/^[0-9a-fA-F]+$/.test(tagHex) ||
    typeof ctHex !== "string" ||
    ctHex.length === 0 ||
    ctHex.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(ctHex)
  ) {
    throw new Error(
      `${opts.errorPrefix} store corrupt: ${path} (bad envelope)`
    );
  }
  let plain: string;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(dek),
      Buffer.from(ivHex, "hex")
    );
    decipher.setAAD(Buffer.from(opts.aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    plain =
      decipher.update(Buffer.from(ctHex, "hex"), undefined, "utf8") +
      decipher.final("utf8");
  } catch {
    throw new Error(
      `${opts.errorPrefix}: decryption failed (wrong DEK or tampered file)`
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(plain) as unknown;
  } catch {
    throw new Error(`${opts.errorPrefix} store corrupt: ${path} (bad payload)`);
  }
  try {
    return validate(decoded);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(opts.errorPrefix)) {
      throw error;
    }
    throw new Error(`${opts.errorPrefix} store corrupt: ${path} (bad payload)`);
  }
}
