import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openKeystore,
  readPassphrase,
  resealKeystore,
  sealKeystore,
  zeroize,
} from "../src/index.js";

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

  it("passphrase sourcing: env, then file, then prompt, else clear error (ticket 04)", () => {
    // Env wins when present (legacy).
    assert.equal(
      readPassphrase({ PTF_PASSPHRASE: "env-pass" }, { prompt: () => "no" }),
      "env-pass"
    );
    // File sourcing with trailing-newline tolerance.
    const dir = mkdtempSync(join(tmpdir(), "ptf-pass-"));
    const fp = join(dir, "pp");
    writeFileSync(fp, "file-pass\n", { mode: 0o600 });
    assert.equal(readPassphrase({ PTF_PASSPHRASE_FILE: fp }), "file-pass");
    assert.throws(
      () => readPassphrase({ PTF_PASSPHRASE_FILE: join(dir, "absent") }),
      /cannot stat/
    );
    // Prompt fallback; empty prompt and no source both fail closed.
    assert.equal(
      readPassphrase({}, { prompt: () => "typed-pass" }),
      "typed-pass"
    );
    assert.throws(() => readPassphrase({}, { prompt: () => "" }), /required/);
    assert.throws(() => readPassphrase({}), /PTF_PASSPHRASE_FILE/);
  });

  it("reseals under a new passphrase without re-issuing keys (ticket 04)", () => {
    const file = sealKeystore(testKeys(), PASS);
    const rotated = resealKeystore(file, PASS, "brand new passphrase");
    assert.deepEqual(openKeystore(rotated, "brand new passphrase"), testKeys());
    assert.throws(() => openKeystore(rotated, PASS));
    assert.throws(() => resealKeystore(file, "wrong passphrase", "x"));
    assert.throws(() => resealKeystore(file, PASS, ""));
  });

  it("zeroize overwrites buffers in place (ticket 04)", () => {
    const buf = new Uint8Array([1, 2, 3, 255]);
    zeroize(buf);
    assert.deepEqual(buf, new Uint8Array(4));
  });
});
