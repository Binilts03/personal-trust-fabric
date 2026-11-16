import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Operator module resolution for `ptf host-conformance --boundary`.
 *
 * The module under test is the ADOPTER's own host kit, so it has to be
 * resolved the way the adopter's application would resolve it: from the
 * adopter's working directory, with the ESM rules, and without PTF's own
 * dependency tree deciding what "their" module means.
 *
 * Why not `createRequire(...).resolve()`: that is the CommonJS resolver. It
 * resolves an `exports` map with the `require` condition, so a package that
 * publishes only an `import` condition — the normal shape of a modern
 * ESM-only package — fails with ERR_PACKAGE_PATH_NOT_EXPORTED even though
 * `import()` of the very same specifier works. A host kit published that way
 * was unloadable through the conformance gate.
 *
 * Why not `import.meta.resolve(specifier, parent)`: the parent argument is
 * ignored on Node 22.18 (the version this package supports): the resolution
 * runs against the CALLING module, so the operator's package would be looked
 * up in PTF's own `node_modules`. The version this resolver implements is
 * therefore explicit, and the unit tests pin the anchoring.
 *
 * Resolution rules:
 * - `./x.mjs`, `../x.mjs` and absolute paths resolve against the working
 *   directory;
 * - a bare specifier (`my-host-kit`, `@scope/my-host-kit`) resolves from the
 *   working directory's `node_modules`, walking up the directory tree the way
 *   Node does, so the host's module — not PTF's — owns the dependency and the
 *   module's own `import "personal-trust-fabric/hostkit"` resolves from the
 *   host's project;
 * - the `exports` map is applied with the ESM conditions (`node`, `import`,
 *   `default`), including subpath maps and `*` patterns;
 * - a package without an `exports` map falls back to `main`, then `index.js`.
 */

/** The conditions Node applies to an `import` of a package entry point. */
const ESM_CONDITIONS: ReadonlySet<string> = new Set([
  "node",
  "import",
  "default",
]);

/** A resolution failure with an actionable message. */
export class OperatorModuleResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorModuleResolutionError";
  }
}

interface BareSpecifier {
  /** The package name, including the scope when there is one. */
  readonly name: string;
  /** The subpath inside the package: "." for the package entry. */
  readonly subpath: string;
}

function splitBareSpecifier(specifier: string): BareSpecifier {
  const segments = specifier.split("/").filter((part) => part.length > 0);
  if (segments.length === 0) {
    throw new OperatorModuleResolutionError(
      "host-conformance: the boundary module specifier is empty"
    );
  }
  const scoped = specifier.startsWith("@");
  const nameSegments = scoped ? segments.slice(0, 2) : segments.slice(0, 1);
  const rest = segments.slice(nameSegments.length);
  if (scoped && nameSegments.length < 2) {
    throw new OperatorModuleResolutionError(
      `host-conformance: "${specifier}" is not a package name`
    );
  }
  return {
    name: nameSegments.join("/"),
    subpath: rest.length === 0 ? "." : `./${rest.join("/")}`,
  };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Find the package directory the way Node does: `node_modules` in the
 * working directory, then in each parent directory.
 */
function findPackageDirectory(name: string, cwd: string): string | undefined {
  let current = resolve(cwd);
  for (;;) {
    const candidate = join(current, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

interface PackageManifest {
  readonly exports?: unknown;
  readonly main?: unknown;
}

function readManifest(packageDir: string): PackageManifest {
  try {
    return JSON.parse(
      readFileSync(join(packageDir, "package.json"), "utf8")
    ) as PackageManifest;
  } catch {
    return {};
  }
}

function notExported(
  specifier: string,
  subpath: string
): OperatorModuleResolutionError {
  return new OperatorModuleResolutionError(
    `host-conformance: the package "${specifier}" does not export "${subpath}"`
  );
}

/**
 * Resolve a value inside an `exports` map. `value` is a target string, an
 * array of alternatives, a conditions object, or a subpath map.
 */
function resolveExportsValue(
  value: unknown,
  subpath: string,
  specifier: string
): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      try {
        return resolveExportsValue(entry, subpath, specifier);
      } catch {
        // An alternative that does not resolve is skipped, as Node does.
      }
    }
    throw notExported(specifier, subpath);
  }
  if (value !== null && typeof value === "object") {
    const map = value as Record<string, unknown>;
    const keys = Object.keys(map);
    if (keys.some((key) => key.startsWith("."))) {
      // A subpath map: an exact match wins over a pattern.
      const exact = map[subpath];
      if (exact !== undefined) {
        return resolveExportsValue(exact, subpath, specifier);
      }
      for (const key of keys) {
        const star = key.indexOf("*");
        if (star === -1) continue;
        const prefix = key.slice(0, star);
        const suffix = key.slice(star + 1);
        if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
        if (subpath.length < prefix.length + suffix.length) continue;
        const matched = subpath.slice(
          prefix.length,
          subpath.length - suffix.length
        );
        const target = resolveExportsValue(map[key], subpath, specifier);
        return target.replace(/\*/g, matched);
      }
      throw notExported(specifier, subpath);
    }
    // A conditions object: the first matching condition wins, in the order
    // the package declared it.
    for (const [condition, target] of Object.entries(map)) {
      if (condition === "default" || ESM_CONDITIONS.has(condition)) {
        return resolveExportsValue(target, subpath, specifier);
      }
    }
    throw notExported(specifier, subpath);
  }
  throw notExported(specifier, subpath);
}

/** Resolve the package entry point declared by an `exports` map. */
function resolveExportsEntry(
  exportsField: unknown,
  subpath: string,
  specifier: string
): string {
  if (typeof exportsField === "string") {
    if (subpath !== ".") throw notExported(specifier, subpath);
    return exportsField;
  }
  return resolveExportsValue(exportsField, subpath, specifier);
}

/** Resolve a package without an `exports` map: `main`, then `index.js`. */
function resolveLegacyMain(
  packageDir: string,
  manifest: PackageManifest,
  specifier: string
): string {
  const main = typeof manifest.main === "string" ? manifest.main : undefined;
  if (main !== undefined) {
    const target = join(packageDir, main);
    if (isFile(target)) return main;
    if (isFile(`${target}.js`)) return `${main}.js`;
    const index = join(target, "index.js");
    if (isFile(index)) return join(main, "index.js");
  }
  const index = join(packageDir, "index.js");
  if (isFile(index)) return "./index.js";
  throw new OperatorModuleResolutionError(
    `host-conformance: the package "${specifier}" has no resolvable entry point`
  );
}

/**
 * Resolve the operator's boundary module to a file URL the ESM loader can
 * import. The specifier comes from the operator's own command line and is
 * never reachable from an agent-facing surface.
 */
export function resolveOperatorModuleUrl(
  specifier: string,
  cwd: string = process.cwd()
): string {
  const trimmed = specifier.trim();
  if (trimmed.length === 0) {
    throw new OperatorModuleResolutionError(
      "host-conformance: the boundary module specifier is empty"
    );
  }
  if (trimmed.startsWith(".") || isAbsolute(trimmed)) {
    const path = resolve(cwd, trimmed);
    if (!existsSync(path)) {
      throw new OperatorModuleResolutionError(
        `host-conformance: no boundary module at ${path}`
      );
    }
    return pathToFileURL(path).href;
  }
  const { name, subpath } = splitBareSpecifier(trimmed);
  const packageDir = findPackageDirectory(name, cwd);
  if (packageDir === undefined) {
    throw new OperatorModuleResolutionError(
      `host-conformance: cannot find the package "${name}" from ${cwd} — install it in the host project or pass a path to the module`
    );
  }
  const manifest = readManifest(packageDir);
  const target =
    manifest.exports !== undefined
      ? resolveExportsEntry(manifest.exports, subpath, name)
      : resolveLegacyMain(packageDir, manifest, name);
  const file = isAbsolute(target) ? target : join(packageDir, target);
  if (!isFile(file)) {
    throw new OperatorModuleResolutionError(
      `host-conformance: the boundary module "${specifier}" resolves to ${file}, which is not a file`
    );
  }
  return pathToFileURL(file).href;
}
