/**
 * PTF capability types — decision 01 (`ptf/cap@0.1`).
 * UCAN-delegation semantics over canonical-JSON bytes (not DAG-CBOR byte-compatible).
 * Key ids are opaque strings (`did:key:…`, `did:jwk:…`, `did:web:…`, or test ids).
 * Core never resolves DIDs — callers supply keys via KeyResolver (Identity Binding lives outside core).
 */

export type KeyId = string;

export type Command = `/${string}`;

export type PredicateOp =
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "like"
  | "and"
  | "or"
  | "not"
  | "all"
  | "any";

/** UCAN-style predicate. Top-level arrays are implicit AND. */
export type Predicate =
  | readonly ["==" | "!=", string, unknown]
  | readonly ["<" | "<=" | ">" | ">=", string, number]
  | readonly ["like", string, string]
  | readonly ["and" | "or", readonly Predicate[]]
  | readonly ["not", Predicate]
  | readonly ["all" | "any", string, Predicate];

export interface CapabilityPayload {
  readonly tag: "ptf/cap@0.1";
  readonly iss: KeyId;
  readonly aud: KeyId;
  /** Principal the chain is about. Never null in v0.1 (powerline forbidden). */
  readonly sub: KeyId;
  readonly cmd: Command;
  readonly pol: readonly Predicate[];
  readonly purpose: string;
  readonly resource: string;
  /** Merchant / verifier / signer-effect recipient. Fixed across attenuation. */
  readonly recipient: KeyId;
  /** Payment ceiling in minor units. Present only for `/pay*`. Child may only lower. */
  readonly amountMax?: number;
  readonly currency?: string;
  /** Allowed claims. Present only for `/disclose*`. Child may only subset. */
  readonly claims?: readonly string[];
  readonly nonce: string;
  readonly nbf?: number;
  /** Required in v0.1. Immortal capabilities (`exp: null`) are rejected. */
  readonly exp: number;
  readonly maxUses: number;
  /** SHA-256 hex of canonical approved-terms JSON. */
  readonly termsDigest: string;
  readonly revocationId: string;
  readonly parentRevocationId: string | null;
  /**
   * Signed but non-authoritative annotations (challenges, references, labels).
   * Attenuation deliberately ignores meta: it can neither grant nor narrow.
   * Verifiers MUST NOT treat meta as authority.
   */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface SealedCapability {
  readonly payload: CapabilityPayload;
  /** Ed25519 signature (raw 64 bytes) over canonical payload bytes. */
  readonly sig: Uint8Array;
}

export type CapabilityChain = readonly SealedCapability[];

export interface Demand {
  readonly cmd: Command;
  readonly args: Readonly<Record<string, unknown>>;
  readonly recipient: KeyId;
  readonly termsDigest: string;
}

/** Fail-closed verification outcome. */
export type DenyReason =
  | "sig"
  | "chain"
  | "expired"
  | "not-yet-valid"
  | "uses-exhausted"
  | "recipient"
  | "terms"
  | "revoked"
  | "policy"
  | "forbidden-shape";

export type AuthorizeResult =
  | { readonly ok: true; readonly remaining: number }
  | {
      readonly ok: false;
      readonly reason: DenyReason;
      readonly detail?: string;
    };

/** Resolve a key id to a raw Ed25519 public key (32 bytes). Return null when unknown. */
export type KeyResolver = (id: KeyId) => Uint8Array | null;

export interface RevocationStore {
  has(id: string): boolean;
  add(id: string, exp?: number): void;
  /** Drop entries known-expired before nowSec. Stores without expiries are unaffected. */
  prune?(nowSec: number): void;
}

export interface UseLedger {
  remaining(chainId: string): number | null;
  consume(chainId: string, maxUses: number, exp?: number): number;
  /** Drop entries known-expired before nowSec. */
  prune?(nowSec: number): void;
}
