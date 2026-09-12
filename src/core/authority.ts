import { termsDigestOf } from "./canonical.js";

/**
 * Policy authority — default-deny evaluation over explicit grants and approvals.
 * ADR-0002: policy constrains, never creates. A matching policy with no covering
 * grant or approval still denies. Shape follows the deep read
 * (`docs/research/2026-09-09-deep-delegation-policy.md`): AuthZEN-shaped
 * demand evaluated offline, Cedar precedence (any forbid wins, else cited
 * permit, else deny), schema-style checks at add-time rather than per-request.
 */

const SKEW_SEC = 60; // parity with capability CLOCK_SKEW_SEC; clocks are never exact.

export interface AuthorityDemand {
  readonly principal: string;
  readonly agent: string;
  readonly cmd: `/${string}`;
  readonly purpose: string;
  readonly resource: string;
  readonly recipient: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly claims?: readonly string[];
  /** Proposal hash. Bound at approval time; any term change needs a new approval. */
  readonly termsDigest: string;
}

export interface StandingGrant {
  readonly id: string;
  readonly principal: string;
  /** Absent = any agent of the principal. */
  readonly agent?: string;
  readonly cmd: `/${string}`;
  readonly purpose?: string;
  readonly resource?: string;
  readonly recipient?: string;
  readonly amountMax?: number;
  readonly currency?: string;
  readonly allowedClaims?: readonly string[];
  readonly nbf?: number;
  readonly exp?: number;
  /** Absent = unlimited uses. */
  readonly maxUses?: number;
}

export interface OneTimeApproval {
  readonly id: string;
  readonly principal: string;
  readonly agent: string;
  readonly cmd: `/${string}`;
  readonly purpose: string;
  readonly resource: string;
  readonly recipient: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly claims?: readonly string[];
  readonly termsDigest: string;
  readonly exp: number;
  readonly maxUses: number;
}

/** Narrowing-only constraint. No effect field: every applicable constraint must hold. */
export interface PolicyConstraint {
  readonly id: string;
  readonly agent?: string;
  readonly cmd?: `/${string}`;
  readonly purpose?: string;
  readonly amountMax?: number;
  readonly recipients?: readonly string[];
  readonly allowedClaims?: readonly string[];
  readonly nbf?: number;
  readonly exp?: number;
}

export interface Citation {
  readonly authorityId: string;
  readonly kind: "grant" | "approval";
  readonly policyIds: readonly string[];
}

export type AuthorityDenyReason =
  | "no-authority"
  | "forbidden"
  | "expired"
  | "uses-exhausted"
  | "revoked"
  | "terms";

export type AuthorityDecision =
  | {
      readonly allow: true;
      readonly citations: readonly [Citation, ...Citation[]];
    }
  | {
      readonly allow: false;
      readonly reason: AuthorityDenyReason;
      readonly detail?: string;
      readonly authorityId?: string;
      readonly policyId?: string;
    };

function isCovered(broad: `/${string}`, narrow: `/${string}`): boolean {
  return (
    narrow === broad ||
    narrow.startsWith(broad.endsWith("/") ? broad : `${broad}/`)
  );
}

function isPayCmd(cmd: `/${string}`): boolean {
  return cmd === "/pay" || cmd.startsWith("/pay/");
}

/** Fail-loud numeric validation: NaN/Infinity must never become authority. */
function checkBoundsShape(
  v: {
    readonly amountMax?: number;
    readonly nbf?: number;
    readonly exp?: number;
    readonly maxUses?: number;
  },
  what: string
): void {
  if (
    v.amountMax !== undefined &&
    (!Number.isFinite(v.amountMax) || v.amountMax <= 0)
  ) {
    throw new Error(`${what}: amountMax must be a positive finite number`);
  }
  for (const [name, bound] of [
    ["nbf", v.nbf],
    ["exp", v.exp],
  ] as const) {
    if (bound !== undefined && (!Number.isInteger(bound) || bound < 0)) {
      throw new Error(`${what}: ${name} must be a non-negative epoch integer`);
    }
  }
  if (
    v.maxUses !== undefined &&
    (!Number.isInteger(v.maxUses) || v.maxUses < 1)
  ) {
    throw new Error(`${what}: maxUses must be an integer >= 1`);
  }
}

function claimsEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((c) => right.includes(c));
}

type Bounds = Pick<
  StandingGrant,
  | "principal"
  | "agent"
  | "cmd"
  | "purpose"
  | "resource"
  | "recipient"
  | "amountMax"
  | "currency"
  | "allowedClaims"
>;

/** Class-level bounds check. Time, uses, and revocation are handled by the caller. */
function boundsMatch(auth: Bounds, demand: AuthorityDemand): boolean {
  if (auth.principal !== demand.principal) return false;
  if (auth.agent !== undefined && auth.agent !== demand.agent) return false;
  if (!isCovered(auth.cmd, demand.cmd)) return false;
  if (auth.purpose !== undefined && auth.purpose !== demand.purpose)
    return false;
  if (auth.resource !== undefined && auth.resource !== demand.resource)
    return false;
  if (auth.recipient !== undefined && auth.recipient !== demand.recipient)
    return false;
  if (auth.amountMax !== undefined) {
    if (
      demand.amount === undefined ||
      !(demand.amount > 0) ||
      demand.amount > auth.amountMax
    )
      return false;
  }
  if (auth.currency !== undefined && demand.currency !== auth.currency)
    return false;
  if (demand.claims !== undefined && demand.claims.length > 0) {
    if (auth.allowedClaims === undefined) return false;
    const allowed = new Set(auth.allowedClaims);
    if (!demand.claims.every((c) => allowed.has(c))) return false;
  }
  return true;
}

function constraintApplies(
  p: PolicyConstraint,
  demand: AuthorityDemand
): boolean {
  if (p.agent !== undefined && p.agent !== demand.agent) return false;
  if (p.cmd !== undefined && !isCovered(p.cmd, demand.cmd)) return false;
  if (p.purpose !== undefined && p.purpose !== demand.purpose) return false;
  return true;
}

function constraintHolds(
  p: PolicyConstraint,
  demand: AuthorityDemand,
  now: number
): boolean {
  if (p.nbf !== undefined && now < p.nbf - SKEW_SEC) return false;
  if (p.exp !== undefined && now > p.exp + SKEW_SEC) return false;
  if (p.amountMax !== undefined) {
    if (demand.amount === undefined || demand.amount > p.amountMax)
      return false;
  }
  if (p.recipients !== undefined && !p.recipients.includes(demand.recipient))
    return false;
  if (p.allowedClaims !== undefined && demand.claims !== undefined) {
    const allowed = new Set(p.allowedClaims);
    if (!demand.claims.every((c) => allowed.has(c))) return false;
  }
  return true;
}

export interface AuthoritySnapshot {
  readonly grants: StandingGrant[];
  readonly approvals: OneTimeApproval[];
  readonly policies: PolicyConstraint[];
  readonly revoked: [string, number | null][];
  readonly used: [string, number][];
  readonly issued: [string, string[]][];
}

export class Authority {
  private readonly grants = new Map<string, StandingGrant>();
  private readonly approvals = new Map<string, OneTimeApproval>();
  private readonly policies = new Map<string, PolicyConstraint>();
  private readonly revoked = new Map<string, number | null>();
  private readonly used = new Map<string, number>();
  private readonly issued = new Map<string, Set<string>>();
  private readonly nowSec: () => number;
  private readonly onRevoke:
    ((capabilityRevocationIds: string[]) => void) | undefined;

  constructor(
    opts: {
      readonly nowSec?: () => number;
      readonly onRevoke?: (capabilityRevocationIds: string[]) => void;
    } = {}
  ) {
    this.nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
    this.onRevoke = opts.onRevoke;
  }

  addGrant(g: StandingGrant): void {
    if (g.id.length === 0) throw new Error("grant id required");
    if (g.cmd === "/" || !g.cmd.startsWith("/"))
      throw new Error("grant: wildcard cmd forbidden");
    checkBoundsShape(g, `grant ${g.id}`);
    if (
      isPayCmd(g.cmd) &&
      (g.amountMax === undefined || g.currency === undefined)
    ) {
      throw new Error(
        `grant ${g.id}: /pay grants require an amountMax ceiling and currency`
      );
    }
    this.grants.set(g.id, g);
  }

  addApproval(a: OneTimeApproval): void {
    if (a.id.length === 0) throw new Error("approval id required");
    checkBoundsShape(a, `approval ${a.id}`);
    this.approvals.set(a.id, a);
  }

  /** Mint a one-time approval binding the EXACT terms. Any term change → new approval. */
  createApproval(params: {
    readonly id: string;
    readonly principal: string;
    readonly agent: string;
    readonly cmd: `/${string}`;
    readonly purpose: string;
    readonly resource: string;
    readonly recipient: string;
    readonly amount?: number;
    readonly currency?: string;
    readonly claims?: readonly string[];
    readonly terms: unknown;
    readonly ttlSec: number;
    readonly maxUses?: number;
  }): OneTimeApproval {
    if (!Number.isFinite(params.ttlSec) || params.ttlSec <= 0) {
      throw new Error(
        "createApproval: ttlSec must be a positive finite number"
      );
    }
    if (
      params.amount !== undefined &&
      (!Number.isFinite(params.amount) || params.amount <= 0)
    ) {
      throw new Error(
        "createApproval: amount must be a positive finite number"
      );
    }
    const approval: OneTimeApproval = {
      id: params.id,
      principal: params.principal,
      agent: params.agent,
      cmd: params.cmd,
      purpose: params.purpose,
      resource: params.resource,
      recipient: params.recipient,
      ...(params.amount !== undefined ? { amount: params.amount } : {}),
      ...(params.currency !== undefined ? { currency: params.currency } : {}),
      ...(params.claims !== undefined ? { claims: params.claims } : {}),
      termsDigest: termsDigestOf(params.terms),
      exp: this.nowSec() + params.ttlSec,
      maxUses: params.maxUses ?? 1,
    };
    this.addApproval(approval);
    return approval;
  }

  addPolicy(p: PolicyConstraint): void {
    if (p.id.length === 0) throw new Error("policy id required");
    checkBoundsShape(p, `policy ${p.id}`);
    this.policies.set(p.id, p);
  }

  /**
   * Record which capability revocation ids were minted under an authority id,
   * so `revoke` fans out to everything derived from it (spec story 4).
   * The host calls this at mint time and wires `onRevoke` to its Capabilities.
   */
  noteIssued(authorityId: string, capabilityRevocationId: string): void {
    const set = this.issued.get(authorityId) ?? new Set<string>();
    set.add(capabilityRevocationId);
    this.issued.set(authorityId, set);
  }

  revoke(id: string, exp?: number): void {
    this.revoked.set(id, exp ?? null);
    const derived = this.issued.get(id);
    if (derived !== undefined && this.onRevoke !== undefined) {
      this.onRevoke([...derived]);
    }
  }

  /** Drop revocation entries whose authority is known-expired. */
  prune(nowSec?: number): void {
    const now = nowSec ?? this.nowSec();
    for (const [id, exp] of this.revoked) {
      if (exp !== null && now > exp + SKEW_SEC) this.revoked.delete(id);
    }
  }

  /** Plain-data snapshot for durable stores. No keys, no secrets — ids and bounds only. */
  snapshot(): AuthoritySnapshot {
    return {
      grants: [...this.grants.values()],
      approvals: [...this.approvals.values()],
      policies: [...this.policies.values()],
      revoked: [...this.revoked.entries()],
      used: [...this.used.entries()],
      issued: [...this.issued.entries()].map(
        ([k, v]) => [k, [...v]] as [string, string[]]
      ),
    };
  }

  /** Restore from a snapshot, validating through the same gates as live input. */
  static restore(
    data: unknown,
    opts?: {
      readonly nowSec?: () => number;
      readonly onRevoke?: (capabilityRevocationIds: string[]) => void;
    }
  ): Authority {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("authority snapshot must be an object");
    }
    const snap = data as Record<string, unknown>;
    const auth = new Authority(opts ?? {});
    for (const key of ["grants", "approvals", "policies"] as const) {
      if (!Array.isArray(snap[key]))
        throw new Error(`authority snapshot: ${key} must be an array`);
    }
    for (const g of snap["grants"] as unknown[])
      auth.addGrant(g as StandingGrant);
    for (const a of snap["approvals"] as unknown[])
      auth.addApproval(a as OneTimeApproval);
    for (const p of snap["policies"] as unknown[])
      auth.addPolicy(p as PolicyConstraint);
    const revoked = snap["revoked"];
    if (!Array.isArray(revoked))
      throw new Error("authority snapshot: revoked must be an array");
    for (const entry of revoked) {
      if (
        !Array.isArray(entry) ||
        typeof entry[0] !== "string" ||
        !(typeof entry[1] === "number" || entry[1] === null)
      ) {
        throw new Error("authority snapshot: bad revocation entry");
      }
      auth.revoked.set(entry[0] as string, entry[1] as number | null);
    }
    const used = snap["used"];
    if (!Array.isArray(used))
      throw new Error("authority snapshot: used must be an array");
    for (const entry of used) {
      if (
        !Array.isArray(entry) ||
        typeof entry[0] !== "string" ||
        !Number.isInteger(entry[1]) ||
        (entry[1] as number) < 0
      ) {
        throw new Error("authority snapshot: bad usage entry");
      }
      auth.used.set(entry[0] as string, entry[1] as number);
    }
    const issued = snap["issued"];
    if (!Array.isArray(issued))
      throw new Error("authority snapshot: issued must be an array");
    for (const entry of issued) {
      if (
        !Array.isArray(entry) ||
        typeof entry[0] !== "string" ||
        !Array.isArray(entry[1]) ||
        !(entry[1] as unknown[]).every((x) => typeof x === "string")
      ) {
        throw new Error("authority snapshot: bad issuance entry");
      }
      auth.issued.set(entry[0] as string, new Set(entry[1] as string[]));
    }
    return auth;
  }

  evaluate(
    demand: AuthorityDemand,
    opts: { readonly consume?: boolean; readonly nowSec?: number } = {}
  ): AuthorityDecision {
    const now = opts.nowSec ?? this.nowSec();

    // 1. Candidate approvals: exact terms match. Anything sharing the approval's
    // identity fields but differing anywhere else is a terms mutation, not a new ask.
    const approvalHits: OneTimeApproval[] = [];
    let termsMismatch: OneTimeApproval | null = null;
    for (const a of this.approvals.values()) {
      if (a.principal !== demand.principal || a.agent !== demand.agent)
        continue;
      if (a.cmd !== demand.cmd || a.purpose !== demand.purpose) continue;
      if (a.resource !== demand.resource || a.recipient !== demand.recipient)
        continue;
      const exact =
        a.termsDigest === demand.termsDigest &&
        (a.amount ?? null) === (demand.amount ?? null) &&
        (a.currency ?? null) === (demand.currency ?? null) &&
        claimsEqual(a.claims, demand.claims);
      if (!exact) {
        termsMismatch = a;
        continue;
      }
      const bounds: Bounds = {
        principal: a.principal,
        agent: a.agent,
        cmd: a.cmd,
        purpose: a.purpose,
        resource: a.resource,
        recipient: a.recipient,
        ...(a.amount !== undefined ? { amountMax: a.amount } : {}),
        ...(a.currency !== undefined ? { currency: a.currency } : {}),
        ...(a.claims !== undefined ? { allowedClaims: a.claims } : {}),
      };
      if (boundsMatch(bounds, demand)) approvalHits.push(a);
    }

    // 2. Candidate grants: class-level bounds.
    const grantHits: StandingGrant[] = [];
    let blocked: AuthorityDecision | null = null;
    for (const g of this.grants.values()) {
      if (!boundsMatch(g, demand)) continue;
      if (this.revoked.has(g.id)) {
        blocked = { allow: false, reason: "revoked", authorityId: g.id };
        continue;
      }
      if (g.exp !== undefined && now > g.exp + SKEW_SEC) {
        blocked = {
          allow: false,
          reason: "expired",
          detail: `exp ${g.exp}`,
          authorityId: g.id,
        };
        continue;
      }
      if (g.nbf !== undefined && now < g.nbf - SKEW_SEC) {
        blocked = {
          allow: false,
          reason: "expired",
          detail: `nbf ${g.nbf}`,
          authorityId: g.id,
        };
        continue;
      }
      if (g.maxUses !== undefined && (this.used.get(g.id) ?? 0) >= g.maxUses) {
        blocked = { allow: false, reason: "uses-exhausted", authorityId: g.id };
        continue;
      }
      grantHits.push(g);
    }
    for (const a of approvalHits) {
      if (this.revoked.has(a.id)) {
        blocked = { allow: false, reason: "revoked", authorityId: a.id };
        continue;
      }
      if (now > a.exp + SKEW_SEC) {
        blocked = {
          allow: false,
          reason: "expired",
          detail: `exp ${a.exp}`,
          authorityId: a.id,
        };
        continue;
      }
      if ((this.used.get(a.id) ?? 0) >= a.maxUses) {
        blocked = { allow: false, reason: "uses-exhausted", authorityId: a.id };
        continue;
      }
    }
    const usableApprovals = approvalHits.filter(
      (a) =>
        !this.revoked.has(a.id) &&
        now <= a.exp + SKEW_SEC &&
        (this.used.get(a.id) ?? 0) < a.maxUses
    );

    // 3. Mutated terms: fields match a known approval but the digest does not.
    if (
      usableApprovals.length === 0 &&
      grantHits.length === 0 &&
      termsMismatch !== null
    ) {
      return {
        allow: false,
        reason: "terms",
        detail: "terms digest mismatch — new approval required",
        authorityId: termsMismatch.id,
      };
    }
    // 4. No covering authority: policies alone never allow.
    if (usableApprovals.length === 0 && grantHits.length === 0) {
      return blocked ?? { allow: false, reason: "no-authority" };
    }

    // 5. Narrowing policies: every applicable constraint must hold (Cedar forbid-first).
    const applicable = [...this.policies.values()].filter((p) =>
      constraintApplies(p, demand)
    );
    for (const p of applicable) {
      if (!constraintHolds(p, demand, now)) {
        return {
          allow: false,
          reason: "forbidden",
          policyId: p.id,
          detail: `narrowed by policy ${p.id}`,
        };
      }
    }

    // 6. Allow with citation. Approvals outrank grants; first applicable policy set cited.
    const primary: Citation =
      usableApprovals.length > 0
        ? {
            authorityId: (usableApprovals[0] as OneTimeApproval).id,
            kind: "approval",
            policyIds: applicable.map((p) => p.id),
          }
        : {
            authorityId: (grantHits[0] as StandingGrant).id,
            kind: "grant",
            policyIds: applicable.map((p) => p.id),
          };
    if (opts.consume === true) {
      this.used.set(
        primary.authorityId,
        (this.used.get(primary.authorityId) ?? 0) + 1
      );
    }
    return { allow: true, citations: [primary] };
  }
}
