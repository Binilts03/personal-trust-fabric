import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PaymentExecutor, PaymentInstruction } from "../core/execute.js";
import type { Credential } from "../core/disclose.js";
import { canonicalize, sha256Hex } from "../core/canonical.js";
import {
  checkSettlement,
  type PaymentRequirement,
  type SettlementResult,
  type X402Facilitator,
} from "./x402.js";

/**
 * Reference host settlement evidence (ticket 09): PTF decides, external
 * systems execute, PTF verifies results via `checkSettlement`.
 * Core is untouched: this adapter turns a recorded external settlement
 * into the `{transaction}` the receipt needs, enforcing network/payer and
 * opt-in amount/asset expectations via checkSettlement. No live RPC in v04;
 * pass a recorded SettlementResult (external attestation) for verifiable demos.
 * CLI/MCP consume the `PaymentExecutor` seam directly (today
 * `FakePaymentExecutor` — no money moves); production hosts supply their own
 * `PaymentExecutor` (e.g. one of the reference executors below) with value
 * movement performed by their own `PaymentProvider` rail and credentials
 * supplied by their own `CredentialProvider` store. Call sites untouched.
 * PTF never facilitates, settles, or moves value itself.
 */

/**
 * Host-owned value-movement rail behind a `PaymentExecutor`. Minimal on
 * purpose: move value per the instruction on the external rail and resolve
 * with the rail's transaction reference, which PTF then verifies with
 * `checkSettlement` before it can enter a receipt.
 */
export interface PaymentProvider {
  settlePayment(
    instruction: PaymentInstruction
  ): Promise<{ readonly transaction: string }>;
}

/**
 * Host-owned credential store for disclosure. Issuance and trust registries
 * stay host-side (out of v0.1 scope): credentials arrive from the host's own
 * store and presentations still go through `Disclose.present` / `verify`.
 */
export interface CredentialProvider {
  /** Return the holder's credential for disclosure, or null when unknown. */
  getCredential(holder: string): Promise<Credential | null>;
}

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

/**
 * Settlement through an external x402 facilitator (still evidence-only):
 * verify with the facilitator, settle through it, then enforce expectations
 * locally. "Facilitator" here is x402's name for the EXTERNAL verify/settle
 * service — PTF calls it; PTF never is it. Personal trust fabric does not
 * facilitate payments.
 */
export class X402SettlementExecutor implements PaymentExecutor {
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
      throw new Error("settlement: external facilitator verify failed");
    const settled = await this.facilitator.settle(
      this.payload,
      this.requirements
    );
    const checked = checkSettlement(settled, this.expected);
    if (!checked.ok) throw new Error(`settlement: ${checked.reason}`);
    return { ok: true, transaction: settled.transaction };
  }
}
