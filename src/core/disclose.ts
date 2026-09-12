import type { KeyObject } from "node:crypto";
import { canonicalize, sha256Hex } from "./canonical.js";
import { randomHex, signBytes, verifyBytes } from "./crypto.js";

/**
 * Selective disclosure — minimal presentation bound to a verifier.
 * Model follows the deep read (`docs/research/2026-09-09-deep-identity-openid4vp-sdjwt.md`):
 * disclose `requested ∩ available ∩ allowed`, holder-signed over aud + nonce +
 * freshness + disclosure digests (our KB-JWT analog; see ticket 03). Issuer
 * authenticity is the host's business — credentials arrive from its own store;
 * issuance and trust registries are out of v0.1 scope.
 */

export interface Credential {
  readonly issuer: string;
  readonly subject: string;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly exp?: number;
  /** Pinned holder id (RFC 7800 `cnf` analog). Presentations for another id are rejected. */
  readonly cnf?: string;
}

export interface DisclosureRequest {
  readonly verifier: string;
  readonly nonce: string;
  /** Top-level claim keys. v0.1 has no nested paths (DCQL paths deferred). */
  readonly requested: readonly string[];
}

export interface ClaimAllowList {
  readonly recipient: string;
  readonly allowed: readonly string[];
}

export interface Disclosure {
  readonly name: string;
  readonly value: unknown;
  readonly salt: string;
  readonly digest: string;
}

export interface Presentation {
  readonly issuer: string;
  readonly subject: string;
  readonly holder: string;
  readonly verifier: string;
  readonly nonce: string;
  readonly iat: number;
  readonly disclosures: readonly Disclosure[];
  /** Holder Ed25519 signature over canonical presentation sans sig. Empty = bearer. */
  readonly sig: Uint8Array;
}

export type DiscloseDenyReason =
  "unsigned" | "bad-signature" | "audience" | "stale" | "digest-mismatch";

export type VerifyResult =
  | { readonly ok: true; readonly disclosed: readonly string[] }
  | { readonly ok: false; readonly reason: DiscloseDenyReason };

/** v0.1 claim catalog seed. Validity-critical claims stay always-visible, never disclosed. */
export const v01ClaimCatalog = [
  {
    name: "ca_status",
    description: "Professional standing, e.g. active/suspended",
  },
  { name: "age_over_18", description: "Boolean age predicate, no birthdate" },
] as const;

const FUTURE_SKEW_SEC = 60;

function utf8(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "utf8"));
}

export const Disclose = {
  present(
    cred: Credential,
    req: DisclosureRequest,
    allow: ClaimAllowList,
    holder: { readonly id: string; readonly privateKey: KeyObject },
    nowSec: number
  ): Presentation {
    if (allow.recipient !== req.verifier)
      throw new Error("allow-list is bound to a different recipient");
    if (cred.cnf !== undefined && cred.cnf !== holder.id)
      throw new Error("holder differs from credential cnf");
    if (req.nonce.length === 0) throw new Error("nonce required");
    if (cred.exp !== undefined && nowSec > cred.exp + FUTURE_SKEW_SEC)
      throw new Error("credential expired");

    const allowed = new Set(allow.allowed);
    const names = req.requested.filter(
      (n) => n in cred.claims && allowed.has(n)
    );
    const disclosures: Disclosure[] = names.map((name) => {
      const value = (cred.claims as Record<string, unknown>)[name];
      const salt = randomHex(16);
      return {
        name,
        value,
        salt,
        digest: sha256Hex(canonicalize([salt, name, value])),
      };
    });
    const unsigned = {
      issuer: cred.issuer,
      subject: cred.subject,
      holder: holder.id,
      verifier: req.verifier,
      nonce: req.nonce,
      iat: nowSec,
      disclosures,
    };
    return {
      ...unsigned,
      sig: signBytes(holder.privateKey, utf8(canonicalize(unsigned))),
    };
  },

  verify(
    pres: Presentation,
    opts: {
      readonly holderKey: Uint8Array;
      readonly expectedAud: string;
      readonly maxAgeSec?: number;
      readonly nowSec: number;
    }
  ): VerifyResult {
    if (pres.sig.length !== 64) return { ok: false, reason: "unsigned" };
    if (pres.verifier !== opts.expectedAud)
      return { ok: false, reason: "audience" };
    const maxAge = opts.maxAgeSec ?? 300;
    if (
      opts.nowSec < pres.iat - FUTURE_SKEW_SEC ||
      opts.nowSec > pres.iat + maxAge
    ) {
      return { ok: false, reason: "stale" };
    }
    for (const d of pres.disclosures) {
      if (sha256Hex(canonicalize([d.salt, d.name, d.value])) !== d.digest) {
        return { ok: false, reason: "digest-mismatch" };
      }
    }
    const { sig, ...unsigned } = pres;
    void sig;
    if (!verifyBytes(opts.holderKey, utf8(canonicalize(unsigned)), pres.sig)) {
      return { ok: false, reason: "bad-signature" };
    }
    return { ok: true, disclosed: pres.disclosures.map((d) => d.name) };
  },
};
