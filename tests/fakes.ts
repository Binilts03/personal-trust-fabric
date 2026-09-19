import type { KeyObject } from "node:crypto";
import {
  randomHex,
  signBytes,
  type PaymentRequirement,
  type SettlementResult,
  type SignInstruction,
  type SigningExecutor,
  type X402Facilitator,
} from "../src/index.js";

/** Test stub for the EXTERNAL x402 facilitator role (moved from adapters/x402.ts). PTF calls facilitators; it never is one. */
export class StubFacilitator implements X402Facilitator {
  constructor(
    private readonly valid: boolean,
    private readonly payer = "0xstub-payer"
  ) {}
  async verify(
    _payload: unknown,
    _requirements: PaymentRequirement
  ): Promise<{ readonly isValid: boolean }> {
    return { isValid: this.valid };
  }
  async settle(
    _payload: unknown,
    requirements: PaymentRequirement
  ): Promise<SettlementResult> {
    if (!this.valid) {
      return {
        success: false,
        transaction: "",
        network: requirements.network,
        payer: "",
        errorReason: "insufficient_funds",
      };
    }
    return {
      success: true,
      transaction: "0xstub",
      network: requirements.network,
      payer: this.payer,
      amount: requirements.amount,
      asset: requirements.asset,
    };
  }
}

/** In-memory signing stand-in (moved from core/signing.ts). */
export class FakeSigningExecutor implements SigningExecutor {
  readonly calls: SignInstruction[] = [];
  constructor(private readonly privateKey?: KeyObject) {}
  async sign(
    instruction: SignInstruction
  ): Promise<{ readonly ok: true; readonly signature: string }> {
    this.calls.push(instruction);
    if (this.privateKey === undefined) {
      return { ok: true, signature: `fake-sig-${randomHex(8)}` };
    }
    const bytes = new Uint8Array(Buffer.from(instruction.bytesHex, "hex"));
    return {
      ok: true,
      signature: Buffer.from(signBytes(this.privateKey, bytes)).toString("hex"),
    };
  }
}
