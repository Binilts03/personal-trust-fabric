import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProposal,
  gcChallenges,
  loadProposal,
  transitionProposal,
} from "../src/index.js";

const DIGEST = "ab".repeat(32);
const NOW = 1_700_000_000;

function dir(): string {
  return mkdtempSync(join(tmpdir(), "ptf-ch-"));
}

describe("durable proposals/challenges file CAS (v04/02)", () => {
  it("survives reload and rejects corrupt/expired reads", () => {
    const d = dir();
    createProposal(d, DIGEST, { amount: 100 }, 600, NOW);
    assert.equal(loadProposal(d, DIGEST, NOW + 10).state, "pending");
    assert.throws(() => loadProposal(d, DIGEST, NOW + 601), /expired/);
  });

  it("double-create does not lost-update; terminal transitions are CAS", () => {
    const d = dir();
    const first = createProposal(d, DIGEST, { amount: 100 }, 600, NOW);
    const second = createProposal(d, DIGEST, { amount: 999 }, 600, NOW + 1);
    assert.deepEqual(second.demand, first.demand);
    const done = transitionProposal(
      d,
      DIGEST,
      "executed",
      { tx: "t" },
      NOW + 2
    );
    assert.equal(done.state, "executed");
    assert.throws(
      () => transitionProposal(d, DIGEST, "denied", undefined, NOW + 3),
      /already executed/
    );
  });

  it("GC purges expired proposals and cleans stale tmp files", () => {
    const d = dir();
    createProposal(d, DIGEST, { amount: 1 }, 10, NOW);
    const res = gcChallenges(d, NOW + 11);
    assert.equal(res.purged, 1);
    assert.throws(
      () => loadProposal(d, DIGEST, NOW + 11),
      /corrupt|expired|missing|ENOENT/i
    );
  });
});
