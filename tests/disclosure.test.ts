import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Disclose,
  canonicalize,
  generateEd25519Keypair,
} from "../src/index.js";

const ISSUER = "did:test:ca-authority";
const HOLDER = "did:test:holder";
const HOSPITAL = "did:test:hospital-a";
const ATTACKER = "did:test:attacker";
const NOW = 1_700_000_000;

function keys() {
  const holder = generateEd25519Keypair();
  const other = generateEd25519Keypair();
  return { holder, other };
}

function credential() {
  return {
    issuer: ISSUER,
    subject: HOLDER,
    claims: {
      ca_status: "active",
      age_over_18: true,
      certificate_no: "CA-12345",
      full_name: "Binil Test",
      address: "Kerala",
      income: 900000,
      passport: "X123",
      tax_id: "T-9",
      license: "L-1",
      membership: "gold",
    },
    cnf: HOLDER,
  };
}

describe("selective disclosure with holder binding (ptf-v01/03)", () => {
  it("discloses exactly requested ∩ available ∩ allowed", () => {
    const { holder } = keys();
    const pres = Disclose.present(
      credential(),
      {
        verifier: HOSPITAL,
        nonce: "n-1",
        requested: ["ca_status", "age_over_18", "passport", "nope"],
      },
      { recipient: HOSPITAL, allowed: ["ca_status", "age_over_18"] },
      { id: HOLDER, privateKey: holder.privateKey },
      NOW
    );
    assert.deepEqual(pres.disclosures.map((d) => d.name).sort(), [
      "age_over_18",
      "ca_status",
    ]);
    const blob = canonicalize(pres);
    assert.ok(
      !blob.includes("X123") &&
        !blob.includes("CA-12345") &&
        !blob.includes("Kerala")
    );
  });

  it("rejects bearer presentations and wrong-key signatures", () => {
    const { holder, other } = keys();
    const pres = Disclose.present(
      credential(),
      { verifier: HOSPITAL, nonce: "n-2", requested: ["ca_status"] },
      { recipient: HOSPITAL, allowed: ["ca_status"] },
      { id: HOLDER, privateKey: holder.privateKey },
      NOW
    );
    const bearer = { ...pres, sig: new Uint8Array(0) };
    assert.equal(
      Disclose.verify(bearer, {
        holderKey: holder.publicKeyRaw,
        expectedAud: HOSPITAL,
        nowSec: NOW,
      }).ok,
      false
    );
    const forged = Disclose.verify(pres, {
      holderKey: other.publicKeyRaw,
      expectedAud: HOSPITAL,
      nowSec: NOW,
    });
    assert.equal(forged.ok, false);
    if (!forged.ok) assert.equal(forged.reason, "bad-signature");
    assert.equal(
      Disclose.verify(pres, {
        holderKey: holder.publicKeyRaw,
        expectedAud: HOSPITAL,
        nowSec: NOW,
      }).ok,
      true
    );
  });

  it("rejects wrong audience and stale presentations", () => {
    const { holder } = keys();
    const pres = Disclose.present(
      credential(),
      { verifier: HOSPITAL, nonce: "n-3", requested: ["ca_status"] },
      { recipient: HOSPITAL, allowed: ["ca_status"] },
      { id: HOLDER, privateKey: holder.privateKey },
      NOW
    );
    const wrongAud = Disclose.verify(pres, {
      holderKey: holder.publicKeyRaw,
      expectedAud: ATTACKER,
      nowSec: NOW,
    });
    assert.equal(wrongAud.ok, false);
    if (!wrongAud.ok) assert.equal(wrongAud.reason, "audience");
    const stale = Disclose.verify(pres, {
      holderKey: holder.publicKeyRaw,
      expectedAud: HOSPITAL,
      nowSec: NOW + 3600,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.reason, "stale");
  });

  it("pins the holder to the credential cnf", () => {
    const { holder } = keys();
    assert.throws(() =>
      Disclose.present(
        credential(),
        { verifier: HOSPITAL, nonce: "n-4", requested: ["ca_status"] },
        { recipient: HOSPITAL, allowed: ["ca_status"] },
        { id: ATTACKER, privateKey: holder.privateKey },
        NOW
      )
    );
  });

  it("binds credential expiry into the presentation and enforces it at verify", () => {
    const { holder } = keys();
    const pres = Disclose.present(
      { ...credential(), exp: NOW + 120 },
      { verifier: HOSPITAL, nonce: "n-5", requested: ["ca_status"] },
      { recipient: HOSPITAL, allowed: ["ca_status"] },
      { id: HOLDER, privateKey: holder.privateKey },
      NOW
    );
    assert.equal(pres.credExp, NOW + 120);
    assert.equal(
      Disclose.verify(pres, {
        holderKey: holder.publicKeyRaw,
        expectedAud: HOSPITAL,
        nowSec: NOW,
      }).ok,
      true
    );
    const expired = Disclose.verify(pres, {
      holderKey: holder.publicKeyRaw,
      expectedAud: HOSPITAL,
      nowSec: NOW + 200,
    });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, "expired");
  });

  it("denies presentation replay when the host tracks nonces", () => {
    const { holder } = keys();
    const pres = Disclose.present(
      credential(),
      { verifier: HOSPITAL, nonce: "n-6", requested: ["ca_status"] },
      { recipient: HOSPITAL, allowed: ["ca_status"] },
      { id: HOLDER, privateKey: holder.privateKey },
      NOW
    );
    const seen = new Set<string>();
    const base = {
      holderKey: holder.publicKeyRaw,
      expectedAud: HOSPITAL,
      nowSec: NOW,
      usedNonces: seen,
    };
    assert.equal(Disclose.verify(pres, base).ok, true);
    const replay = Disclose.verify(pres, base);
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "replay");
  });
});
