import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { VerifiedIdentity } from "../core/authority.js";
import { randomHex, verifyBytes } from "../core/crypto.js";
import { atomicWrite } from "./files.js";

/**
 * Authenticated agent ingress for the Personal Authority Node (Phase 5).
 *
 * The fixed stdio identity stays the local reference (the MCP spec itself
 * directs stdio servers to environment credentials, not OAuth). For
 * multiple interchangeable agents, this module binds each agent to a
 * locally registered Ed25519 key plus challenge-response:
 *
 * register key → challenge (single-use, 120s TTL, in-memory) → verify
 * signature → VerifiedIdentity (actor derived from the KEY, never from
 * request fields — there is no request.actor input at all).
 *
 * Revocation is immediate and permanent for the alias (retired aliases stay
 * retired, mirroring the recipient registry). Challenges carry live
 * material and never touch disk: restart loses them (fail-closed callers
 * simply challenge again). Registration and revocation are durable
 * (`agents.json`, revision CAS).
 */

const FILE = "agents.json";
const DEFAULT_TTL_SEC = 120;
const DEFAULT_MAX_PENDING = 100;

export interface AgentRecord {
  readonly agentId: string;
  readonly principal: string;
  readonly publicKeyHex: string;
  readonly revoked: boolean;
  readonly addedAt: number;
  readonly revokedAt?: number;
}

function nonEmpty(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`agents: ${what} must be a non-empty string`);
  }
  return v;
}

function checkKeyHex(hex: unknown): string {
  if (typeof hex !== "string" || !/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("agents: publicKey must be 32 raw Ed25519 bytes");
  }
  return hex;
}

function checkRecord(rec: unknown): asserts rec is AgentRecord {
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) {
    throw new Error("agents: record corrupt (not an object)");
  }
  const r = rec as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!["agentId", "principal", "publicKeyHex", "revoked", "addedAt", "revokedAt"].includes(k)) {
      throw new Error(`agents: record corrupt (unknown field ${k})`);
    }
  }
  nonEmpty(r["agentId"], "agentId");
  nonEmpty(r["principal"], "principal");
  checkKeyHex(r["publicKeyHex"]);
  if (typeof r["revoked"] !== "boolean") {
    throw new Error("agents: record corrupt (bad revoked)");
  }
  for (const n of ["addedAt", "revokedAt"] as const) {
    const v = r[n];
    if (v !== undefined && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) {
      throw new Error(`agents: record corrupt (bad ${n})`);
    }
  }
}

export class AgentDirectory {
  private agents = new Map<string, AgentRecord>();
  private loadedRev = 0;
  private pristine = true;

  private constructor(private readonly nowSec: () => number) {}

  static load(dir: string, nowSec?: () => number): AgentDirectory {
    const d = new AgentDirectory(nowSec ?? (() => Math.floor(Date.now() / 1000)));
    const path = join(dir, FILE);
    if (!existsSync(path)) return d;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`agents: store corrupt: ${path}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`agents: store corrupt: ${path}`);
    }
    const rec = parsed as Record<string, unknown>;
    const rev = rec["revision"];
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) {
      throw new Error(`agents: store corrupt: ${path} (bad revision)`);
    }
    const raw = rec["agents"];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error(`agents: store corrupt: ${path} (bad agents)`);
    }
    for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
      checkRecord(entry);
      if ((entry as AgentRecord).agentId !== id) {
        throw new Error(`agents: store corrupt: ${path} (id mismatch)`);
      }
      d.agents.set(id, { ...(entry as AgentRecord) });
    }
    d.loadedRev = rev;
    d.pristine = false;
    return d;
  }

  save(dir: string): void {
    const path = join(dir, FILE);
    if (!existsSync(path)) {
      if (!this.pristine || this.loadedRev !== 0) {
        throw new Error(
          `agents: store missing: ${path} — refusing to resurrect stale state`
        );
      }
      atomicWrite(path, JSON.stringify({ revision: 0, agents: Object.fromEntries(this.agents) }));
      this.pristine = false;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      throw new Error(`agents: store corrupt: ${path}`);
    }
    const rev = (parsed as { revision?: unknown })["revision"];
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) {
      throw new Error(`agents: store corrupt: ${path} (bad revision)`);
    }
    if (rev !== this.loadedRev) {
      throw new Error(
        `agents: store changed under us (file revision ${rev}, loaded ${this.loadedRev}) — reload and retry, never overwrite`
      );
    }
    atomicWrite(
      path,
      JSON.stringify({ revision: rev + 1, agents: Object.fromEntries(this.agents) })
    );
    this.loadedRev = rev + 1;
    this.pristine = false;
  }

  register(input: {
    readonly agentId: string;
    readonly principal: string;
    readonly publicKey: Uint8Array;
  }): AgentRecord {
    const agentId = nonEmpty(input.agentId, "agentId");
    const principal = nonEmpty(input.principal, "principal");
    if (!(input.publicKey instanceof Uint8Array) || input.publicKey.length !== 32) {
      throw new Error("agents: publicKey must be 32 raw Ed25519 bytes");
    }
    const existing = this.agents.get(agentId);
    if (existing !== undefined) {
      throw new Error(
        existing.revoked
          ? `agents: ${agentId} is retired (revoked) — register a new alias instead`
          : `agents: ${agentId} already registered — revoke first to rotate`
      );
    }
    const rec: AgentRecord = {
      agentId,
      principal,
      publicKeyHex: Buffer.from(input.publicKey).toString("hex"),
      revoked: false,
      addedAt: this.nowSec(),
    };
    this.agents.set(agentId, rec);
    return { ...rec };
  }

  revoke(agentId: string): AgentRecord {
    const rec = this.agents.get(nonEmpty(agentId, "agentId"));
    if (rec === undefined) {
      throw new Error(`agents: unknown agent ${agentId}`);
    }
    if (rec.revoked) return { ...rec };
    const next: AgentRecord = { ...rec, revoked: true, revokedAt: this.nowSec() };
    this.agents.set(agentId, next);
    return { ...next };
  }

  get(agentId: string): AgentRecord | undefined {
    const rec = this.agents.get(agentId);
    return rec === undefined ? undefined : { ...rec };
  }
}

interface PendingChallenge {
  readonly agentId: string;
  readonly challenge: Uint8Array;
  readonly expiresAt: number;
}

export class AgentAuthenticator {
  private pending = new Map<string, PendingChallenge>();
  private readonly ttlSec: number;
  private readonly maxPending: number;

  constructor(
    private readonly directory: AgentDirectory,
    private readonly nowSec: () => number = () => Math.floor(Date.now() / 1000),
    opts: { readonly ttlSec?: number; readonly maxPending?: number } = {}
  ) {
    const ttlSec = opts.ttlSec ?? DEFAULT_TTL_SEC;
    if (!Number.isSafeInteger(ttlSec) || ttlSec <= 0) {
      throw new Error("agents: ttlSec must be a positive integer");
    }
    const maxPending = opts.maxPending ?? DEFAULT_MAX_PENDING;
    if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
      throw new Error("agents: maxPending must be an integer >= 1");
    }
    this.ttlSec = ttlSec;
    this.maxPending = maxPending;
  }

  challenge(agentId: string): {
    readonly challengeId: string;
    readonly challenge: Uint8Array;
    readonly expiresAt: number;
  } {
    const rec = this.directory.get(nonEmpty(agentId, "agentId"));
    if (rec === undefined) {
      throw new Error(`agents: agent not registered: ${agentId}`);
    }
    if (rec.revoked) {
      throw new Error(`agents: agent revoked: ${agentId}`);
    }
    this.gc();
    if (this.pending.size >= this.maxPending) {
      throw new Error(
        `agents: too many pending challenges (${this.pending.size}) — retry after expiry`
      );
    }
    const now = this.nowSec();
    const challengeId = `ch-${randomHex(8)}`;
    const challenge = new Uint8Array(randomBytes(32));
    this.pending.set(challengeId, {
      agentId,
      challenge,
      expiresAt: now + this.ttlSec,
    });
    return { challengeId, challenge: new Uint8Array(challenge), expiresAt: now + this.ttlSec };
  }

  verify(input: {
    readonly agentId: string;
    readonly challengeId: string;
    readonly sig: Uint8Array;
  }): VerifiedIdentity {
    const agentId = nonEmpty(input.agentId, "agentId");
    const challengeId = nonEmpty(input.challengeId, "challengeId");
    const pending = this.pending.get(challengeId);
    if (pending === undefined || pending.agentId !== agentId) {
      throw new Error("agents: unknown or consumed challenge — challenge again");
    }
    // Single-use even on failure: burn before checking anything else so a
    // wrong guess cannot be retried and expiry cannot be probed twice.
    this.pending.delete(challengeId);
    if (this.nowSec() > pending.expiresAt) {
      throw new Error("agents: challenge expired — challenge again");
    }
    // Re-check registration at verify time: revocation between challenge and
    // verify must deny.
    const rec = this.directory.get(agentId);
    if (rec === undefined) {
      throw new Error(`agents: agent not registered: ${agentId}`);
    }
    if (rec.revoked) {
      throw new Error(`agents: agent revoked: ${agentId}`);
    }
    if (!(input.sig instanceof Uint8Array) || input.sig.length !== 64) {
      throw new Error("agents: proof must be a 64-byte Ed25519 signature");
    }
    const pub = new Uint8Array(Buffer.from(rec.publicKeyHex, "hex"));
    if (!verifyBytes(pub, pending.challenge, input.sig)) {
      throw new Error("agents: bad challenge proof — signature mismatch");
    }
    return {
      id: agentId,
      principal: rec.principal,
      source: "local-registration",
      proofRef: `agent-challenge:${challengeId}`,
    };
  }

  private gc(): void {
    const now = this.nowSec();
    for (const [id, p] of this.pending) {
      if (now > p.expiresAt) this.pending.delete(id);
    }
  }
}
