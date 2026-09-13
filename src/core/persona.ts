/**
 * Persona Capsule + Agent-safe view (v04/01, A).
 * Deterministic allow-list redaction over Personal State. No scores, no ML:
 * Minim-style learned sensitivity (arXiv:2606.13949) and AirGapAgent
 * minimization (arXiv:2405.05175) inform the vocabulary (Nissenbaum CI:
 * sender/recipient/subject/type/principle) but v04 enforces it with a pure
 * allow-list so the redaction itself is auditable. Secrets never cross the
 * interface by construction: the output types have no secret-capable fields
 * beyond the allow-listed claims, proven by the sentinel test.
 */

export interface PersonalState {
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface PersonaCapsule {
  readonly purpose: string;
  readonly claims: Readonly<Record<string, unknown>>;
}

export interface AgentView {
  readonly capsule: PersonaCapsule;
  readonly proposals: readonly unknown[];
  readonly receipts: readonly unknown[];
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Task-scoped minimal view of Personal State. Drops everything not allow-listed. */
export function assembleCapsule(
  state: PersonalState,
  purpose: string,
  allowList: readonly string[]
): PersonaCapsule {
  if (purpose.length === 0) throw new Error("persona: purpose required");
  if (!isPlainRecord(state.attributes))
    throw new Error("persona: Personal State must be a plain record");
  const allowed = new Set(allowList);
  if (allowed.size === 0)
    throw new Error("persona: allow-list must be non-empty");
  const claims: Record<string, unknown> = {};
  for (const name of allowed) {
    if (!Object.hasOwn(state.attributes, name)) continue;
    const v = (state.attributes as Record<string, unknown>)[name];
    if (v === undefined) continue;
    if (typeof v === "function" || typeof v === "symbol")
      throw new Error(`persona: non-serializable claim ${name}`);
    claims[name] = v;
  }
  return { purpose, claims };
}

/** What the agent actually receives: capsule + pending proposals + receipts. Never raw state, keys, or credentials. */
export function renderAgentView(
  capsule: PersonaCapsule,
  proposals: readonly unknown[],
  receipts: readonly unknown[]
): AgentView {
  return { capsule, proposals: [...proposals], receipts: [...receipts] };
}
