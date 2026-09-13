import { CLOCK_SKEW_SEC, canonicalize, termsDigestOf } from "./canonical.js";
import { resolveSelector } from "./policy.js";

/**
 * Policy authority — default-deny evaluation over explicit grants and approvals.
 * ADR-0002: policy constrains, never creates. A matching policy with no covering
 * grant or approval still denies. ADR-0010: the engine is domain-neutral — it
 * matches a structured Subject-Action-Resource-Context operation against
 * attribute bounds instead of payment-shaped fields.
 *
 * Evaluation architecture (preserved from the payment-shaped engine):
 * approvals-exact → grants-bounds → policies-narrow → citations, with
 * time/uses/revocation/cascade handled by the caller-side checks in step 2.
 *
 * Actor binding: every StandingGrant carries a REQUIRED ActorSelector.
 * Missing is never wildcard — addGrant throws when absent; the explicit
 * `{ kind: "any" }` wildcard exists so audits can see the deliberate choice.
 *
 * Digest binding: demands never self-certify. The termsDigest is DERIVED from
 * the normalized operation via digestForOperation (createApproval computes it
 * internally; translators recompute it and ignore caller-supplied values).
 * evaluate keeps comparing digests, so any term change needs a new approval.
 */

const SKEW_SEC = CLOCK_SKEW_SEC;

/** Domain-neutral demand. `termsDigest` is derived, never trusted (see above). */
export interface AuthorityRequest {
  readonly principal: string;
  readonly actor: string;
  readonly actorChain?: readonly string[];
  readonly action: {
    readonly name: `/${string}`;
    readonly properties?: Record<string, unknown>;
  };
  readonly resource: {
    readonly type: string;
    readonly id: string;
    readonly properties?: Record<string, unknown>;
  };
  readonly context: Record<string, unknown>;
  readonly purpose?: string;
  readonly termsDigest: string;
}

/**
 * Attribute bound evaluated against the demand with policy.ts resolveSelector
 * syntax (e.g. ".context.amount", ".action.name", ".principal").
 * Op semantics: `==` canonical deep-equal; `<=`/`>=` finite numbers only;
 * `in` = scalar demand value ∈ bound array; `subset` = demand string[] ⊆
 * bound string[]. An unresolvable path never matches (fail-closed).
 */
export interface AttributeBound {
  readonly path: string;
  readonly op: "==" | "<=" | ">=" | "in" | "subset";
  readonly value: unknown;
}

/**
 * Who may act under a grant. `any` is an explicit, audit-visible wildcard —
 * prefer exact / set / rooted. Absent is NOT wildcard: registration throws.
 */
export type ActorSelector =
  | { readonly kind: "exact"; readonly id: string }
  | { readonly kind: "set"; readonly ids: readonly string[] }
  | { readonly kind: "rooted"; readonly root: string }
  | { readonly kind: "any" };

export interface StandingGrant {
  readonly id: string;
  readonly principal: string;
  /** REQUIRED — addGrant throws when absent: missing is never wildcard. */
  readonly actor: ActorSelector;
  readonly action: {
    readonly name: `/${string}`;
    /** When present the demand's action properties must equal it exactly. */
    readonly properties?: Record<string, unknown>;
  };
  /** When present, type/id must match exactly. */
  readonly resource?: {
    readonly type?: string;
    readonly id?: string;
  };
  readonly purpose?: string;
  readonly bounds: readonly AttributeBound[];
  readonly nbf?: number;
  readonly exp?: number;
  /** Absent = unlimited uses. */
  readonly maxUses?: number;
}

export interface OneTimeApproval {
  readonly id: string;
  readonly principal: string;
  /** Exact actor. */
  readonly actor: string;
  /** When present the demand chain must equal it exactly. */
  readonly chain?: readonly string[];
  readonly action: AuthorityRequest["action"];
  readonly resource: AuthorityRequest["resource"];
  readonly context?: Record<string, unknown>;
  readonly purpose?: string;
  readonly termsDigest: string;
  readonly exp: number;
  readonly maxUses: number;
}

/** Narrowing-only constraint. No effect field: every applicable constraint must hold. */
export interface PolicyConstraint {
  readonly id: string;
  /** Absent = applies to all demands. Policies narrow, never grant. */
  readonly actor?: ActorSelector;
  /** Prefix: matches the demand action name and everything under it. */
  readonly actionName?: `/${string}`;
  readonly purpose?: string;
  readonly bounds: readonly AttributeBound[];
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

export function isCovered(broad: `/${string}`, narrow: `/${string}`): boolean {
  return (
    narrow === broad ||
    narrow.startsWith(broad.endsWith("/") ? broad : `${broad}/`)
  );
}

/** Payment profile (small helper, not a policy language): ceiling + currency pin. */
export function paymentBounds(opts: {
  readonly amountMax: number;
  readonly currency: string;
}): AttributeBound[] {
  if (!Number.isFinite(opts.amountMax) || opts.amountMax <= 0) {
    throw new Error(
      "paymentBounds: amountMax must be a positive finite number"
    );
  }
  if (opts.currency.length === 0) {
    throw new Error("paymentBounds: currency must be non-empty");
  }
  return [
    { path: ".context.amount", op: "<=", value: opts.amountMax },
    { path: ".context.currency", op: "==", value: opts.currency },
  ];
}

/** Disclosure profile: the demanded claims must sit inside the allowed set. */
export function claimsSubset(allowed: readonly string[]): AttributeBound[] {
  if (allowed.length === 0) {
    throw new Error("claimsSubset: allowed must be non-empty");
  }
  for (const c of allowed) {
    if (typeof c !== "string" || c.length === 0) {
      throw new Error("claimsSubset: allowed must be non-empty strings");
    }
  }
  return [{ path: ".context.claims", op: "subset", value: [...allowed] }];
}

type Operation = Omit<AuthorityRequest, "termsDigest">;

/**
 * Canonical form of an operation for digesting. Absent optionals normalize to
 * stable sentinels (absent chain ≡ [], absent purpose ≡ null, absent property
 * bags ≡ {}), so two operations with the same meaning bind the same digest.
 * Array ORDER is significant: ["b","a"] and ["a","b"] bind different digests
 * (the engine cannot know which arrays are order-insensitive).
 */
function normalizeOperation(op: Operation): Record<string, unknown> {
  return {
    action: { name: op.action.name, properties: op.action.properties ?? {} },
    actor: op.actor,
    actorChain: [...(op.actorChain ?? [])],
    context: op.context ?? {},
    principal: op.principal,
    purpose: op.purpose ?? null,
    resource: {
      id: op.resource.id,
      properties: op.resource.properties ?? {},
      type: op.resource.type,
    },
  };
}

/**
 * Derive the binding digest for an operation. Callers NEVER supply termsDigest:
 * createApproval computes it internally and translators recompute it from the
 * normalized operation, ignoring any caller-supplied value.
 */
export function digestForOperation(
  op: Omit<AuthorityRequest, "termsDigest">
): string {
  return termsDigestOf(normalizeOperation(op));
}

function canonicalEqual(a: unknown, b: unknown): boolean {
  try {
    return canonicalize(a) === canonicalize(b);
  } catch {
    return false;
  }
}

function actorMatches(
  sel: ActorSelector,
  actor: string,
  chain: readonly string[] | undefined
): boolean {
  switch (sel.kind) {
    case "exact":
      return actor === sel.id;
    case "set":
      return sel.ids.includes(actor);
    case "rooted":
      return chain !== undefined && chain.includes(sel.root);
    case "any":
      // Explicit wildcard — deliberate and audit-visible. Prefer exact/set/rooted.
      return true;
  }
}

function isScalar(v: unknown): v is string | number | boolean {
  return (
    typeof v === "string" || typeof v === "number" || typeof v === "boolean"
  );
}

function boundHolds(b: AttributeBound, demand: AuthorityRequest): boolean {
  const r = resolveSelector(demand, b.path);
  if (!r.found) return false;
  const v = r.value;
  switch (b.op) {
    case "==":
      return canonicalEqual(v, b.value);
    case "<=":
    case ">=": {
      if (typeof v !== "number" || typeof b.value !== "number") return false;
      if (!Number.isFinite(v) || !Number.isFinite(b.value)) return false;
      return b.op === "<=" ? v <= b.value : v >= b.value;
    }
    case "in": {
      if (!isScalar(v) || !Array.isArray(b.value)) return false;
      return (b.value as unknown[]).some((item) => canonicalEqual(item, v));
    }
    case "subset": {
      if (!Array.isArray(v) || !Array.isArray(b.value)) return false;
      const allowed = b.value as unknown[];
      return (v as unknown[]).every(
        (item) => typeof item === "string" && allowed.includes(item)
      );
    }
  }
}

/** Fail-loud time/use validation: non-integers must never become authority. */
function checkTimeUses(
  v: {
    readonly nbf?: number;
    readonly exp?: number;
    readonly maxUses?: number;
  },
  what: string
): void {
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

function checkActorSelector(sel: unknown, what: string): void {
  if (typeof sel !== "object" || sel === null || Array.isArray(sel)) {
    throw new Error(
      `${what}: actor selector required — missing is never wildcard (use { kind: "any" } explicitly)`
    );
  }
  const rec = sel as Record<string, unknown>;
  switch (rec["kind"]) {
    case "exact": {
      if (typeof rec["id"] !== "string" || rec["id"].length === 0) {
        throw new Error(`${what}: exact actor id must be a non-empty string`);
      }
      return;
    }
    case "set": {
      const ids: unknown = rec["ids"];
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        !(ids as unknown[]).every((x) => typeof x === "string" && x.length > 0)
      ) {
        throw new Error(
          `${what}: set actor ids must be a non-empty string array`
        );
      }
      return;
    }
    case "rooted": {
      if (typeof rec["root"] !== "string" || rec["root"].length === 0) {
        throw new Error(
          `${what}: rooted actor root must be a non-empty string`
        );
      }
      return;
    }
    case "any":
      // Explicit wildcard — deliberate, audit-visible. Prefer exact/set/rooted.
      return;
    default:
      throw new Error(`${what}: unknown actor selector kind`);
  }
}

/** Schema-style checks at add-time rather than per-request. */
function checkBounds(bounds: unknown, what: string): void {
  if (!Array.isArray(bounds)) {
    throw new Error(`${what}: bounds must be an array`);
  }
  for (const b of bounds) {
    if (typeof b !== "object" || b === null || Array.isArray(b)) {
      throw new Error(`${what}: bound must be an object`);
    }
    const rec = b as Record<string, unknown>;
    if (
      typeof rec["path"] !== "string" ||
      !(rec["path"] as string).startsWith(".") ||
      (rec["path"] as string).length < 2
    ) {
      throw new Error(
        `${what}: bound path must be a resolveSelector path like ".context.amount"`
      );
    }
    const op: unknown = rec["op"];
    if (
      op !== "==" &&
      op !== "<=" &&
      op !== ">=" &&
      op !== "in" &&
      op !== "subset"
    ) {
      throw new Error(
        `${what}: bound op must be one of ==, <=, >=, in, subset`
      );
    }
    const value: unknown = rec["value"];
    if (op === "<=" || op === ">=") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${what}: bound ${op} value must be a finite number`);
      }
    } else if (op === "in") {
      if (!Array.isArray(value)) {
        throw new Error(`${what}: bound in value must be an array`);
      }
    } else if (op === "subset") {
      if (
        !Array.isArray(value) ||
        !(value as unknown[]).every((x) => typeof x === "string")
      ) {
        throw new Error(`${what}: bound subset value must be a string array`);
      }
    } else {
      try {
        canonicalize(value);
      } catch {
        throw new Error(`${what}: bound == value must be canonicalizable`);
      }
    }
  }
}

function checkActionName(
  name: unknown,
  what: string
): asserts name is `/${string}` {
  if (typeof name !== "string" || !name.startsWith("/") || name === "/") {
    throw new Error(`${what}: action name must be a /-path ("/" forbidden)`);
  }
}

/** Class-level bounds check. Time, uses, and revocation are handled by the caller. */
function grantMatches(
  g: StandingGrant,
  demand: AuthorityRequest,
  ignoreActor: boolean
): boolean {
  if (g.principal !== demand.principal) return false;
  if (!ignoreActor && !actorMatches(g.actor, demand.actor, demand.actorChain))
    return false;
  if (!isCovered(g.action.name, demand.action.name)) return false;
  if (
    g.action.properties !== undefined &&
    !canonicalEqual(g.action.properties, demand.action.properties ?? {})
  )
    return false;
  if (g.resource !== undefined) {
    if (
      g.resource.type !== undefined &&
      g.resource.type !== demand.resource.type
    )
      return false;
    if (g.resource.id !== undefined && g.resource.id !== demand.resource.id)
      return false;
  }
  if (g.purpose !== undefined && g.purpose !== demand.purpose) return false;
  for (const b of g.bounds) {
    if (!boundHolds(b, demand)) return false;
  }
  return true;
}

function approvalIdentity(
  a: OneTimeApproval,
  demand: AuthorityRequest,
  ignoreActor: boolean
): boolean {
  if (a.principal !== demand.principal) return false;
  if (!ignoreActor && a.actor !== demand.actor) return false;
  if (a.action.name !== demand.action.name) return false;
  if (
    a.resource.type !== demand.resource.type ||
    a.resource.id !== demand.resource.id
  )
    return false;
  if ((a.purpose ?? null) !== (demand.purpose ?? null)) return false;
  return true;
}

function chainEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function approvalExact(a: OneTimeApproval, demand: AuthorityRequest): boolean {
  if (!approvalIdentity(a, demand, false)) return false;
  if (
    !canonicalEqual(a.action.properties ?? {}, demand.action.properties ?? {})
  )
    return false;
  if (
    !canonicalEqual(
      a.resource.properties ?? {},
      demand.resource.properties ?? {}
    )
  )
    return false;
  if (!canonicalEqual(a.context ?? {}, demand.context)) return false;
  if (!chainEqual(a.chain ?? [], demand.actorChain ?? [])) return false;
  return a.termsDigest === demand.termsDigest;
}

function policyApplies(p: PolicyConstraint, demand: AuthorityRequest): boolean {
  if (
    p.actor !== undefined &&
    !actorMatches(p.actor, demand.actor, demand.actorChain)
  )
    return false;
  if (
    p.actionName !== undefined &&
    !isCovered(p.actionName, demand.action.name)
  )
    return false;
  if (p.purpose !== undefined && p.purpose !== demand.purpose) return false;
  return true;
}

function policyHolds(
  p: PolicyConstraint,
  demand: AuthorityRequest,
  now: number
): boolean {
  if (p.nbf !== undefined && now < p.nbf - SKEW_SEC) return false;
  if (p.exp !== undefined && now > p.exp + SKEW_SEC) return false;
  for (const b of p.bounds) {
    if (!boundHolds(b, demand)) return false;
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
    if (typeof g !== "object" || g === null || Array.isArray(g)) {
      throw new Error("grant must be an object");
    }
    if (typeof g.id !== "string" || g.id.length === 0) {
      throw new Error("grant id required");
    }
    const rec = g as unknown as Record<string, unknown>;
    if (rec["actor"] === undefined) {
      throw new Error(
        `grant ${g.id}: actor selector required — missing is never wildcard (use { kind: "any" } explicitly)`
      );
    }
    if (rec["cmd"] !== undefined && rec["action"] === undefined) {
      throw new Error(
        `grant ${g.id}: pre-0010 snapshot format (cmd) — see ADR-0010 migration notes`
      );
    }
    checkActorSelector(g.actor, `grant ${g.id}`);
    if (typeof g.action !== "object" || g.action === null) {
      throw new Error(`grant ${g.id}: action required`);
    }
    checkActionName(
      (g.action as { readonly name: unknown }).name,
      `grant ${g.id}`
    );
    if (g.resource !== undefined) {
      if (typeof g.resource !== "object" || g.resource === null) {
        throw new Error(`grant ${g.id}: resource must be an object`);
      }
      if (
        g.resource.type !== undefined &&
        (typeof g.resource.type !== "string" || g.resource.type.length === 0)
      ) {
        throw new Error(`grant ${g.id}: resource.type must be non-empty`);
      }
      if (
        g.resource.id !== undefined &&
        (typeof g.resource.id !== "string" || g.resource.id.length === 0)
      ) {
        throw new Error(`grant ${g.id}: resource.id must be non-empty`);
      }
    }
    if (
      g.purpose !== undefined &&
      (typeof g.purpose !== "string" || g.purpose.length === 0)
    ) {
      throw new Error(`grant ${g.id}: purpose must be non-empty`);
    }
    checkTimeUses(g, `grant ${g.id}`);
    checkBounds(g.bounds, `grant ${g.id}`);
    // Soft guard (ticket 11): unbounded /pay* standing grants are a persistent
    // over-spend foot-gun — a grant lives until revoked/expired, so an amount
    // without a ceiling mints open-ended spend authority. Policy constrains,
    // never creates (ADR-0002): require an explicit `.context.amount` ceiling
    // (<=, ==, or `in`) on every /pay* grant. One-time exact-terms approvals
    // remain the path for open or unusual amounts. Soft (add-time throw, not
    // an evaluation rule) so existing bounded grants and restores keep working.
    if (g.action.name.startsWith("/pay")) {
      const hasAmountCeiling = g.bounds.some(
        (b) =>
          b.path === ".context.amount" &&
          (b.op === "<=" || b.op === "==" || b.op === "in")
      );
      if (!hasAmountCeiling) {
        throw new Error(
          `grant ${g.id}: unbounded /pay* grant rejected — add a .context.amount ceiling (e.g. paymentBounds({ amountMax, currency }))`
        );
      }
    }
    this.grants.set(g.id, g);
  }

  addApproval(a: OneTimeApproval): void {
    if (typeof a !== "object" || a === null || Array.isArray(a)) {
      throw new Error("approval must be an object");
    }
    if (typeof a.id !== "string" || a.id.length === 0) {
      throw new Error("approval id required");
    }
    const what = `approval ${a.id}`;
    if (typeof a.principal !== "string" || a.principal.length === 0) {
      throw new Error(`${what}: principal required`);
    }
    if (typeof a.actor !== "string" || a.actor.length === 0) {
      throw new Error(`${what}: actor required`);
    }
    if (typeof a.action !== "object" || a.action === null) {
      throw new Error(`${what}: action required`);
    }
    checkActionName((a.action as { readonly name: unknown }).name, what);
    if (typeof a.resource !== "object" || a.resource === null) {
      throw new Error(`${what}: resource required`);
    }
    if (
      typeof a.resource.type !== "string" ||
      a.resource.type.length === 0 ||
      typeof a.resource.id !== "string" ||
      a.resource.id.length === 0
    ) {
      throw new Error(`${what}: resource type and id required`);
    }
    if (
      a.purpose !== undefined &&
      (typeof a.purpose !== "string" || a.purpose.length === 0)
    ) {
      throw new Error(`${what}: purpose must be non-empty`);
    }
    if (a.chain !== undefined) {
      if (
        !Array.isArray(a.chain) ||
        !(a.chain as unknown[]).every(
          (x) => typeof x === "string" && x.length > 0
        )
      ) {
        throw new Error(`${what}: chain must be a non-empty-string array`);
      }
    }
    if (a.context !== undefined) {
      if (
        typeof a.context !== "object" ||
        a.context === null ||
        Array.isArray(a.context)
      ) {
        throw new Error(`${what}: context must be an object`);
      }
    }
    if (typeof a.termsDigest !== "string" || a.termsDigest.length === 0) {
      throw new Error(`${what}: termsDigest required`);
    }
    checkTimeUses(a, what);
    this.approvals.set(a.id, a);
  }

  /**
   * Mint a one-time approval binding the EXACT operation. The digest is
   * derived internally via digestForOperation — there is no terms parameter
   * to disagree about. Any term change → new approval.
   */
  createApproval(params: {
    readonly id: string;
    readonly principal: string;
    readonly actor: string;
    readonly chain?: readonly string[];
    readonly action: AuthorityRequest["action"];
    readonly resource: AuthorityRequest["resource"];
    readonly context?: Record<string, unknown>;
    readonly purpose?: string;
    readonly ttlSec: number;
    readonly maxUses?: number;
  }): OneTimeApproval {
    if (params.id.length === 0) throw new Error("createApproval: id required");
    if (params.principal.length === 0) {
      throw new Error("createApproval: principal required");
    }
    if (params.actor.length === 0) {
      throw new Error("createApproval: actor required");
    }
    if (!Number.isFinite(params.ttlSec) || params.ttlSec <= 0) {
      throw new Error(
        "createApproval: ttlSec must be a positive finite number"
      );
    }
    if (
      params.maxUses !== undefined &&
      (!Number.isInteger(params.maxUses) || params.maxUses < 1)
    ) {
      throw new Error("createApproval: maxUses must be an integer >= 1");
    }
    checkActionName(params.action.name, "createApproval");
    const action: AuthorityRequest["action"] = {
      name: params.action.name,
      ...(params.action.properties !== undefined
        ? { properties: { ...params.action.properties } }
        : {}),
    };
    const resource: AuthorityRequest["resource"] = {
      type: params.resource.type,
      id: params.resource.id,
      ...(params.resource.properties !== undefined
        ? { properties: { ...params.resource.properties } }
        : {}),
    };
    const op: Operation = {
      principal: params.principal,
      actor: params.actor,
      ...(params.chain !== undefined ? { actorChain: [...params.chain] } : {}),
      action,
      resource,
      context: { ...(params.context ?? {}) },
      ...(params.purpose !== undefined ? { purpose: params.purpose } : {}),
    };
    const approval: OneTimeApproval = {
      id: params.id,
      principal: params.principal,
      actor: params.actor,
      ...(params.chain !== undefined ? { chain: [...params.chain] } : {}),
      action,
      resource,
      ...(params.context !== undefined
        ? { context: { ...params.context } }
        : {}),
      ...(params.purpose !== undefined ? { purpose: params.purpose } : {}),
      termsDigest: digestForOperation(op),
      exp: this.nowSec() + params.ttlSec,
      maxUses: params.maxUses ?? 1,
    };
    this.addApproval(approval);
    return approval;
  }

  addPolicy(p: PolicyConstraint): void {
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      throw new Error("policy must be an object");
    }
    if (typeof p.id !== "string" || p.id.length === 0) {
      throw new Error("policy id required");
    }
    const what = `policy ${p.id}`;
    if (p.actor !== undefined) checkActorSelector(p.actor, what);
    if (p.actionName !== undefined) {
      if (
        typeof p.actionName !== "string" ||
        !(p.actionName as string).startsWith("/")
      ) {
        throw new Error(`${what}: actionName must be a /-path prefix`);
      }
    }
    if (
      p.purpose !== undefined &&
      (typeof p.purpose !== "string" || p.purpose.length === 0)
    ) {
      throw new Error(`${what}: purpose must be non-empty`);
    }
    checkTimeUses(p, what);
    checkBounds(p.bounds, what);
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
    demand: AuthorityRequest,
    opts: { readonly consume?: boolean; readonly nowSec?: number } = {}
  ): AuthorityDecision {
    const now = opts.nowSec ?? this.nowSec();

    // 1. Candidate approvals: exact binding. Identity match with any deviation
    // (properties, context, chain, or digest) is a terms mutation, not a new ask.
    const approvalHits: OneTimeApproval[] = [];
    let termsMismatch: OneTimeApproval | null = null;
    let actorMismatch: string | null = null;
    for (const a of this.approvals.values()) {
      if (!approvalIdentity(a, demand, false)) {
        if (actorMismatch === null && approvalIdentity(a, demand, true)) {
          actorMismatch = `approval ${a.id}`;
        }
        continue;
      }
      if (!approvalExact(a, demand)) {
        termsMismatch = a;
        continue;
      }
      approvalHits.push(a);
    }

    // 2. Candidate grants: class-level bounds.
    const grantHits: StandingGrant[] = [];
    let blocked: AuthorityDecision | null = null;
    for (const g of this.grants.values()) {
      if (!grantMatches(g, demand, false)) {
        if (actorMismatch === null && grantMatches(g, demand, true)) {
          actorMismatch = `grant ${g.id}`;
        }
        continue;
      }
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

    // 3. Mutated terms: identity matches a known approval but the binding does not.
    if (
      usableApprovals.length === 0 &&
      grantHits.length === 0 &&
      termsMismatch !== null
    ) {
      return {
        allow: false,
        reason: "terms",
        detail: "terms digest mismatch — new approval required",
        authorityId: (termsMismatch as OneTimeApproval).id,
      };
    }
    // 4. No covering authority: policies alone never allow. An actor-scoped
    // near-miss keeps the "no-authority" reason but names the authority whose
    // actor selector excluded this demand.
    if (usableApprovals.length === 0 && grantHits.length === 0) {
      if (blocked !== null) return blocked;
      if (actorMismatch !== null) {
        return {
          allow: false,
          reason: "no-authority",
          detail: `actor mismatch on ${actorMismatch}`,
        };
      }
      return { allow: false, reason: "no-authority" };
    }

    // 5. Narrowing policies: every applicable constraint must hold (Cedar forbid-first).
    const applicable = [...this.policies.values()].filter((p) =>
      policyApplies(p, demand)
    );
    for (const p of applicable) {
      if (!policyHolds(p, demand, now)) {
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
