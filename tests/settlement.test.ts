import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LedgerSettlementExecutor,
  RecordedSettlementExecutor,
  FacilitatorSettlementExecutor,
} from "../src/index.js";
import { StubFacilitator } from "./fakes.js";

const INSTR = {
  capabilityId: "cid-1",
  recipient: "0xshop",
  amount: 100,
  currency: "USDC",
  resource: "data:premium",
  purpose: "buy",
};

describe("real settlement behind the boundary (v04/03)", () => {
  it("recorded settlement enforces expectations; swap fails", async () => {
    const good = new RecordedSettlementExecutor(
      {
        success: true,
        transaction: "0xabc",
        network: "eip155:84532",
        payer: "0xfrom",
        amount: "100",
        asset: "0xusdc",
      },
      {
        network: "eip155:84532",
        payer: "0xfrom",
        amount: "100",
        asset: "0xusdc",
      }
    );
    assert.equal((await good.executePayment(INSTR)).transaction, "0xabc");
    const swapped = new RecordedSettlementExecutor(
      {
        success: true,
        transaction: "0xabc",
        network: "eip155:84532",
        payer: "0xfrom",
        amount: "100",
        asset: "0xjunk",
      },
      {
        network: "eip155:84532",
        payer: "0xfrom",
        amount: "100",
        asset: "0xusdc",
      }
    );
    await assert.rejects(() => swapped.executePayment(INSTR), /asset/);
  });

  it("ledger demo appends a content-bound tx id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-ledger-"));
    const ex = new LedgerSettlementExecutor(join(dir, "ledger.jsonl"));
    const r1 = await ex.executePayment(INSTR);
    const r2 = await ex.executePayment(INSTR);
    assert.ok(r1.transaction.startsWith("ledger-tx-"));
    assert.equal(r1.transaction, r2.transaction);
  });

  it("facilitator path verifies then settles (stub, evidence-only)", async () => {
    const req = {
      scheme: "exact",
      network: "eip155:84532",
      amount: "100",
      asset: "0xusdc",
      payTo: "0xshop",
      maxTimeoutSeconds: 60,
    };
    const ex = new FacilitatorSettlementExecutor(
      new StubFacilitator(true, "0xfrom"),
      req,
      { x: 1 },
      {
        network: "eip155:84532",
        payer: "0xfrom",
        amount: "100",
        asset: "0xusdc",
      }
    );
    assert.equal((await ex.executePayment(INSTR)).transaction, "0xstub");
    const bad = new FacilitatorSettlementExecutor(
      new StubFacilitator(false),
      req,
      { x: 1 },
      { network: "eip155:84532", payer: "0xfrom" }
    );
    await assert.rejects(() => bad.executePayment(INSTR), /verify|settlement/);
  });
});
