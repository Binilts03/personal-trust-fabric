import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  Authority,
  digestForOperation,
  loadAuthority,
  paymentBounds,
  saveAuthority,
} from "../src/index.js";

// Cross-PROCESS proof (ticket 11 follow-through): one shared file-backed
// authority store evaluated by three separate OS processes (separate V8
// isolates, no shared memory). Replaceable Agents A/B allow, an
// unauthenticated attacker denies on the identical demand, and one central
// revoke flips every process to deny. Genuine cross-process independence;
// cross-VENDOR (real broker, real AP2 party, separate hosts) remains future.
const NOW = 1789257600;
const EXP = 1790812740;
const PRINCIPAL = "did:test:traveler";
const AGENT_A = "did:test:agent-a";
const AGENT_B = "did:test:agent-b";
const ATTACKER = "did:attacker:anything";
const MERCHANT = "did:test:airline";

const WORKER = fileURLToPath(new URL("./pdp-worker.js", import.meta.url));

function seedStore(): string {
  const dir = mkdtempSync(join(tmpdir(), "ptf-three-process-"));
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "travel-domestic-economy",
    principal: PRINCIPAL,
    actor: { kind: "set", ids: [AGENT_A, AGENT_B] },
    action: { name: "/pay" },
    purpose: "book domestic economy flight",
    resource: { type: "flight", id: "flight:domestic:economy" },
    bounds: paymentBounds({ amountMax: 15000, currency: "INR" }),
    exp: EXP,
  });
  saveAuthority(dir, auth);
  return dir;
}

function demandFor(agent: string, amount: number): string {
  const operation = {
    principal: PRINCIPAL,
    actor: agent,
    action: { name: "/pay" as const },
    resource: { type: "flight", id: "flight:domestic:economy" },
    context: { amount, currency: "INR", recipient: MERCHANT },
    purpose: "book domestic economy flight",
  };
  return JSON.stringify({
    ...operation,
    termsDigest: digestForOperation(operation),
  });
}

function evaluateInFreshProcess(
  dir: string,
  agent: string,
  amount: number
): { readonly allow: boolean; readonly reason?: string } {
  const out = execFileSync(
    process.execPath,
    [WORKER, dir, String(NOW), demandFor(agent, amount)],
    { encoding: "utf8", timeout: 30000 }
  );
  return JSON.parse(out) as {
    readonly allow: boolean;
    readonly reason?: string;
  };
}

describe("three separate processes, one shared store (ticket 11)", () => {
  it("A and B allow in fresh processes; attacker denies on the identical demand", () => {
    const dir = seedStore();
    assert.deepEqual(evaluateInFreshProcess(dir, AGENT_A, 12000), {
      allow: true,
    });
    assert.deepEqual(evaluateInFreshProcess(dir, AGENT_B, 12000), {
      allow: true,
    });
    assert.deepEqual(evaluateInFreshProcess(dir, ATTACKER, 12000), {
      allow: false,
      reason: "no-authority",
    });
  });

  it("one central revoke flips every fresh process to deny", () => {
    const dir = seedStore();
    assert.deepEqual(evaluateInFreshProcess(dir, AGENT_A, 12000), {
      allow: true,
    });
    // Revoke through an independent handle on the same store file.
    const handle = loadAuthority(dir, { nowSec: () => NOW });
    handle.revoke("travel-domestic-economy", EXP);
    saveAuthority(dir, handle);
    assert.deepEqual(evaluateInFreshProcess(dir, AGENT_A, 12000), {
      allow: false,
      reason: "revoked",
    });
    assert.deepEqual(evaluateInFreshProcess(dir, AGENT_B, 12000), {
      allow: false,
      reason: "revoked",
    });
  });
});
