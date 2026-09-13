import { canonicalize, sha256Hex } from "./canonical.js";
import { randomHex } from "./crypto.js";

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
}

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

/** Runs only with proof of redemption bound to this instruction. Freshness: redeem immediately before signing. */
export async function signAndReceipt(
  executor: SigningExecutor,
  instruction: SignInstruction,
  redemption: { readonly ok: true; readonly chainId: string },
  at: number
): Promise<SignReceipt> {
  if (redemption.ok !== true)
    throw new Error("signing: redemption required before execution");
  if (redemption.chainId !== instruction.capabilityId) {
    throw new Error("signing: redemption is not bound to this instruction");
  }
  const bytes = bytesOf(instruction);
  const settled = await executor.sign(instruction);
  void bytes;
  return {
    receiptId: `sig-rcpt-${randomHex(8)}`,
    capabilityId: instruction.capabilityId,
    recipient: instruction.recipient,
    bytesDigest: sha256Hex(canonicalize(instruction.bytesHex.toLowerCase())),
    purpose: instruction.purpose,
    resource: instruction.resource,
    signature: settled.signature,
    at,
  };
}
