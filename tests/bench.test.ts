import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const run = promisify(execFile);
// Compiled tests run from dist/tests: climb back to the repo root — the
// harness is a plain script, never compiled into dist.
const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "bench.mjs"
);

interface BenchRow {
  readonly op: string;
  readonly n: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

describe("benchmark harness (G14)", () => {
  it("emits env-stamped percentile rows, shape-only (never thresholds)", async () => {
    const { stdout } = await run(process.execPath, [script, "--n", "5"]);
    const report = JSON.parse(stdout) as {
      env?: { node?: string };
      ops?: BenchRow[];
    };
    assert.equal(typeof report.env?.node, "string");
    assert.ok(Array.isArray(report.ops) && report.ops.length > 0);
    for (const row of report.ops ?? []) {
      assert.equal(typeof row.op, "string");
      assert.equal(row.n, 5);
      for (const k of ["min", "p50", "p95", "p99"] as const) {
        assert.ok(
          typeof row[k] === "number" && row[k] >= 0,
          `${row.op}.${k} is a non-negative number`
        );
      }
      assert.ok(row.min <= row.p50, `${row.op}: min <= p50`);
      assert.ok(row.p50 <= row.p95, `${row.op}: p50 <= p95`);
      assert.ok(row.p95 <= row.p99, `${row.op}: p95 <= p99`);
    }
  });

  it("rejects bad flags without running", async () => {
    await assert.rejects(
      run(process.execPath, [script, "--n", "0"]),
      /positive integer|usage/
    );
  });
});
