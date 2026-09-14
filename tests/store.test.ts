import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  FileAuditLog,
  RecipientRegistry,
  generateEd25519Keypair,
  loadAuthority,
  loadRegistry,
  paymentBounds,
  saveAuthority,
  saveRegistry,
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
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
      maxUses: 2,
    });
    const operation = {
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "r" },
      context: { amount: 100, currency: "INR", recipient: M },
      purpose: "p",
    };
    const ingress = {
      id: A,
      principal: P,
      source: "local-registration",
      proofRef: "store-test",
    } as const;
    assert.equal(
      auth.evaluate(operation, { ...ingress }, { consume: true }).allow,
      true
    );
    saveAuthority(dir, auth);

    const reloaded = loadAuthority(dir, { nowSec: () => NOW });
    assert.equal(
      reloaded.evaluate(operation, { ...ingress }, { consume: true }).allow,
      true
    );
    const exhausted = reloaded.evaluate(
      operation,
      { ...ingress },
      { consume: true }
    );
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

  it("concurrent authority writers fail closed — never lost-update (ticket 02)", () => {
    const dir = tmp();
    const seed = new Authority({ nowSec: () => NOW });
    seed.addGrant({
      id: "g1",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
    });
    saveAuthority(dir, seed);

    // Two handles load the same revision; the first save wins.
    const a = loadAuthority(dir, { nowSec: () => NOW });
    const b = loadAuthority(dir, { nowSec: () => NOW });
    a.revoke("g1");
    saveAuthority(dir, a);
    b.addGrant({
      id: "g2",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 1, currency: "INR" }),
      exp: NOW + 3600,
    });
    assert.throws(() => saveAuthority(dir, b), /changed under us/);

    // Winner's revoke survived; loser's grant never landed (no half-state).
    const fresh = loadAuthority(dir, { nowSec: () => NOW });
    const operation = {
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "r" },
      context: { amount: 100, currency: "INR", recipient: M },
      purpose: "p",
    };
    const ingress = {
      id: A,
      principal: P,
      source: "local-registration",
      proofRef: "store-test",
    } as const;
    const denied = fresh.evaluate(operation, { ...ingress });
    assert.equal(denied.allow, false);
    if (!denied.allow) assert.equal(denied.reason, "revoked");

    // Reload-and-retry works: the loser reloads and saves cleanly.
    const b2 = loadAuthority(dir, { nowSec: () => NOW });
    b2.addGrant({
      id: "g2",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 1, currency: "INR" }),
      exp: NOW + 3600,
    });
    saveAuthority(dir, b2);
  });

  it("concurrent registry writers fail closed too (ticket 02)", () => {
    const dir = tmp();
    const seed = new RecipientRegistry(() => NOW);
    const k1 = generateEd25519Keypair();
    seed.register(M, k1.publicKeyRaw);
    saveRegistry(dir, seed);

    const a = loadRegistry(dir, () => NOW);
    const b = loadRegistry(dir, () => NOW);
    const k2 = generateEd25519Keypair();
    a.rotate(M, k2.publicKeyRaw);
    saveRegistry(dir, a);
    const k3 = generateEd25519Keypair();
    b.rotate(M, k3.publicKeyRaw);
    assert.throws(() => saveRegistry(dir, b), /changed under us/);
    assert.deepEqual(loadRegistry(dir, () => NOW).resolve(M), k2.publicKeyRaw);
  });

  it("fresh instances cannot overwrite an existing store; deleted stores fail closed (ticket 02)", () => {
    const dir = tmp();
    const seed = new Authority({ nowSec: () => NOW });
    seed.addGrant({
      id: "g1",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
    });
    saveAuthority(dir, seed);
    // A fresh instance that never loaded the file must not clobber it.
    assert.throws(() => saveAuthority(dir, new Authority()), /never loaded/);

    const reg = new RecipientRegistry(() => NOW);
    reg.register(M, generateEd25519Keypair().publicKeyRaw);
    saveRegistry(dir, reg);
    assert.throws(
      () => saveRegistry(dir, new RecipientRegistry(() => NOW)),
      /never loaded/
    );

    // A deleted store file never accepts a stale resurrection.
    const h = loadAuthority(dir, { nowSec: () => NOW });
    rmSync(join(dir, "authority.json"));
    h.revoke("g1");
    assert.throws(() => saveAuthority(dir, h), /store missing/);
  });
});
