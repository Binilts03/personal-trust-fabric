import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const examples = ["payment-disclosure.mjs", "vault-protected-action.mjs"] as const;

describe("documented reference examples", () => {
  for (const name of examples) {
    it(`${name} executes with real proof and emits no protected secret`, () => {
      const run = spawnSync(
        process.execPath,
        [join(root, "examples", name)],
        { cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 }
      );
      assert.equal(run.error, undefined, `spawn failed: ${run.error?.message}`);
      assert.equal(run.status, 0, `${name} exited ${run.status}: ${run.stderr}`);
      const combined = run.stdout + run.stderr;
      assert.doesNotMatch(combined, /PAN-SECRET-4111-never-leaves-host/);
      assert.doesNotMatch(combined, /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
      assert.doesNotMatch(combined, /real payment (sent|transferred|settled)/i);
      assert.match(run.stdout, /receipt:/);
    });
  }
});
