import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { Authority } from "../core/authority.js";
import { Audit, type AuditEntry, type AuditEvent } from "../core/execute.js";
import { canonicalize } from "../core/canonical.js";
import { RecipientRegistry } from "../core/identity.js";

/**
 * Durable JSON stores for a single operator (prod-01) with optimistic
 * concurrency (ticket 02): every authority/registry file carries a
 * `revision` bumped atomically with the data on each write. A save whose
 * instance revision no longer matches the file fails closed ("changed
 * under us — reload and retry") instead of last-write-wins. A pristine
 * (never loaded, never saved) instance may only create a missing file —
 * never overwrite one it never read, and never resurrect a deleted store.
 * Callers follow load → mutate → save on a fresh handle per mutation; the
 * MCP server and CLI already do (each tool call / invocation reloads).
 *
 * Atomic writes via tmp-file rename with a per-write random suffix;
 * fsync best-effort (POSIX durable, Windows rename is not atomic-replace).
 * Corrupt or missing files fail closed. The audit log stays append-only:
 * concurrent appends both land (each `open` verifies the chain, so a fork
 * fails loudly on next open rather than silently) — the money path is
 * guarded by the authority CAS above, which throws before any receipt.
 */
export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeFileSync(fd, content, "utf8");
    try {
      fsyncSync(fd);
    } catch {
      // Windows/odd FS: best effort only.
    }
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/**
 * Read + parse a JSON store file. Missing and corrupt files fail closed with
 * the same vocabulary for every store backend.
 */
export function parseStoreFile(path: string, what: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${what} store missing: ${path}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${what} store corrupt: ${path}`);
  }
}

/**
 * The revision rule every durable store follows (ADR-0015): a file that
 * changed under us is never overwritten, a missing file is only re-created
 * by a pristine instance, and a store that was never loaded is never
 * written blind. One rule and one vocabulary; the store name is the only
 * per-store wording.
 */
export function nextStoreRevision(opts: {
  readonly what: string;
  readonly path: string;
  /** The revision stored in the file; undefined when the file is absent. */
  readonly fileRevision: unknown;
  readonly loadedRevision: number;
  readonly hasKnownLineage: boolean;
}): number {
  const { what, path, fileRevision, loadedRevision, hasKnownLineage } = opts;
  if (fileRevision === undefined) {
    if (loadedRevision !== 0 || hasKnownLineage) {
      throw new Error(
        `${what} store missing: ${path} (instance at revision ${loadedRevision} - the store was deleted under us; refusing to resurrect stale state - re-init deliberately)`
      );
    }
    return 0;
  }
  if (
    typeof fileRevision !== "number" ||
    !Number.isInteger(fileRevision) ||
    fileRevision < 0
  ) {
    throw new Error(`${what} store corrupt: ${path} (bad revision)`);
  }
  if (fileRevision !== loadedRevision) {
    throw new Error(
      `${what} store changed under us (file revision ${fileRevision}, loaded ${loadedRevision}) - reload and retry, never overwrite`
    );
  }
  if (fileRevision === 0 && !hasKnownLineage) {
    throw new Error(
      `${what} store exists at ${path} but this instance never loaded it - refusing a fresh overwrite (load first, or init a new dir)`
    );
  }
  return fileRevision + 1;
}

export function saveAuthority(dir: string, auth: Authority): void {
  atomicWrite(
    join(dir, "authority.json"),
    JSON.stringify(withNextRevision(dir, "authority.json", auth))
  );
}

/**
 * Compare-and-swap a snapshot file: the instance must have loaded the
 * revision currently on disk (fresh instances start at 0 and may only
 * create a missing file). Returns the snapshot stamped with the next
 * revision and adopts it on the instance — one atomic file write commits
 * data + revision together, so a crash can never advance one without
 * the other.
 */
function withNextRevision(
  dir: string,
  file: "authority.json" | "registry.json",
  store: {
    snapshot(): { readonly revision: number };
    loadedRevision(): number;
    hasKnownLineage(): boolean;
    adoptRevision(rev: number): void;
  }
): { readonly revision: number } {
  const path = join(dir, file);
  const what = file === "authority.json" ? "authority" : "registry";
  // Pre-revision files (no field) read as 0 - same default `restore` uses,
  // so old stores upgrade on first write instead of failing.
  const fileRevision = existsSync(path)
    ? ((parseStoreFile(path, what) as Record<string, unknown>)["revision"] ?? 0)
    : undefined;
  const next = nextStoreRevision({
    what,
    path,
    fileRevision,
    loadedRevision: store.loadedRevision(),
    hasKnownLineage: store.hasKnownLineage(),
  });
  const stamped = { ...store.snapshot(), revision: next };
  store.adoptRevision(next);
  return stamped;
}

export function loadAuthority(
  dir: string,
  opts?: ConstructorParameters<typeof Authority>[0]
): Authority {
  const auth = Authority.restore(
    parseStoreFile(join(dir, "authority.json"), "authority"),
    opts
  );
  checkFreshness(dir, "authority", auth.loadedRevision());
  return auth;
}

export function saveRegistry(dir: string, reg: RecipientRegistry): void {
  atomicWrite(
    join(dir, "registry.json"),
    JSON.stringify(withNextRevision(dir, "registry.json", reg))
  );
}

export function loadRegistry(
  dir: string,
  nowSec?: () => number
): RecipientRegistry {
  const reg = RecipientRegistry.restore(
    parseStoreFile(join(dir, "registry.json"), "registry"),
    nowSec
  );
  checkFreshness(dir, "registry", reg.loadedRevision());
  return reg;
}

/**
 * Rollback detection (ticket 03): every audit entry commits to the store
 * revisions it was recorded under, so a file rolled back past recorded
 * history fails closed at load instead of silently resurrecting revokes
 * and spent uses. Lines without revision fields (pre-revision history)
 * impose no constraint; a missing audit file imposes none either. A full
 * directory rollback (all files consistently old) is undetectable here —
 * that needs an external anchor (`store/anchor.ts` checkpoints, ticket 12
 * runbook). Linear scan per load: operator-scale by design; high-throughput
 * PDP hosts pin snapshots (ticket 10).
 */
export function checkFreshness(
  dir: string,
  what: "authority" | "registry" | "vault" | "agents" | "privacy",
  fileRev: number
): void {
  const field =
    what === "authority"
      ? "authorityRev"
      : what === "registry"
        ? "registryRev"
        : what === "vault"
          ? "vaultRev"
          : what === "agents"
            ? "agentRev"
            : null;
  const path = join(dir, "audit.jsonl");
  if (!existsSync(path)) return;
  let maxRef: number | null = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(t) as unknown;
    } catch {
      continue; // corrupt lines detonate at FileAuditLog.open, not here
    }
    if (typeof rec !== "object" || rec === null || Array.isArray(rec)) continue;
    const obj = rec as Record<string, unknown>;
    const legacy: unknown = field === null ? undefined : obj[field];
    const generic =
      typeof obj["stateRevisions"] === "object" &&
      obj["stateRevisions"] !== null &&
      !Array.isArray(obj["stateRevisions"])
        ? (obj["stateRevisions"] as Record<string, unknown>)[what]
        : undefined;
    for (const v of [legacy, generic]) {
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
        maxRef = maxRef === null ? v : Math.max(maxRef, v);
      }
    }
  }
  if (maxRef !== null && fileRev < maxRef) {
    throw new Error(
      `${what} store at revision ${fileRev} predates audit history (references revision ${maxRef}) — suspected partial rollback; restore authority.json, registry.json, personal-state.json, and audit.jsonl from the same backup`
    );
  }
}

/** Append-only audit log file. Entries are canonical JSON, one per line. */
export class FileAuditLog {
  private constructor(
    private readonly audit: Audit,
    private readonly path: string
  ) {}

  static open(
    path: string,
    nowSec: () => number = () => Math.floor(Date.now() / 1000),
    opts: { readonly hmacKey?: Uint8Array } = {}
  ): FileAuditLog {
    const audit = new Audit(nowSec, opts);
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8").split("\n");
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        try {
          audit.ingest(line);
        } catch {
          throw new Error(`audit log corrupt: ${path}`);
        }
      }
      if (!audit.verifyChain()) {
        throw new Error(`audit log corrupt: ${path} (chain broken)`);
      }
    }
    return new FileAuditLog(audit, path);
  }

  append(event: AuditEvent): AuditEntry {
    const entry = this.audit.append(event);
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${canonicalize(entry)}\n`, "utf8");
    return entry;
  }

  verifyChain(): boolean {
    return this.audit.verifyChain();
  }
}
