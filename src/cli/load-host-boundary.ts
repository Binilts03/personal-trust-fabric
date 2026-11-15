import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { HostConformanceBoundaryFactory } from "../hostkit/index.js";

/**
 * Load the host's own boundary composition for `ptf host-conformance
 * --boundary`.
 *
 * The conformance suite is only an adoption gate if the thing under test is
 * the ADOPTER's composition. Left to itself the command always exercises the
 * kit's reference boundary, so a green run proves only that the kit still
 * works — not that the host does. This loader lets the operator name the
 * module that composes their boundary.
 *
 * Trust: the specifier comes from the operator's own command line, never
 * from an agent or an MCP caller. The operator already holds the store, so
 * loading their own module adds no privilege the CLI does not already have.
 * The module runs with the operator's privileges, like the CLI itself.
 *
 * Resolution:
 * - `./x.mjs`, `../x.mjs` and absolute paths resolve against the working
 *   directory;
 * - a bare specifier (`my-host-kit`) resolves from the working directory's
 *   `node_modules`, so the host's module — not PTF's — owns the dependency
 *   and the module's own `import "personal-trust-fabric/hostkit"` resolves
 *   from the host's project.
 */

/** The named export a boundary module must provide. */
export const HOST_BOUNDARY_EXPORT = "boundary";

function resolveModuleUrl(specifier: string): string {
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return pathToFileURL(resolve(process.cwd(), specifier)).href;
  }
  // Bare specifier: anchor a require resolver at a synthetic module inside
  // the working directory and hand back a file URL for the ESM loader. That
  // puts the operator's `node_modules` on the lookup path, so the module the
  // operator named is the one that loads — not whatever PTF happens to provide.
  const requireFromCwd = createRequire(
    pathToFileURL(join(process.cwd(), "ptf-boundary-resolver.cjs")).href
  );
  const resolvedPath = requireFromCwd.resolve(specifier);
  return pathToFileURL(resolvedPath).href;
}

/**
 * Load the host's boundary factory. Throws with an actionable message when
 * the module cannot be found, cannot be imported, or exports no factory.
 */
export async function loadHostBoundary(
  specifier: string
): Promise<HostConformanceBoundaryFactory> {
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(resolveModuleUrl(specifier))) as Record<
      string,
      unknown
    >;
  } catch (error) {
    throw new Error(
      `host-conformance: cannot load boundary module ${specifier} (or a module it imports): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const candidate = loaded[HOST_BOUNDARY_EXPORT] ?? loaded["default"];
  if (typeof candidate !== "function") {
    throw new Error(
      `host-conformance: ${specifier} exports no boundary factory — expected a named export "${HOST_BOUNDARY_EXPORT}" or a default export that is a function`
    );
  }
  return candidate as HostConformanceBoundaryFactory;
}
