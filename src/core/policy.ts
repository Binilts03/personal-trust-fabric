import { canonicalize } from "./canonical.js";
import type { Predicate } from "./types.js";

export interface Resolved {
  readonly found: boolean;
  readonly value?: unknown;
}

/**
 * Minimal UCAN-selector subset: `.` identity, `.a.b` maps,
 * `[i]` / `[-i]` indexes, trailing `?` per segment = optional (→ null, found).
 * Anything else returns { found: false } — never throws.
 */
export function resolveSelector(args: unknown, selector: string): Resolved {
  if (selector === ".") return { found: true, value: args };
  if (!selector.startsWith(".")) return { found: false };
  let cur: unknown = args;
  const rest = selector.slice(1);
  const segments = rest.split(".");
  for (const raw of segments) {
    const m = /^([A-Za-z0-9_-]*)((?:\[-?\d+\])*?)([?]?)$/.exec(raw);
    if (m === null) return { found: false };
    const name = m[1] as string;
    const indexes = m[2] as string;
    const optional = m[3] === "?";
    if (name.length > 0) {
      if (typeof cur !== "object" || cur === null || Array.isArray(cur)) {
        return optional ? { found: true, value: null } : { found: false };
      }
      if (
        name === "__proto__" ||
        name === "constructor" ||
        name === "prototype"
      ) {
        return { found: false };
      }
      const rec = cur as Record<string, unknown>;
      if (!Object.hasOwn(rec, name)) {
        return optional ? { found: true, value: null } : { found: false };
      }
      cur = rec[name];
    }
    const idxMatches = indexes.match(/-?\d+/g) ?? [];
    for (const idxStr of idxMatches) {
      const idx = Number.parseInt(idxStr, 10);
      if (!Array.isArray(cur))
        return optional ? { found: true, value: null } : { found: false };
      const at = idx < 0 ? cur.length + idx : idx;
      if (at < 0 || at >= cur.length) {
        return optional ? { found: true, value: null } : { found: false };
      }
      cur = cur[at];
    }
  }
  return { found: true, value: cur };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

function likeMatch(value: unknown, pattern: string): boolean {
  if (typeof value !== "string") return false;
  // Glob with `*` only; `\*` is a literal star.
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "\\" && pattern[i + 1] === "*") {
      re += "\\*";
      i++;
    } else if (c === "*") {
      re += ".*";
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += "$";
  return new RegExp(re).test(value);
}

function asCollection(value: unknown): readonly unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null)
    return Object.values(value as Record<string, unknown>);
  return null;
}

/** Evaluate one predicate against invocation args. Missing selectors → false, never throw. */
export function evalPredicate(pred: Predicate, args: unknown): boolean {
  const op = pred[0];
  try {
    switch (op) {
      case "==":
        return resolveToBool(pred[1], args, (v) => deepEqual(v, pred[2]));
      case "!=":
        return resolveToBool(pred[1], args, (v) => !deepEqual(v, pred[2]));
      case "<":
      case "<=":
      case ">":
      case ">=": {
        const bound = pred[2];
        return resolveToBool(pred[1], args, (v) => {
          if (typeof v !== "number" || typeof bound !== "number") return false;
          if (!Number.isFinite(v) || !Number.isFinite(bound)) return false;
          switch (op) {
            case "<":
              return v < bound;
            case "<=":
              return v <= bound;
            case ">":
              return v > bound;
            case ">=":
              return v >= bound;
          }
        });
      }
      case "like":
        return resolveToBool(pred[1], args, (v) => likeMatch(v, pred[2]));
      case "and": {
        const stmts = pred[1];
        return stmts.every((s) => evalPredicate(s, args));
      }
      case "or": {
        const stmts = pred[1];
        if (stmts.length === 0) return false;
        return stmts.some((s) => evalPredicate(s, args));
      }
      case "not":
        return !evalPredicate(pred[1], args);
      case "all": {
        const r = resolveSelector(args, pred[1]);
        if (!r.found) return false;
        const coll = asCollection(r.value);
        if (coll === null) return false;
        return coll.every((item) => evalPredicate(pred[2], item));
      }
      case "any": {
        const r = resolveSelector(args, pred[1]);
        if (!r.found) return false;
        const coll = asCollection(r.value);
        if (coll === null) return false;
        return coll.some((item) => evalPredicate(pred[2], item));
      }
    }
  } catch {
    return false;
  }
}

function resolveToBool(
  sel: string,
  args: unknown,
  f: (v: unknown) => boolean
): boolean {
  const r = resolveSelector(args, sel);
  if (!r.found) return false;
  return f(r.value);
}

/** Top-level policy is implicit AND: every predicate must hold. */
export function satisfiesPolicy(
  pol: readonly Predicate[],
  args: unknown
): boolean {
  return pol.every((p) => evalPredicate(p, args));
}

/**
 * Conservative narrowing check: child policy must preserve every parent
 * predicate (exact match) except numeric `<=`/`<` bounds on the same
 * selector, which may tighten (smaller value). Parent `< v` + child
 * `<= w` needs `w < v` (strict: `<= v` admits `v` which `< v` forbids);
 * all other `<`/`<=` combos keep `w <= v`. Anything else must be
 * byte-identical. Safe direction: may reject exotic-but-valid narrowings.
 */
export function isPolicyNarrower(
  parent: readonly Predicate[],
  child: readonly Predicate[]
): boolean {
  const childSet = new Set(child.map((p) => canonicalize(p)));
  for (const p of parent) {
    if (childSet.has(canonicalize(p))) continue;
    if ((p[0] === "<=" || p[0] === "<") && typeof p[2] === "number") {
      const tightened = child.some((c) => {
        if (!(c[0] === "<=" || c[0] === "<")) return false;
        if (
          (c as readonly [string, string, unknown])[1] !==
          (p as readonly [string, string, unknown])[1]
        )
          return false;
        if (typeof (c as readonly [string, string, unknown])[2] !== "number")
          return false;
        const w = (
          c as unknown as readonly [string, string, number]
        )[2] as number;
        const v = p[2] as number;
        // Exclusive-parent + inclusive-child admits the boundary on the
        // child side only (src/core/policy.ts: strict `<` vs `<=` check),
        // so equal values widen and must fail.
        if (p[0] === "<" && c[0] === "<=") return w < v;
        return w <= v;
      });
      if (tightened) continue;
    }
    return false;
  }
  return true;
}
