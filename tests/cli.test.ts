import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
});
