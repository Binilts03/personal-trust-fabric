import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentAuthenticator,
  AgentDirectory,
  Authority,
  generateEd25519Keypair,
  paymentBounds,
  signBytes,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:principal";
const A = "did:test:agent-a";
const B = "did:test:agent-b";

function dir() {
  return mkdtempSync(join(tmpdir(), "ptf-agents-"));
}

function registered(dirPath: string, now: number = NOW) {
  const directory = AgentDirectory.load(dirPath, () => now);
  const a = generateEd25519Keypair();
  const b = generateEd25519Keypair();
  directory.register({ agentId: A, principal: P, publicKey: a.publicKeyRaw });
  directory.register({ agentId: B, principal: P, publicKey: b.publicKeyRaw });
  directory.save(dirPath);
  return { directory, a, b };
}

describe("authenticated agent ingress (prod)", () => {
  it("challenge-response derives the actor from the key, never the request", () => {
    const d = dir();
    const { directory, a } = registered(d);
    const auth = new AgentAuthenticator(directory, () => NOW);
    const { challengeId, challenge } = auth.challenge(A);
    const ingress = auth.verify({
      agentId: A,
      challengeId,
      sig: signBytes(a.privateKey, challenge),
    });
    assert.equal(ingress.id, A);
    assert.equal(ingress.principal, P);
    assert.equal(ingress.source, "local-registration");
    assert.ok(ingress.proofRef.length > 0);

    // There is no request.actor input at all: the signature decides the
    // actor, so a caller claiming to be someone else still gets the
    // key-bound identity.
    const { challengeId: cid2, challenge: ch2 } = auth.challenge(A);
    const derived = auth.verify({ agentId: A, challengeId: cid2, sig: signBytes(a.privateKey, ch2) });
    assert.equal(derived.id, A);
    assert.notEqual(derived.id, "did:test:attacker");
  });

  it("Agent A offboards, Agent B carries on under the same grant", () => {
    const d = dir();
    const { directory, a, b } = registered(d);
    const auth = new AgentAuthenticator(directory, () => NOW);
    const authority = new Authority({ nowSec: () => NOW });
    authority.addGrant({
      id: "g-shared",
      principal: P,
      actor: { kind: "set", ids: [A, B] },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 3600,
      maxUses: 10,
    });
    const op = {
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "inv-1" },
      context: { amount: 100, currency: "INR", recipient: "did:test:m" },
      purpose: "personal",
    };
    const login = (
      agentId: string,
      priv: { privateKey: Parameters<typeof signBytes>[0] }
    ) => {
      const c = auth.challenge(agentId);
      return auth.verify({ agentId, challengeId: c.challengeId, sig: signBytes(priv.privateKey, c.challenge) });
    };
    assert.equal(authority.evaluate(op, login(A, a)).allow, true);
    assert.equal(authority.evaluate(op, login(B, b)).allow, true);

    // A is removed: authentication denies, but the user-owned authority is
    // untouched and B is unaffected.
    directory.revoke(A);
    assert.throws(() => auth.challenge(A), /revoked/i);
    assert.equal(authority.evaluate(op, login(B, b)).allow, true);
  });

  it("unknown, revoked, expired, replayed, and forged logins all deny", () => {
    const d = dir();
    const { directory, a, b } = registered(d);
    let t = NOW;
    const auth = new AgentAuthenticator(directory, () => t);
    assert.throws(
      () => auth.challenge("did:test:ghost"),
      /unknown|not registered/i
    );
    const { challengeId, challenge } = auth.challenge(A);
    const sig = signBytes(a.privateKey, challenge);
    // Replay: the challenge is single-use — first verify burns it.
    assert.ok(auth.verify({ agentId: A, challengeId, sig }).id);
    assert.throws(
      () => auth.verify({ agentId: A, challengeId, sig }),
      /unknown|expired|consumed|replay/i
    );
    // Expiry: move past the 120s TTL.
    const c2 = auth.challenge(A);
    t += 1000;
    assert.throws(
      () =>
        auth.verify({
          agentId: A,
          challengeId: c2.challengeId,
          sig: signBytes(a.privateKey, c2.challenge),
        }),
      /expired/i
    );
    // Forgery: wrong key over a live challenge.
    const other = generateEd25519Keypair();
    const c3 = auth.challenge(A);
    assert.throws(
      () =>
        auth.verify({
          agentId: A,
          challengeId: c3.challengeId,
          sig: signBytes(other.privateKey, c3.challenge),
        }),
      /signature|proof/i
    );
    // Revocation between challenge and verify denies at verify time.
    const c4 = auth.challenge(B);
    directory.revoke(B);
    assert.throws(
      () =>
        auth.verify({
          agentId: B,
          challengeId: c4.challengeId,
          sig: signBytes(b.privateKey, c4.challenge),
        }),
      /revoked/i
    );
    // Revocation closes both challenge and verify.
    directory.revoke(A);
    assert.throws(() => auth.challenge(A), /revoked/i);
  });

  it("registry is durable: revocation survives restart; corrupt/CAS fail closed", () => {
    const d = dir();
    const { directory } = registered(d);
    directory.revoke(A);
    directory.save(d);
    const reloaded = AgentDirectory.load(d, () => NOW);
    assert.equal(reloaded.get(A)?.revoked, true);
    assert.equal(reloaded.get(B)?.revoked, false);
    const auth = new AgentAuthenticator(reloaded, () => NOW);
    assert.throws(() => auth.challenge(A), /revoked/i);

    writeFileSync(join(d, "agents.json"), "{broken", "utf8");
    assert.throws(() => AgentDirectory.load(d, () => NOW), /corrupt/i);

    const d2 = dir();
    const x = AgentDirectory.load(d2, () => NOW);
    const kp = generateEd25519Keypair();
    x.register({ agentId: A, principal: P, publicKey: kp.publicKeyRaw });
    x.save(d2);
    const y = AgentDirectory.load(d2, () => NOW);
    const kp2 = generateEd25519Keypair();
    x.register({ agentId: B, principal: P, publicKey: kp2.publicKeyRaw });
    x.save(d2);
    const kp3 = generateEd25519Keypair();
    y.register({ agentId: "did:test:c", principal: P, publicKey: kp3.publicKeyRaw });
    assert.throws(() => y.save(d2), /changed under us/i);
  });

  it("registration validates shape; retired aliases stay retired", () => {
    const d = dir();
    const directory = AgentDirectory.load(d, () => NOW);
    const kp = generateEd25519Keypair();
    assert.throws(
      () => directory.register({ agentId: "", principal: P, publicKey: kp.publicKeyRaw }),
      /agentId/i
    );
    assert.throws(
      () =>
        directory.register({
          agentId: A,
          principal: P,
          publicKey: new Uint8Array([1, 2, 3]),
        }),
      /publicKey/i
    );
    directory.register({ agentId: A, principal: P, publicKey: kp.publicKeyRaw });
    assert.throws(
      () =>
        directory.register({
          agentId: A,
          principal: P,
          publicKey: generateEd25519Keypair().publicKeyRaw,
        }),
      /exists|registered/i
    );
    directory.revoke(A);
    assert.throws(
      () =>
        directory.register({
          agentId: A,
          principal: P,
          publicKey: generateEd25519Keypair().publicKeyRaw,
        }),
      /retired|revoked/i
    );
  });

  it("pending challenges are capped fail-closed (anti-fill)", () => {
    const d = dir();
    const { directory } = registered(d);
    const auth = new AgentAuthenticator(directory, () => NOW, {
      maxPending: 2,
    });
    auth.challenge(A);
    auth.challenge(B);
    assert.throws(() => auth.challenge(A), /cap|pending/i);
  });
});
