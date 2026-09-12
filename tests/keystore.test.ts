import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openKeystore, sealKeystore } from "../src/index.js";

const PASS = "correct horse battery staple";

function testKeys(): Record<string, Uint8Array> {
  return {
    principal: new Uint8Array(32).fill(1),
    agent: new Uint8Array(32).fill(2),
    merchant: new Uint8Array(32).fill(3),
  };
}

describe("encrypted keystore (prod-02)", () => {
  it("roundtrips keys byte-identically through JSON", () => {
    const file = sealKeystore(testKeys(), PASS);
    const blob = JSON.stringify(file);
    const reopened = openKeystore(
      JSON.parse(blob) as Parameters<typeof openKeystore>[0],
      PASS
    );
    assert.deepEqual(reopened, testKeys());
  });

  it("fails closed on wrong passphrase and tampering", () => {
    const file = sealKeystore(testKeys(), PASS);
    assert.throws(() => openKeystore(file, "wrong passphrase"));
    const tamperedCt = {
      ...file,
      ctHex:
        file.ctHex.slice(0, -2) + (file.ctHex.endsWith("00") ? "11" : "00"),
    };
    assert.throws(() => openKeystore(tamperedCt, PASS));
    assert.throws(() => openKeystore({ ...file, version: 2 } as never, PASS));
    assert.throws(() => openKeystore({ ...file, ivHex: "zz" }, PASS));
  });

  it("never holds key material in cleartext", () => {
    const file = sealKeystore(testKeys(), PASS);
    const blob = JSON.stringify(file);
    for (const key of Object.values(testKeys())) {
      assert.ok(!blob.includes(Buffer.from(key).toString("hex")));
    }
    assert.equal(file.version, 1);
  });
});
