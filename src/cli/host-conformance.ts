import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMcpPrivacyConfig } from "../privacy/mcp.js";
import { runHostConformance } from "../hostkit/conformance.js";
import { optional, readJson } from "./privacy-shared.js";
import { loadHostBoundary } from "./load-host-boundary.js";

/**
 * The `ptf host-conformance` operator command.
 *
 * It runs the host kit's conformance checks and prints one line per check.
 * The checks need their own stores, so they run in a scratch directory: the
 * operator's store is not read at all, and nothing here reaches the network.
 *
 * With `--boundary MODULE` the checks run against the ADOPTER's composition
 * instead of the kit's reference one — that is what turns this command from
 * a self-test of the kit into a gate a host can put in its own CI. The
 * boundary under test is always named in the output, so a green run is
 * attributable.
 *
 * Trust: the module the operator names is executed in this process, so this
 * process must not hold anything the checks do not need. The checks seed
 * their own encrypted stores in a scratch directory with their own key, so
 * the command deliberately does NOT open the operator's keystore and does NOT
 * decrypt the operator's privacy state. The adoption gate can therefore run in
 * CI without the operator's passphrase, and an adopter's module never runs
 * beside decrypted operator material.
 */

export interface HostConformanceCliContext {
  readonly dir: string;
  readonly flags: Record<string, string | boolean>;
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

  ctx.io.print(
    "store: not read (the checks use their own encrypted scratch stores; your keystore and privacy state are never decrypted here)"
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
