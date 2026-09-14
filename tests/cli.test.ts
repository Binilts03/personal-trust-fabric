import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";

describe("operator CLI argument parsing (prod-03)", () => {
  it("parses commands, flags, and the store dir", () => {
    assert.deepEqual(
      parseArgs(["pay", "--agent", "a", "--amount", "10", "--yes"]),
      {
        command: "pay",
        dir: "./ptf-store",
        flags: { agent: "a", amount: "10", yes: true },
      }
    );
    assert.deepEqual(
      parseArgs(["--dir", "/tmp/x", "audit", "--verify"]).dir,
      "/tmp/x"
    );
  });

  it("rejects garbage with usage errors", () => {
    assert.throws(() => parseArgs([]), /usage/);
    assert.throws(() => parseArgs(["frobnicate"]), /unknown command/);
    assert.throws(() => parseArgs(["pay", "--agent"]), /expects a value/);
    assert.throws(
      () => parseArgs(["pay", "--yes", "extra"]),
      /unexpected positional/
    );
    assert.throws(
      () => parseArgs(["pay", "pos", "--agent", "a"]),
      /unexpected positional/
    );
  });

  it("supports --help/--version and rejects unknown flags", () => {
    assert.equal(parseArgs(["--help"]).command, "help");
    assert.equal(parseArgs(["--version"]).command, "version");
    assert.equal(parseArgs(["help"]).command, "help");
    assert.throws(
      () => parseArgs(["pay", "--frobnicate", "x"]),
      /unknown flag/
    );
    assert.throws(
      () => parseArgs(["grant", "--id", "g", "--nope", "v"]),
      /unknown flag/
    );
  });

  it("operator-quickstart README commands all pass parseArgs (ticket 17)", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const block =
      readme.split("## Operator quickstart")[1]?.split("```")[1] ?? "";
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) => l.startsWith("node dist/src/cli.js") || l.startsWith("ptf ")
      );
    assert.ok(lines.length > 0, "expected operator-quickstart commands");
    for (const line of lines) {
      // Skip placeholder lines (e.g. --key <hex-from-keygen>): not parseable by design.
      if (line.includes("<") && line.includes(">")) continue;
      const argv = line.startsWith("node dist/src/cli.js")
        ? line.slice("node dist/src/cli.js".length).trim().split(/\s+/)
        : line.slice("ptf ".length).trim().split(/\s+/);
      if (argv.length === 1 && argv[0] === "") continue;
      parseArgs(argv);
    }
  });
});
