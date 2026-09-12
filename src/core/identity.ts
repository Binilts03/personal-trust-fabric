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

  rotate(alias: string, key: Uint8Array, at?: number): void {
    const chain = this.bindings.get(alias);
    if (chain === undefined)
      throw new Error(`registry: unknown alias ${alias}`);
    if (key.length !== 32)
      throw new Error("registry: Ed25519 public keys are 32 bytes");
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

  /** Plugs directly into Capabilities as its KeyResolver. */
  asResolver(): KeyResolver {
    return (id) => this.resolve(id);
  }
}
