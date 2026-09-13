import { loadAuthority } from "../src/index.js";
import type { AuthorityRequest } from "../src/index.js";

/**
 * Cross-process PDP worker (ticket 11 follow-through). Loads ONE shared
 * file-backed authority store and evaluates exactly one demand. No shared
 * memory with the parent or sibling workers: separate V8 isolate per call.
 * Usage: node pdp-worker.js <storeDir> <nowSec> <demandJson>
 * Prints one JSON line {allow, reason?, detail?}. Exit 0 on decision,
 * exit 2 on transport errors (missing store, malformed input).
 */
function fail(message: string): never {
  process.stderr.write(`pdp-worker: ${message}\n`);
  process.exit(2);
}

const dir = process.argv[2];
const nowSecRaw = process.argv[3];
const demandJson = process.argv[4];
if (dir === undefined || dir.length === 0) fail("storeDir required");
if (nowSecRaw === undefined || !/^\d+$/.test(nowSecRaw)) {
  fail("nowSec must be a non-negative epoch integer");
}
if (demandJson === undefined || demandJson.length === 0) {
  fail("demandJson required");
}
const nowSec = Number.parseInt(nowSecRaw as string, 10);
let demand: AuthorityRequest;
try {
  demand = JSON.parse(demandJson as string) as AuthorityRequest;
} catch {
  fail("demandJson must be valid JSON");
  throw new Error("unreachable");
}
let verdict: { readonly allow: boolean; readonly reason?: string };
try {
  const auth = loadAuthority(dir as string);
  const decision = auth.evaluate(demand, { nowSec });
  verdict = decision.allow
    ? { allow: true }
    : { allow: false, reason: decision.reason };
} catch (error) {
  fail(error instanceof Error ? error.message : "evaluation failed");
  throw new Error("unreachable");
}
process.stdout.write(`${JSON.stringify(verdict)}\n`);
