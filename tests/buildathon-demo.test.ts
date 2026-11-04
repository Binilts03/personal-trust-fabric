import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const demo = join(root, "examples", "buildathon", "demo.mjs");

function execute(args: string[]): Record<string, unknown> {
  const result = spawnSync(process.execPath, [demo, ...args], {
    cwd: root, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /BEGIN (?:EC |OPENSSH )?PRIVATE KEY/);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe("Google Buildathon synthetic integration", () => {
  it("executes exactly one proof-bound fake-provider action", () => {
    const result = execute(["--offline"]);
    assert.equal(result.outcome, "executed");
    assert.equal(result.providerCalls, 1);
    assert.equal(result.authorityUses, 1);
    assert.equal(result.processingMode, "synthetic-no-personal-data");
  });
  it("a substituted recipient cannot consume authority or trigger a provider", () => {
    const result = execute(["--denied-recipient"]);
    assert.equal(result.outcome, "denied");
    assert.equal(result.providerCalls, 0);
    assert.equal(result.authorityUses, 0);
  });
  it("a substituted agent cannot consume authority or trigger a provider", () => {
    const result = execute(["--denied-actor"]);
    assert.equal(result.outcome, "denied");
    assert.equal(result.providerCalls, 0);
    assert.equal(result.authorityUses, 0);
  });
  it("replaying an already successful exact effect cannot call the provider twice", () => {
    const result = execute(["--replay"]);
    assert.equal(result.outcome, "executed");
    assert.equal(result.providerCalls, 1);
    assert.equal(result.replayedSameReceipt, true);
  });
  it("Gemini function-call parsing rejects malformed, extra and forged requests", () => {
    const result = spawnSync(process.execPath, ["--test", join(root, "examples", "buildathon", "gemini.test.mjs")], {
      cwd: root, encoding: "utf8", timeout: 30_000
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});
