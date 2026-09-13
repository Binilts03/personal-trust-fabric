import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Audit,
  auditEntryToInterop,
  inclusionProof,
  merkleRoot,
  verifyInteropAnchor,
  verifyInteropChain,
} from "../src/index.js";

const NOW = 1_700_000_000;

function threeRecords() {
  const audit = new Audit(() => NOW);
  const e0 = audit.append({
    actor: "alice",
    action: "grant",
    authorityId: "g1",
  });
  const e1 = audit.append({
    actor: "alice",
    action: "approve",
    authorityId: "a1",
  });
  const e2 = audit.append({
    actor: "agent",
    action: "execute",
    capabilityId: "c1",
  });
  return { audit, records: [e0, e1, e2].map(auditEntryToInterop) };
}

describe("audit interop projection (pivot/06)", () => {
  it("projects with unique jti + intact prev linkage; tamper fails", () => {
    const { records } = threeRecords();
    assert.equal(new Set(records.map((r) => r.jti)).size, 3);
    assert.equal(records[1]?.prev, records[0]?.jti);
    assert.deepEqual(verifyInteropChain(records), { ok: true });

    const tampered = records.map((r) => ({ ...r }));
    (tampered[1] as { action: string }).action = "forged";
    const bad = verifyInteropChain(tampered);
    assert.deepEqual(bad, { ok: false, reason: "hash", atSeq: 1 });
  });

  it("keyed chains are opaque to third parties; anchor verifies offline", () => {
    const keyed = new Audit(() => NOW, { hmacKey: new Uint8Array(16).fill(7) });
    const k0 = keyed.append({ actor: "alice", action: "grant" });
    assert.deepEqual(
      verifyInteropChain([auditEntryToInterop(k0)], { keyed: true }),
      { ok: false, reason: "keyed" }
    );

    const audit = new Audit(() => NOW);
    const entries = [
      audit.append({ actor: "alice", action: "one" }),
      audit.append({ actor: "alice", action: "two" }),
    ];
    const canonical = audit.toJSONL().trim().split("\n");
    const root = merkleRoot(canonical);
    const proof = inclusionProof(canonical, 1);
    assert.equal(verifyInteropAnchor(proof, root), true);
    assert.equal(verifyInteropAnchor(proof, `dead${root}`), false);
    assert.equal(entries.length, 2);
  });

  it("empty log is vacuous ok:true (callers must check anchored count)", () => {
    assert.deepEqual(verifyInteropChain([]), { ok: true });
  });

  it("per-reason asserts: seq, prev, hash, jti, shape each report reason+atSeq", () => {
    const { records } = threeRecords();

    const badSeq = records.map((r) => ({ ...r }));
    (badSeq[1] as { seq: number }).seq = 5;
    assert.deepEqual(verifyInteropChain(badSeq), {
      ok: false,
      reason: "seq",
      atSeq: 5,
    });

    const badPrev = records.map((r) => ({ ...r }));
    (badPrev[1] as { prev: string }).prev = "00".repeat(32);
    assert.deepEqual(verifyInteropChain(badPrev), {
      ok: false,
      reason: "prev",
      atSeq: 1,
    });

    const badHash = records.map((r) => ({ ...r }));
    (badHash[1] as { action: string }).action = "forged";
    assert.deepEqual(verifyInteropChain(badHash), {
      ok: false,
      reason: "hash",
      atSeq: 1,
    });

    const dupJti = records.map((r) => ({ ...r }));
    (dupJti[1] as { jti: string }).jti = (records[0] as { jti: string }).jti;
    assert.deepEqual(verifyInteropChain(dupJti), {
      ok: false,
      reason: "jti",
      atSeq: 1,
    });

    // Structural failures report shape with atSeq = log index (never throw).
    const nullRecord = [...records];
    (nullRecord as unknown[])[1] = null;
    assert.deepEqual(verifyInteropChain(nullRecord), {
      ok: false,
      reason: "shape",
      atSeq: 1,
    });
    const numericJti = records.map((r) => ({ ...r }));
    (numericJti[0] as unknown as { jti: unknown }).jti = 42;
    assert.deepEqual(verifyInteropChain(numericJti), {
      ok: false,
      reason: "shape",
      atSeq: 0,
    });
    assert.deepEqual(verifyInteropChain("not-an-array" as unknown as never), {
      ok: false,
      reason: "shape",
    });
  });

  it("duplicate-jti fork fails as jti (forked sibling reusing settled jti)", () => {
    const { records } = threeRecords();
    // Fork: a second record at seq 1 reuses the settled jti of seq 0 with
    // intact prev linkage — the duplicate is caught before hash recompute.
    const forked = [records[0], { ...records[1] }];
    (forked[1] as { jti: string }).jti = (records[0] as { jti: string }).jti;
    assert.deepEqual(verifyInteropChain(forked as typeof records), {
      ok: false,
      reason: "jti",
      atSeq: 1,
    });
  });

  it("keyed-without-flag reports hash (callers must pass {keyed:true})", () => {
    const keyed = new Audit(() => NOW, { hmacKey: new Uint8Array(16).fill(7) });
    const k0 = keyed.append({ actor: "alice", action: "grant" });
    // Without the flag the HMAC entry looks like tamper — documented `hash`,
    // not `keyed`. Callers holding keyed logs must pass {keyed:true} for the
    // explicit refusal.
    assert.deepEqual(verifyInteropChain([auditEntryToInterop(k0)]), {
      ok: false,
      reason: "hash",
      atSeq: 0,
    });
    assert.deepEqual(
      verifyInteropChain([auditEntryToInterop(k0)], { keyed: true }),
      { ok: false, reason: "keyed" }
    );
  });

  it("anchor path-folding: mutated leaf/sibling/flipped left/different-log proof must fail", () => {
    const audit = new Audit(() => NOW);
    for (const action of ["one", "two", "three", "four"]) {
      audit.append({ actor: "alice", action });
    }
    const canonical = audit.toJSONL().trim().split("\n");
    const root = merkleRoot(canonical);
    const proof = inclusionProof(canonical, 1);
    assert.equal(verifyInteropAnchor(proof, root), true);

    assert.equal(
      verifyInteropAnchor({ ...proof, leaf: "00".repeat(32) }, root),
      false
    );
    const sib0 = proof.path[0];
    assert.ok(sib0 !== undefined);
    assert.equal(
      verifyInteropAnchor(
        {
          ...proof,
          path: [{ ...sib0, sibling: "ff".repeat(32) }, ...proof.path.slice(1)],
        },
        root
      ),
      false
    );
    assert.equal(
      verifyInteropAnchor(
        {
          ...proof,
          path: [{ ...sib0, left: !sib0.left }, ...proof.path.slice(1)],
        },
        root
      ),
      false
    );
    const other = new Audit(() => NOW + 1);
    other.append({ actor: "bob", action: "other" });
    other.append({ actor: "bob", action: "entries" });
    const otherCanonical = other.toJSONL().trim().split("\n");
    const otherProof = inclusionProof(otherCanonical, 0);
    assert.equal(verifyInteropAnchor(otherProof, root), false);
    assert.equal(verifyInteropAnchor(proof, `dead${root}`), false);
    // Malformed proofs fail closed (false, never throw).
    assert.equal(
      verifyInteropAnchor(null as unknown as typeof proof, root),
      false
    );
    assert.equal(
      verifyInteropAnchor({} as unknown as typeof proof, root),
      false
    );
    assert.equal(
      verifyInteropAnchor(
        { ...proof, path: null as unknown as typeof proof.path },
        root
      ),
      false
    );
    assert.equal(verifyInteropAnchor(proof, ""), false);
  });

  it("entryToInterop throw paths (fail-closed, never TypeError)", () => {
    const { audit } = threeRecords();
    const good = audit.append({ actor: "alice", action: "grant" });
    assert.throws(
      () => auditEntryToInterop(null as unknown as typeof good),
      /audit-interop:/
    );
    assert.throws(
      () => auditEntryToInterop({ ...good, seq: -1 }),
      /audit-interop:/
    );
    assert.throws(
      () => auditEntryToInterop({ ...good, seq: 1.5 }),
      /audit-interop:/
    );
    // Numeric hash bypasses naive .length checks — typeof guard throws.
    assert.throws(
      () =>
        auditEntryToInterop({
          ...good,
          hash: 42 as unknown as string,
        }),
      /audit-interop:/
    );
    assert.throws(
      () => auditEntryToInterop({ ...good, hash: "short" }),
      /audit-interop:/
    );
    assert.throws(
      () => auditEntryToInterop({ ...good, prevHash: "" }),
      /audit-interop:/
    );
    assert.throws(
      () =>
        auditEntryToInterop({
          ...good,
          prevHash: 7 as unknown as string,
        }),
      /audit-interop:/
    );
    assert.throws(
      () => auditEntryToInterop({ ...good, at: NaN }),
      /audit-interop:/
    );
    assert.throws(
      () =>
        auditEntryToInterop({
          ...good,
          at: "now" as unknown as number,
        }),
      /audit-interop:/
    );
    assert.throws(
      () => auditEntryToInterop({ ...good, actor: "" }),
      /audit-interop:/
    );
    assert.throws(
      () =>
        auditEntryToInterop({
          ...good,
          actor: 7 as unknown as string,
        }),
      /audit-interop:/
    );
    assert.throws(
      () => auditEntryToInterop({ ...good, action: "" }),
      /audit-interop:/
    );
    assert.throws(
      () =>
        auditEntryToInterop({
          ...good,
          authorityId: 7 as unknown as string,
        }),
      /audit-interop:/
    );
  });
});
