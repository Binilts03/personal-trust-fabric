import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveOperatorModuleUrl } from "../src/cli.js";

/**
 * Operator module resolution for `ptf host-conformance --boundary`.
 *
 * These rules decide whether an adopter's host kit is loadable at all, so
 * they are pinned here rather than left to the runtime:
 *
 * - the CommonJS resolver refuses an ESM-only package (`exports` with only an
 *   `import` condition) with ERR_PACKAGE_PATH_NOT_EXPORTED, even though
 *   `import()` of the same specifier works;
 * - `import.meta.resolve(specifier, parent)` ignores the parent on Node
 *   22.18, so a bare specifier would be looked up in PTF's own
 *   `node_modules` instead of the adopter's.
 *
 * Both were ways for the adopter's module to fail to load.
 */

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ptf-resolve-"));
}

function writePackage(
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>
): string {
  const dir = join(root, "node_modules", ...name.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", ...manifest })
  );
  for (const [file, source] of Object.entries(files)) {
    const path = join(dir, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);
  }
  return dir;
}

describe("operator module resolution", () => {
  it("resolves a relative path against the working directory", () => {
    const root = scratch();
    try {
      const file = join(root, "host-boundary.mjs");
      writeFileSync(file, "export const boundary = () => null;\n");
      assert.equal(
        resolveOperatorModuleUrl("./host-boundary.mjs", root),
        pathToFileURL(file).href
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves an absolute path as given", () => {
    const root = scratch();
    try {
      const file = join(root, "host-boundary.mjs");
      writeFileSync(file, "export const boundary = () => null;\n");
      assert.equal(
        resolveOperatorModuleUrl(file, scratch()),
        pathToFileURL(file).href
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves an ESM-only package that the CommonJS resolver refuses", () => {
    // The regression: this package exports only an "import" condition, so
    // require.resolve() throws ERR_PACKAGE_PATH_NOT_EXPORTED. The adopter's
    // kit is loadable all the same.
    const root = scratch();
    try {
      const dir = writePackage(
        root,
        "esm-only-kit",
        { type: "module", exports: { ".": { import: "./index.js" } } },
        { "index.js": "export const boundary = () => null;\n" }
      );
      assert.equal(
        resolveOperatorModuleUrl("esm-only-kit", root),
        pathToFileURL(join(dir, "index.js")).href
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers the import condition over the require condition", () => {
    const root = scratch();
    try {
      const dir = writePackage(
        root,
        "dual-kit",
        {
          type: "module",
          exports: {
            ".": { require: "./index.cjs", import: "./index.mjs" },
          },
        },
        {
          "index.cjs": "module.exports = {};\n",
          "index.mjs": "export const boundary = () => null;\n",
        }
      );
      assert.equal(
        resolveOperatorModuleUrl("dual-kit", root),
        pathToFileURL(join(dir, "index.mjs")).href
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a scoped package and an exports subpath", () => {
    const root = scratch();
    try {
      const dir = writePackage(
        root,
        "@scope/host-kit",
        {
          type: "module",
          exports: {
            ".": "./index.js",
            "./boundary": { import: "./boundary.js" },
          },
        },
        {
          "index.js": "export const boundary = () => null;\n",
          "boundary.js": "export const boundary = () => null;\n",
        }
      );
      assert.equal(
        resolveOperatorModuleUrl("@scope/host-kit", root),
        pathToFileURL(join(dir, "index.js")).href
      );
      assert.equal(
        resolveOperatorModuleUrl("@scope/host-kit/boundary", root),
        pathToFileURL(join(dir, "boundary.js")).href
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves a package without an exports map through main", () => {
    const root = scratch();
    try {
      const dir = writePackage(
        root,
        "legacy-kit",
        { type: "module", main: "./lib/entry.js" },
        { "lib/entry.js": "export const boundary = () => null;\n" }
      );
      assert.equal(
        resolveOperatorModuleUrl("legacy-kit", root),
        pathToFileURL(join(dir, "lib", "entry.js")).href
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves from the operator's project, never from PTF's own packages", () => {
    // `zod` is PTF's own dependency and is installed next to PTF. An
    // adopter's bare specifier must not resolve to it: the operator's
    // project owns the dependency.
    const root = scratch();
    try {
      assert.throws(
        () => resolveOperatorModuleUrl("zod", root),
        /cannot find the package "zod"/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports an actionable error for a package that is not installed", () => {
    const root = scratch();
    try {
      assert.throws(
        () => resolveOperatorModuleUrl("nowhere-kit", root),
        /cannot find the package "nowhere-kit"/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports an actionable error for a subpath the package does not export", () => {
    const root = scratch();
    try {
      writePackage(
        root,
        "partial-kit",
        { type: "module", exports: { ".": "./index.js" } },
        { "index.js": "export const boundary = () => null;\n" }
      );
      assert.throws(
        () => resolveOperatorModuleUrl("partial-kit/missing", root),
        /does not export "\.\/missing"/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports an actionable error for a missing file path", () => {
    const root = scratch();
    try {
      assert.throws(
        () => resolveOperatorModuleUrl("./not-here.mjs", root),
        /no boundary module at/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
