import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

  it("authority plane ships zero runtime dependencies", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8")
    ) as Record<string, unknown>;
    assert.equal(pkg["dependencies"], undefined);
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
