import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMcpPrivacyConfig } from "../privacy/mcp.js";
import { loadPrivacyStore } from "../store/privacy.js";
import { runHostConformance } from "../hostkit/conformance.js";
import { optional, readJson } from "./privacy-shared.js";
import { loadHostBoundary } from "./load-host-boundary.js";

/**
 * The `ptf host-conformance` operator command.
 *
 * It runs the host kit's conformance checks and prints one line per check.
 * The checks need their own stores, so they run in a scratch directory: the
 * operator's store is read, never written. Nothing here reaches the
 * network.
 *
 * With `--boundary MODULE` the checks run against the ADOPTER's composition
 * instead of the kit's reference one — that is what turns this command from
 * a self-test of the kit into a gate a host can put in its own CI. The
 * boundary under test is always named in the output, so a green run is
 * attributable.
 */

export interface HostConformanceCliContext {
  readonly dir: string;
  readonly flags: Record<string, string | boolean>;
  readonly keys: Record<string, Uint8Array>;
  readonly io: {
    readonly now: () => number;
    readonly print: (line: string) => void;
  };
}

export async function runHostConformanceCommand(
  ctx: HostConformanceCliContext
): Promise<number> {
  const configPath = optional(ctx.flags, "privacy-config");
  if (configPath === undefined) {
    throw new Error("usage: --privacy-config FILE is required");
  }
  const config = resolveMcpPrivacyConfig(readJson(configPath));

  // The kit needs a place to keep the evidence: the store must be readable
  // and its privacy state must decrypt before any check is meaningful.
  const store = loadPrivacyStore(ctx.dir, {
    keys: ctx.keys,
    nowSec: ctx.io.now,
  });
  ctx.io.print(
    `store: ${ctx.dir} (privacy state loaded, revision ${store.loadedRevision()})`
  );
  ctx.io.print(
    `operator configuration: valid (recipient roles: ${Object.keys(config.recipientRoles).length}, /pay categories: ${(config.actionCategories?.["/pay"] ?? []).length})`
  );

  const scratch = mkdtempSync(join(tmpdir(), "ptf-host-conformance-"));
  try {
    const boundarySpec = optional(ctx.flags, "boundary");
    const boundary =
      boundarySpec === undefined
        ? undefined
        : await loadHostBoundary(boundarySpec);
    ctx.io.print(
      boundarySpec === undefined
        ? "boundary: reference (the kit's own composition)"
        : `boundary: host-supplied (${boundarySpec})`
    );
    const results = await runHostConformance({
      config,
      tmpDir: scratch,
      ...(boundary !== undefined ? { boundary } : {}),
    });
    for (const result of results) {
      const status = result.ok ? "PASS" : "FAIL";
      const detail = result.ok ? "" : `  — ${result.detail ?? "failed"}`;
      ctx.io.print(`${result.id}  ${status}  ${result.requirement}${detail}`);
    }
    const failed = results.filter((result) => !result.ok).length;
    ctx.io.print(
      `${results.length - failed}/${results.length} checks passed${
        failed === 0 ? "" : ` (${failed} failed)`
      }`
    );
    return failed === 0 ? 0 : 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
