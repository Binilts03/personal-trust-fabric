import type { KeyResolver } from "./types.js";

/**
 * Recipient binding registry — local Subjects + Identity Bindings (wayfinder 03).
 * Alias → current Ed25519 key with rotation history and revocation. Resolution
 * failure is null (never throws), so redemption gates fail closed downstream.
 * No DID resolution and no fetching: bindings are registered, not discovered.
 */

export interface BindingSnapshot {
  readonly key: Uint8Array;
  readonly addedAt: number;
  readonly superseded: boolean;
  readonly revoked: boolean;
}

export interface RegistrySnapshot {
  readonly bindings: {
    readonly alias: string;
    readonly keys: {
      readonly keyHex: string;
      readonly addedAt: number;
      readonly superseded: boolean;
      readonly revoked: boolean;
    }[];
  }[];
}

interface Binding extends BindingSnapshot {
  superseded: boolean;
  revoked: boolean;
}

export class RecipientRegistry {
  private readonly bindings = new Map<string, Binding[]>();
  private readonly nowSec: () => number;

  constructor(nowSec: () => number = () => Math.floor(Date.now() / 1000)) {
    this.nowSec = nowSec;
  }

  register(alias: string, key: Uint8Array, at?: number): void {
    if (alias.length === 0) throw new Error("registry: alias required");
    if (key.length !== 32)
      throw new Error("registry: Ed25519 public keys are 32 bytes");
    if (this.bindings.has(alias))
      throw new Error(`registry: ${alias} already bound (rotate instead)`);
    this.bindings.set(alias, [
      {
        key: Uint8Array.from(key),
        addedAt: at ?? this.nowSec(),
        superseded: false,
        revoked: false,
      },
    ]);
  }

  /**
   * Rotate to a new key. Retired (revoked) aliases stay retired: rotation
   * after revocation throws, so in-flight capabilities bound to the old key
   * fail closed at the recipient gate instead of silently rebinding.
   * Smooth rollover without breakage means issuing under the new alias
   * before revoking the old — rotation itself is a hard cutover.
   */
  rotate(alias: string, key: Uint8Array, at?: number): void {
    const chain = this.bindings.get(alias);
    if (chain === undefined)
      throw new Error(`registry: unknown alias ${alias}`);
    if (chain.some((b) => b.revoked)) {
      throw new Error(
        `registry: ${alias} is revoked and stays retired (use a new alias)`
      );
    }
    if (key.length !== 32)
      throw new Error("registry: Ed25519 public keys are 32 bytes");
    const live = chain.find((b) => !b.superseded && !b.revoked);
    if (live !== undefined && Buffer.from(live.key).equals(Buffer.from(key))) {
      throw new Error(`registry: ${alias} already bound to this key`);
    }
    for (const b of chain) b.superseded = true;
    chain.push({
      key: Uint8Array.from(key),
      addedAt: at ?? this.nowSec(),
      superseded: false,
      revoked: false,
    });
  }

  revoke(alias: string): void {
    const chain = this.bindings.get(alias);
    if (chain === undefined)
      throw new Error(`registry: unknown alias ${alias}`);
    for (const b of chain) b.revoked = true;
  }

  /** Current live key, or null when unknown, superseded-only, or revoked. Never throws. */
  resolve(alias: string): Uint8Array | null {
    const chain = this.bindings.get(alias);
    if (chain === undefined) return null;
    const live = chain.find((b) => !b.superseded && !b.revoked);
    return live === undefined ? null : Uint8Array.from(live.key);
  }

  history(alias: string): readonly BindingSnapshot[] | null {
    const chain = this.bindings.get(alias);
    if (chain === undefined) return null;
    return chain.map((b) => ({
      key: Uint8Array.from(b.key),
      addedAt: b.addedAt,
      superseded: b.superseded,
      revoked: b.revoked,
    }));
  }

  aliases(): string[] {
    return [...this.bindings.keys()];
  }

  /** Plain-data snapshot (hex keys) for durable stores. */
  snapshot(): RegistrySnapshot {
    return {
      bindings: [...this.bindings.entries()].map(([alias, chain]) => ({
        alias,
        keys: chain.map((b) => ({
          keyHex: Buffer.from(b.key).toString("hex"),
          addedAt: b.addedAt,
          superseded: b.superseded,
          revoked: b.revoked,
        })),
      })),
    };
  }

  /** Restore from a snapshot, validating key material. Unknown aliases stay absent. */
  static restore(
    data: unknown,
    nowSec: () => number = () => Math.floor(Date.now() / 1000)
  ): RecipientRegistry {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("registry snapshot must be an object");
    }
    const bindings = (data as Record<string, unknown>)["bindings"];
    if (!Array.isArray(bindings))
      throw new Error("registry snapshot: bindings must be an array");
    const reg = new RecipientRegistry(nowSec);
    for (const entry of bindings) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error("registry snapshot: bad binding");
      }
      const rec = entry as Record<string, unknown>;
      if (
        typeof rec["alias"] !== "string" ||
        (rec["alias"] as string).length === 0 ||
        !Array.isArray(rec["keys"]) ||
        (rec["keys"] as unknown[]).length === 0
      ) {
        throw new Error("registry snapshot: bad binding");
      }
      const chain = (rec["keys"] as Record<string, unknown>[]).map((k) => {
        if (
          typeof k["keyHex"] !== "string" ||
          !Number.isInteger(k["addedAt"]) ||
          typeof k["superseded"] !== "boolean" ||
          typeof k["revoked"] !== "boolean"
        ) {
          throw new Error("registry snapshot: bad key entry");
        }
        const key = new Uint8Array(Buffer.from(k["keyHex"] as string, "hex"));
        if (
          key.length !== 32 ||
          Buffer.from(key).toString("hex") !==
            (k["keyHex"] as string).toLowerCase()
        ) {
          throw new Error("registry snapshot: bad key material");
        }
        return {
          key,
          addedAt: k["addedAt"] as number,
          superseded: k["superseded"] as boolean,
          revoked: k["revoked"] as boolean,
        };
      });
      reg.bindings.set(rec["alias"] as string, chain);
    }
    return reg;
  }

  /** Plugs directly into Capabilities as its KeyResolver. */
  asResolver(): KeyResolver {
    return (id) => this.resolve(id);
  }
}
