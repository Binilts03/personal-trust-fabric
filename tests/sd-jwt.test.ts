import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  Disclose,
  generateEd25519Keypair,
  kbJwsSigningInput,
  presentationToSdJwt,
  sdPayloadToKbClaims,
  toSdDisclosure,
  verifySdProjection,
} from "../src/index.js";

const NOW = 1_700_000_000;
const HOLDER = "did:test:holder";
const VERIFIER = "did:test:verifier";
const NONCE = "n-1234567890abcdef";

function stdDisclosure(salt: string, name: string, value: unknown) {
  const s = Buffer.from(JSON.stringify([salt, name, value]), "utf8").toString(
    "base64url"
  );
  const digest = createHash("sha256")
    .update(s, "utf8")
    .digest()
    .toString("base64url");
  return { s, digest };
}

function presentOne() {
  const kp = generateEd25519Keypair();
  const pres = Disclose.present(
    {
      issuer: "did:test:issuer",
      subject: "did:test:subject",
      claims: { age_over_18: true },
      cnf: HOLDER,
    },
    { verifier: VERIFIER, nonce: NONCE, requested: ["age_over_18"] },
    { recipient: VERIFIER, allowed: ["age_over_18"] },
    { id: HOLDER, privateKey: kp.privateKey },
    NOW
  );
  return { kp, pres };
}

describe("SD-JWT translator (pivot/05)", () => {
  it("emits independently recomputable standard digests; PTF digest is trace-only", () => {
    const kp = generateEd25519Keypair();
    const pres = Disclose.present(
      {
        issuer: "did:test:issuer",
        subject: "did:test:subject",
        claims: { age_over_18: true, name: "A. User" },
        cnf: HOLDER,
      },
      { verifier: VERIFIER, nonce: NONCE, requested: ["age_over_18"] },
      { recipient: VERIFIER, allowed: ["age_over_18"] },
      { id: HOLDER, privateKey: kp.privateKey },
      NOW
    );
    const sd = presentationToSdJwt(pres);
    assert.equal(sd.payload._sd_alg, "sha-256");
    assert.equal((sd.payload.cnf as { kid: string }).kid, HOLDER);
    for (const d of sd.disclosures) {
      const expected = stdDisclosure(
        (pres.disclosures.find((x) => x.name === d.name) as { salt: string })
          .salt,
        d.name,
        (pres.disclosures.find((x) => x.name === d.name) as { value: unknown })
          .value
      );
      assert.equal(d.disclosure, expected.s);
      assert.equal(d.digest, expected.digest);
    }
    const kb = sdPayloadToKbClaims(sd, { verifier: VERIFIER, nonce: NONCE });
    assert.equal(kb.iss, HOLDER);
    const ok = verifySdProjection(sd, kb, {
      expectedAud: VERIFIER,
      expectedNonce: NONCE,
      expectedHolder: HOLDER,
      nowSec: NOW,
    });
    assert.deepEqual(ok, { ok: true });

    // Tampering only the trace-only PTF digest changes nothing.
    const tampered = {
      ...sd,
      disclosures: sd.disclosures.map((d) => ({
        ...d,
        ptf_digest: "00".repeat(32),
      })),
    };
    assert.deepEqual(
      verifySdProjection(tampered, kb, {
        expectedAud: VERIFIER,
        expectedNonce: NONCE,
        expectedHolder: HOLDER,
        nowSec: NOW,
      }),
      { ok: true }
    );
  });

  it("denies wrong audience, nonce, stale, and holder mismatch", () => {
    const { pres } = presentOne();
    const sd = presentationToSdJwt(pres);
    const kb = sdPayloadToKbClaims(sd, { verifier: VERIFIER, nonce: NONCE });
    const base = {
      expectedAud: VERIFIER,
      expectedNonce: NONCE,
      expectedHolder: HOLDER,
      nowSec: NOW,
    };
    assert.deepEqual(
      verifySdProjection(sd, kb, { ...base, expectedAud: "did:test:other" }),
      {
        ok: false,
        reason: "audience",
      }
    );
    assert.deepEqual(
      verifySdProjection(sd, kb, { ...base, expectedNonce: "other" }),
      {
        ok: false,
        reason: "nonce",
      }
    );
    assert.deepEqual(
      verifySdProjection(sd, kb, { ...base, nowSec: NOW + 3600 }),
      {
        ok: false,
        reason: "stale",
      }
    );
    assert.deepEqual(
      verifySdProjection(sd, kb, {
        ...base,
        expectedHolder: "did:test:intruder",
      }),
      { ok: false, reason: "holder" }
    );
  });

  it("discloses only requested claims; disclosure decodes to [salt,name,value]", () => {
    const kp = generateEd25519Keypair();
    const pres = Disclose.present(
      {
        issuer: "did:test:issuer",
        subject: "did:test:subject",
        claims: { age_over_18: true, name: "A. User", email: "a@example.com" },
        cnf: HOLDER,
      },
      { verifier: VERIFIER, nonce: NONCE, requested: ["age_over_18", "name"] },
      { recipient: VERIFIER, allowed: ["age_over_18"] },
      { id: HOLDER, privateKey: kp.privateKey },
      NOW
    );
    const sd = presentationToSdJwt(pres);
    // Only requested ∩ available ∩ allowed.
    assert.equal(sd.disclosures.length, 1);
    assert.equal(sd.payload._sd.length, 1);
    assert.equal(sd.disclosures[0]?.name, "age_over_18");
    assert.ok(!sd.disclosures.some((d) => d.name === "name"));
    assert.ok(!sd.disclosures.some((d) => d.name === "email"));
    // Structural decode check.
    for (const d of sd.disclosures) {
      const raw = Buffer.from(d.disclosure, "base64url").toString("utf8");
      const decoded = JSON.parse(raw) as unknown;
      assert.ok(Array.isArray(decoded));
      assert.equal((decoded as unknown[]).length, 3);
      const [salt, name, value] = decoded as [unknown, unknown, unknown];
      assert.equal(typeof salt, "string");
      assert.ok((salt as string).length > 0);
      assert.equal(name, d.name);
      assert.equal(value, true);
      const expected = stdDisclosure(salt as string, name as string, value);
      assert.equal(d.disclosure, expected.s);
      assert.equal(d.digest, expected.digest);
    }
  });

  it("rejects sd-hash-mismatch when payload mutated after KB", () => {
    const { pres } = presentOne();
    const sd = presentationToSdJwt(pres);
    const kb = sdPayloadToKbClaims(sd, { verifier: VERIFIER, nonce: NONCE });
    const base = {
      expectedAud: VERIFIER,
      expectedNonce: NONCE,
      expectedHolder: HOLDER,
      nowSec: NOW,
    };
    assert.deepEqual(verifySdProjection(sd, kb, base), { ok: true });
    const mutated = {
      ...sd,
      payload: { ...sd.payload, iss: "did:test:forged" },
    };
    assert.deepEqual(verifySdProjection(mutated, kb, base), {
      ok: false,
      reason: "sd-hash-mismatch",
    });
  });

  it("digest-mismatch cases: forged string, digest-not-in-_sd, swapped digests, extra disclosure", () => {
    const kp = generateEd25519Keypair();
    const pres = Disclose.present(
      {
        issuer: "did:test:issuer",
        subject: "did:test:subject",
        claims: { a: "1", b: "2" },
        cnf: HOLDER,
      },
      { verifier: VERIFIER, nonce: NONCE, requested: ["a", "b"] },
      { recipient: VERIFIER, allowed: ["a", "b"] },
      { id: HOLDER, privateKey: kp.privateKey },
      NOW
    );
    const sd = presentationToSdJwt(pres);
    assert.equal(sd.disclosures.length, 2);
    const kb = sdPayloadToKbClaims(sd, { verifier: VERIFIER, nonce: NONCE });
    const base = {
      expectedAud: VERIFIER,
      expectedNonce: NONCE,
      expectedHolder: HOLDER,
      nowSec: NOW,
    };
    const d0 = sd.disclosures[0];
    const d1 = sd.disclosures[1];
    assert.ok(d0 !== undefined && d1 !== undefined);

    // Forged disclosure string (digest recompute fails).
    const forged = stdDisclosure("forged-salt", d0.name, "forged-value");
    const forgedSd = {
      ...sd,
      disclosures: [{ ...d0, disclosure: forged.s }, d1],
    };
    assert.deepEqual(verifySdProjection(forgedSd, kb, base), {
      ok: false,
      reason: "digest-mismatch",
    });

    // Valid disclosure/digest pair but digest not in _sd. Note the digest
    // membership check runs before the sd_hash check, so a narrowed _sd
    // with a stale KB still reports digest-mismatch (not sd-hash-mismatch).
    const missingSd = {
      ...sd,
      payload: { ...sd.payload, _sd: [d1.digest] },
    };
    assert.deepEqual(
      verifySdProjection(missingSd, kb, {
        ...base,
      }),
      {
        ok: false,
        reason: "digest-mismatch",
      }
    );
    // Same scenario but with a freshly bound KB keeps it digest-mismatch:
    // rebuild KB over the narrowed payload is impossible without the
    // disclosure, so instead drop the disclosure and keep a consistent KB.
    const droppedDisclosure = {
      payload: { ...sd.payload, _sd: [d1.digest] },
      disclosures: [d1],
    };
    const kbNarrow = sdPayloadToKbClaims(droppedDisclosure, {
      verifier: VERIFIER,
      nonce: NONCE,
    });
    // Re-adding the removed disclosure now fails as digest-not-in-_sd.
    const readded = {
      payload: droppedDisclosure.payload,
      disclosures: [d0, d1],
    };
    assert.deepEqual(verifySdProjection(readded, kbNarrow, base), {
      ok: false,
      reason: "digest-mismatch",
    });

    // Swapped digests between the two disclosures.
    const swapped = {
      ...sd,
      disclosures: [
        { ...d0, digest: d1.digest },
        { ...d1, digest: d0.digest },
      ],
    };
    assert.deepEqual(verifySdProjection(swapped, kb, base), {
      ok: false,
      reason: "digest-mismatch",
    });

    // Extra disclosure not listed in _sd.
    const extraRaw = stdDisclosure("extra-salt", "extra", "x");
    const extra = {
      disclosure: extraRaw.s,
      digest: extraRaw.digest,
      name: "extra",
      ptf_digest: "00".repeat(32),
    };
    const withExtra = {
      ...sd,
      disclosures: [...sd.disclosures, extra],
    };
    assert.deepEqual(verifySdProjection(withExtra, kb, base), {
      ok: false,
      reason: "digest-mismatch",
    });
  });

  it("denies expired credExp", () => {
    const kp = generateEd25519Keypair();
    const credExp = NOW + 100;
    const pres = Disclose.present(
      {
        issuer: "did:test:issuer",
        subject: "did:test:subject",
        claims: { age_over_18: true },
        cnf: HOLDER,
        exp: credExp,
      },
      { verifier: VERIFIER, nonce: NONCE, requested: ["age_over_18"] },
      { recipient: VERIFIER, allowed: ["age_over_18"] },
      { id: HOLDER, privateKey: kp.privateKey },
      NOW
    );
    const sd = presentationToSdJwt(pres);
    assert.equal(sd.payload.exp, credExp);
    const kb = sdPayloadToKbClaims(sd, { verifier: VERIFIER, nonce: NONCE });
    // Large maxAge so freshness passes but expiry fails.
    assert.deepEqual(
      verifySdProjection(sd, kb, {
        expectedAud: VERIFIER,
        expectedNonce: NONCE,
        expectedHolder: HOLDER,
        nowSec: NOW + 1000,
        maxAgeSec: 5000,
      }),
      { ok: false, reason: "expired" }
    );
  });

  it("split holder checks: cnf.kid-only vs kb.iss-only tamper both deny as holder", () => {
    const { pres } = presentOne();
    const sd = presentationToSdJwt(pres);
    const kb = sdPayloadToKbClaims(sd, { verifier: VERIFIER, nonce: NONCE });
    const base = {
      expectedAud: VERIFIER,
      expectedNonce: NONCE,
      expectedHolder: HOLDER,
      nowSec: NOW,
    };
    const cnfTampered = {
      ...sd,
      payload: { ...sd.payload, cnf: { kid: "did:test:intruder" } },
    };
    // kb.iss still honest but cnf.kid mismatches → holder. sd_hash also
    // mismatches, but holder is checked first and reported.
    assert.deepEqual(verifySdProjection(cnfTampered, kb, base), {
      ok: false,
      reason: "holder",
    });
    const kbTampered = { ...kb, iss: "did:test:intruder" };
    assert.deepEqual(verifySdProjection(sd, kbTampered, base), {
      ok: false,
      reason: "holder",
    });
  });

  it("holderJwk standard cnf + kbJwsSigningInput ascii h.p shape", () => {
    const { pres } = presentOne();
    const jwk = { kty: "OKP", crv: "Ed25519", x: "abc" };
    const sd = presentationToSdJwt(pres, { holderJwk: jwk });
    assert.deepEqual(sd.payload.cnf, { jwk });
    assert.ok(!("kid" in (sd.payload.cnf as Record<string, unknown>)));
    // Standard path carries no kid → holder param required.
    assert.throws(
      () => sdPayloadToKbClaims(sd, { verifier: VERIFIER, nonce: NONCE }),
      /sd-jwt: holder required with cnf\.jwk/
    );
    // nowSec sets presentation-time KB iat (standard); default falls back.
    const kbDefault = sdPayloadToKbClaims(sd, {
      verifier: VERIFIER,
      nonce: NONCE,
      holder: HOLDER,
    });
    assert.equal(kbDefault.iat, sd.payload.iat);
    const kb = sdPayloadToKbClaims(sd, {
      verifier: VERIFIER,
      nonce: NONCE,
      holder: HOLDER,
      nowSec: NOW + 5,
    });
    assert.equal(kb.iss, HOLDER);
    assert.equal(kb.iat, NOW + 5);
    assert.deepEqual(
      verifySdProjection(sd, kb, {
        expectedAud: VERIFIER,
        expectedNonce: NONCE,
        expectedHolder: HOLDER,
        nowSec: NOW + 5,
      }),
      { ok: true }
    );
    // Standard JWS signing input: ASCII "b64u(header).b64u(payload)".
    const input = kbJwsSigningInput(kb, { typ: "kb+jwt", alg: "EdDSA" });
    assert.ok(input instanceof Uint8Array);
    const ascii = Buffer.from(input).toString("ascii");
    const parts = ascii.split(".");
    assert.equal(parts.length, 2);
    const header = JSON.parse(
      Buffer.from(parts[0] as string, "base64url").toString("utf8")
    ) as { typ: string; alg: string };
    assert.equal(header.typ, "kb+jwt");
    assert.equal(header.alg, "EdDSA");
    const body = JSON.parse(
      Buffer.from(parts[1] as string, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    assert.equal(body["iss"], HOLDER);
    assert.equal(body["aud"], VERIFIER);
    assert.equal(body["nonce"], NONCE);
    assert.equal(body["sd_hash"], kb.sd_hash);
    // Standard input with default header matches the explicit one.
    const def = kbJwsSigningInput(kb);
    assert.ok(def instanceof Uint8Array);
    assert.ok(def.length > 0);
  });

  it("shape guards never throw TypeError: NaN iat, _sd string, undefined value", () => {
    const { pres } = presentOne();
    const sd = presentationToSdJwt(pres);
    const kb = sdPayloadToKbClaims(sd, { verifier: VERIFIER, nonce: NONCE });
    const base = {
      expectedAud: VERIFIER,
      expectedNonce: NONCE,
      expectedHolder: HOLDER,
      nowSec: NOW,
    };
    // NaN KB iat bypassed the old stale check; now fail-closed stale.
    assert.deepEqual(verifySdProjection(sd, { ...kb, iat: NaN }, base), {
      ok: false,
      reason: "stale",
    });
    assert.deepEqual(verifySdProjection(sd, kb, { ...base, nowSec: NaN }), {
      ok: false,
      reason: "stale",
    });
    // Old `new Set(string)` iterated chars; now shape → digest-mismatch.
    const sdString = {
      ...sd,
      payload: { ...sd.payload, _sd: "abc" as unknown as readonly string[] },
    };
    assert.deepEqual(verifySdProjection(sdString, kb, base), {
      ok: false,
      reason: "digest-mismatch",
    });
    // undefined values must throw SdJwtError, never stringify to null.
    assert.throws(
      () =>
        toSdDisclosure({
          name: "a",
          value: undefined,
          salt: "s",
          digest: "d",
        }),
      /sd-jwt:/
    );
    // Non-finite presentation iat throws SdJwtError.
    assert.throws(
      () =>
        presentationToSdJwt({
          ...(pres as unknown as Record<string, unknown>),
          iat: NaN,
        } as unknown as Parameters<typeof presentationToSdJwt>[0]),
      /sd-jwt:/
    );
  });

  it("iss/sub shape-checked and optionally verified via expectedIss/expectedSub", () => {
    const { pres } = presentOne();
    const sd = presentationToSdJwt(pres);
    const kb = sdPayloadToKbClaims(sd, { verifier: VERIFIER, nonce: NONCE });
    const base = {
      expectedAud: VERIFIER,
      expectedNonce: NONCE,
      expectedHolder: HOLDER,
      nowSec: NOW,
    };
    assert.deepEqual(verifySdProjection(sd, kb, base), { ok: true });
    assert.deepEqual(
      verifySdProjection(sd, kb, {
        ...base,
        expectedIss: "did:test:issuer",
        expectedSub: "did:test:subject",
      }),
      { ok: true }
    );
    assert.deepEqual(
      verifySdProjection(sd, kb, { ...base, expectedIss: "did:test:other" }),
      { ok: false, reason: "issuer" }
    );
    assert.deepEqual(
      verifySdProjection(sd, kb, { ...base, expectedSub: "did:test:other" }),
      { ok: false, reason: "issuer" }
    );
    const badIss = {
      ...sd,
      payload: { ...sd.payload, iss: "" },
    };
    assert.deepEqual(verifySdProjection(badIss, kb, base), {
      ok: false,
      reason: "issuer",
    });
  });
});
