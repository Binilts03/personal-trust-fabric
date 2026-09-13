import { canonicalize, sha256Hex } from "../core/canonical.js";
import { GENESIS, type AuditEntry } from "../core/execute.js";
import { isRecord } from "./guards.js";
// Reuses the Merkle proof verifier from store/anchor.js verbatim.
// Justification: anchor.ts owns no authority state — it is a pure hash-tree
// math helper (leaf/node hashing + path folding). This adapter projects audit
// entries into interop vocabulary and reuses that math for offline anchor
// checks; the hash chain itself stays owned by core/execute.ts. Core stays
// zero-dep (node:crypto only); this adapter carries the interop import risk
// per ADR-0009 (adapters carry all third-party risk, core never imports
// adapters — the reverse edge core->adapter is what is forbidden).
import { verifyInclusion, type InclusionProof } from "../store/anchor.js";

/**
 * Audit interop projection (ADR-0009).
 * The hash chain stays local (`core/execute.ts` + `store/anchor.ts` own it).
 * This module projects an `AuditEntry` into an interop record using standard
 * `jti` vocabulary so third parties can reference entries without learning
 * PTF internals. No new claims: `jti` = entry hash, subject/action linkage
 * preserved, Merkle inclusion reused verbatim.
 * HMAC-keyed entries are opaque to third parties — `verifyInteropChain`
 * refuses them with reason `keyed` and the host must verify with its key.
 *
 * NON-STANDARD / BEHAVIOR NOTES (read before relying on `ok:true`):
 * 1. `GENESIS` is the shared constant imported from `core/execute.ts`
 *    (previously hardcoded here — now single-sourced).
 * 2. Empty log verifies `ok:true` (vacuous truth). Callers expecting a
 *    non-empty log MUST additionally check `records.length` against an
 *    anchored count (cf. `AnchorCheckpoint.count`); an empty chain proves
 *    nothing by itself.
 * 3. Keyed-without-flag misreport: HMAC entries verified WITHOUT
 *    `{keyed:true}` fail with reason `hash` (unkeyed recompute mismatch),
 *    NOT `keyed`. Callers holding keyed logs MUST pass `{keyed:true}` to get
 *    the explicit `keyed` refusal; without the flag a `hash` failure is
 *    ambiguous between tamper and keyed-source. Host verifies keyed logs.
 * 4. Unknown extra fields on `AuditEntry` are DROPPED by the projection
 *    (only the documented fields are copied). Core `ingest` preserves unknown
 *    fields and hashes them, so an entry with unknown fields fails interop
 *    verification fail-closed with `hash`. Hosts MUST NOT add unknown fields
 *    to interop-verified logs (verify via core instead).
 * 5. Structural failures return the new `shape` reason (distinct from `hash`,
 *    which means cryptographic recompute mismatch). `shape` covers: non-array
 *    input, null/non-object records, wrong field types (`shape` never throws;
 *    `auditEntryToInterop` throws fail-closed instead — see below).
 * 6. `verifyInteropAnchor` shape-guards its proof and returns `false` on any
 *    malformed proof or root (never throws). Callers MUST also check the
 *    anchored `count` covers the records they verified (a valid inclusion
 *    proof for entry k of n says nothing about entries k+1..n).
 */

export interface InteropLogRecord {
  /** Standard JWT ID vocabulary: the entry hash. Unique per entry. */
  readonly jti: string;
  readonly seq: number;
  readonly at: number;
  readonly sub: string;
  readonly action: string;
  readonly authorityId?: string;
  readonly capabilityId?: string;
  readonly detail?: string;
  readonly prev: string;
}

export function auditEntryToInterop(e: AuditEntry): InteropLogRecord {
  if (!isRecord(e as unknown)) {
    throw new Error("audit-interop: entry must be an object");
  }
  const rec = e as unknown as Record<string, unknown>;
  if (!Number.isInteger(rec["seq"]) || (rec["seq"] as number) < 0) {
    throw new Error("audit-interop: bad seq");
  }
  if (typeof rec["hash"] !== "string" || (rec["hash"] as string).length < 16) {
    throw new Error("audit-interop: bad chain hashes");
  }
  if (
    typeof rec["prevHash"] !== "string" ||
    (rec["prevHash"] as string).length === 0
  ) {
    throw new Error("audit-interop: bad chain hashes");
  }
  if (typeof rec["at"] !== "number" || !Number.isFinite(rec["at"] as number)) {
    throw new Error("audit-interop: bad at");
  }
  if (
    typeof rec["actor"] !== "string" ||
    (rec["actor"] as string).length === 0
  ) {
    throw new Error("audit-interop: bad actor");
  }
  if (
    typeof rec["action"] !== "string" ||
    (rec["action"] as string).length === 0
  ) {
    throw new Error("audit-interop: bad action");
  }
  for (const f of ["authorityId", "capabilityId", "detail"] as const) {
    if (rec[f] !== undefined && typeof rec[f] !== "string") {
      throw new Error(`audit-interop: bad ${f}`);
    }
  }
  return {
    jti: e.hash,
    seq: e.seq,
    at: e.at,
    sub: e.actor,
    action: e.action,
    ...(e.authorityId !== undefined ? { authorityId: e.authorityId } : {}),
    ...(e.capabilityId !== undefined ? { capabilityId: e.capabilityId } : {}),
    ...(e.detail !== undefined ? { detail: e.detail } : {}),
    prev: e.prevHash,
  };
}

export type InteropVerifyReason =
  "seq" | "prev" | "hash" | "keyed" | "jti" | "shape";

function isShapeValidRecord(r: unknown): r is InteropLogRecord {
  if (!isRecord(r)) return false;
  if (!Number.isInteger(r["seq"])) return false;
  if (typeof r["jti"] !== "string" || r["jti"].length === 0) return false;
  if (typeof r["prev"] !== "string" || r["prev"].length === 0) return false;
  if (typeof r["at"] !== "number" || !Number.isFinite(r["at"])) return false;
  if (typeof r["sub"] !== "string" || r["sub"].length === 0) return false;
  if (typeof r["action"] !== "string" || r["action"].length === 0) return false;
  for (const f of ["authorityId", "capabilityId", "detail"] as const) {
    if (r[f] !== undefined && typeof r[f] !== "string") return false;
  }
  return true;
}

/**
 * Verify projected records as an unkeyed chain. Pass `keyed: true` when the
 * source log uses HMAC — verification is then refused (host-side only).
 * Empty input returns `ok:true` (vacuous truth — see header note 2).
 * Per-record structural failures return `shape` with `atSeq` = log index;
 * `seq`/`prev`/`jti`/`hash` failures return `atSeq` = the record's `seq`.
 */
export function verifyInteropChain(
  records: readonly InteropLogRecord[],
  opts: { readonly keyed?: boolean } = {}
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: InteropVerifyReason;
      readonly atSeq?: number;
    } {
  if (opts.keyed === true) return { ok: false, reason: "keyed" };
  if (!Array.isArray(records)) return { ok: false, reason: "shape" };
  let prev = GENESIS;
  const seen = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    const r = (records as readonly unknown[])[i] as InteropLogRecord;
    if (!isShapeValidRecord(r)) return { ok: false, reason: "shape", atSeq: i };
    if (r.seq !== i) return { ok: false, reason: "seq", atSeq: r.seq };
    if (r.prev !== prev) return { ok: false, reason: "prev", atSeq: r.seq };
    if (seen.has(r.jti)) return { ok: false, reason: "jti", atSeq: r.seq };
    seen.add(r.jti);
    const body: Omit<AuditEntry, "hash"> = {
      seq: r.seq,
      prevHash: r.prev,
      at: r.at,
      actor: r.sub,
      action: r.action,
      ...(r.authorityId !== undefined ? { authorityId: r.authorityId } : {}),
      ...(r.capabilityId !== undefined ? { capabilityId: r.capabilityId } : {}),
      ...(r.detail !== undefined ? { detail: r.detail } : {}),
    };
    let recomputed: string;
    try {
      recomputed = sha256Hex(canonicalize({ ...body, prevHash: r.prev }));
    } catch {
      return { ok: false, reason: "hash", atSeq: r.seq };
    }
    if (recomputed !== r.jti) {
      return { ok: false, reason: "hash", atSeq: r.seq };
    }
    prev = r.jti;
  }
  return { ok: true };
}

/**
 * Offline anchor check reusing the existing Merkle proof verifier.
 * Shape-guards the proof and returns `false` on any malformed input
 * (never throws). Callers must also check anchored `count`.
 */
export function verifyInteropAnchor(
  proof: InclusionProof,
  root: string
): boolean {
  if (typeof root !== "string" || root.length === 0) return false;
  try {
    return verifyInclusion(proof, root);
  } catch {
    return false;
  }
}
