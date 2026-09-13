import { createHash } from "node:crypto";
import { canonicalize } from "../core/canonical.js";

/**
 * Merkle-root audit anchor (v04/05).
 * Lineage: Merkle 1988 hash trees → Crosby–Wallach history trees → CT
 * RFC 6962/9162 at Internet scale; lightweight log pipeline without a ledger
 * per Yağız et al. arXiv:2605.00065 (Merkle root + trusted anchor,
 * O(log n) inclusion, 1 hash). v04 anchors to a checkpoint file the operator
 * keeps; no blockchain, no witness network.
 */

function H(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function leafHash(canonicalEntry: string): string {
  return H(`leaf:${canonicalEntry}`);
}

function nodeHash(left: string, right: string): string {
  return H(`node:${left}${right}`);
}

/** Merkle root over canonical entries (empty log → empty string, no fake root). */
export function merkleRoot(canonicalEntries: readonly string[]): string {
  if (canonicalEntries.length === 0) return "";
  let level = canonicalEntries.map(leafHash);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as string;
      const right = i + 1 < level.length ? (level[i + 1] as string) : left;
      next.push(nodeHash(left, right));
    }
    level = next;
  }
  return level[0] as string;
}

export interface InclusionProof {
  readonly leaf: string;
  readonly leafIndex: number;
  readonly path: readonly {
    readonly sibling: string;
    readonly left: boolean;
  }[];
  readonly root: string;
  readonly count: number;
}

/** O(log n) inclusion proof for one entry. */
export function inclusionProof(
  canonicalEntries: readonly string[],
  index: number
): InclusionProof {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= canonicalEntries.length
  ) {
    throw new Error("anchor: leaf index out of range");
  }
  const leaf = leafHash(canonicalEntries[index] as string);
  const path: { sibling: string; left: boolean }[] = [];
  let level = canonicalEntries.map(leafHash);
  let idx = index;
  while (level.length > 1) {
    const isRight = idx % 2 === 1;
    const sibIdx = isRight ? idx - 1 : idx + 1 < level.length ? idx + 1 : idx;
    path.push({ sibling: level[sibIdx] as string, left: isRight });
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as string;
      const right = i + 1 < level.length ? (level[i + 1] as string) : left;
      next.push(nodeHash(left, right));
    }
    level = next;
    idx = Math.floor(idx / 2);
  }
  return {
    leaf,
    leafIndex: index,
    path,
    root: level[0] as string,
    count: canonicalEntries.length,
  };
}

/** Offline verify against a previously anchored root. */
export function verifyInclusion(proof: InclusionProof, root: string): boolean {
  if (proof.root !== root) return false;
  let acc = proof.leaf;
  for (const step of proof.path) {
    acc = step.left ? nodeHash(step.sibling, acc) : nodeHash(acc, step.sibling);
  }
  return acc === root;
}

export interface AnchorCheckpoint {
  readonly root: string;
  readonly count: number;
  readonly at: number;
}

/** Checkpoint value callers persist (file, print, third-party store). */
export function checkpoint(
  entries: readonly unknown[],
  at: number
): AnchorCheckpoint {
  const canonical = entries.map((e) => canonicalize(e));
  return { root: merkleRoot(canonical), count: canonical.length, at };
}

/** Consistency: checkpoint B must extend checkpoint A (same leaves prefix, larger count). */
export function verifyConsistency(
  earlier: AnchorCheckpoint,
  later: AnchorCheckpoint,
  earlierEntries: readonly unknown[],
  laterEntries: readonly unknown[]
): boolean {
  if (later.count < earlier.count) return false;
  if (
    earlierEntries.length < earlier.count ||
    laterEntries.length < later.count
  )
    return false;
  for (let i = 0; i < earlier.count; i++) {
    if (canonicalize(earlierEntries[i]) !== canonicalize(laterEntries[i]))
      return false;
  }
  const recomputedEarlier = checkpoint(
    earlierEntries.slice(0, earlier.count),
    earlier.at
  );
  const recomputedLater = checkpoint(
    laterEntries.slice(0, later.count),
    later.at
  );
  return (
    recomputedEarlier.root === earlier.root &&
    recomputedLater.root === later.root
  );
}
