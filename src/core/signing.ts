import { canonicalize, sha256Hex } from "./canonical.js";
import { randomHex } from "./crypto.js";
import { requireBoundOperation } from "./execute.js";
import type { Redemption } from "./types.js";

/**
 * Signing-key Protected Execution with C parity (v04/04).
 * Mirrors the payment gates: Recipient auth + termsDigest binding + expiry +
 * maxUses are enforced by Capabilities.authorize before this module runs; here
 * the redemption chainId must equal instruction.capabilityId, and the receipt
 * carries what/who/capability-id only. No key material crosses the seam.
 */

export interface SignInstruction {
  readonly capabilityId: string;
  readonly recipient: string;
  readonly bytesHex: string;
  readonly purpose: string;
  readonly resource: string;
  /** Must equal the authorized terms digest (ADR-0018). */
  readonly termsDigest: string;
}

export interface SigningExecutor {
  sign(
    instruction: SignInstruction
  ): Promise<{ readonly ok: true; readonly signature: string }>;
}

export interface SignReceipt {
  readonly receiptId: string;
  readonly capabilityId: string;
  readonly recipient: string;
  readonly bytesDigest: string;
  readonly purpose: string;
  readonly resource: string;
  readonly signature: string;
  readonly at: number;
  /** Terms digest the signing ran under (authorized === executed). */
  readonly termsDigest: string;
}
// NOTE: SignReceipt intentionally does not extend ExecutionReceipt — a
// signature has no transaction counterpart, and forcing one would invent
// terms. Both carry receiptId/capabilityId/recipient/resource/purpose/at.

function bytesOf(instruction: SignInstruction): Uint8Array {
  if (
    !/^[0-9a-fA-F]*$/.test(instruction.bytesHex) ||
    instruction.bytesHex.length % 2 !== 0 ||
    instruction.bytesHex.length === 0
  ) {
    throw new Error("signing: bytesHex must be non-empty hex");
  }
  return new Uint8Array(Buffer.from(instruction.bytesHex, "hex"));
}

/** Runs only with proof of redemption carrying the EXACT authorized operation. Freshness: redeem immediately before signing. */
export async function signAndReceipt(
  executor: SigningExecutor,
  instruction: SignInstruction,
  redemption: Redemption,
  at: number
): Promise<SignReceipt> {
  if (redemption.ok !== true)
    throw new Error("signing: redemption required before execution");
  // Binding first, then flags — see execute.ts.
  const op = requireBoundOperation(redemption);
  if (redemption.consumed !== true || redemption.proofVerified !== true) {
    throw new Error(
      "signing: dry-run check cannot execute — redeem with proof first (ADR-0018)"
    );
  }
  if (redemption.chainId !== instruction.capabilityId) {
    throw new Error("signing: redemption is not bound to this instruction");
  }
  if (op.cmd !== "/sign" && !op.cmd.startsWith("/sign/")) {
    throw new Error("signing: authorized cmd is not a signing operation");
  }
  if (op.termsDigest !== instruction.termsDigest) {
    throw new Error("signing: terms digest mismatch — new approval required");
  }
  if (op.recipient !== instruction.recipient) {
    throw new Error("signing: recipient differs from authorized terms");
  }
  if (op.resource === undefined || op.resource !== instruction.resource) {
    throw new Error("signing: resource differs from authorized terms");
  }
  if (op.purpose === undefined || op.purpose !== instruction.purpose) {
    throw new Error("signing: purpose differs from authorized terms");
  }
  const bytes = bytesOf(instruction);
  const bytesDigest = sha256Hex(
    canonicalize(instruction.bytesHex.toLowerCase())
  );
  const bound = (op.args as Record<string, unknown>)["bytesDigest"];
  if (typeof bound !== "string" || bound !== bytesDigest) {
    throw new Error(
      "signing: bytes differ from authorized terms — authorize must bind bytesDigest"
    );
  }
  const settled = await executor.sign(instruction);
  void bytes;
  return {
    receiptId: `sig-rcpt-${randomHex(8)}`,
    capabilityId: instruction.capabilityId,
    recipient: instruction.recipient,
    bytesDigest,
    purpose: instruction.purpose,
    resource: instruction.resource,
    signature: settled.signature,
    at,
    termsDigest: instruction.termsDigest,
  };
}
