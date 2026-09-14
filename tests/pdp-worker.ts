import { loadAuthority } from "../src/index.js";
import type { AuthorityOperation, VerifiedIdentity } from "../src/index.js";

/**
 * Cross-process PDP worker (ticket 11 follow-through, ingress model tickets
 * 15+16). Loads ONE shared file-backed authority store and evaluates exactly
 * one identity-free operation under one verified ingress. No shared memory
 * with the parent or sibling workers: separate V8 isolate per call.
 * Usage: node pdp-worker.js <storeDir> <nowSec> <operationJson> <ingressJson>
 * Prints one JSON line {allow, reason?, detail?}. Exit 0 on decision,
 * exit 2 on transport errors (missing store, malformed input).
 */
function fail(message: string): never {
  process.stderr.write(`pdp-worker: ${message}\n`);
  process.exit(2);
}

const dir = process.argv[2];
const nowSecRaw = process.argv[3];
const operationJson = process.argv[4];
const ingressJson = process.argv[5];
if (dir === undefined || dir.length === 0) fail("storeDir required");
if (nowSecRaw === undefined || !/^\d+$/.test(nowSecRaw)) {
  fail("nowSec must be a non-negative epoch integer");
}
if (operationJson === undefined || operationJson.length === 0) {
  fail("operationJson required");
}
if (ingressJson === undefined || ingressJson.length === 0) {
  fail("ingressJson required");
}
const nowSec = Number.parseInt(nowSecRaw as string, 10);
let operation: AuthorityOperation;
let ingress: VerifiedIdentity;
try {
  operation = JSON.parse(operationJson as string) as AuthorityOperation;
} catch {
  fail("operationJson must be valid JSON");
  throw new Error("unreachable");
}
try {
  ingress = JSON.parse(ingressJson as string) as VerifiedIdentity;
} catch {
  fail("ingressJson must be valid JSON");
  throw new Error("unreachable");
}
let verdict: { readonly allow: boolean; readonly reason?: string };
try {
  const auth = loadAuthority(dir as string);
  const decision = auth.evaluate(operation, ingress, { nowSec });
  verdict = decision.allow
    ? { allow: true }
    : { allow: false, reason: decision.reason };
} catch (error) {
  fail(error instanceof Error ? error.message : "evaluation failed");
  throw new Error("unreachable");
}
process.stdout.write(`${JSON.stringify(verdict)}\n`);
