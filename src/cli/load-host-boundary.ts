import type { HostConformanceBoundaryFactory } from "../hostkit/index.js";
import { resolveOperatorModuleUrl } from "./resolve-module.js";

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
 *   from the host's project;
 * - the `exports` map is applied with the ESM conditions, so a host kit
 *   published as an ESM-only package loads. See `resolve-module.ts`.
 */

/** The named export a boundary module must provide. */
export const HOST_BOUNDARY_EXPORT = "boundary";

/**
 * Load the host's boundary factory. Throws with an actionable message when
 * the module cannot be found, cannot be imported, or exports no factory.
 */
export async function loadHostBoundary(
  specifier: string
): Promise<HostConformanceBoundaryFactory> {
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(resolveOperatorModuleUrl(specifier))) as Record<
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
