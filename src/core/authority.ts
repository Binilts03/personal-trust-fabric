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
 * Actor binding: the engine binds identity from a host-verified ingress
 * (`VerifiedIdentity`), never from caller-supplied fields. Every StandingGrant
 * carries a REQUIRED ActorSelector. Missing is never wildcard — addGrant
 * throws when absent; the explicit `{ kind: "any" }` wildcard exists so
 * audits can see the deliberate choice.
 *
 * Digest binding: demands never self-certify. The termsDigest is DERIVED
 * inside `evaluate` from the normalized operation + ingress identity (plus
 * the verified external binding when one is passed via opts) — there is no
 * caller-supplied digest to disagree about. `createApproval` computes it
 * internally; translators recompute it and ignore caller-supplied values.
 * evaluate keeps comparing digests, so any term change needs a new approval.
 */

const SKEW_SEC = CLOCK_SKEW_SEC;

/**
 * @internal INTERNAL bound form: an operation + ingress identity + derived
 * digest, assembled by the engine (or by translators from verified ingress)
 * for citations/snapshots. Never construct by hand from caller-supplied
 * identity — call `evaluate(operation, ingress)` and let the engine bind.
 */
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
 * Trusted ingress identity (ADR-0013). The host verifies the caller
 * OUT-OF-BAND (OAuth, token, DPoP, mTLS, local registration, API key) and
 * hands the engine this record; the engine binds principal/actor/chain from
 * it and derives the digest internally. Callers NEVER choose their own
 * identity: request-carried identity fields are untrusted hints that fail
 * closed on mismatch (see `adapters/authzen.ts`).
 */
export interface VerifiedIdentity {
  /** Verified actor id. Binds the demand `actor`. */
  readonly id: string;
  /** Verified principal. Binds the demand `principal`. */
  readonly principal: string;
  readonly source:
    "oauth" | "mcp-token" | "dpop" | "mtls" | "local-registration" | "api-key";
  /**
   * Pointer to the verification evidence (token jti, key id, stdio handle).
   * Never a secret.
   */
  readonly proofRef: string;
  /**
   * Delegation evidence. Recorded as the demand `actorChain` for provenance
   * ONLY — it never confers authority (`rooted` selectors were removed).
   */
  readonly chain?: readonly string[];
}

/**
 * Verified external binding folded into digest derivation (ADR-0013). The
 * `value` (e.g. an AP2 transaction id that arrived as verified mandate
 * evidence) is covered by the digest so approvals bind it; the full record
 * is echoed in citations.
 */
export interface VerifiedExternalBinding {
  readonly scheme: "ap2";
  /** The bound value. Covered by the digest. */
  readonly value: string;
  /** Pointer to the evidence (e.g. mandate ref). Echoed, never digested. */
  readonly evidenceRef: string;
}

/**
 * Caller-supplied operation: action + resource + context (+ purpose).
 * Carries NO identity and NO digest — those bind from the verified ingress
 * inside `evaluate`.
 */
export type AuthorityOperation = Omit<
  AuthorityRequest,
  "termsDigest" | "principal" | "actor" | "actorChain"
>;

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
 * prefer exact / set. Absent is NOT wildcard: registration throws.
 * (`rooted` was removed in ADR-0013: delegation history is provenance, not
 * authorization — a chain entry must never mint power.)
 */
export type ActorSelector =
  | { readonly kind: "exact"; readonly id: string }
  | { readonly kind: "set"; readonly ids: readonly string[] }
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
  /**
   * Verified external binding the approval was minted under (e.g. an AP2
   * transaction id). Folded into the terms digest, so evaluation with a
   * different (or absent) binding fails closed on terms.
   */
  readonly binding?: VerifiedExternalBinding;
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
  /** Echo of the verified external binding the decision was derived under. */
  readonly binding?: VerifiedExternalBinding;
}

/**
 * Closed deny vocabulary as a runtime tuple — the single source of truth.
 * Metrics bucket keys must come from here, never from caller content
 * (cardinality + secrecy guard); unknown strings bucket as "other".
 */
export const AUTHORITY_DENY_REASONS = [
  "no-authority",
  "forbidden",
  "expired",
  "uses-exhausted",
  "revoked",
  "terms",
] as const;

export type AuthorityDenyReason = (typeof AUTHORITY_DENY_REASONS)[number];

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

/** Bound operation: identity attached, digest not yet derived. */
type BoundOperation = Omit<AuthorityRequest, "termsDigest">;

/**
 * Canonical form of a bound operation for digesting. Absent optionals
 * normalize to stable sentinels (absent chain ≡ [], absent purpose ≡ null,
 * absent property bags ≡ {}), so two operations with the same meaning bind
 * the same digest. Array ORDER is significant: ["b","a"] and ["a","b"] bind
 * different digests (the engine cannot know which arrays are
 * order-insensitive). A verified external binding, when present, folds its
 * scheme + value into the digest (evidenceRef is a log pointer, not terms).
 */
function normalizeOperation(
  op: BoundOperation,
  binding?: VerifiedExternalBinding
): Record<string, unknown> {
  return {
    action: { name: op.action.name, properties: op.action.properties ?? {} },
    actor: op.actor,
    actorChain: [...(op.actorChain ?? [])],
    ...(binding !== undefined
      ? { binding: { scheme: binding.scheme, value: binding.value } }
      : {}),
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

/** Fail-closed validation for verified external bindings. */
function checkBinding(binding: VerifiedExternalBinding, what: string): void {
  if (
    typeof binding !== "object" ||
    binding === null ||
    Array.isArray(binding)
  ) {
    throw new Error(`${what}: binding must be an object`);
  }
  const rec = binding as unknown as Record<string, unknown>;
  if (rec["scheme"] !== "ap2") {
    throw new Error(`${what}: unknown binding scheme (expected "ap2")`);
  }
  if (typeof rec["value"] !== "string" || rec["value"].length === 0) {
    throw new Error(`${what}: binding value must be a non-empty string`);
  }
  if (
    typeof rec["evidenceRef"] !== "string" ||
    rec["evidenceRef"].length === 0
  ) {
    throw new Error(`${what}: binding evidenceRef must be a non-empty string`);
  }
}

/** Fail-closed validation for trusted ingress identities. */
function checkIngress(ingress: VerifiedIdentity): void {
  if (
    typeof ingress !== "object" ||
    ingress === null ||
    Array.isArray(ingress)
  ) {
    throw new Error("evaluate: ingress must be a VerifiedIdentity object");
  }
  const rec = ingress as unknown as Record<string, unknown>;
  if (typeof rec["id"] !== "string" || rec["id"].length === 0) {
    throw new Error("evaluate: ingress.id must be a non-empty string");
  }
  if (typeof rec["principal"] !== "string" || rec["principal"].length === 0) {
    throw new Error("evaluate: ingress.principal must be a non-empty string");
  }
  const source: unknown = rec["source"];
  if (
    source !== "oauth" &&
    source !== "mcp-token" &&
    source !== "dpop" &&
    source !== "mtls" &&
    source !== "local-registration" &&
    source !== "api-key"
  ) {
    throw new Error(
      "evaluate: ingress.source must be one of oauth|mcp-token|dpop|mtls|local-registration|api-key"
    );
  }
  if (typeof rec["proofRef"] !== "string" || rec["proofRef"].length === 0) {
    throw new Error("evaluate: ingress.proofRef must be a non-empty string");
  }
  const chain: unknown = rec["chain"];
  if (
    chain !== undefined &&
    (!Array.isArray(chain) ||
      !(chain as unknown[]).every((x) => typeof x === "string" && x.length > 0))
  ) {
    throw new Error("evaluate: ingress.chain must be a non-empty-string array");
  }
}

/**
 * Derive the binding digest for a bound operation. Callers NEVER supply
 * termsDigest: `evaluate` computes it internally from (operation, ingress,
 * binding); `createApproval` computes it internally; translators recompute
 * it from the normalized operation, ignoring any caller-supplied value.
 */
export function digestForOperation(
  op: BoundOperation,
  binding?: VerifiedExternalBinding
): string {
  if (binding !== undefined) checkBinding(binding, "digestForOperation");
  return termsDigestOf(normalizeOperation(op, binding));
}

function canonicalEqual(a: unknown, b: unknown): boolean {
  try {
    return canonicalize(a) === canonicalize(b);
  } catch {
    return false;
  }
}

function actorMatches(sel: ActorSelector, actor: string): boolean {
  switch (sel.kind) {
    case "exact":
      return actor === sel.id;
    case "set":
      return sel.ids.includes(actor);
    case "any":
      // Explicit wildcard — deliberate and audit-visible. Prefer exact/set.
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
    case "any":
      // Explicit wildcard — deliberate, audit-visible. Prefer exact/set.
      return;
    default:
      throw new Error(
        `${what}: unknown actor selector kind (rooted was removed — see ADR-0013)`
      );
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
  if (!ignoreActor && !actorMatches(g.actor, demand.actor)) return false;
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
  if (p.actor !== undefined && !actorMatches(p.actor, demand.actor))
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
  /**
   * Optimistic-concurrency revision (ticket 02). Bumped by the store layer
   * on every durable write; `saveAuthority` refuses to overwrite a revision
   * it did not load, so concurrent writers fail closed instead of
   * last-write-wins. Absent (pre-revision snapshots) means 0.
   */
  readonly revision: number;
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
  /**
   * Revision this instance was restored at (0 for fresh instances).
   * Compared — never merged — by the store layer on save (ticket 02).
   */
  private snapshotRevision = 0;
  /**
   * Whether this instance descends from a durable read or write. Fresh
   * in-memory instances may only create a missing file — never overwrite
   * an existing store they never loaded (operator-error clobber).
   */
  private knownLineage = false;

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
    this.checkDuplicateId(g.id, `grant ${g.id}`);
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
    // an evaluation rule) so existing bounded grants keep working; restores
    // re-validate through the same path, so pre-guard currency-less
    // snapshots throw instead of minting unbounded-currency authority.
    // Currency is part of the same guard: an amount without an exact currency
    // is not a bound at all (2000 of WHAT?), and one ceiling cannot safely
    // cover two monies — so `.context.currency == "<ISO>"` is required too.
    // Multi-currency authority needs one grant per currency, or a real
    // monetary-bound model instead of independent scalar predicates.
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
      const hasExactCurrency = g.bounds.some(
        (b) =>
          b.path === ".context.currency" &&
          b.op === "==" &&
          typeof b.value === "string" &&
          b.value.length > 0
      );
      if (!hasExactCurrency) {
        throw new Error(
          `grant ${g.id}: currency-less /pay* grant rejected — bind one exact .context.currency (e.g. paymentBounds({ amountMax, currency }))`
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
    this.checkDuplicateId(a.id, `approval ${a.id}`);
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
    if (a.binding !== undefined) {
      checkBinding(a.binding, what);
    }
    checkTimeUses(a, what);
    this.approvals.set(a.id, a);
  }

  /**
   * Mint a one-time approval binding the EXACT operation. The digest is
   * derived internally via digestForOperation — there is no terms parameter
   * to disagree about. Any term change → new approval. Pass the verified
   * external binding (e.g. AP2 evidence) to mint exact approvals for bound
   * operations; the binding folds into the digest.
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
    readonly binding?: VerifiedExternalBinding;
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
    if (params.binding !== undefined) {
      checkBinding(params.binding, "createApproval");
    }
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
    const op: BoundOperation = {
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
      ...(params.binding !== undefined
        ? {
            binding: {
              scheme: params.binding.scheme,
              value: params.binding.value,
              evidenceRef: params.binding.evidenceRef,
            },
          }
        : {}),
      termsDigest: digestForOperation(
        op,
        params.binding !== undefined ? params.binding : undefined
      ),
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
    this.checkDuplicateId(p.id, `policy ${p.id}`);
    if (this.revoked.has(p.id)) {
      throw new Error(
        `policy ${p.id}: id was retired via disablePolicy — ids are global and immutable`
      );
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
   * Authority ids are global across grants, approvals, and policies:
   * revocation, usage, and citations are all keyed by id, so silently
   * replacing authority under an existing identifier would make history
   * ambiguous. Re-registering an id throws — revoke the old one first
   * (revocation is permanent and audit-visible).
   */
  private checkDuplicateId(id: string, what: string): void {
    if (
      this.grants.has(id) ||
      this.approvals.has(id) ||
      this.policies.has(id)
    ) {
      throw new Error(
        `${what}: id ${id} already registered (ids are global and immutable — revoke first)`
      );
    }
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

  /**
   * Revoke a grant or approval id. Revocation is permanent, audit-visible
   * (snapshot `revoked`), and fans out to derived capabilities via onRevoke.
   *
   * Policies are NOT revocable: evaluate never consults `revoked` for
   * policies, so revoking a policy id used to record a revocation that
   * changed nothing while the policy kept narrowing. Passing a policy id
   * throws — retire policies with {@link disablePolicy}.
   */
  revoke(id: string, exp?: number): void {
    if (this.policies.has(id)) {
      throw new Error(
        `revoke: ${id} is a policy — revoke has no effect on policies; retire it with disablePolicy`
      );
    }
    this.revoked.set(id, exp ?? null);
    const derived = this.issued.get(id);
    if (derived !== undefined && this.onRevoke !== undefined) {
      this.onRevoke([...derived]);
    }
  }

  /**
   * Retire a policy: it stops narrowing immediately, and the retirement is
   * permanent and audit-visible. The id is recorded in `revoked` (so
   * snapshots/audits show the retirement and the id can never be
   * re-registered — citations may still reference it), while the policy body
   * is dropped so it can never apply again, including across
   * snapshot/restore cycles.
   */
  disablePolicy(id: string): void {
    if (!this.policies.has(id)) {
      if (this.grants.has(id) || this.approvals.has(id)) {
        throw new Error(
          `disablePolicy: ${id} is not a policy — revoke grants and approvals with revoke`
        );
      }
      throw new Error(`disablePolicy: unknown policy ${id}`);
    }
    this.policies.delete(id);
    this.revoked.set(id, null);
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
      revision: this.snapshotRevision,
    };
  }

  /**
   * Revision this instance was restored at (0 for fresh instances).
   * The store layer compares it against the file revision on save and
   * refuses mismatches — callers must reload, never forge it forward.
   */
  loadedRevision(): number {
    return this.snapshotRevision;
  }

  /**
   * Adopt a revision after a successful durable write. Store-layer use
   * only (`saveAuthority` calls this after its compare-and-swap succeeds).
   */
  adoptRevision(rev: number): void {
    if (!Number.isInteger(rev) || rev < 0) {
      throw new Error("authority: bad snapshot revision");
    }
    this.snapshotRevision = rev;
    this.knownLineage = true;
  }

  /**
   * Whether this instance descends from a durable read or write. The
   * store layer refuses a fresh instance overwriting an existing file.
   */
  hasKnownLineage(): boolean {
    return this.knownLineage;
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
    auth.knownLineage = true;
    const rev: unknown = snap["revision"];
    if (rev !== undefined) {
      if (!Number.isInteger(rev) || (rev as number) < 0) {
        throw new Error("authority snapshot: bad revision");
      }
      auth.adoptRevision(rev as number);
    }
    for (const key of ["grants", "approvals", "policies"] as const) {
      if (!Array.isArray(snap[key]))
        throw new Error(`authority snapshot: ${key} must be an array`);
    }
    // Fail fast on ambiguous history: ids are global, so a snapshot reusing
    // one id across entries (any kinds) is corrupt input, not something to
    // half-load. Recovery is manual: assign distinct ids in the snapshot.
    {
      const seen = new Set<string>();
      for (const key of ["grants", "approvals", "policies"] as const) {
        for (const entry of snap[key] as unknown[]) {
          const id: unknown = (entry as Record<string, unknown>)["id"];
          if (typeof id === "string") {
            if (seen.has(id)) {
              throw new Error(
                `authority snapshot: duplicate id ${id} — assign distinct ids across grants, approvals, and policies`
              );
            }
            seen.add(id);
          }
        }
      }
    }
    for (const g of snap["grants"] as unknown[])
      auth.addGrant(g as StandingGrant);
    for (const a of snap["approvals"] as unknown[])
      auth.addApproval(a as OneTimeApproval);
    // Revocations load BEFORE policies: addPolicy rejects retired ids, so a
    // snapshot smuggling both a policy body and its retirement scar fails
    // closed here instead of reviving the policy. (Grants/approvals have no
    // such check — a revoked grant must restore as revoked, not throw.)
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
    for (const p of snap["policies"] as unknown[])
      auth.addPolicy(p as PolicyConstraint);
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

  /**
   * Evaluate an operation under a verified ingress identity. The engine
   * binds principal/actor/chain from the ingress and derives the digest
   * internally (folding opts.binding when present) — the operation carries
   * NO identity and NO digest, so callers cannot choose their own identity
   * or self-certify terms. Never throws on deny, only on malformed
   * operation/ingress/binding (fail-closed at the caller).
   */
  evaluate(
    operation: AuthorityOperation,
    ingress: VerifiedIdentity,
    opts: {
      readonly consume?: boolean;
      readonly nowSec?: number;
      readonly binding?: VerifiedExternalBinding;
    } = {}
  ): AuthorityDecision {
    if (
      typeof operation !== "object" ||
      operation === null ||
      Array.isArray(operation)
    ) {
      throw new Error("evaluate: operation must be an object");
    }
    checkIngress(ingress);
    if (opts.binding !== undefined) checkBinding(opts.binding, "evaluate");
    const bound: BoundOperation = {
      ...operation,
      principal: ingress.principal,
      actor: ingress.id,
      ...(ingress.chain !== undefined
        ? { actorChain: [...ingress.chain] }
        : {}),
    };
    const demand: AuthorityRequest = {
      ...bound,
      termsDigest: digestForOperation(bound, opts.binding),
    };
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
    // A verified external binding is echoed so auditors can see what the
    // derived digest was bound under.
    const boundEcho =
      opts.binding !== undefined ? { binding: opts.binding } : {};
    const primary: Citation =
      usableApprovals.length > 0
        ? {
            authorityId: (usableApprovals[0] as OneTimeApproval).id,
            kind: "approval",
            policyIds: applicable.map((p) => p.id),
            ...boundEcho,
          }
        : {
            authorityId: (grantHits[0] as StandingGrant).id,
            kind: "grant",
            policyIds: applicable.map((p) => p.id),
            ...boundEcho,
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
