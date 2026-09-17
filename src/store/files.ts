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

function parseFile(path: string, what: string): unknown {
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
  if (!existsSync(path)) {
    // Only a pristine instance (never loaded, never saved) may create a
    // missing file. Anything else means the store was deleted under us —
    // resurrecting stale state over the deletion would fork the lineage.
    if (store.loadedRevision() !== 0 || store.hasKnownLineage()) {
      throw new Error(
        `${what} store missing: ${path} (instance at revision ${store.loadedRevision()} — the store was deleted under us; refusing to resurrect stale state — re-init deliberately)`
      );
    }
    const stamped = { ...store.snapshot(), revision: 0 };
    store.adoptRevision(0);
    return stamped;
  }
  const parsed = parseFile(path, what) as Record<string, unknown>;
  const current: unknown = parsed["revision"];
  // Pre-revision files (no field) read as 0 — same default `restore` uses,
  // so old stores upgrade on first write instead of failing.
  const currentRev =
    current === undefined
      ? 0
      : typeof current === "number" && Number.isInteger(current) && current >= 0
        ? current
        : (() => {
            throw new Error(`${what} store corrupt: ${path} (bad revision)`);
          })();
  if (currentRev !== store.loadedRevision()) {
    throw new Error(
      `${what} store changed under us (file revision ${currentRev}, loaded ${store.loadedRevision()}) — reload and retry, never overwrite`
    );
  }
  if (currentRev === 0 && !store.hasKnownLineage()) {
    throw new Error(
      `${what} store exists at ${path} but this instance never loaded it — refusing a fresh overwrite (load first, or init a new dir)`
    );
  }
  const stamped = { ...store.snapshot(), revision: currentRev + 1 };
  store.adoptRevision(currentRev + 1);
  return stamped;
}

export function loadAuthority(
  dir: string,
  opts?: ConstructorParameters<typeof Authority>[0]
): Authority {
  const auth = Authority.restore(
    parseFile(join(dir, "authority.json"), "authority"),
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
    parseFile(join(dir, "registry.json"), "registry"),
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
function checkFreshness(
  dir: string,
  what: "authority" | "registry" | "vault",
  fileRev: number
): void {
  const field =
    what === "authority"
      ? "authorityRev"
      : what === "registry"
        ? "registryRev"
        : "vaultRev";
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
    const v: unknown = (rec as Record<string, unknown>)[field];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) {
      maxRef = maxRef === null ? v : Math.max(maxRef, v);
    }
  }
  if (maxRef !== null && fileRev < maxRef) {
    throw new Error(
      `${what} store at revision ${fileRev} predates audit history (references revision ${maxRef}) — suspected partial rollback; restore authority.json, registry.json, personal-state.json, and audit.jsonl from the same backup`
    );
  }
}

export function checkStoreFreshness(
  dir: string,
  what: "authority" | "registry" | "vault",
  fileRev: number
): void {
  checkFreshness(dir, what, fileRev);
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
