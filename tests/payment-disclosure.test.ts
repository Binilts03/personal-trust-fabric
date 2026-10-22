import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// The launch demo is part of the product. Run it from the compiled tree so a
// broken demand or a stale receipt binding fails the gate, not the demo.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXAMPLE = join(ROOT, "examples", "payment-disclosure.mjs");

test("payment-disclosure example runs end to end", () => {
  const stdout = execFileSync(process.execPath, [EXAMPLE], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  assert.match(
    stdout,
    /^payment receipt: rcpt-[0-9a-f]+ -> did:example:shop 1790 INR$/m
  );
  assert.match(stdout, /^disclosed: ca_status$/m);
  assert.match(stdout, /^verify: ok \(ca_status\)$/m);
});
