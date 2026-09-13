import { assertSafeUrl } from "./urls.js";

/**
 * OAuth-agent delegation attenuator (ADR-0009) — experimental agent profile
 * over stable foundations.
 *
 * Stable foundations (NOT experimental — behavior cited, not redefined):
 * - RFC8693 (OAuth 2.0 Token Exchange): `act` vocabulary; §4.1 nested
 *   `{"sub", "act"}` object (outermost = current actor). This module's JWT
 *   mapping (`toJwtClaims` / `fromJwtClaims`) follows that nesting.
 * - RFC9396 (Rich Authorization Requests): `authorization_details` array of
 *   typed objects. `rarPaymentDetails` below builds one such entry.
 * - RFC8707 (Resource Indicators): `resource` parameter as an absolute URI
 *   without fragment. `resourceIndicator` below validates that shape.
 * - RFC9449 (DPoP): `cnf.jkt` confirmation (JWK thumbprint). The JWT mapping
 *   wraps the bare descriptor `cnf` to `{ jkt }` per RFC9449 (NOT RFC7800 —
 *   `jkt` is DPoP, not RFC7800; RFC7800 defines the `cnf` container only).
 *
 * Experimental profile (PTF-local agent conventions, labeled as such):
 * `DelegatedToken` is a host-side attenuation record *inspired by* the above
 * (RFC8693 `act`/`scope` shape, RFC9449 `cnf.jkt` binding). This module
 * performs NO signature verification and enforces NO proof-of-possession:
 * delegation here is an opaque descriptor copy. The host MUST authenticate
 * the presenter and verify `cnf` key possession (DPoP / mTLS) out-of-band
 * before honoring any descriptor.
 *
 * Standard JWT wire shape lives ONLY in `toJwtClaims` / `fromJwtClaims`:
 * the `scope` array <-> space-delimited string and the `act` string array
 * <-> RFC8693 section 4.1 nested `{"sub", "act"}` object conversions happen
 * in that mapping layer and nowhere else.
 *
 * Explicit deviations from RFC8693 / RFC9449 (every item PTF-local with
 * reason):
 * - PTF-local: `act` is a flat append-only `string[]` (oldest actor first),
 *   not the RFC8693 nested object. Reason: cheap subset/cycle checks at the
 *   descriptor layer. Nested form exists only in JWT claims mapping.
 * - PTF-local: `scope` is a `string[]`, not the JWT space-delimited string.
 *   Reason: array form makes subset attenuation exact. The string form
 *   exists only in JWT claims mapping.
 * - PTF-local: `cnf` is a bare opaque key-reference string, not the RFC9449
 *   `{"jkt": ...}` object. Reason: this layer copies descriptors without
 *   verifying possession. The object form exists only in JWT claims mapping.
 * - PTF-local: `aud` is a single string and v0.1 keeps it identical-only:
 *   the `aud` delegate option exists for forward compatibility but any value
 *   other than the parent's throws. Reason: v0.1 ceiling, not RFC behavior
 *   (RFC8707 `resource` narrowing lives in `resourceIndicator`, not here).
 * - PTF-local: `MAX_DELEGATION_DEPTH` (10) and cycle rejection. Reason:
 *   PTF attenuation policy, not RFC.
 * - PTF-local: timestamps are integer seconds with ZERO clock skew (exact
 *   `<=` expiry checks). Reason: deterministic attenuation; core authority
 *   comparisons allow ±60s (`CLOCK_SKEW_SEC`) but this module deliberately
 *   does not. `ttlSec` floats are floored to preserve the integer-`exp`
 *   invariant; `nowSec` must be a finite integer >= 0 (float/NaN `nowSec`
 *   would mint float/NaN `exp` that the next `delegate` call rejects —
 *   self-rejecting chains — so it is rejected up front instead).
 * - PTF-local: empty child scope is rejected, consistent with `mintRoot`.
 *   Reason: the empty set is a valid subset mathematically, but a delegation
 *   granting nothing is treated as a caller bug.
 * - PTF-local: `cnf` rotation/uniqueness is NOT enforced: reusing the
 *   parent's `cnf` string is permitted at this layer (opaque copy, no
 *   possession proof possible here). Reason: host-side PoP verification is
 *   the real control. v0.1 ceiling.
 * - PTF-local: `rarPaymentDetails` `type: "payment_initiation"` string is
 *   profile-defined (experimental agent profile), not an IANA-registered
 *   RFC9396 type. Reason: minimal helper for tests/hosts; real deployments
 *   must agree the type string with their AS.
 * - PTF-local: `resourceIndicator` reuses the edge `assertSafeUrl` discipline
 *   (private-range / userinfo blocking) on top of RFC8707's absolute-https-
 *   no-fragment rule. Reason: consistent SSRF posture across adapters; extra
 *   rejections beyond RFC8707 are documented, not silent.
 *
 * Policy engines, audit stores, budgets, and vaults stay outside this core
 * (cf. `draft-mishra-oauth-agent-grants-02` §1.1).
 */

export interface DelegatedToken {
  /** Principal (human) the chain acts for. Fixed across delegation. */
  readonly sub: string;
  /**
   * PTF-LOCAL actor chain: [parent agent, ..., this agent]. Append-only.
   * Flat array form; the RFC8693 nested object exists only via
   * `toJwtClaims` / `fromJwtClaims`.
   */
  readonly act: readonly string[];
  /**
   * Granted scopes as an array. PTF-LOCAL: the JWT space-delimited string
   * exists only via `toJwtClaims` / `fromJwtClaims`. Non-empty; a child
   * must be a subset of its parent.
   */
  readonly scope: readonly string[];
  /** Resource/audience the token is bound to. v0.1: identical-only. */
  readonly aud: string;
  /**
   * PTF-LOCAL sender-constraint descriptor: opaque key reference (e.g. DPoP
   * jkt or mTLS thumbprint ref). Required. Bare string here; the RFC9449
   * `{"jkt": ...}` object exists only via the JWT mapping layer. No
   * possession is verified by this module — the host must check.
   */
  readonly cnf: string;
  readonly exp: number;
  readonly iat: number;
}

export interface DelegateRequest {
  readonly parent: DelegatedToken;
  /** Agent instance receiving the delegation. Must be non-empty. */
  readonly actor: string;
  /** Requested scopes. Must be a non-empty subset of the parent grant. */
  readonly scope: readonly string[];
  /**
   * Optional narrower audience; absent = inherit parent aud. v0.1 ceiling:
   * any value other than the parent's `aud` throws.
   */
  readonly aud?: string;
  /**
   * Requested lifetime in seconds. Must be positive; fractional values are
   * floored to preserve integer `exp`. Clamped to parent expiry.
   */
  readonly ttlSec: number;
  readonly senderCnf: string;
  /** Current time, integer seconds >= 0. Zero skew: exact comparison. */
  readonly nowSec: number;
}

export class OAuthAgentError extends Error {
  constructor(reason: string) {
    super(`oauth-agent: ${reason}`);
  }
}

/** PTF policy (not RFC): maximum actor-chain length. */
export const MAX_DELEGATION_DEPTH = 10;

/**
 * Standard-JWT nested actor object (RFC8693 §4.1). Outermost `sub` is the
 * current (most recent) actor; each inner `act` is the delegator above it.
 */
export interface JwtActClaim {
  readonly sub: string;
  readonly act?: JwtActClaim;
}

/**
 * Standard-JWT wire shape. Produced/consumed ONLY by `toJwtClaims` /
 * `fromJwtClaims` — the only place PTF-LOCAL array shapes meet standard
 * claim shapes. Unknown extra claims on input are ignored (forward
 * compatibility); every listed field is validated strictly.
 */
export interface JwtDelegationClaims {
  readonly sub: string;
  readonly act: JwtActClaim;
  /** Space-delimited scopes (JWT string form). */
  readonly scope: string;
  /** Single audience string (v0.1 ceiling; JWT `aud` arrays rejected). */
  readonly aud: string;
  readonly cnf: { readonly jkt: string };
  readonly exp: number;
  readonly iat: number;
}

function assertNowSec(nowSec: unknown): asserts nowSec is number {
  if (!Number.isInteger(nowSec) || (nowSec as number) < 0) {
    throw new OAuthAgentError("nowSec must be a finite integer >= 0");
  }
}

function assertTtlSec(ttlSec: unknown): asserts ttlSec is number {
  if (typeof ttlSec !== "number" || !Number.isFinite(ttlSec) || ttlSec <= 0) {
    throw new OAuthAgentError("ttlSec must be positive");
  }
}

function assertNonEmptyString(
  value: unknown,
  message: string
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OAuthAgentError(message);
  }
}

function assertScopeArray(
  scope: unknown,
  what: string
): asserts scope is readonly string[] {
  if (!Array.isArray(scope)) {
    throw new OAuthAgentError(`${what} must be an array`);
  }
  for (const entry of scope) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new OAuthAgentError(`${what} entries must be non-empty strings`);
    }
  }
}

/**
 * Structural validator for any alleged token-shaped value. Runs before any
 * field is trusted: type-checks every claim first so malformed input (e.g.
 * `act: null`, string `scope`, numeric `sub`) throws `OAuthAgentError`
 * instead of a `TypeError` deep in attenuation logic.
 */
function assertTokenShape(
  value: unknown,
  what: string
): asserts value is DelegatedToken {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OAuthAgentError(`${what} must be an object`);
  }
  const rec = value as Record<string, unknown>;
  assertNonEmptyString(rec["sub"], `${what} sub required`);
  const act: unknown = rec["act"];
  if (!Array.isArray(act)) {
    throw new OAuthAgentError(`${what} act must be an array`);
  }
  if (act.length === 0) {
    throw new OAuthAgentError(`${what} act required`);
  }
  for (const a of act) {
    if (typeof a !== "string" || a.length === 0) {
      throw new OAuthAgentError(
        `${what} act entries must be non-empty strings`
      );
    }
  }
  if (act.length > MAX_DELEGATION_DEPTH) {
    throw new OAuthAgentError(`${what} delegation depth exceeded`);
  }
  const scope: unknown = rec["scope"];
  assertScopeArray(scope, `${what} scope`);
  if (scope.length === 0) {
    throw new OAuthAgentError(`${what} scope required`);
  }
  assertNonEmptyString(rec["aud"], `${what} aud required`);
  assertNonEmptyString(rec["cnf"], `${what} cnf required`);
  if (!Number.isInteger(rec["exp"])) {
    throw new OAuthAgentError(`${what} exp must be an integer`);
  }
  if (!Number.isInteger(rec["iat"]) || (rec["iat"] as number) < 0) {
    throw new OAuthAgentError(`${what} iat must be a finite integer >= 0`);
  }
}

function assertScopeSubset(
  parent: readonly string[],
  child: readonly string[]
): void {
  const allowed = new Set(parent);
  for (const s of child) {
    if (!allowed.has(s)) {
      throw new OAuthAgentError(`scope ${s} outside parent grant`);
    }
  }
}

/**
 * Attenuate a parent token into a child. Child ≤ parent on scope, audience,
 * expiry, and depth; `sub` fixed; `act` appended. Depth-cap and
 * cycle-rejection are PTF policy, not RFC. Throws fail-closed.
 */
export function delegate(request: DelegateRequest): DelegatedToken {
  if (typeof request !== "object" || request === null) {
    throw new OAuthAgentError("request must be an object");
  }
  const { parent, actor, scope, ttlSec, senderCnf, nowSec } = request;
  assertTokenShape(parent, "parent");
  assertNowSec(nowSec);
  assertTtlSec(ttlSec);
  assertNonEmptyString(actor, "actor required");
  assertNonEmptyString(senderCnf, "sender cnf required");
  assertScopeArray(scope, "scope");
  if (scope.length === 0) {
    throw new OAuthAgentError("scope required");
  }
  if (parent.exp <= nowSec) {
    throw new OAuthAgentError("parent expired");
  }
  if (parent.act.length + 1 > MAX_DELEGATION_DEPTH) {
    throw new OAuthAgentError("delegation depth exceeded");
  }
  if (parent.act.includes(actor)) {
    throw new OAuthAgentError("delegation cycle rejected");
  }
  assertScopeSubset(parent.scope, scope);
  const audOpt: unknown = request.aud;
  const aud: unknown = audOpt === undefined ? parent.aud : audOpt;
  assertNonEmptyString(aud, "aud required");
  if (aud !== parent.aud) {
    throw new OAuthAgentError("aud may only stay identical in v0.1");
  }
  const exp = Math.min(parent.exp, nowSec + Math.floor(ttlSec));
  if (exp <= nowSec)
    throw new OAuthAgentError("delegation expiry not in future");
  return {
    sub: parent.sub,
    act: [...parent.act, actor],
    scope: [...scope],
    aud,
    cnf: senderCnf,
    exp,
    iat: nowSec,
  };
}

/** Root grant descriptor minted after human consent (host issues the JWT). */
export function mintRoot(params: {
  readonly sub: string;
  readonly actor: string;
  readonly scope: readonly string[];
  readonly aud: string;
  readonly senderCnf: string;
  readonly ttlSec: number;
  readonly nowSec: number;
}): DelegatedToken {
  if (typeof params !== "object" || params === null) {
    throw new OAuthAgentError("params must be an object");
  }
  assertNowSec(params.nowSec);
  assertTtlSec(params.ttlSec);
  assertNonEmptyString(params.sub, "sub required");
  assertNonEmptyString(params.actor, "actor required");
  const scope: unknown = params.scope;
  assertScopeArray(scope, "scope");
  if (scope.length === 0) {
    throw new OAuthAgentError("scope required");
  }
  assertNonEmptyString(params.aud, "aud required");
  assertNonEmptyString(params.senderCnf, "sender cnf required");
  const exp = params.nowSec + Math.floor(params.ttlSec);
  if (exp <= params.nowSec) {
    throw new OAuthAgentError("root expiry must be in the future");
  }
  return {
    sub: params.sub,
    act: [params.actor],
    scope: [...scope],
    aud: params.aud,
    cnf: params.senderCnf,
    exp,
    iat: params.nowSec,
  };
}

/**
 * Map a PTF-LOCAL descriptor to standard JWT claims: `act` array wraps into
 * the RFC8693 §4.1 nested object (outermost = current actor), `scope` array
 * joins to a space-delimited string, bare `cnf` wraps to `{ jkt }` per
 * RFC9449 (DPoP). The input descriptor is structurally validated first.
 */
export function toJwtClaims(token: DelegatedToken): JwtDelegationClaims {
  assertTokenShape(token, "token");
  let nested: JwtActClaim | undefined = undefined;
  for (const actor of token.act) {
    nested =
      nested === undefined ? { sub: actor } : { sub: actor, act: nested };
  }
  if (nested === undefined) {
    throw new OAuthAgentError("token act required");
  }
  return {
    sub: token.sub,
    act: nested,
    scope: token.scope.join(" "),
    aud: token.aud,
    cnf: { jkt: token.cnf },
    exp: token.exp,
    iat: token.iat,
  };
}

/**
 * Unwrap one RFC8693 §4.1 nesting level chain into a root-first actor
 * array. Rejects non-objects (flat string/array `act`), empty `sub`s,
 * repeats (PTF cycle policy), and chains deeper than
 * `MAX_DELEGATION_DEPTH` (PTF depth policy).
 */
function parseNestedAct(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OAuthAgentError("claims act must be a nested object");
  }
  const chain: string[] = [];
  const seen = new Set<string>();
  let node: unknown = value;
  for (;;) {
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      throw new OAuthAgentError("claims act must be a nested object");
    }
    const rec = node as Record<string, unknown>;
    const sub: unknown = rec["sub"];
    assertNonEmptyString(sub, "claims act.sub required");
    if (seen.has(sub)) {
      throw new OAuthAgentError("claims act cycle rejected");
    }
    seen.add(sub);
    chain.unshift(sub);
    if (chain.length > MAX_DELEGATION_DEPTH) {
      throw new OAuthAgentError("claims act delegation depth exceeded");
    }
    if (!("act" in rec) || rec["act"] === undefined) break;
    node = rec["act"];
  }
  return chain;
}

/**
 * Strict inverse of `toJwtClaims`: standard claims back to a PTF-LOCAL
 * descriptor. `scope` must be a single-space-separated non-empty string
 * (arrays rejected); `cnf` must be an object with non-empty `jkt` per
 * RFC9449 (DPoP; bare-string `cnf` rejected); `act` must be the nested
 * object (flat string/array `act` rejected); `aud` must be a single
 * non-empty string; `exp`/`iat` must be integers with `exp > iat`. Unknown
 * extra claims are ignored. Throws `OAuthAgentError` fail-closed.
 */
export function fromJwtClaims(claims: unknown): DelegatedToken {
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) {
    throw new OAuthAgentError("claims must be an object");
  }
  const rec = claims as Record<string, unknown>;
  const sub: unknown = rec["sub"];
  assertNonEmptyString(sub, "claims sub required");
  const act = parseNestedAct(rec["act"]);
  const scopeRaw: unknown = rec["scope"];
  if (typeof scopeRaw !== "string" || scopeRaw.length === 0) {
    throw new OAuthAgentError(
      "claims scope must be a non-empty space-delimited string"
    );
  }
  if (scopeRaw !== scopeRaw.trim() || scopeRaw.includes("  ")) {
    throw new OAuthAgentError("claims scope must use single-space separators");
  }
  const scope = scopeRaw.split(" ");
  for (const s of scope) {
    if (s.length === 0 || /\s/.test(s)) {
      throw new OAuthAgentError(
        "claims scope entries must be non-empty strings"
      );
    }
  }
  const aud: unknown = rec["aud"];
  assertNonEmptyString(aud, "claims aud required");
  const cnf: unknown = rec["cnf"];
  if (typeof cnf !== "object" || cnf === null || Array.isArray(cnf)) {
    throw new OAuthAgentError("claims cnf must be an object");
  }
  const jkt: unknown = (cnf as Record<string, unknown>)["jkt"];
  assertNonEmptyString(jkt, "claims cnf.jkt required");
  const exp: unknown = rec["exp"];
  const iat: unknown = rec["iat"];
  if (!Number.isInteger(exp)) {
    throw new OAuthAgentError("claims exp must be an integer");
  }
  if (!Number.isInteger(iat) || (iat as number) < 0) {
    throw new OAuthAgentError("claims iat must be a finite integer >= 0");
  }
  if ((exp as number) <= (iat as number)) {
    throw new OAuthAgentError("claims exp must be after iat");
  }
  return {
    sub,
    act,
    scope,
    aud,
    cnf: jkt,
    exp: exp as number,
    iat: iat as number,
  };
}

/**
 * RFC9396-style `authorization_details` entry for a payment initiation.
 * The `type: "payment_initiation"` string is PROFILE-DEFINED (experimental
 * agent profile, PTF-local) — not an IANA-registered RFC9396 type. Real
 * deployments must agree the type string with their authorization server.
 * Fail-closed via `OAuthAgentError` (never `TypeError`).
 */
export interface RarPaymentDetails {
  readonly type: "payment_initiation";
  readonly amount: number;
  readonly currency: string;
  readonly payee: string;
  readonly transactionId: string;
}

export function rarPaymentDetails(params: {
  readonly amount: number;
  readonly currency: string;
  readonly payee: string;
  readonly transactionId: string;
}): RarPaymentDetails {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new OAuthAgentError("payment details must be an object");
  }
  const rec = params as Record<string, unknown>;
  const amount: unknown = rec["amount"];
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new OAuthAgentError("payment amount must be a finite number > 0");
  }
  const currency: unknown = rec["currency"];
  const payee: unknown = rec["payee"];
  const transactionId: unknown = rec["transactionId"];
  assertNonEmptyString(currency, "payment currency required");
  assertNonEmptyString(payee, "payment payee required");
  assertNonEmptyString(transactionId, "payment transactionId required");
  return {
    type: "payment_initiation",
    amount,
    currency,
    payee,
    transactionId,
  };
}

/**
 * RFC8707 resource-indicator validation passthrough: absolute `https:` URL
 * with no fragment. Reuses the edge `assertSafeUrl` discipline (so
 * private-range / userinfo URLs are also rejected — a PTF-local strictness
 * beyond bare RFC8707, documented in the module header). Returns the input
 * string unchanged on success. Fail-closed via `OAuthAgentError` (wraps the
 * edge `UrlError` to keep this module's error contract).
 */
export function resourceIndicator(url: string): string {
  if (typeof url !== "string" || url.length === 0) {
    throw new OAuthAgentError("resource must be a non-empty string");
  }
  let parsed: URL;
  try {
    parsed = assertSafeUrl(url, "resource");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new OAuthAgentError(msg);
  }
  if (parsed.hash !== "") {
    throw new OAuthAgentError("resource must not contain a fragment");
  }
  return url;
}
