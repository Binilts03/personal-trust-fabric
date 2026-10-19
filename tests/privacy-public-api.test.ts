import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("curated privacy package surface", () => {
  it("publishes ./privacy without persistence implementations", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      exports: Record<string, { types?: string; default?: string }>;
    };
    assert.deepEqual(pkg.exports["./privacy"], {
      types: "./dist/src/privacy/api.d.ts",
      default: "./dist/src/privacy/api.js",
    });
    const api = readFileSync(join(ROOT, "src", "privacy", "api.ts"), "utf8");
    assert.ok(api.includes("./runtime.js"));
    assert.ok(api.includes("./dpdp.js"));
    assert.ok(api.includes("./model.js"));
    assert.ok(!api.includes("../store/privacy"));
    assert.ok(!api.includes("FilePrivacyEventRepository"));
    assert.ok(!api.includes("PrivacyStore"));
    const index = readFileSync(join(ROOT, "src", "index.ts"), "utf8");
    assert.ok(!index.includes('./store/privacy.js'));
    assert.ok(!index.includes('./store/privacy-events.js'));
    assert.ok(index.includes('./privacy/api.js'));

  });
});
