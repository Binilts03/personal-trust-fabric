import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWrite } from "./files.js";

/**
 * Operator-managed agent registry (ADR-0023, roadmap G5).
 *
 * Maps agent ids to Ed25519 public keys (optional — keyless entries cover
 * plain LLM clients that cannot sign) plus lifecycle status. The MCP
 * server binds evaluations to registry members only: launcher-asserted
 * env identity must be registered + active, and `ptf_authenticate`
 * sessions prove key possession. Removal retires permanently and takes
 * effect on the next tool call (registry reloaded per call); rotation
 * swaps the key (hard cutover — sessions re-authenticate).
 *
 * Durability mirrors authority/registry.json: whole-snapshot file
 * (`agents.json`) with revision CAS (stale saves fail closed, fresh
 * instances may only create). Ids are global + immutable like authority
 * ids: re-registering (even after removal) throws — a new id means a new
 * agent, keeping citations and audit unambiguous.
 */

export interface AgentRecord {
  readonly id: string;
  /** 64-char hex Ed25519 public key; absent = keyless (env-asserted only). */
  readonly publicKeyHex?: string;
  readonly status: "active" | "removed";
  readonly registeredAt: number;
  readonly removedAt?: number;
}

export interface AgentSnapshot {
  readonly agents: AgentRecord[];
  readonly revision: number;
}

function checkId(id: string): void {
  if (typeof id !== "string" || id.length === 0 || id.length > 256) {
    throw new Error("agents: id must be a non-empty string ≤ 256 chars");
  }
}

function checkKeyHex(keyHex: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("agents: key must be 32-byte hex");
  }
}

export class AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>();
  private snapshotRevision = 0;
  private knownLineage = false;
  private readonly nowSec: () => number;

  constructor(nowSec: () => number = () => Math.floor(Date.now() / 1000)) {
    this.nowSec = nowSec;
  }

  register(id: string, publicKeyHex?: string, at?: number): void {
    checkId(id);
    if (publicKeyHex !== undefined) checkKeyHex(publicKeyHex);
    if (this.agents.has(id)) {
      throw new Error(`agents: ${id} already registered (ids are immutable)`);
    }
    this.agents.set(id, {
      id,
      ...(publicKeyHex !== undefined
        ? { publicKeyHex: publicKeyHex.toLowerCase() }
        : {}),
      status: "active",
      registeredAt: at ?? this.nowSec(),
    });
  }

  rotate(id: string, publicKeyHex: string): void {
    checkId(id);
    checkKeyHex(publicKeyHex);
    const current = this.agents.get(id);
    if (current === undefined) throw new Error(`agents: unknown agent ${id}`);
    if (current.status !== "active") {
      throw new Error(
        `agents: ${id} is removed and stays retired (use a new id)`
      );
    }
    if (current.publicKeyHex === publicKeyHex.toLowerCase()) {
      throw new Error(`agents: ${id} already bound to this key`);
    }
    this.agents.set(id, {
      ...current,
      publicKeyHex: publicKeyHex.toLowerCase(),
    });
  }

  remove(id: string, at?: number): void {
    checkId(id);
    const current = this.agents.get(id);
    if (current === undefined) throw new Error(`agents: unknown agent ${id}`);
    if (current.status !== "active") return;
    this.agents.set(id, {
      ...current,
      status: "removed",
      removedAt: at ?? this.nowSec(),
    });
  }

  /** Active membership check. Never throws. */
  isActive(id: string): boolean {
    return this.agents.get(id)?.status === "active";
  }

  /** Registered public key as raw bytes, or null (unknown/removed/keyless). Never throws. */
  publicKeyRaw(id: string): Uint8Array | null {
    const rec = this.agents.get(id);
    if (
      rec === undefined ||
      rec.status !== "active" ||
      rec.publicKeyHex === undefined
    ) {
      return null;
    }
    return new Uint8Array(Buffer.from(rec.publicKeyHex, "hex"));
  }

  get(id: string): AgentRecord | null {
    const rec = this.agents.get(id);
    return rec === undefined ? null : { ...rec };
  }

  ids(): string[] {
    return [...this.agents.keys()];
  }

  loadedRevision(): number {
    return this.snapshotRevision;
  }

  hasKnownLineage(): boolean {
    return this.knownLineage;
  }

  adoptRevision(rev: number): void {
    this.snapshotRevision = rev;
    this.knownLineage = true;
  }

  snapshot(): AgentSnapshot {
    return {
      agents: [...this.agents.values()].map((a) => ({ ...a })),
      revision: this.snapshotRevision,
    };
  }

  static restore(data: unknown): AgentRegistry {
    const reg = new AgentRegistry();
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("agents: snapshot corrupt");
    }
    const rec = data as {
      agents?: unknown;
      revision?: unknown;
    };
    if (!Array.isArray(rec.agents)) throw new Error("agents: snapshot corrupt");
    for (const entry of rec.agents as unknown[]) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error("agents: snapshot corrupt");
      }
      const e = entry as Record<string, unknown>;
      if (
        typeof e["id"] !== "string" ||
        (e["publicKeyHex"] !== undefined &&
          typeof e["publicKeyHex"] !== "string") ||
        (e["status"] !== "active" && e["status"] !== "removed") ||
        typeof e["registeredAt"] !== "number"
      ) {
        throw new Error("agents: snapshot corrupt");
      }
      if (typeof e["publicKeyHex"] === "string") checkKeyHex(e["publicKeyHex"]);
      checkId(e["id"] as string);
      reg.agents.set(e["id"] as string, {
        id: e["id"] as string,
        ...(typeof e["publicKeyHex"] === "string"
          ? { publicKeyHex: (e["publicKeyHex"] as string).toLowerCase() }
          : {}),
        status: e["status"] as "active" | "removed",
        registeredAt: e["registeredAt"] as number,
        ...(typeof e["removedAt"] === "number"
          ? { removedAt: e["removedAt"] as number }
          : {}),
      });
    }
    if (
      typeof rec.revision === "number" &&
      Number.isInteger(rec.revision) &&
      rec.revision >= 0
    ) {
      reg.snapshotRevision = rec.revision;
    }
    reg.knownLineage = true;
    return reg;
  }
}

function agentsPath(dir: string): string {
  return join(dir, "agents.json");
}

function parseAgentsFile(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`agents store missing: ${path}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`agents store corrupt: ${path}`);
  }
}

/** CAS-guarded save mirroring authority/registry files. */
export function saveAgents(dir: string, reg: AgentRegistry): void {
  const path = agentsPath(dir);
  const snap = reg.snapshot();
  if (!existsSync(path)) {
    if (reg.loadedRevision() !== 0) {
      throw new Error(
        `agents store missing: ${path} (instance at revision ${reg.loadedRevision()} — refusing to resurrect stale state)`
      );
    }
    mkdirSync(dirname(path), { recursive: true });
    atomicWrite(path, JSON.stringify({ agents: snap.agents, revision: 0 }));
    reg.adoptRevision(0);
    return;
  }
  // Revision discipline matches files.ts: stale handles fail closed.
  let currentRev = 0;
  const parsed = parseAgentsFile(path) as { revision?: unknown };
  if (parsed.revision !== undefined) {
    if (
      typeof parsed.revision !== "number" ||
      !Number.isInteger(parsed.revision) ||
      parsed.revision < 0
    ) {
      throw new Error(`agents store corrupt: ${path} (bad revision)`);
    }
    currentRev = parsed.revision;
  }
  if (currentRev !== reg.loadedRevision()) {
    throw new Error(
      `agents store changed under us (file revision ${currentRev}, loaded ${reg.loadedRevision()}) — reload and retry, never overwrite`
    );
  }
  if (currentRev === 0 && !reg.hasKnownLineage()) {
    throw new Error(
      `agents store exists at ${path} but this instance never loaded it — refusing a fresh overwrite (load first)`
    );
  }
  atomicWrite(
    path,
    JSON.stringify({ agents: snap.agents, revision: currentRev + 1 })
  );
  reg.adoptRevision(currentRev + 1);
}

/** Load + adopt revision. Missing file reads as an empty registry. */
export function loadAgents(dir: string): AgentRegistry {
  const path = agentsPath(dir);
  if (!existsSync(path)) return new AgentRegistry();
  const reg = AgentRegistry.restore(parseAgentsFile(path));
  return reg;
}
