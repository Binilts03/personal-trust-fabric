import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Authority } from "../core/authority.js";
import { Audit, type AuditEntry, type AuditEvent } from "../core/execute.js";
import { canonicalize } from "../core/canonical.js";
import { RecipientRegistry } from "../core/identity.js";

/**
 * Durable JSON stores for a single operator (prod-01).
 * Atomic writes via tmp-file rename; no locking — concurrent writers are out
 * of scope (see the production spec). Corrupt or missing files fail closed.
 */

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf8");
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
  atomicWrite(join(dir, "authority.json"), JSON.stringify(auth.snapshot()));
}

export function loadAuthority(
  dir: string,
  opts?: ConstructorParameters<typeof Authority>[0]
): Authority {
  return Authority.restore(
    parseFile(join(dir, "authority.json"), "authority"),
    opts
  );
}

export function saveRegistry(dir: string, reg: RecipientRegistry): void {
  atomicWrite(join(dir, "registry.json"), JSON.stringify(reg.snapshot()));
}

export function loadRegistry(
  dir: string,
  nowSec?: () => number
): RecipientRegistry {
  return RecipientRegistry.restore(
    parseFile(join(dir, "registry.json"), "registry"),
    nowSec
  );
}

/** Append-only audit log file. Entries are canonical JSON, one per line. */
export class FileAuditLog {
  private constructor(
    private readonly audit: Audit,
    private readonly path: string
  ) {}

  static open(
    path: string,
    nowSec: () => number = () => Math.floor(Date.now() / 1000)
  ): FileAuditLog {
    const audit = new Audit(nowSec);
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
