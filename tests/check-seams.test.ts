import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
const CHECKER = join(process.cwd(), "scripts", "check-seams.mjs");
const PRIVACY_STORE = "../src/store/privacy.js";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "ptf-seams-"));
  mkdirSync(join(root, "src", "core"), { recursive: true });
  writeFileSync(join(root, "src", "core", "placeholder.ts"), "export {};\n");
  mkdirSync(join(root, "tests"), { recursive: true });
  return root;
}

function check(root: string) {
  return spawnSync(process.execPath, [CHECKER, "--root", root], {
    encoding: "utf8",
  });
}

describe("seam guard fixture", () => {
  it("rejects a persistence import from a non-exempt test file", () => {
    const root = fixture();
    try {
      writeFileSync(
        join(root, "tests", "probe.test.ts"),
        `import { PrivacyStore } from ${JSON.stringify(PRIVACY_STORE)};\n`
      );
      const result = check(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /tests\/probe\.test\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows the exact repository-owned persistence suite", () => {
    const root = fixture();
    try {
      const file = join(root, "tests", "privacy-store.test.ts");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        `import { PrivacyStore } from ${JSON.stringify(PRIVACY_STORE)};\n`
      );
      const result = check(root);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /seam check: ok/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
