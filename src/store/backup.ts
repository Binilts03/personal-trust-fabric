import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { checkpoint } from "./anchor.js";
import { gcChallenges } from "./challenges.js";
import { FileAuditLog, loadAuthority, loadRegistry } from "./files.js";
import { loadVault } from "./vault.js";

/**
 * Backup/restore as code (runbook in `docs/audit/operations.md`).
 *
 * A store is backed up and restored as ONE unit — authority.json,
 * registry.json, personal-state.json + keystore.json + audit.jsonl when
 * present, plus the proposals/ directory — never merged across vintages.
 * Every backup carries an `anchor.json` checkpoint (Merkle root + line
 * count over audit.jsonl); restore recomputes it and refuses mismatch, so
 * partial rollbacks, mixed vintages, and tamper are caught. Honest scope:
 * this is a consistency checkpoint *within* one backup, not external
 * freshness — a whole backup directory rolled back coherently still
 * verifies (only external retention defeats that; host duty, ADR-0006).
 * Partial rollbacks (mixed
 * vintages) fail closed at load via the revision freshness check.
 *
 * Refusals (fail-closed, never overwrite/merge):
 * - destination exists and is non-empty;
 * - destination resolves inside the source (recursive copy);
 * - the passphrase file lives inside the store (a backup must never carry
 *   the secret that unlocks it);
 * - a vault file is restored without key material to verify it.
 */

const STORE_FILES = [
  "authority.json",
  "registry.json",
  "personal-state.json",
  "keystore.json",
  "audit.jsonl",
] as const;

function isNonEmptyDir(path: string): boolean {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function insideDir(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== "" && !rel.startsWith("..");
}

function readAuditEntries(dir: string): unknown[] {
  const path = join(dir, "audit.jsonl");
  if (!existsSync(path)) return [];
  const out: unknown[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      out.push(JSON.parse(t) as unknown);
    } catch {
      throw new Error(`backup: audit log corrupt: ${path}`);
    }
  }
  return out;
}

export interface BackupSummary {
  readonly destDir: string;
  readonly files: readonly string[];
  readonly proposals: number;
  readonly anchor: { readonly root: string; readonly count: number };
}

export function backupStore(
  srcDir: string,
  destDir: string,
  opts: {
    readonly nowSec?: () => number;
    readonly passphraseFile?: string;
  } = {}
): BackupSummary {
  if (!existsSync(join(srcDir, "authority.json"))) {
    throw new Error(`no store at ${srcDir} (run: ptf init)`);
  }
  if (isNonEmptyDir(destDir)) {
    throw new Error(
      `backup: refusing to merge into non-empty ${destDir} (back up to a fresh directory)`
    );
  }
  if (insideDir(srcDir, destDir)) {
    throw new Error("backup: destination must not live inside the store");
  }
  if (
    opts.passphraseFile !== undefined &&
    opts.passphraseFile.length > 0 &&
    insideDir(srcDir, opts.passphraseFile)
  ) {
    throw new Error(
      "backup: passphrase file lives inside the store — move it out (a backup must never carry its own unlock secret)"
    );
  }
  const now = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
  mkdirSync(destDir, { recursive: true });
  const files: string[] = [];
  for (const name of STORE_FILES) {
    const from = join(srcDir, name);
    if (existsSync(from)) {
      writeFileSync(join(destDir, name), readFileSync(from), { mode: 0o600 });
      files.push(name);
    }
  }
  let proposals = 0;
  if (existsSync(join(srcDir, "proposals"))) {
    try {
      gcChallenges(srcDir, now());
    } catch {
      // Hygiene only — copy whatever is there.
    }
    cpSync(join(srcDir, "proposals"), join(destDir, "proposals"), {
      recursive: true,
    });
    try {
      proposals = readdirSync(join(destDir, "proposals")).filter((n) =>
        n.endsWith(".json")
      ).length;
    } catch {
      proposals = 0;
    }
  }
  // Validate the chain before checkpointing: never anchor a broken log.
  if (existsSync(join(srcDir, "audit.jsonl"))) {
    FileAuditLog.open(join(srcDir, "audit.jsonl"), now);
  }
  const entries = readAuditEntries(srcDir);
  const anchor = checkpoint(entries, now());
  writeFileSync(join(destDir, "anchor.json"), `${JSON.stringify(anchor)}\n`, {
    mode: 0o600,
  });
  return { destDir, files, proposals, anchor };
}

export interface RestoreSummary {
  readonly destDir: string;
  readonly files: readonly string[];
  readonly anchorChecked: boolean;
  readonly anchorMatch: boolean;
}

export function restoreStore(
  backupDir: string,
  destDir: string,
  opts: {
    readonly nowSec?: () => number;
    readonly keys?: Record<string, Uint8Array>;
  } = {}
): RestoreSummary {
  if (!existsSync(join(backupDir, "authority.json"))) {
    throw new Error(`no backup at ${backupDir}`);
  }
  if (isNonEmptyDir(destDir)) {
    throw new Error(
      `restore: refusing to merge into non-empty ${destDir} (restore over a fresh directory — never mix vintages)`
    );
  }
  if (insideDir(backupDir, destDir)) {
    throw new Error("restore: destination must not live inside the backup");
  }
  const now = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
  mkdirSync(destDir, { recursive: true });
  const files: string[] = [];
  for (const name of STORE_FILES) {
    const from = join(backupDir, name);
    if (existsSync(from)) {
      writeFileSync(join(destDir, name), readFileSync(from), { mode: 0o600 });
      files.push(name);
    }
  }
  if (existsSync(join(backupDir, "proposals"))) {
    cpSync(join(backupDir, "proposals"), join(destDir, "proposals"), {
      recursive: true,
    });
    files.push("proposals/");
  }
  // Verify the restored unit: chain valid, stores load (freshness enforced
  // by the loaders — mixed vintages fail closed here), vault needs keys.
  const audit = FileAuditLog.open(join(destDir, "audit.jsonl"), now);
  if (!audit.verifyChain()) {
    throw new Error(`restore: audit chain BROKEN in ${destDir}`);
  }
  loadAuthority(destDir, { nowSec: now });
  loadRegistry(destDir, now);
  if (existsSync(join(destDir, "personal-state.json"))) {
    if (opts.keys === undefined) {
      throw new Error(
        "restore: vault present but no key material given — unlock the keystore to verify the restore"
      );
    }
    loadVault(destDir, { nowSec: now, keys: opts.keys });
  }
  // Anchor: recompute over the restored log and compare with the backup's.
  let anchorChecked = false;
  let anchorMatch = false;
  const anchorPath = join(backupDir, "anchor.json");
  if (existsSync(anchorPath)) {
    anchorChecked = true;
    let recorded: unknown;
    try {
      recorded = JSON.parse(readFileSync(anchorPath, "utf8")) as unknown;
    } catch {
      throw new Error(`restore: anchor corrupt: ${anchorPath}`);
    }
    const rec = recorded as { root?: unknown; count?: unknown };
    const recomputed = checkpoint(readAuditEntries(destDir), now());
    anchorMatch =
      rec.root === recomputed.root && rec.count === recomputed.count;
    if (!anchorMatch) {
      throw new Error(
        "restore: anchor mismatch — the restored log differs from the backup checkpoint (suspected rollback or tamper)"
      );
    }
  }
  return { destDir, files, anchorChecked, anchorMatch };
}
