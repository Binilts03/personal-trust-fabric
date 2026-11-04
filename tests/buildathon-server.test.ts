import { it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

it("Buildathon Cloud Run presentation endpoint refuses unsafe paths", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const script = join(root, "examples", "buildathon", "server.test.mjs");
  const result = spawnSync(process.execPath, ["--test", script], {
    cwd: root, encoding: "utf8", timeout: 30_000
  });
  assert.equal(result.error, undefined, result.error?.message ?? "spawn failed");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
