import type { Authority } from "../core/authority.js";
import type { AuditEntry, AuditEvent } from "../core/execute.js";
import { atomicWrite } from "./files.js";
import { loadAuthority, saveAuthority } from "./files.js";
import {
  createProposal,
  loadProposal,
  transitionProposal,
} from "./challenges.js";
import {
  abortExecution,
  createExecution,
  findByIdempotencyKey,
  listExecutions,
  loadExecution,
  recoverUnsettled,
  transitionExecution,
} from "./execution.js";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Storage-independent repository seams (ADR-0019, ADR-0022, roadmap G4).
 *
 * The authority engine never touches these (CI zero-dep check on
 * `src/core/`); orchestrators program to the interfaces while the file
 * backend stays the default. Execution/proposal/authority shapes are bound
 * with `typeof` existing functions (signature parity); behavioral parity
 * (transition map, budgets, error cases) is proven per backend by suite,
 * not by types — the audit interface is structural, with FileAuditLog as
 * the file implementation.
 */

/** Authority state: whole-snapshot load + CAS-guarded save. */
export interface AuthorityRepository {
  load(
    storeDir: string,
    opts?: ConstructorParameters<typeof Authority>[0]
  ): Authority;
  save(storeDir: string, auth: Authority): void;
}

export const FileAuthority: AuthorityRepository = {
  load: loadAuthority,
  save: saveAuthority,
};

/** Durable proposals: one record per terms digest. */
export interface ProposalRepository {
  create: typeof createProposal;
  load: typeof loadProposal;
  transition: typeof transitionProposal;
}

export const FileProposals: ProposalRepository = {
  create: createProposal,
  load: loadProposal,
  transition: transitionProposal,
};

/** Execution journal: outcome lifecycle per execution id. */
export interface ExecutionRepository {
  create: typeof createExecution;
  load: typeof loadExecution;
  transition: typeof transitionExecution;
  findByIdempotencyKey: typeof findByIdempotencyKey;
  list: typeof listExecutions;
  recoverUnsettled: typeof recoverUnsettled;
  abort: typeof abortExecution;
}

export const FileExecutions: ExecutionRepository = {
  create: createExecution,
  load: loadExecution,
  transition: transitionExecution,
  findByIdempotencyKey,
  list: listExecutions,
  recoverUnsettled,
  abort: abortExecution,
};

/** Append-only audit: hash-chained, opt-HMAC. File stays first. */
export interface AuditRepository {
  append(event: AuditEvent): AuditEntry;
  verifyChain(): boolean;
}

/** Durable replay set for verifier nonces/challenges (reference file impl).
 *
 * Freshness windows stay verifier-enforced; this set only answers
 * "seen before?" durably so restarts do not reset replay protection.
 * Single `nonces.json` file, atomic rewrites, single-writer backstop
 * (same as every file surface). Operators prune with the same TTL the
 * verifier enforces.
 */
export interface ReplayRepository {
  has(storeDir: string, nonce: string): boolean;
  add(storeDir: string, nonce: string, nowSec?: number): void;
  prune(storeDir: string, olderThanSec: number, nowSec?: number): number;
}

function noncesPath(storeDir: string): string {
  return join(storeDir, "nonces.json");
}

function readNonces(storeDir: string): Record<string, number> {
  const path = noncesPath(storeDir);
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8") as string) as unknown;
  } catch {
    throw new Error(`replay store corrupt: ${path}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`replay store corrupt: ${path}`);
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
  }
  return out;
}

function checkNonce(nonce: string): void {
  if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 256) {
    throw new Error("replay: nonce must be a non-empty string ≤ 256 chars");
  }
}

export const FileReplay: ReplayRepository = {
  has(storeDir: string, nonce: string): boolean {
    checkNonce(nonce);
    return Object.hasOwn(readNonces(storeDir), nonce);
  },
  add(
    storeDir: string,
    nonce: string,
    nowSec: number = Math.floor(Date.now() / 1000)
  ): void {
    checkNonce(nonce);
    const path = noncesPath(storeDir);
    mkdirSync(dirname(path), { recursive: true });
    const all = readNonces(storeDir);
    all[nonce] = nowSec;
    atomicWrite(path, JSON.stringify(all));
  },
  prune(
    storeDir: string,
    olderThanSec: number,
    nowSec: number = Math.floor(Date.now() / 1000)
  ): number {
    if (!Number.isInteger(olderThanSec) || olderThanSec < 0) {
      throw new Error("replay: olderThanSec must be a non-negative integer");
    }
    const path = noncesPath(storeDir);
    const all = readNonces(storeDir);
    let pruned = 0;
    for (const [k, v] of Object.entries(all)) {
      if (nowSec - v > olderThanSec) {
        delete all[k];
        pruned += 1;
      }
    }
    if (pruned > 0) {
      mkdirSync(dirname(path), { recursive: true });
      atomicWrite(path, JSON.stringify(all));
    }
    return pruned;
  },
};
