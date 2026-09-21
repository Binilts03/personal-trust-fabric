import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite } from "./files.js";

/**
 * Durable replay set (Phase 11).
 *
 * `Disclose.verify({ usedNonces })` accepts any `Set<string>` — but a plain
 * in-memory set resets on restart, reopening replay inside the freshness
 * window. This store IS that set, persisted: verifier hosts pass it directly
 * and save after each accepted verification. Restart reloads every used
 * nonce, so `redeem → restart → replay` and
 * `presentation → restart → replay` both deny.
 *
 * Entries carry their accept time and prune past `ttlSec` on load. The TTL
 * MUST exceed every verifier's `maxAgeSec` using this store: a nonce
 * forgotten while still fresh would verify again. Default 24h against the
 * 300s default freshness window.
 *
 * Same revision-CAS discipline as the other file stores: stale saves fail
 * closed, corrupt files throw, unknown fields throw.
 */

const FILE = "nonces.json";
const DEFAULT_TTL_SEC = 86400;

export class NonceStore extends Set<string> {
  private at = new Map<string, number>();
  private loadedRev = 0;
  private pristine = true;

  private constructor(
    private readonly nowSec: () => number,
    private readonly ttlSec: number
  ) {
    super();
  }

  static load(
    dir: string,
    opts: { readonly nowSec?: () => number; readonly ttlSec?: number } = {}
  ): NonceStore {
    const nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
    const ttlSec = opts.ttlSec ?? DEFAULT_TTL_SEC;
    if (!Number.isSafeInteger(ttlSec) || ttlSec <= 0) {
      throw new Error("replay: ttlSec must be a positive integer");
    }
    const store = new NonceStore(nowSec, ttlSec);
    const path = join(dir, FILE);
    if (!existsSync(path)) return store;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`replay: store corrupt: ${path}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`replay: store corrupt: ${path}`);
    }
    const rec = parsed as Record<string, unknown>;
    const rev = rec["revision"];
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) {
      throw new Error(`replay: store corrupt: ${path} (bad revision)`);
    }
    const nonces = rec["nonces"];
    if (typeof nonces !== "object" || nonces === null || Array.isArray(nonces)) {
      throw new Error(`replay: store corrupt: ${path} (bad nonces)`);
    }
    for (const [nonce, at] of Object.entries(nonces as Record<string, unknown>)) {
      if (nonce.length === 0 || typeof at !== "number" || !Number.isSafeInteger(at) || at < 0) {
        throw new Error(`replay: store corrupt: ${path} (bad entry)`);
      }
      superAdd(store, nonce);
      store.at.set(nonce, at);
    }
    store.loadedRev = rev;
    store.pristine = false;
    store.prune(store.nowSec(), ttlSec);
    return store;
  }

  save(dir: string): void {
    // Bound the file on every write: expired entries never round-trip.
    this.prune(this.nowSec(), this.ttlSec);
    const path = join(dir, FILE);
    const body = {
      revision: 0,
      nonces: Object.fromEntries(this.at),
    };
    if (!existsSync(path)) {
      if (!this.pristine || this.loadedRev !== 0) {
        throw new Error(
          `replay: store missing: ${path} — refusing to resurrect stale state`
        );
      }
      atomicWrite(path, JSON.stringify(body));
      this.pristine = false;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`replay: store corrupt: ${path}`);
    }
    const rev = (parsed as { revision?: unknown })["revision"];
    if (typeof rev !== "number" || rev !== this.loadedRev) {
      throw new Error(
        `replay: store changed under us (file revision ${String(rev)}, loaded ${this.loadedRev}) — reload and retry, never overwrite`
      );
    }
    atomicWrite(
      path,
      JSON.stringify({ revision: rev + 1, nonces: Object.fromEntries(this.at) })
    );
    this.loadedRev = rev + 1;
    this.pristine = false;
  }

  override add(nonce: string): this {
    if (typeof nonce !== "string" || nonce.length === 0) {
      throw new Error("replay: nonce must be a non-empty string");
    }
    super.add(nonce);
    this.at.set(nonce, this.nowSec());
    return this;
  }

  override delete(nonce: string): boolean {
    this.at.delete(nonce);
    return super.delete(nonce);
  }

  override clear(): void {
    this.at.clear();
    super.clear();
  }

  prune(now: number, ttlSec: number): void {
    for (const [nonce, at] of this.at) {
      // Future stamps (clock skew) are kept; only provably-old entries go.
      if (at <= now && now - at > ttlSec) {
        super.delete(nonce);
        this.at.delete(nonce);
      }
    }
  }
}

function superAdd(store: NonceStore, nonce: string): void {
  Set.prototype.add.call(store, nonce);
}
