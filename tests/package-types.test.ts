import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The published types must match the published runtime.
 *
 * The declaration build strips declarations marked as internal-only. When a
 * declaration the PUBLISHED surface depends on carried that marker, the
 * emitted `.d.ts` files referenced names that no longer existed — and the
 * package's TypeScript types did not compile for any consumer, while the
 * repository's own `tsc --noEmit` stayed green because it checks the
 * sources, not the emitted declarations.
 *
 * This check is the fast local guard for that class of defect:
 * - every name a published declaration re-exports must exist in the
 *   declaration it points at;
 * - every runtime export of a published entry point must be declared in its
 *   declarations.
 *
 * The full TypeScript compile of a consumer against the installed tarball is
 * the authoritative gate (`npm run verify:package -- --install`).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Manifest {
  readonly exports?: Record<string, unknown>;
}

function manifest(): Manifest {
  return JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8")
  ) as Manifest;
}

/** The published entry points and the declaration file behind each. */
function publishedEntries(): {
  readonly name: string;
  readonly types: string;
}[] {
  const pkg = manifest();
  const entries: { name: string; types: string }[] = [];
  for (const [name, value] of Object.entries(pkg.exports ?? {})) {
    if (value === null || typeof value !== "object") continue;
    const types = (value as { readonly types?: unknown }).types;
    if (typeof types !== "string") continue;
    entries.push({ name, types: join(ROOT, types.replace(/^\.\//, "")) });
  }
  return entries;
}

/** Names a declaration file declares or re-exports. */
function declaredNames(file: string, stack: string[] = []): Set<string> {
  const names = new Set<string>();
  if (stack.includes(file)) return names;
  const nextStack = [...stack, file];
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return names;
  }
  const local =
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|enum|interface|type|namespace)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(local)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  const reexport = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  for (const match of source.matchAll(reexport)) {
    const specifiers = (match[1] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const target = match[2] ?? "";
    for (const specifier of specifiers) {
      const exported = specifier.includes(" as ")
        ? specifier.split(" as ")[1]?.trim()
        : specifier;
      if (exported === undefined || exported.length === 0) continue;
      names.add(exported);
      // The name must exist in the declaration it points at.
      if (!target.startsWith(".")) continue;
      const targetFile = resolve(
        dirname(file),
        target.replace(/\.js$/, ".d.ts")
      );
      const targetNames = declaredNames(targetFile, nextStack);
      assert.ok(
        targetNames.has(exported),
        `${file.replace(ROOT, ".")} re-exports "${exported}" from "${target}", but that declaration does not exist in ${targetFile.replace(ROOT, ".")}`
      );
    }
  }
  // `export * from` publishes everything the target declares.
  const star = /export\s+\*\s+from\s*"([^"]+)"/g;
  for (const match of source.matchAll(star)) {
    const target = match[1] ?? "";
    if (!target.startsWith(".")) continue;
    const targetFile = resolve(dirname(file), target.replace(/\.js$/, ".d.ts"));
    for (const name of declaredNames(targetFile, nextStack)) names.add(name);
  }
  const localReexport = /export\s+(?:type\s+)?\{([^}]*)\}\s*;/g;
  for (const match of source.matchAll(localReexport)) {
    for (const specifier of (match[1] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)) {
      const exported = specifier.includes(" as ")
        ? specifier.split(" as ")[1]?.trim()
        : specifier;
      if (exported !== undefined && exported.length > 0) names.add(exported);
    }
  }
  return names;
}

describe("published declarations match the published runtime", () => {
  const entries = publishedEntries();

  it("publishes at least the curated root and the capability subpath", () => {
    const names = entries.map((entry) => entry.name);
    assert.ok(names.includes("."));
    assert.ok(names.includes("./capabilities"));
  });

  for (const entry of entries) {
    it(`${entry.name} declares every runtime export`, async () => {
      const names = declaredNames(entry.types);
      assert.ok(names.size > 0, `${entry.types} declares nothing`);
      const runtimeFile = entry.types.replace(/\.d\.ts$/, ".js");
      const runtime = (await import(pathToFileURL(runtimeFile).href)) as Record<
        string,
        unknown
      >;
      for (const name of Object.keys(runtime)) {
        assert.ok(
          names.has(name),
          `${entry.name} exports "${name}" at runtime but its declarations do not declare it`
        );
      }
    });
  }
});
