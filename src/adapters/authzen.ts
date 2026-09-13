import type {
  Authority,
  AuthorityRequest,
  Citation,
} from "../core/authority.js";
import { digestForOperation } from "../core/authority.js";
import { isRecord, reqString } from "./guards.js";

/**
 * AuthZEN INFORMATION-MODEL adapter (ADR-0009, ADR-0010) — choice B.
 * This module is NOT a PDP endpoint: it speaks the AuthZEN Authorization
 * API 1.0 Final (Jan 2026) information model — Subject-Action-Resource-
 * Context (SARC) request plus `{ decision, context }` response — so PTF
 * demands can be projected to / recovered from that shape. File + function
 * names are unchanged to avoid churn; only this header/docs were renamed
 * honestly. The decision itself still comes from `Authority.evaluate` —
 * policy constrains, never creates (ADR-0002). External protocol messages
 * are evidence, never authority (ADR-0005).
 *
 * Field vocabulary (Final 1.0 as far as known):
 * `{ subject: { type, id, properties? }, action: { name, properties? },
 * resource: { type, id, properties? }, context? }` → decision
 * `{ decision: boolean, context }`. Note `action` uses `name` (not
 * `type`/`id`); `subject`/`resource` share `type`/`id`/`properties`.
 *
 * PTF vocabulary placement (PTF fields in `properties`/`context`, never
 * new envelope keys):
 * - `subject.id` = principal; `subject.properties.actor` (+ optional
 *   `subject.properties.actorChain: string[]`) carry verified actor binding.
 * - `action.name` carries the /-path; `action.properties` carries the demand
 *   action properties plus `purpose` when present.
 * - `resource` (`type`, `id`, `properties`) passes through. Unlike the
 *   pre-0010 translator, `resource.type` IS read: the neutral model matches
 *   on it. It is still evidence — a demand field can only narrow against
 *   grants, never grant by itself.
 * - `context` carries the demand context verbatim plus a `termsDigest` echo
 *   of the derived binding for PDP logs. `termsDigest` is a RESERVED context
 *   key: demand data must not use it (recovery strips it before rebuilding
 *   the context).
 *
 * Transport mapping (host-owned, NOT implemented here): to call a real v1
 * PDP, the host POSTs this module's `AuthZenEvaluationRequest` as JSON
 * (`Content-Type: application/json`) to the PDP's evaluation endpoint and
 * reads `{ decision: boolean, context }` (HTTP 200 carries even denies;
 * 401/403/500 are transport errors only — draft-01 behavior, unchanged as
 * far as known in Final 1.0; PEP authentication via mTLS / OAuth2-bearer /
 * API-key remains out of scope per the same transport assumptions).
 * Boxcarred (batched) evaluations and search APIs are explicitly OUT OF
 * SCOPE: this adapter handles single evaluations only.
 *
 * Live drafts (NOT Final, explicitly out of scope except as noted):
 * COAZ Framework 1.0, COAZ-MCP Binding 1.0, Access-Request-and-Approval
 * Profile 1.0, Obligations Profile 1.0. The `coazMcpToAuthZen` helper below
 * follows the COAZ-MCP profile DIRECTION (MCP JSON-RPC → SARC via
 * declarative mapping) as a PTF-local mapping choice; it is not a
 * conformance claim against the draft.
 *
 * Digest derivation (ADR-0010): recovery builds the operation WITHOUT any
 * digest, computes it via digestForOperation, and IGNORES any
 * caller-supplied `context.termsDigest`. Untrusted PEPs must not supply
 * binding — the decision follows the true terms even when the envelope
 * carries a tampered digest. AP2 EXCEPTION: verified mandates
 * (`adapters/ap2.ts` toAp2PaymentDemand) may bind an external transaction id
 * as the digest, because there the id is verified evidence (checkout_hash
 * linkage recomputed during verification), not caller assertion. That path
 * bypasses this translator until ap2.ts migrates to the neutral model.
 *
 * Deviations / edge contract (all fail-closed via thrown `Error`, never
 * `TypeError`; every remaining non-standard item is PTF-local with reason):
 * - PTF-local: `subject.type` is envelope metadata only — preserved on
 *   projection, IGNORED (untrusted) on recovery. Reason: PEP-supplied type
 *   strings are not authority; the decision keys on id/actor binding only.
 * - PTF-local: `action.name` must be a /-path; bare `"/"` is forbidden.
 *   Reason: core forbids wildcard actions; the /-path rule keeps AuthZEN
 *   actions mappable to PTF's attenuation lattice.
 * - PTF-local: `actorChain`, when present, must be a non-empty string array.
 *   Reason: preserves delegation trace for rooted-grant matching; empty or
 *   non-string chains would be ambiguous evidence.
 * - PTF-local: `purpose`, when present, must be non-empty. Reason: purpose
 *   participates in grant narrowing; empty purpose would silently widen.
 * - PTF-local: `context.termsDigest` echo (projection) + strip-and-recompute
 *   (recovery). Reason: carries the derived binding for PDP logs without
 *   trusting PEP-supplied binding.
 * - PTF-local: `coazMcpToAuthZen` defaults (`subject.type "user"`,
 *   `resource.type "mcp-tool"`, `action.name "/mcp/<method>"`, self-actor).
 *   Reason: declarative mapping choice following the COAZ-MCP direction;
 *   MCP has no separate principal/actor distinction.
 * - Out of scope (not implemented): boxcarred evaluations, search APIs,
 *   Access-Request-and-Approval and Obligations profile flows
 *   (`requestableContext` is a minimal remediability hint only, not a
 *   profile implementation).
 */

export interface AuthZenSubject {
  readonly type: string;
  readonly id: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface AuthZenAction {
  readonly name: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface AuthZenResource {
  readonly type: string;
  readonly id: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface AuthZenEvaluationRequest {
  readonly subject: AuthZenSubject;
  readonly action: AuthZenAction;
  readonly resource: AuthZenResource;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface AuthZenDecision {
  readonly decision: boolean;
  readonly context: Readonly<Record<string, unknown>>;
}

function parseActorChain(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !(value as unknown[]).every((x) => typeof x === "string" && x.length > 0)
  ) {
    throw new Error("authzen: actorChain must be a non-empty string array");
  }
  return [...(value as string[])];
}

/** Project a PTF demand into AuthZEN SARC. Lossless for decision fields. */
export function demandToAuthZen(d: AuthorityRequest): AuthZenEvaluationRequest {
  if (!isRecord(d)) throw new Error("authzen: demand must be an object");
  const rec = d as unknown as Record<string, unknown>;
  const principal = rec["principal"];
  if (typeof principal !== "string" || principal.length === 0) {
    throw new Error("authzen: principal required");
  }
  const actor = rec["actor"];
  if (typeof actor !== "string" || actor.length === 0) {
    throw new Error("authzen: actor required");
  }
  const actionRaw: unknown = rec["action"];
  if (!isRecord(actionRaw)) {
    throw new Error("authzen: action must be an object");
  }
  const actionName: unknown = actionRaw["name"];
  if (
    typeof actionName !== "string" ||
    !actionName.startsWith("/") ||
    actionName === "/"
  ) {
    throw new Error('authzen: action.name must be a /-path ("/" forbidden)');
  }
  const actionPropsRaw: unknown = actionRaw["properties"] ?? {};
  if (!isRecord(actionPropsRaw)) {
    throw new Error("authzen: action.properties must be an object");
  }
  const resourceRaw: unknown = rec["resource"];
  if (!isRecord(resourceRaw)) {
    throw new Error("authzen: resource must be an object");
  }
  const resourceType = reqString(
    resourceRaw["type"],
    "authzen: resource.type required"
  );
  const resourceId = reqString(
    resourceRaw["id"],
    "authzen: resource.id required"
  );
  const resourcePropsRaw: unknown = resourceRaw["properties"] ?? {};
  if (!isRecord(resourcePropsRaw)) {
    throw new Error("authzen: resource.properties must be an object");
  }
  const contextRaw: unknown = rec["context"] ?? {};
  if (!isRecord(contextRaw)) {
    throw new Error("authzen: context must be an object");
  }
  const purposeRaw: unknown = rec["purpose"];
  if (
    purposeRaw !== undefined &&
    (typeof purposeRaw !== "string" || purposeRaw.length === 0)
  ) {
    throw new Error("authzen: purpose must be non-empty");
  }
  const termsDigest = reqString(
    rec["termsDigest"],
    "authzen: termsDigest required"
  );
  let actorChain: readonly string[] | undefined;
  if (rec["actorChain"] !== undefined) {
    actorChain = parseActorChain(rec["actorChain"]);
  }
  const actionProps =
    Object.keys(actionPropsRaw).length > 0 ? { ...actionPropsRaw } : undefined;
  const resourceProps =
    Object.keys(resourcePropsRaw).length > 0
      ? { ...resourcePropsRaw }
      : undefined;
  return {
    subject: {
      type: "user",
      id: principal,
      properties: {
        actor,
        ...(actorChain !== undefined ? { actorChain: [...actorChain] } : {}),
      },
    },
    action: {
      name: actionName,
      properties: {
        ...(actionProps !== undefined ? actionProps : {}),
        ...(purposeRaw !== undefined ? { purpose: purposeRaw as string } : {}),
      },
    },
    resource: {
      type: resourceType,
      id: resourceId,
      ...(resourceProps !== undefined ? { properties: resourceProps } : {}),
    },
    context: {
      ...contextRaw,
      termsDigest,
    },
  };
}

/**
 * Recover a PTF demand from an AuthZEN request. Fail-closed on shape: every
 * malformed input throws `Error` (never `TypeError`). `subject.type` is
 * untrusted envelope metadata and is not read. Any caller-supplied
 * `context.termsDigest` is IGNORED: the binding is recomputed from the
 * normalized operation via digestForOperation (see module header; AP2
 * exception documented there).
 */
export function authZenToDemand(r: AuthZenEvaluationRequest): AuthorityRequest {
  if (!isRecord(r)) throw new Error("authzen: request must be an object");
  const raw = r as unknown as Record<string, unknown>;
  if (!isRecord(raw["subject"])) {
    throw new Error("authzen: subject must be an object");
  }
  if (!isRecord(raw["action"])) {
    throw new Error("authzen: action must be an object");
  }
  if (!isRecord(raw["resource"])) {
    throw new Error("authzen: resource must be an object");
  }
  const subject = raw["subject"] as Record<string, unknown>;
  const action = raw["action"] as Record<string, unknown>;
  const resource = raw["resource"] as Record<string, unknown>;
  const principal = reqString(subject["id"], "authzen: subject missing id");
  const subjPropsRaw: unknown = subject["properties"] ?? {};
  if (!isRecord(subjPropsRaw)) {
    throw new Error("authzen: subject.properties must be an object");
  }
  const actor = reqString(
    (subjPropsRaw as Record<string, unknown>)["actor"],
    "authzen: subject.properties missing actor"
  );
  let actorChain: readonly string[] | undefined;
  const chainRaw: unknown = (subjPropsRaw as Record<string, unknown>)[
    "actorChain"
  ];
  if (chainRaw !== undefined) {
    actorChain = parseActorChain(chainRaw);
  }
  const actionName = reqString(action["name"], "authzen: action missing name");
  if (!actionName.startsWith("/") || actionName === "/") {
    throw new Error('authzen: action.name must be a /-path ("/" forbidden)');
  }
  const actionPropsRaw: unknown = action["properties"] ?? {};
  if (!isRecord(actionPropsRaw)) {
    throw new Error("authzen: action.properties must be an object");
  }
  const { purpose: purposeRaw, ...restActionProps } = actionPropsRaw as Record<
    string,
    unknown
  >;
  if (
    purposeRaw !== undefined &&
    (typeof purposeRaw !== "string" || purposeRaw.length === 0)
  ) {
    throw new Error("authzen: action.properties.purpose must be non-empty");
  }
  const resourceType = reqString(
    resource["type"],
    "authzen: resource missing type"
  );
  const resourceId = reqString(resource["id"], "authzen: resource missing id");
  const resPropsRaw: unknown = resource["properties"] ?? {};
  if (!isRecord(resPropsRaw)) {
    throw new Error("authzen: resource.properties must be an object");
  }
  const ctxRaw: unknown = raw["context"] ?? {};
  if (!isRecord(ctxRaw)) {
    throw new Error("authzen: context must be an object");
  }
  // Reserved binding echo — stripped, never trusted (see module header).
  const { termsDigest: _ignored, ...restCtx } = ctxRaw as Record<
    string,
    unknown
  >;
  void _ignored;
  const actionPropsOut =
    Object.keys(restActionProps).length > 0
      ? { ...restActionProps }
      : undefined;
  const resourcePropsOut =
    Object.keys(resPropsRaw as Record<string, unknown>).length > 0
      ? { ...(resPropsRaw as Record<string, unknown>) }
      : undefined;
  const op = {
    principal,
    actor,
    ...(actorChain !== undefined ? { actorChain: [...actorChain] } : {}),
    action: {
      name: actionName as `/${string}`,
      ...(actionPropsOut !== undefined ? { properties: actionPropsOut } : {}),
    },
    resource: {
      type: resourceType,
      id: resourceId,
      ...(resourcePropsOut !== undefined
        ? { properties: resourcePropsOut }
        : {}),
    },
    context: { ...restCtx },
    ...(purposeRaw !== undefined ? { purpose: purposeRaw as string } : {}),
  };
  return { ...op, termsDigest: digestForOperation(op) };
}

/**
 * Evaluate an AuthZEN-shaped request against PTF authority (local decision
 * over the information model — NOT a network PDP endpoint; see transport
 * mapping in the module header for real v1 PDP calls).
 * Allow carries citations; deny carries reason. Never throws on deny —
 * only on malformed requests (fail-closed at the caller).
 */
export function evaluateAuthZen(
  auth: Authority,
  req: AuthZenEvaluationRequest,
  opts: { readonly consume?: boolean; readonly nowSec?: number } = {}
): AuthZenDecision {
  const demand = authZenToDemand(req);
  const verdict = auth.evaluate(demand, opts);
  if (verdict.allow) {
    const citations: readonly Citation[] = verdict.citations;
    return {
      decision: true,
      context: {
        citations: citations.map((c) => ({
          authorityId: c.authorityId,
          kind: c.kind,
          policyIds: [...c.policyIds],
        })),
        termsDigest: demand.termsDigest,
      },
    };
  }
  return {
    decision: false,
    context: {
      reason: verdict.reason,
      ...(verdict.authorityId !== undefined
        ? { authorityId: verdict.authorityId }
        : {}),
      ...(verdict.policyId !== undefined ? { policyId: verdict.policyId } : {}),
      ...(verdict.detail !== undefined ? { detail: verdict.detail } : {}),
    },
  };
}

/**
 * Minimal remediability hint (NOT an Access-Request-and-Approval Profile
 * implementation — that live draft is out of scope): returns `{ reason }`
 * only when a fresh grant/approval followed by re-evaluation could plausibly
 * allow (remediable: `expired`, `uses-exhausted`, `terms`, `revoked`). Returns
 * null when there is nothing requestable:
 * - `forbidden` (policy) is NOT remediable: a fresh approval still denies
 *   because narrowing policies are checked after covering authority, so
 *   requesting would mislead.
 * - `no-authority` is NOT requestable: no covering grant/approval scopes
 *   what to ask for, and policies alone never allow — the caller must seek
 *   an out-of-band grant first. (Actor-scoped near-misses still report
 *   `no-authority` with an actor-mismatch detail; the remedy is a wider
 *   grant, which this profile cannot scope — hence still null.)
 */
export function requestableContext(
  decision: AuthZenDecision
): { readonly reason: string } | null {
  if (!isRecord(decision)) return null;
  if (decision["decision"] === true) return null;
  const ctxRaw: unknown = decision["context"];
  if (!isRecord(ctxRaw)) return null;
  const reason: unknown = ctxRaw["reason"];
  if (typeof reason !== "string") return null;
  switch (reason) {
    case "expired":
    case "uses-exhausted":
    case "terms":
    case "revoked":
      return { reason };
    case "forbidden":
    case "no-authority":
    default:
      return null;
  }
}

/** Params for the COAZ-MCP direction helper (all strings non-empty). */
export interface CoazMcpParams {
  /** Principal id; becomes `subject.id` (type defaults to `"user"`). */
  readonly subject: string;
  /** MCP tool name; becomes `resource.id` (`resource.type "mcp-tool"`). */
  readonly toolName: string;
  /** MCP JSON-RPC method (e.g. `"tools/call"`); maps to `/mcp/<method>`. */
  readonly method: string;
  /** MCP tool arguments; become `context` (must not use `termsDigest`). */
  readonly args: Readonly<Record<string, unknown>>;
  /**
   * Optional token subject binding: when present it MUST equal `subject`
   * (fail-closed) and is echoed as `subject.properties.tokenSub` for PDP
   * logs. Recovery via `authZenToDemand` drops it (like `subject.type`).
   */
  readonly tokenSub?: string;
}

/**
 * Map an MCP `tools/call` (method, tool name, arguments, audience binding)
 * into our AuthZEN request shape. Follows the COAZ-MCP profile DIRECTION
 * (MCP JSON-RPC → SARC via declarative mapping) as a PTF-local choice —
 * NOT a conformance claim against the live COAZ-MCP Binding 1.0 draft.
 *
 * Declarative mapping (PTF-local defaults, see module header):
 * - `subject` → `{ type: "user", id: subject, properties: { actor: subject }}`
 *   (self-actor: MCP has no separate principal/actor; hosts with a distinct
 *   agent identity should project via `demandToAuthZen` instead).
 * - `method` → `action.name "/mcp/<method>"` (leading `/` normalized; bare
 *   `"/"` and whitespace rejected to preserve the /-path invariant).
 * - `toolName` → `resource { type: "mcp-tool", id: toolName }`.
 * - `args` → `context` (shallow copy; `termsDigest` key rejected as RESERVED).
 * - `tokenSub` → equality-checked against `subject`, echoed for logs.
 *
 * Single evaluations only: boxcarred (batched) evaluations and search APIs
 * are explicitly out of scope and are NOT produced here. Fail-closed via
 * thrown `Error` (never `TypeError`).
 */
export function coazMcpToAuthZen(
  params: CoazMcpParams
): AuthZenEvaluationRequest {
  if (!isRecord(params))
    throw new Error("authzen: coaz params must be an object");
  const rec = params as unknown as Record<string, unknown>;
  const subject = reqString(rec["subject"], "authzen: coaz subject required");
  const toolName = reqString(
    rec["toolName"],
    "authzen: coaz toolName required"
  );
  const method = reqString(rec["method"], "authzen: coaz method required");
  if (method === "/") {
    throw new Error(
      'authzen: coaz method must map to a /-path ("/" forbidden)'
    );
  }
  if (/\s/.test(method)) {
    throw new Error("authzen: coaz method must not contain whitespace");
  }
  const argsRaw: unknown = rec["args"];
  if (!isRecord(argsRaw)) {
    throw new Error("authzen: coaz args must be an object");
  }
  if ("termsDigest" in (argsRaw as Record<string, unknown>)) {
    throw new Error("authzen: coaz args must not use reserved termsDigest");
  }
  const tokenSubRaw: unknown = rec["tokenSub"];
  if (tokenSubRaw !== undefined) {
    const tokenSub = reqString(
      tokenSubRaw,
      "authzen: coaz tokenSub must be non-empty"
    );
    if (tokenSub !== subject) {
      throw new Error("authzen: coaz tokenSub must equal subject");
    }
  }
  const withSlash = method.startsWith("/") ? method : `/${method}`;
  const actionName = `/mcp${withSlash}`;
  if (actionName === "/" || !actionName.startsWith("/")) {
    throw new Error(
      'authzen: coaz method must map to a /-path ("/" forbidden)'
    );
  }
  return {
    subject: {
      type: "user",
      id: subject,
      properties: {
        actor: subject,
        ...(tokenSubRaw !== undefined
          ? { tokenSub: tokenSubRaw as string }
          : {}),
      },
    },
    action: { name: actionName },
    resource: { type: "mcp-tool", id: toolName },
    context: { ...(argsRaw as Record<string, unknown>) },
  };
}
