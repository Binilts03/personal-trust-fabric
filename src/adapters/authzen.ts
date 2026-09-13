import type {
  Authority,
  AuthorityDemand,
  Citation,
} from "../core/authority.js";
import { isRecord, reqString } from "./guards.js";

/**
 * AuthZEN translation seam (ADR-0009).
 * PTF `Authority` acts as Policy Decision Point speaking the AuthZEN
 * Authorization API draft-01 Subject-Action-Resource-Context envelope.
 * This module is evidence in / decision out at the edge; the decision itself
 * still comes from `Authority.evaluate` — policy constrains, never creates
 * (ADR-0002). External protocol messages are evidence, never authority
 * (ADR-0005).
 *
 * Envelope: standard draft-01
 * (`docs/research/2026-09-09-deep-delegation-policy.md:32`) —
 * `{ subject: { type, id, properties? }, action: { name, properties? },
 * resource: { type, id, properties? }, context? }`. Note `action` uses
 * `name` (not `type`/`id`).
 *
 * Vocabulary: PTF-specific fields live in `properties`/`context`, never as
 * new envelope keys (standard envelope, PTF vocabulary) —
 * `subject.properties.agent`, `action.name` carries the cmd (e.g. `/pay`)
 * with `action.properties.purpose` plus a `"ptf.cmd"` echo of the cmd,
 * `resource.properties.recipient`, and
 * `context.{ amount, currency, claims, termsDigest }`.
 *
 * Deviations / edge contract (all fail-closed via thrown `Error`, never
 * `TypeError`):
 * - `context` is optional in the request type per draft-01, but
 *   `termsDigest` is REQUIRED at demand recovery. Foreign PEPs omitting it
 *   throw; the caller treats that as deny.
 * - `subject.type` / `resource.type` are envelope metadata only. They are
 *   preserved on projection but IGNORED (untrusted) on recovery — only `id`
 *   and the documented `properties` are read.
 * - Extra `context` keys beyond `amount`/`currency`/`claims`/`termsDigest`
 *   have no `AuthorityDemand` field and are silently DROPPED on recovery.
 * - `claims` entries must be non-empty strings; duplicates are DEDUPED
 *   (order-preserving, first wins) rather than rejected.
 * - Cmd `"/"` is rejected both directions (core forbids wildcard cmds even
 *   though it passes a naive `startsWith("/")` check). `amount` must satisfy
 *   `Number.isFinite` and `> 0` — `Infinity`/`NaN`/zero/negative/strings
 *   throw (core rejects non-finite, see `src/core/authority.ts`).
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

function parseClaims(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`authzen: ${what} must be string[]`);
  }
  for (const c of value) {
    if (typeof c !== "string" || c.length === 0) {
      throw new Error(`authzen: ${what} must be non-empty strings`);
    }
  }
  // Dedupe (order-preserving, first wins); empty-string entries reject above.
  return [...new Set(value as string[])];
}

/** Project a PTF demand into AuthZEN SARC. Lossless for decision fields. */
export function demandToAuthZen(d: AuthorityDemand): AuthZenEvaluationRequest {
  if (!isRecord(d)) throw new Error("authzen: demand must be an object");
  const rec = d as unknown as Record<string, unknown>;
  const principal = rec["principal"];
  if (typeof principal !== "string" || principal.length === 0) {
    throw new Error("authzen: principal required");
  }
  const agent = rec["agent"];
  if (typeof agent !== "string" || agent.length === 0) {
    throw new Error("authzen: agent required");
  }
  const cmd = rec["cmd"];
  if (typeof cmd !== "string" || !cmd.startsWith("/") || cmd === "/") {
    throw new Error('authzen: cmd must be a /-path ("/" forbidden)');
  }
  const purpose = rec["purpose"];
  if (typeof purpose !== "string" || purpose.length === 0) {
    throw new Error("authzen: purpose required");
  }
  const resource = rec["resource"];
  if (typeof resource !== "string" || resource.length === 0) {
    throw new Error("authzen: resource required");
  }
  const recipient = rec["recipient"];
  if (typeof recipient !== "string" || recipient.length === 0) {
    throw new Error("authzen: recipient required");
  }
  const termsDigest = rec["termsDigest"];
  if (typeof termsDigest !== "string" || termsDigest.length === 0) {
    throw new Error("authzen: termsDigest required");
  }
  const amount: unknown = rec["amount"];
  if (
    amount !== undefined &&
    (typeof amount !== "number" || !Number.isFinite(amount) || !(amount > 0))
  ) {
    throw new Error("authzen: amount must be a positive finite number");
  }
  const currency: unknown = rec["currency"];
  if (
    currency !== undefined &&
    (typeof currency !== "string" || currency.length === 0)
  ) {
    throw new Error("authzen: currency must be non-empty");
  }
  const claimsRaw: unknown = rec["claims"];
  let claims: readonly string[] | undefined;
  if (claimsRaw !== undefined) {
    claims = parseClaims(claimsRaw, "claims");
  }
  return {
    subject: {
      type: "user",
      id: principal,
      properties: { agent },
    },
    action: {
      name: cmd,
      properties: { purpose, "ptf.cmd": cmd },
    },
    resource: {
      type: "ptf-resource",
      id: resource,
      properties: { recipient },
    },
    context: {
      ...(amount !== undefined ? { amount: amount as number } : {}),
      ...(currency !== undefined ? { currency: currency as string } : {}),
      ...(claims !== undefined ? { claims: [...claims] } : {}),
      termsDigest,
    },
  };
}

/**
 * Recover a PTF demand from an AuthZEN request produced above. Fail-closed
 * on shape: every malformed input throws `Error` (never `TypeError`).
 * `subject.type` / `resource.type` are untrusted envelope metadata and are
 * not read. Extra `context` keys are dropped.
 */
export function authZenToDemand(r: AuthZenEvaluationRequest): AuthorityDemand {
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
  const agent = reqString(
    (subjPropsRaw as Record<string, unknown>)["agent"],
    "authzen: subject.properties missing agent"
  );
  const cmd = reqString(action["name"], "authzen: action missing name");
  if (!cmd.startsWith("/") || cmd === "/") {
    throw new Error('authzen: action.name must be a /-path ("/" forbidden)');
  }
  const actionPropsRaw: unknown = action["properties"] ?? {};
  if (!isRecord(actionPropsRaw)) {
    throw new Error("authzen: action.properties must be an object");
  }
  const purpose = reqString(
    (actionPropsRaw as Record<string, unknown>)["purpose"],
    "authzen: action.properties missing purpose"
  );
  const resourceId = reqString(resource["id"], "authzen: resource missing id");
  const resPropsRaw: unknown = resource["properties"] ?? {};
  if (!isRecord(resPropsRaw)) {
    throw new Error("authzen: resource.properties must be an object");
  }
  const recipient = reqString(
    (resPropsRaw as Record<string, unknown>)["recipient"],
    "authzen: resource.properties missing recipient"
  );
  const ctxRaw: unknown = raw["context"] ?? {};
  if (!isRecord(ctxRaw)) {
    throw new Error("authzen: context must be an object");
  }
  const termsDigest = reqString(
    (ctxRaw as Record<string, unknown>)["termsDigest"],
    "authzen: context missing termsDigest"
  );
  const out: AuthorityDemand = {
    principal,
    agent,
    cmd: cmd as `/${string}`,
    purpose,
    resource: resourceId,
    recipient,
    termsDigest,
  };
  if (ctxRaw["amount"] !== undefined) {
    const amount: unknown = ctxRaw["amount"];
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      !(amount > 0)
    ) {
      throw new Error(
        "authzen: context.amount must be a positive finite number"
      );
    }
    (out as { amount: number }).amount = amount;
  }
  if (ctxRaw["currency"] !== undefined) {
    const currency: unknown = ctxRaw["currency"];
    if (typeof currency !== "string" || currency.length === 0) {
      throw new Error("authzen: context.currency must be non-empty");
    }
    (out as { currency: string }).currency = currency;
  }
  if (ctxRaw["claims"] !== undefined) {
    const claims = parseClaims(ctxRaw["claims"], "context.claims");
    (out as { claims: readonly string[] }).claims = [...claims];
  }
  return out;
}

/**
 * Evaluate an AuthZEN request against PTF authority (PTF as PDP).
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
 * Minimal Access-Request-profile helper: returns `{ reason }` only when a
 * fresh grant/approval followed by re-evaluation could plausibly allow
 * (remediable: `expired`, `uses-exhausted`, `terms`, `revoked`). Returns
 * null when there is nothing requestable:
 * - `forbidden` (policy) is NOT remediable: a fresh approval still denies
 *   because narrowing policies are checked after covering authority
 *   (`src/core/authority.ts:560-569`), so requesting would mislead.
 * - `no-authority` is NOT requestable: no covering grant/approval scopes
 *   what to ask for, and policies alone never allow — the caller must seek
 *   an out-of-band grant first.
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
