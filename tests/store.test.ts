import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  FileAuditLog,
  RecipientRegistry,
  generateEd25519Keypair,
  loadAuthority,
  loadRegistry,
  saveAuthority,
  saveRegistry,
  termsDigestOf,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:p";
const A = "did:test:a";
const M = "did:test:m";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "ptf-store-"));
}

describe("durable JSON stores (prod-01)", () => {
  it("authority decisions reproduce identically after a restart", () => {
    const dir = tmp();
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g1",
      principal: P,
      agent: A,
      cmd: "/pay",
      amountMax: 2000,
      currency: "INR",
      exp: NOW + 3600,
      maxUses: 2,
    });
    const digest = termsDigestOf({ i: 1 });
    const ask = {
      principal: P,
      agent: A,
      cmd: "/pay" as const,
      purpose: "p",
      resource: "r",
      recipient: M,
      amount: 100,
      currency: "INR",
      termsDigest: digest,
    };
    assert.equal(auth.evaluate(ask, { consume: true }).allow, true);
    saveAuthority(dir, auth);

    const reloaded = loadAuthority(dir, { nowSec: () => NOW });
    assert.equal(reloaded.evaluate(ask, { consume: true }).allow, true);
    const exhausted = reloaded.evaluate(ask, { consume: true });
    assert.equal(exhausted.allow, false);
    if (!exhausted.allow) assert.equal(exhausted.reason, "uses-exhausted");
  });

  it("registry bindings and history survive a restart", () => {
    const dir = tmp();
    const reg = new RecipientRegistry(() => NOW);
    const k1 = generateEd25519Keypair();
    const k2 = generateEd25519Keypair();
    reg.register(M, k1.publicKeyRaw);
    reg.rotate(M, k2.publicKeyRaw);
    saveRegistry(dir, reg);

    const reloaded = loadRegistry(dir, () => NOW);
    assert.deepEqual(reloaded.resolve(M), k2.publicKeyRaw);
    assert.equal((reloaded.history(M) ?? []).length, 2);
  });

  it("audit log appends and reloads with an intact chain", () => {
    const dir = tmp();
    const log = FileAuditLog.open(join(dir, "audit.jsonl"), () => NOW);
    log.append({ actor: A, action: "redeem", capabilityId: "cid-1" });
    log.append({ actor: "executor", action: "execute", capabilityId: "cid-1" });
    const reloaded = FileAuditLog.open(join(dir, "audit.jsonl"), () => NOW);
    assert.equal(reloaded.verifyChain(), true);
  });

  it("corrupt files fail closed, never partial", () => {
    const dir = tmp();
    writeFileSync(join(dir, "authority.json"), "{nope");
    assert.throws(() => loadAuthority(dir));
    writeFileSync(join(dir, "audit.jsonl"), '{"seq":0,\n');
    assert.throws(() => FileAuditLog.open(join(dir, "audit.jsonl")));
  });
});
