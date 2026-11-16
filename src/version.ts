import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The one version string: the package's own metadata.
 *
 * The CLI (`ptf --version`), the PDP health endpoint and the MCP server all
 * used to carry their own copy of the version string, and they drifted: the
 * package metadata moved to `0.2.0-rc.1` while the CLI and the MCP server
 * still reported `0.1.0`. A version that is copied is a version that lies.
 *
 * The single source of truth is `package.json`. It is read at runtime, so the
 * published package reports its own version — a tarball built from a
 * different commit reports that commit's version, with no rebuild step and no
 * hand-maintained constant.
 *
 * Resolution: the package's own `package.json` is found through Node's
 * self-reference (the `exports` map publishes `./package.json`), and by
 * walking up from this module when self-reference is unavailable — a linked
 * or copied build has no self-reference.
 */

let cached: string | undefined;

/** Read the package metadata this module was published with. */
function readPackageJson(): { readonly version?: unknown } {
  const selfReference = (): string | undefined => {
    try {
      const require = createRequire(import.meta.url);
      return require.resolve("personal-trust-fabric/package.json");
    } catch {
      return undefined;
    }
  };
  const walkUp = (): string | undefined => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (;;) {
      const candidate = join(dir, "package.json");
      try {
        readFileSync(candidate, "utf8");
        return candidate;
      } catch {
        // keep walking
      }
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  };
  const path = selfReference() ?? walkUp();
  if (path === undefined) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as {
      readonly version?: unknown;
    };
  } catch {
    return {};
  }
}

/**
 * The package version, read from the package's own metadata.
 *
 * Returns `"unknown"` only when the metadata cannot be read at all, which
 * means the build is broken rather than merely old — the version contract
 * test fails on it.
 */
export function packageVersion(): string {
  if (cached !== undefined) return cached;
  const manifest = readPackageJson();
  const version = manifest.version;
  cached =
    typeof version === "string" && version.length > 0 ? version : "unknown";
  return cached;
}
