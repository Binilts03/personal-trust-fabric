import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  Disclose,
  NonceStore,
  generateEd25519Keypair,
  loadAuthority,
  paymentBounds,
  saveAuthority,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:principal";
const A = "did:test:agent";
const HOSPITAL = "did:test:hospital-a";

function dir() {
  return mkdtempSync(join(tmpdir(), "ptf-replay-"));
}

describe("durable replay protection (prod)", () => {
  it("presentation -> restart -> replay nonce -> DENY", () => {
    const d = dir();
    const holder = generateEd25519Keypair();
    const pres = Disclose.present(
      {
        issuer: "did:test:ca",
        subject: "did:test:holder",
        claims: { ca_status: "active" },
        cnf: "did:test:holder",
      },
      { verifier: HOSPITAL, nonce: "nonce-restart-1", requested: ["ca_status"] },
      { recipient: HOSPITAL, allowed: ["ca_status"] },
      { id: "did:test:holder", privateKey: holder.privateKey },
      NOW
    );
    const verifyOpts = {
      holderKey: holder.publicKeyRaw,
      expectedAud: HOSPITAL,
      nowSec: NOW,
    };

    // First verify records the nonce; persist like a production verifier.
    const store = NonceStore.load(d, { nowSec: () => NOW });
    assert.equal(Disclose.verify(pres, { ...verifyOpts, usedNonces: store }).ok, true);
    store.save(d);

    // Restart: fresh handle over the same directory still rejects the replay.
    const reloaded = NonceStore.load(d, { nowSec: () => NOW });
    const replay = Disclose.verify(pres, { ...verifyOpts, usedNonces: reloaded });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "replay");

    // A fresh nonce still verifies through the reloaded store.
    const pres2 = Disclose.present(
      {
        issuer: "did:test:ca",
        subject: "did:test:holder",
        claims: { ca_status: "active" },
        cnf: "did:test:holder",
      },
      { verifier: HOSPITAL, nonce: "nonce-restart-2", requested: ["ca_status"] },
      { recipient: HOSPITAL, allowed: ["ca_status"] },
      { id: "did:test:holder", privateKey: holder.privateKey },
      NOW
    );
    assert.equal(
      Disclose.verify(pres2, { ...verifyOpts, usedNonces: reloaded }).ok,
      true
    );
  });

  it("authority consumption survives restart: second redeem denies", () => {
    const d = dir();
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-once",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 600,
      maxUses: 1,
    });
    saveAuthority(d, auth);
    const op = {
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "inv-1" },
      context: { amount: 100, currency: "INR", recipient: "did:test:m" },
      purpose: "personal",
    };
    const ingress = {
      id: A,
      principal: P,
      source: "local-registration" as const,
      proofRef: "replay-test",
    };
    const live = loadAuthority(d, { nowSec: () => NOW });
    assert.equal(live.evaluate(op, ingress, { consume: true }).allow, true);
    saveAuthority(d, live);

    // Restart: the burned use is durable, the replayed proof finds nothing.
    const restarted = loadAuthority(d, { nowSec: () => NOW });
    const again = restarted.evaluate(op, ingress, { consume: true });
    assert.equal(again.allow, false);
    if (!again.allow) assert.equal(again.reason, "uses-exhausted");
  });

  it("entries older than TTL prune on load; fresh entries survive", () => {
    const d = dir();
    const store = NonceStore.load(d, { nowSec: () => NOW, ttlSec: 600 });
    store.add("old-nonce");
    store.save(d);
    const aged = NonceStore.load(d, { nowSec: () => NOW + 3600, ttlSec: 600 });
    assert.equal(aged.has("old-nonce"), false);
    aged.add("fresh-nonce");
    aged.save(d);
    const reloaded = NonceStore.load(d, { nowSec: () => NOW + 3600, ttlSec: 600 });
    assert.equal(reloaded.has("fresh-nonce"), true);
  });

  it("corrupt files and CAS conflicts fail closed", () => {
    const d = dir();
    const store = NonceStore.load(d, { nowSec: () => NOW });
    store.add("n-1");
    store.save(d);
    writeFileSync(join(d, "nonces.json"), "{broken", "utf8");
    assert.throws(() => NonceStore.load(d, { nowSec: () => NOW }), /corrupt/i);

    const d2 = dir();
    const a = NonceStore.load(d2, { nowSec: () => NOW });
    a.add("n-1");
    a.save(d2);
    const b = NonceStore.load(d2, { nowSec: () => NOW });
    a.add("n-2");
    a.save(d2);
    b.add("n-3");
    assert.throws(() => b.save(d2), /changed under us/i);
  });
});
