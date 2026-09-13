import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signAndReceipt } from "../src/index.js";
import { FakeSigningExecutor } from "./fakes.js";

const NOW = 1_700_000_000;
const INSTR = {
  capabilityId: "cid-sign-1",
  recipient: "did:test:shop",
  bytesHex: "ab".repeat(32),
  purpose: "sign-order",
  resource: "order:1",
};

describe("SigningExecutor parity (v04/04)", () => {
  it("signs with a bound redemption and receipt without key material", async () => {
    const ex = new FakeSigningExecutor();
    const receipt = await signAndReceipt(
      ex,
      INSTR,
      { ok: true, chainId: "cid-sign-1" },
      NOW
    );
    assert.equal(receipt.capabilityId, "cid-sign-1");
    assert.ok(receipt.signature.length > 0);
    assert.ok(!JSON.stringify(receipt).includes("private"));
    assert.equal(ex.calls.length, 1);
  });

  it("rejects mismatched chainId and malformed bytes", async () => {
    const ex = new FakeSigningExecutor();
    await assert.rejects(() =>
      signAndReceipt(ex, INSTR, { ok: true, chainId: "other" }, NOW)
    );
    await assert.rejects(() =>
      signAndReceipt(
        ex,
        { ...INSTR, bytesHex: "zz" },
        { ok: true, chainId: "cid-sign-1" },
        NOW
      )
    );
  });
});
