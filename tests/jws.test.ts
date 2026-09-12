import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { esDerToRaw, rawToDer } from "../src/index.js";

/**
 * DER minimal-encoding edge cases (P0 review follow-up).
 * A 31-byte integer value inside a fixed 32-byte JWS half must encode as
 * `02 1f`, never `02 20 00...` — strict parsers (OpenSSL) reject the padded
 * form, which intermittently (~0.4% per signature) failed real verifications.
 * Vectors are hand-computed, not produced by the code under test.
 */
describe("JWS DER edge cases (review batch D)", () => {
  it("encodes short integers minimally", () => {
    const rValue = Buffer.concat([Buffer.from([0x59]), Buffer.alloc(30, 0x11)]);
    const sValue = Buffer.concat([Buffer.from([0x80]), Buffer.alloc(31, 0x22)]);
    const raw = Buffer.concat([Buffer.from([0]), rValue, sValue]);
    assert.equal(raw.length, 64);
    const der = rawToDer(raw);
    const expectedHex =
      "3044" +
      "021f" +
      "59" +
      "11".repeat(30) +
      "0221" +
      "00" +
      "80" +
      "22".repeat(31);
    assert.equal(der.toString("hex"), expectedHex);
    assert.deepEqual(esDerToRaw(der), raw);
  });

  it("round-trips every integer length class byte-identically", () => {
    const halves = [
      Buffer.concat([Buffer.from([0]), Buffer.alloc(31, 0x33)]),
      Buffer.alloc(32, 0x44),
      Buffer.concat([Buffer.from([0x80]), Buffer.alloc(31, 0x55)]),
    ];
    for (const a of halves) {
      for (const b of halves) {
        const raw = Buffer.concat([a, b]);
        assert.deepEqual(esDerToRaw(rawToDer(raw)), raw);
      }
    }
  });
});
