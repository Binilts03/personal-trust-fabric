import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExecutionJournal,
  runExecution,
} from "../src/index.js";

const NOW = 1_700_000_000;

function dir() {
  return mkdtempSync(join(tmpdir(), "ptf-exec-"));
}

function base(overrides: Record<string, unknown> = {}) {
  return {
    executionId: "exe-1",
    termsDigest: "ab".repeat(32),
    capabilityId: "cid-1",
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

describe("durable execution journal (prod)", () => {
  it("happy path: PREPARED -> AUTHORIZED -> SUBMITTING -> SUCCEEDED", async () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    j.prepare(base());
    j.authorize("exe-1");
    const seen: string[] = [];
    const rec = await runExecution(
      j,
      () => j.save(d),
      "exe-1",
      async (key) => {
        seen.push(key);
        return "pine-debit-1";
      }
    );
    assert.equal(rec.state, "SUCCEEDED");
    assert.equal(rec.providerRef, "pine-debit-1");
    assert.deepEqual(seen, ["idem-1"]);

    // Reload = restart: terminal state survives, re-run refused.
    const r = ExecutionJournal.load(d, () => NOW);
    assert.equal(r.get("exe-1")?.state, "SUCCEEDED");
    await assert.rejects(
      () => runExecution(r, () => r.save(d), "exe-1", async () => "x"),
      /terminal|reconcile/i
    );
  });

  it("crash after submit -> SUBMITTED_UNKNOWN -> reconcile no-effect -> retry with SAME key", async () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    j.prepare(base());
    j.authorize("exe-1");
    j.save(d);
    const seen: string[] = [];
    await assert.rejects(
      () =>
        runExecution(
          j,
          () => j.save(d),
          "exe-1",
          async (key) => {
            seen.push(key);
            throw new Error("socket hangup after submit");
          }
        ),
      /socket hangup/
    );
    assert.equal(j.get("exe-1")?.state, "SUBMITTED_UNKNOWN");

    // Crash + restart: fresh handle loads the unknown state from disk.
    const r = ExecutionJournal.load(d, () => NOW);
    assert.equal(r.get("exe-1")?.state, "SUBMITTED_UNKNOWN");
    // No blind retry: running while unknown throws until reconciled.
    await assert.rejects(
      () => runExecution(r, () => r.save(d), "exe-1", async () => "x"),
      /reconcile/i
    );
    // Provider confirms no effect: back to AUTHORIZED, same idempotency key.
    r.reconcile("exe-1", "no-effect", "provider: no debit for idem-1");
    assert.equal(r.get("exe-1")?.state, "AUTHORIZED");
    assert.equal(r.get("exe-1")?.idempotencyKey, "idem-1");
    r.save(d);
    const rec = await runExecution(
      r,
      () => r.save(d),
      "exe-1",
      async (key) => {
        seen.push(key);
        return "pine-debit-2";
      }
    );
    assert.equal(rec.state, "SUCCEEDED");
    assert.deepEqual(seen, ["idem-1", "idem-1"]);
  });

  it("reconcile effect confirms without re-submitting", async () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    j.prepare(base());
    j.authorize("exe-1");
    let calls = 0;
    await assert.rejects(() =>
      runExecution(
        j,
        () => j.save(d),
        "exe-1",
        async () => {
          calls += 1;
          throw new Error("timeout");
        }
      )
    );
    const r = ExecutionJournal.load(d, () => NOW);
    r.reconcile("exe-1", "effect", "pine-debit-9");
    const rec = r.get("exe-1");
    assert.equal(rec?.state, "SUCCEEDED");
    assert.equal(rec?.providerRef, "pine-debit-9");
    assert.equal(calls, 1);
  });

  it("confirmed final failure lands FAILED_FINAL (terminal)", async () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    j.prepare(base());
    j.authorize("exe-1");
    j.beginSubmit("exe-1");
    j.failFinal("exe-1", "provider: DECLINED (insufficient mandate)");
    assert.equal(j.get("exe-1")?.state, "FAILED_FINAL");
    await assert.rejects(
      () => runExecution(j, () => j.save(d), "exe-1", async () => "x"),
      /terminal/i
    );
  });

  it("unconfirmable outcome quarantines for manual reconciliation", async () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    j.prepare(base());
    j.authorize("exe-1");
    await assert.rejects(() =>
      runExecution(
        j,
        () => j.save(d),
        "exe-1",
        async () => {
          throw new Error("partition");
        }
      )
    );
    const r = ExecutionJournal.load(d, () => NOW);
    r.reconcile("exe-1", "unknown", "provider unreachable, paged human");
    const rec = r.get("exe-1");
    assert.equal(rec?.state, "SUBMITTED_UNKNOWN");
    assert.equal(rec?.quarantined, true);
    await assert.rejects(
      () => runExecution(r, () => r.save(d), "exe-1", async () => "x"),
      /quarantine|reconcile/i
    );
    // Manual path only, with a note; terminal afterwards.
    r.reconcile("exe-1", "manual", "human confirmed no debit, closed");
    assert.equal(r.get("exe-1")?.state, "RECONCILED");
    assert.throws(() => r.reconcile("exe-1", "effect", "late"));
    assert.throws(() => r.authorize("exe-1"));
  });

  it("reloaded SUBMITTING becomes SUBMITTED_UNKNOWN (crash before submit)", async () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    j.prepare(base());
    j.authorize("exe-1");
    j.beginSubmit("exe-1");
    j.save(d);

    // Crash between persist(SUBMITTING) and the submit call: reload must
    // treat the effect as possible, not as retryable, not as stuck.
    const r = ExecutionJournal.load(d, () => NOW + 5);
    assert.equal(r.get("exe-1")?.state, "SUBMITTED_UNKNOWN");
    await assert.rejects(
      () => runExecution(r, () => r.save(d), "exe-1", async () => "x"),
      /reconcile/i
    );
    r.reconcile("exe-1", "no-effect", "provider: nothing received");
    assert.equal(r.get("exe-1")?.state, "AUTHORIZED");
  });

  it("pruneTerminal drops old terminals, keeps unknown and fresh", () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    j.prepare(base());
    j.authorize("exe-1");
    j.beginSubmit("exe-1");
    j.succeed("exe-1", "ref-1");
    j.prepare({ ...base(), executionId: "exe-2", idempotencyKey: "idem-2" });
    j.authorize("exe-2");
    j.beginSubmit("exe-2");
    j.save(d);

    // Crash a second record mid-submit, then age the journal out.
    const aged = ExecutionJournal.load(d, () => NOW + 10_000);
    assert.equal(aged.get("exe-2")?.state, "SUBMITTED_UNKNOWN");
    const dropped = aged.pruneTerminal(NOW + 10_000, 3600);
    assert.equal(dropped, 1);
    assert.equal(aged.get("exe-1"), undefined);
    assert.equal(aged.get("exe-2")?.state, "SUBMITTED_UNKNOWN");
    aged.save(d);
    const reloaded = ExecutionJournal.load(d, () => NOW + 10_000);
    assert.equal(reloaded.get("exe-1"), undefined);
    assert.equal(reloaded.get("exe-2")?.state, "SUBMITTED_UNKNOWN");
  });

  it("invalid transitions and duplicate ids fail closed", () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    j.prepare(base());
    assert.throws(() => j.prepare(base()), /duplicate|exists/i);
    assert.throws(() => j.succeed("exe-1", "x"), /transition/i);
    assert.equal(j.get("nope"), undefined);
    assert.throws(() => j.authorize("nope"), /unknown/i);
    assert.throws(
      () =>
        j.prepare({ ...base(), executionId: "" }),
      /executionId/i
    );
    assert.throws(
      () => j.prepare({ ...base(), executionId: "exe-2", idempotencyKey: "" }),
      /idempotencyKey/i
    );
  });

  it("corrupt files and CAS conflicts fail closed, never last-write-wins", () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    j.prepare(base());
    j.save(d);
    writeFileSync(join(d, "executions.json"), "{broken", "utf8");
    assert.throws(() => ExecutionJournal.load(d, () => NOW), /corrupt/i);
    writeFileSync(
      join(d, "executions.json"),
      JSON.stringify({ revision: "seven", records: {} }),
      "utf8"
    );
    assert.throws(() => ExecutionJournal.load(d, () => NOW), /corrupt/i);

    // A well-formed handle that finds a revision-mangled file at save time
    // reports corruption, not a CAS conflict.
    const d3 = dir();
    const h = ExecutionJournal.load(d3, () => NOW);
    h.prepare(base());
    h.save(d3);
    writeFileSync(
      join(d3, "executions.json"),
      JSON.stringify({ revision: "seven", records: {} }),
      "utf8"
    );
    assert.throws(() => h.save(d3), /corrupt/i);

    const d2 = dir();
    const a = ExecutionJournal.load(d2, () => NOW);
    a.prepare(base());
    a.save(d2);
    const b = ExecutionJournal.load(d2, () => NOW);
    a.authorize("exe-1");
    a.save(d2);
    b.authorize("exe-1");
    assert.throws(() => b.save(d2), /changed under us/i);
  });

  it("records carry a fixed field set (no room for secrets by construction)", () => {
    const d = dir();
    const j = ExecutionJournal.load(d, () => NOW);
    const rec = j.prepare(base());
    assert.deepEqual(Object.keys(rec).sort(), [
      "attempts",
      "capabilityId",
      "createdAt",
      "executionId",
      "idempotencyKey",
      "state",
      "termsDigest",
      "updatedAt",
    ]);
  });
});
