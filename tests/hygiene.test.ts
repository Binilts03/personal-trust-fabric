import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("peer-review hygiene gate (ptf-v01/05)", () => {
  it("core never imports adapters", () => {
    const core = join(ROOT, "src", "core");
    const importAdapters =
      /(?:import|export)[^;]*from\s*["'][^"']*adapters[^"']*["']/;
    for (const file of readdirSync(core).filter((f) => f.endsWith(".ts"))) {
      const content = readFileSync(join(core, file), "utf8");
      assert.ok(
        !importAdapters.test(content),
        `${file} must not import from adapters`
      );
    }
  });

  it("core imports only node:crypto and relative paths", () => {
    const fromRe = /from\s*["']([^"']+)["']/g;
    for (const file of walkTsFiles(join(ROOT, "src", "core"))) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(fromRe)) {
        const spec = match[1] as string;
        const ok = spec === "node:crypto" || spec.startsWith(".");
        assert.ok(ok, `${file}: non-allowlisted import ${spec}`);
      }
    }
  });

  it("runtime dependencies stay on the ADR-0007 allowlist", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8")
    ) as Record<string, unknown>;
    const allowed = new Set(["@modelcontextprotocol/server", "zod"]);
    for (const dep of Object.keys(
      (pkg["dependencies"] as Record<string, string> | undefined) ?? {}
    )) {
      assert.ok(allowed.has(dep), `dependency ${dep} needs an ADR`);
    }
    for (const field of [
      "peerDependencies",
      "optionalDependencies",
      "bundledDependencies",
    ]) {
      assert.equal(pkg[field], undefined, `${field} must stay absent`);
    }
    assert.ok((pkg["devDependencies"] as Record<string, string>)["typescript"]);
  });

  it("strict flags stay pinned", () => {
    const tsconfig = JSON.parse(
      readFileSync(join(ROOT, "tsconfig.json"), "utf8")
    ) as {
      compilerOptions: Record<string, unknown>;
    };
    assert.equal(tsconfig.compilerOptions["strict"], true);
    assert.equal(tsconfig.compilerOptions["noUncheckedIndexedAccess"], true);
  });
});
