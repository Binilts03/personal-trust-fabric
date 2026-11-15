import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("README first-run example", () => {
  it("demonstrates domain-neutral permission and two denials without effects", () => {
    const child = spawnSync(process.execPath, [
      join(root, "examples", "authority-decision.mjs"),
    ], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /ALLOW: exact operation for agent-a/);
    assert.match(child.stdout, /DENY: other actor/);
    assert.match(child.stdout, /DENY: changed recipient/);
    assert.match(child.stdout, /CHECK only: no authority consumed, no external effect/);
    assert.doesNotMatch(child.stdout + child.stderr, /PRIVATE KEY|secret=/);
  });
});
