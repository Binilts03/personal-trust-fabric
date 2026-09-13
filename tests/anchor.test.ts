import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  checkpoint,
  inclusionProof,
  merkleRoot,
  verifyConsistency,
  verifyInclusion,
} from "../src/index.js";

const AT = 1_700_000_000;

describe("audit anchor Merkle checkpoint (v04/05)", () => {
  it("empty log has empty root; single leaf proves itself", () => {
    assert.equal(merkleRoot([]), "");
    const entries = [{ n: 1 }];
    const canon = entries.map((e) => canonicalize(e));
    const cp = checkpoint(entries, AT);
    assert.equal(cp.count, 1);
    const proof = inclusionProof(canon, 0);
    assert.equal(proof.root, cp.root);
    assert.equal(verifyInclusion(proof, cp.root), true);
    assert.equal(verifyInclusion(proof, "00".repeat(32)), false);
  });

  it("tampered leaf fails inclusion; fork fails consistency", () => {
    const a = [{ n: 1 }, { n: 2 }];
    const b = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const fork = [{ n: 1 }, { n: 999 }];
    const cpa = checkpoint(a, AT);
    const cpb = checkpoint(b, AT + 1);
    const cpf = checkpoint(fork, AT + 1);
    assert.equal(verifyConsistency(cpa, cpb, a, b), true);
    assert.equal(verifyConsistency(cpa, cpf, a, fork), false);
    const canonB = b.map((e) => canonicalize(e));
    const proof = inclusionProof(canonB, 2);
    assert.equal(verifyInclusion(proof, cpb.root), true);
    const tampered = { ...proof, leaf: "ff".repeat(32) };
    assert.equal(verifyInclusion(tampered, cpb.root), false);
  });
});
