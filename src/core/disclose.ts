import type { KeyObject } from "node:crypto";
import {
  CLOCK_SKEW_SEC,
  canonicalize,
  sha256Hex,
  utf8Bytes,
} from "./canonical.js";
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
  /** Credential expiry at issuance, when the credential had one. Enforced at verify. */
  readonly credExp?: number;
  readonly disclosures: readonly Disclosure[];
  /** Holder Ed25519 signature over canonical presentation sans sig. Empty = bearer. */
  readonly sig: Uint8Array;
}

export type DiscloseDenyReason =
  | "unsigned"
  | "bad-signature"
  | "audience"
  | "stale"
  | "expired"
  | "replay"
  | "digest-mismatch";

export type VerifyResult =
  | { readonly ok: true; readonly disclosed: readonly string[] }
  | { readonly ok: false; readonly reason: DiscloseDenyReason };

const FUTURE_SKEW_SEC = CLOCK_SKEW_SEC;

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
      (n) => Object.hasOwn(cred.claims, n) && allowed.has(n)
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
      ...(cred.exp !== undefined ? { credExp: cred.exp } : {}),
      disclosures,
    };
    return {
      ...unsigned,
      sig: signBytes(holder.privateKey, utf8Bytes(canonicalize(unsigned))),
    };
  },

  verify(
    pres: Presentation,
    opts: {
      readonly holderKey: Uint8Array;
      readonly expectedAud: string;
      readonly maxAgeSec?: number;
      readonly nowSec: number;
      /**
       * Host-managed replay cache. When provided, a repeated nonce is denied
       * and fresh nonces are recorded. The store itself lives with the host;
       * without it, replay inside the freshness window is possible.
       */
      readonly usedNonces?: Set<string>;
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
    if (opts.usedNonces !== undefined) {
      if (opts.usedNonces.has(pres.nonce))
        return { ok: false, reason: "replay" };
    }
    if (
      pres.credExp !== undefined &&
      opts.nowSec > pres.credExp + FUTURE_SKEW_SEC
    ) {
      return { ok: false, reason: "expired" };
    }
    for (const d of pres.disclosures) {
      if (sha256Hex(canonicalize([d.salt, d.name, d.value])) !== d.digest) {
        return { ok: false, reason: "digest-mismatch" };
      }
    }
    const { sig, ...unsigned } = pres;
    void sig;
    if (
      !verifyBytes(opts.holderKey, utf8Bytes(canonicalize(unsigned)), pres.sig)
    ) {
      return { ok: false, reason: "bad-signature" };
    }
    if (opts.usedNonces !== undefined) {
      opts.usedNonces.add(pres.nonce);
    }
    return { ok: true, disclosed: pres.disclosures.map((d) => d.name) };
  },
};
