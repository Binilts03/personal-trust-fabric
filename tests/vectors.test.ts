import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Disclose,
  canonicalize,
  generateEd25519Keypair,
  sha256Hex,
  signBytes,
  termsDigestOf,
} from "../src/index.js";

/**
 * Format pins (review batch C). Expected values below were produced OUTSIDE
 * this codebase: hand-written canonical strings hashed with the platform
 * SHA-256 (node:crypto directly, no PTF code path). If canonicalization or
 * hashing regresses, these fail even though issue and demand would still
 * agree with each other.
 */
describe("independent digest vectors (review batch C)", () => {
  it("pins canonical key ordering and the terms digest", () => {
    assert.equal(canonicalize({ b: "x", a: 1 }), '{"a":1,"b":"x"}');
    assert.equal(
      termsDigestOf({ b: "x", a: 1 }),
      "ecf9e98ec0641e23113ff3ce8bdc78d0ddd249886517fd4a7f68cc83d4e65667"
    );
    assert.equal(
      sha256Hex(canonicalize({ a: 1 })),
      "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"
    );
  });

  it("pins the disclosure digest construction end-to-end", () => {
    const holder = generateEd25519Keypair();
    const disclosure = {
      name: "ca_status",
      value: "active",
      salt: "s4",
      digest:
        "ad0ddbc30912fd3349266691bc0143778c8acb137dbaff7cf9b17b53bcff9438",
    };
    const unsigned = {
      issuer: "did:test:ca",
      subject: "did:test:holder",
      holder: "did:test:holder",
      verifier: "did:test:v",
      nonce: "n-vec",
      iat: 1_700_000_000,
      disclosures: [disclosure],
    };
    const pres = {
      ...unsigned,
      sig: signBytes(
        holder.privateKey,
        new Uint8Array(Buffer.from(canonicalize(unsigned), "utf8"))
      ),
    };
    const result = Disclose.verify(pres, {
      holderKey: holder.publicKeyRaw,
      expectedAud: "did:test:v",
      nowSec: 1_700_000_000,
    });
    assert.equal(result.ok, true);
  });
});
