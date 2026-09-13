import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PaymentExecutor, PaymentInstruction } from "../core/execute.js";
import { canonicalize, sha256Hex } from "../core/canonical.js";
import {
  checkSettlement,
  type PaymentRequirement,
  type SettlementResult,
  type X402Facilitator,
} from "./x402.js";

/**
 * Real settlement behind the existing PaymentExecutor seam (v04/03).
 * Core is untouched: this adapter turns a recorded facilitator settlement
 * into the `{transaction}` the receipt needs, enforcing network/payer and
 * opt-in amount/asset expectations via checkSettlement. No live RPC in v04;
 * pass a recorded SettlementResult (facilitator proof) for verifiable demos.
 */

export class RecordedSettlementExecutor implements PaymentExecutor {
  constructor(
    private readonly recorded: SettlementResult,
    private readonly expected: {
      readonly network: string;
      readonly payer: string;
      readonly amount?: string;
      readonly asset?: string;
    }
  ) {}
  async executePayment(
    _instruction: PaymentInstruction
  ): Promise<{ readonly ok: true; readonly transaction: string }> {
    const checked = checkSettlement(this.recorded, this.expected);
    if (!checked.ok) throw new Error(`settlement: ${checked.reason}`);
    return { ok: true, transaction: this.recorded.transaction };
  }
}

/** Ledger demo: appends canonical instructions to a JSONL file, returns a content-bound tx id. No money moves; the ledger is the audit trail. */
export class LedgerSettlementExecutor implements PaymentExecutor {
  readonly calls: PaymentInstruction[] = [];
  constructor(private readonly ledgerPath: string) {}
  async executePayment(
    instruction: PaymentInstruction
  ): Promise<{ readonly ok: true; readonly transaction: string }> {
    this.calls.push(instruction);
    mkdirSync(dirname(this.ledgerPath), { recursive: true });
    const tx = `ledger-tx-${sha256Hex(canonicalize(instruction)).slice(0, 16)}`;
    appendFileSync(
      this.ledgerPath,
      `${canonicalize({ ...instruction, tx })}\n`,
      "utf8"
    );
    return { ok: true, transaction: tx };
  }
}

/** Live-shape facilitator path (still evidence-only): verify then settle, then enforce expectations. */
export class FacilitatorSettlementExecutor implements PaymentExecutor {
  constructor(
    private readonly facilitator: X402Facilitator,
    private readonly requirements: PaymentRequirement,
    private readonly payload: unknown,
    private readonly expected: {
      readonly network: string;
      readonly payer: string;
      readonly amount?: string;
      readonly asset?: string;
    }
  ) {}
  async executePayment(
    _instruction: PaymentInstruction
  ): Promise<{ readonly ok: true; readonly transaction: string }> {
    const verified = await this.facilitator.verify(
      this.payload,
      this.requirements
    );
    if (!verified.isValid)
      throw new Error("settlement: facilitator verify failed");
    const settled = await this.facilitator.settle(
      this.payload,
      this.requirements
    );
    const checked = checkSettlement(settled, this.expected);
    if (!checked.ok) throw new Error(`settlement: ${checked.reason}`);
    return { ok: true, transaction: settled.transaction };
  }
}
