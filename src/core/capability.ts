import type { KeyObject } from "node:crypto";
import { canonicalize, payloadCid } from "./canonical.js";
import { randomHex, signBytes, verifyBytes } from "./crypto.js";
import { isPolicyNarrower, satisfiesPolicy } from "./policy.js";
import type {
  AuthorizeResult,
  CapabilityChain,
  CapabilityPayload,
  Demand,
  KeyResolver,
  Predicate,
  RevocationStore,
  SealedCapability,
  UseLedger,
} from "./types.js";

export const CLOCK_SKEW_SEC = 60;

export interface IssueRequest {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly cmd: `/${string}`;
  readonly pol: readonly Predicate[];
  readonly purpose: string;
  readonly resource: string;
  readonly recipient: string;
  readonly amountMax?: number;
  readonly currency?: string;
  readonly claims?: readonly string[];
  readonly nbf?: number;
  readonly exp: number;
  readonly maxUses?: number;
  readonly termsDigest: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface AuthorizeOptions {
  /** consume=true redeems one use and requires recipient proof. consume=false is a dry-run. */
  readonly consume?: boolean;
  readonly proof?: { readonly key: Uint8Array; readonly sig: Uint8Array };
  readonly nowSec?: number;
}

function utf8(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "utf8"));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

function isSubpath(parent: string, child: string): boolean {
  return (
    child === parent ||
    child.startsWith(parent.endsWith("/") ? parent : `${parent}/`)
  );
}

function fail(
  reason: AuthorizeResult & { readonly ok: false }
): AuthorizeResult {
  return reason;
}

export class MapRevocationStore implements RevocationStore {
  private readonly revoked = new Set<string>();
  has(id: string): boolean {
    return this.revoked.has(id);
  }
  add(id: string): void {
    this.revoked.add(id);
  }
}

export class MapUseLedger implements UseLedger {
  private readonly used = new Map<string, number>();
  remaining(chainId: string): number | null {
    const v = this.used.get(chainId);
    return v === undefined ? null : v;
  }
  consume(chainId: string, maxUses: number): number {
    const prev = this.used.get(chainId) ?? maxUses;
    const next = prev - 1;
    this.used.set(chainId, next);
    return next;
  }
}

/**
 * Deep capability module: small interface (`issue` / `authorize` / `revoke`)
 * hiding canonicalization, Ed25519 chains, narrowing, revocation cascade,
 * replay ledger, and recipient proof checks.
 */
export class Capabilities {
  private readonly resolveKey: KeyResolver;
  private readonly revocations: RevocationStore;
  private readonly uses: UseLedger;
  private readonly nowSec: () => number;

  constructor(opts: {
    readonly resolveKey: KeyResolver;
    readonly revocations?: RevocationStore;
    readonly uses?: UseLedger;
    readonly nowSec?: () => number;
  }) {
    this.resolveKey = opts.resolveKey;
    this.revocations = opts.revocations ?? new MapRevocationStore();
    this.uses = opts.uses ?? new MapUseLedger();
    this.nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Issue a root (parent=null) or attenuated child (parent=chain). Child authority can only shrink. */
  issue(
    parent: CapabilityChain | null,
    req: IssueRequest,
    signer: KeyObject
  ): SealedCapability {
    const maxUses = req.maxUses ?? 1;
    const payload: CapabilityPayload = {
      tag: "ptf/cap@0.1",
      iss: req.iss,
      aud: req.aud,
      sub: req.sub,
      cmd: req.cmd,
      pol: req.pol,
      purpose: req.purpose,
      resource: req.resource,
      recipient: req.recipient,
      ...(req.amountMax !== undefined ? { amountMax: req.amountMax } : {}),
      ...(req.currency !== undefined ? { currency: req.currency } : {}),
      ...(req.claims !== undefined ? { claims: req.claims } : {}),
      nonce: randomHex(16),
      ...(req.nbf !== undefined ? { nbf: req.nbf } : {}),
      exp: req.exp,
      maxUses,
      termsDigest: req.termsDigest,
      revocationId: randomHex(16),
      parentRevocationId:
        parent === null
          ? null
          : (parent[parent.length - 1] as SealedCapability).payload
              .revocationId,
      ...(req.meta !== undefined ? { meta: req.meta } : {}),
    };
    const problem =
      parent === null
        ? checkRootShape(payload)
        : checkNarrowing(parent, payload);
    if (problem !== null)
      throw new Error(`capability issue rejected: ${problem}`);
    const bytes = utf8(canonicalize(payload));
    return { payload, sig: signBytes(signer, bytes) };
  }

  /**
   * Verify (consume=false, dry-run for adapters) or redeem (consume=true, requires
   * recipient proof, decrements the use ledger). Fail-closed: first failure wins.
   */
  authorize(
    chain: CapabilityChain,
    demand: Demand,
    opts: AuthorizeOptions = {}
  ): AuthorizeResult {
    const now = opts.nowSec ?? this.nowSec();
    if (chain.length === 0)
      return fail({ ok: false, reason: "chain", detail: "empty chain" });
    const root = chain[0] as SealedCapability;
    const leaf = chain[chain.length - 1] as SealedCapability;

    for (const link of chain) {
      const shape = checkLinkShape(link.payload);
      if (shape !== null)
        return fail({ ok: false, reason: "forbidden-shape", detail: shape });
    }
    if (root.payload.iss !== root.payload.sub) {
      return fail({
        ok: false,
        reason: "chain",
        detail: "root iss must equal sub (self-rooted)",
      });
    }
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1] as SealedCapability;
      const cur = chain[i] as SealedCapability;
      if (cur.payload.iss !== prev.payload.aud) {
        return fail({
          ok: false,
          reason: "chain",
          detail: `link ${i}: iss/aud misalignment`,
        });
      }
      if (cur.payload.sub !== prev.payload.sub) {
        return fail({
          ok: false,
          reason: "chain",
          detail: `link ${i}: sub changed`,
        });
      }
      const narrow = checkNarrowing(chain.slice(0, i), cur.payload);
      if (narrow !== null)
        return fail({
          ok: false,
          reason: "policy",
          detail: `link ${i}: ${narrow}`,
        });
    }
    for (const link of chain) {
      const pub = this.resolveKey(link.payload.iss);
      if (pub === null)
        return fail({
          ok: false,
          reason: "sig",
          detail: `unknown issuer ${link.payload.iss}`,
        });
      if (!verifyBytes(pub, utf8(canonicalize(link.payload)), link.sig)) {
        return fail({
          ok: false,
          reason: "sig",
          detail: `bad signature from ${link.payload.iss}`,
        });
      }
    }
    for (const link of chain) {
      const p = link.payload;
      if (p.nbf !== undefined && now < p.nbf - CLOCK_SKEW_SEC) {
        return fail({
          ok: false,
          reason: "not-yet-valid",
          detail: `nbf ${p.nbf}`,
        });
      }
      if (now > p.exp + CLOCK_SKEW_SEC) {
        return fail({ ok: false, reason: "expired", detail: `exp ${p.exp}` });
      }
    }
    for (const link of chain) {
      if (this.revocations.has(link.payload.revocationId)) {
        return fail({
          ok: false,
          reason: "revoked",
          detail: link.payload.revocationId,
        });
      }
    }
    if (!isSubpath(leaf.payload.cmd, demand.cmd)) {
      return fail({
        ok: false,
        reason: "policy",
        detail: `cmd ${demand.cmd} outside ${leaf.payload.cmd}`,
      });
    }
    if (!satisfiesPolicy(leaf.payload.pol, demand.args)) {
      return fail({
        ok: false,
        reason: "policy",
        detail: "policy predicates not satisfied",
      });
    }
    if (leaf.payload.cmd === "/pay" || leaf.payload.cmd.startsWith("/pay/")) {
      const amount = (demand.args as Record<string, unknown>)["amount"];
      if (typeof amount !== "number" || !(amount > 0)) {
        return fail({
          ok: false,
          reason: "policy",
          detail: "pay demand needs positive numeric amount",
        });
      }
      if (
        leaf.payload.amountMax === undefined ||
        amount > leaf.payload.amountMax
      ) {
        return fail({
          ok: false,
          reason: "policy",
          detail: "amount exceeds ceiling",
        });
      }
      const currency = (demand.args as Record<string, unknown>)["currency"];
      if (
        leaf.payload.currency !== undefined &&
        currency !== leaf.payload.currency
      ) {
        return fail({
          ok: false,
          reason: "policy",
          detail: "currency mismatch",
        });
      }
    }
    if (
      leaf.payload.cmd === "/disclose" ||
      leaf.payload.cmd.startsWith("/disclose/")
    ) {
      const want = (demand.args as Record<string, unknown>)["claims"];
      const allowed = new Set(leaf.payload.claims ?? []);
      if (
        !Array.isArray(want) ||
        !want.every((c) => typeof c === "string" && allowed.has(c))
      ) {
        return fail({
          ok: false,
          reason: "policy",
          detail: "claims outside allowance",
        });
      }
    }
    if (demand.recipient !== leaf.payload.recipient) {
      return fail({
        ok: false,
        reason: "recipient",
        detail: "recipient mismatch",
      });
    }
    if (demand.termsDigest !== leaf.payload.termsDigest) {
      return fail({
        ok: false,
        reason: "terms",
        detail: "terms digest mismatch — new approval required",
      });
    }

    const chainId = payloadCid(canonicalize(leaf.payload));
    const remaining = this.uses.remaining(chainId) ?? leaf.payload.maxUses;
    if (remaining <= 0) return fail({ ok: false, reason: "uses-exhausted" });

    if (opts.consume === true) {
      if (opts.proof === undefined)
        return fail({
          ok: false,
          reason: "recipient",
          detail: "recipient proof required",
        });
      const expected = this.resolveKey(leaf.payload.recipient);
      if (expected === null)
        return fail({
          ok: false,
          reason: "recipient",
          detail: "unknown recipient key",
        });
      if (!bytesEqual(opts.proof.key, expected)) {
        return fail({
          ok: false,
          reason: "recipient",
          detail: "proof key differs from binding",
        });
      }
      const cidBytes = new Uint8Array(Buffer.from(chainId, "hex"));
      if (!verifyBytes(opts.proof.key, cidBytes, opts.proof.sig)) {
        return fail({
          ok: false,
          reason: "recipient",
          detail: "bad recipient signature",
        });
      }
      return {
        ok: true,
        remaining: this.uses.consume(chainId, leaf.payload.maxUses),
      };
    }
    return { ok: true, remaining };
  }

  revoke(revocationId: string): void {
    this.revocations.add(revocationId);
  }
}

function checkLinkShape(p: CapabilityPayload): string | null {
  if (p.tag !== "ptf/cap@0.1") return "unknown tag";
  if (p.cmd === "/" || !p.cmd.startsWith("/"))
    return "top/wildcard cmd forbidden in v0.1";
  if (p.sub.length === 0 || p.iss.length === 0 || p.aud.length === 0)
    return "empty iss/aud/sub";
  if (!Number.isInteger(p.exp) || p.exp <= 0)
    return "exp must be a positive epoch";
  if (p.nbf !== undefined && (!Number.isInteger(p.nbf) || p.nbf < 0))
    return "bad nbf";
  if (!Number.isInteger(p.maxUses) || p.maxUses < 1)
    return "maxUses must be >= 1";
  if (p.nonce.length < 16) return "nonce too short";
  if (p.termsDigest.length < 16) return "termsDigest missing";
  if (p.revocationId.length < 8) return "revocationId missing";
  if (p.cmd === "/pay" || p.cmd.startsWith("/pay/")) {
    if (p.amountMax === undefined || !(p.amountMax > 0))
      return "/pay needs positive amountMax";
    if (p.currency === undefined || p.currency.length === 0)
      return "/pay needs currency";
  }
  return null;
}

function checkRootShape(p: CapabilityPayload): string | null {
  const shape = checkLinkShape(p);
  if (shape !== null) return shape;
  if (p.parentRevocationId !== null) return "root must not reference a parent";
  if (p.iss !== p.sub) return "root must be self-issued (iss == sub)";
  return null;
}

/** Child ≤ parent across every bound dimension. Returns a reason or null when acceptable. */
function checkNarrowing(
  parent: CapabilityChain,
  child: CapabilityPayload
): string | null {
  const prev = parent[parent.length - 1] as SealedCapability;
  const par = prev.payload;
  const shape = checkLinkShape(child);
  if (shape !== null) return shape;
  if (child.iss !== par.aud) return "child iss must equal parent aud";
  if (child.sub !== par.sub) return "sub is fixed for the chain";
  if (child.parentRevocationId !== par.revocationId)
    return "parent linkage broken";
  if (!isSubpath(par.cmd, child.cmd)) return "cmd may only stay or go deeper";
  if (!isPolicyNarrower(par.pol, child.pol)) return "policy may only narrow";
  if (child.exp > par.exp) return "exp may only shorten";
  if (
    (child.nbf ?? Number.NEGATIVE_INFINITY) <
    (par.nbf ?? Number.NEGATIVE_INFINITY)
  )
    return "nbf may only move later";
  if (child.maxUses > par.maxUses) return "maxUses may only decrease";
  if (child.purpose !== par.purpose) return "purpose is fixed";
  if (child.resource !== par.resource) return "resource is fixed";
  if (child.recipient !== par.recipient)
    return "recipient is fixed — re-issue for a new recipient";
  if (child.termsDigest !== par.termsDigest)
    return "termsDigest is fixed — new approval required";
  if (
    par.amountMax !== undefined &&
    (child.amountMax === undefined || child.amountMax > par.amountMax)
  ) {
    return "amountMax may only decrease";
  }
  if (par.currency !== undefined && child.currency !== par.currency)
    return "currency is fixed";
  if (par.claims !== undefined) {
    const allowed = new Set(child.claims ?? []);
    if (!par.claims.every((c) => allowed.has(c)))
      return "claims may only subset";
  } else if (
    child.claims !== undefined &&
    (child.cmd === "/pay" || child.cmd.startsWith("/pay/"))
  ) {
    return "claims do not belong on /pay";
  }
  return null;
}

export function leafCidHex(leaf: SealedCapability): string {
  return payloadCid(canonicalize(leaf.payload));
}
