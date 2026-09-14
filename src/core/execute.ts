import { createHmac } from "node:crypto";
import { canonicalize, sha256Hex } from "./canonical.js";
import { randomHex } from "./crypto.js";

/**
 * Protected execution with receipts and secretness audit (ticket 02).
 * The boundary rule: executors receive a sanitized instruction — ids, amounts,
 * digests — never credentials, keys, or tokens. Those types have no fields
 * capable of carrying secrets, so non-propagation holds by construction for
 * everything except the free-text audit `detail`, which callers must keep
 * secret-free (enforced by test, documented as a host obligation).
 */

export interface PaymentInstruction {
  readonly capabilityId: string;
  readonly recipient: string;
  readonly amount: number;
  readonly currency: string;
  readonly resource: string;
  readonly purpose: string;
}

export interface PaymentExecutor {
  executePayment(
    instruction: PaymentInstruction
  ): Promise<{ readonly ok: true; readonly transaction: string }>;
}

/** In-memory stand-in for a PSP/facilitator. Records calls for assertions. No money moves. */
export class FakePaymentExecutor implements PaymentExecutor {
  readonly calls: PaymentInstruction[] = [];
  async executePayment(
    instruction: PaymentInstruction
  ): Promise<{ readonly ok: true; readonly transaction: string }> {
    this.calls.push(instruction);
    return { ok: true, transaction: `fake-tx-${randomHex(8)}` };
  }
}

export interface Receipt {
  readonly receiptId: string;
  readonly capabilityId: string;
  readonly recipient: string;
  readonly amount: number;
  readonly currency: string;
  readonly resource: string;
  readonly purpose: string;
  readonly transaction: string;
  readonly at: number;
}

/**
 * Runs only with proof of redemption: pass the successful `authorize` result.
 * The result is bound to the redeemed leaf (`chainId` must equal
 * `instruction.capabilityId`); a bare `{ok:true}` or a redemption for a
 * different capability is rejected. (It cannot prove freshness — redeem
 * immediately before executing. Callers persist consumption BEFORE calling
 * this, so a crash/failing rail burns a use instead of double-spending.)
 */
export async function executeAndReceipt(
  executor: PaymentExecutor,
  instruction: PaymentInstruction,
  redemption: { readonly ok: true; readonly chainId: string },
  at: number
): Promise<Receipt> {
  if (redemption.ok !== true)
    throw new Error("execute: redemption required before execution");
  if (redemption.chainId !== instruction.capabilityId) {
    throw new Error("execute: redemption is not bound to this instruction");
  }
  const settled = await executor.executePayment(instruction);
  return {
    receiptId: `rcpt-${randomHex(8)}`,
    capabilityId: instruction.capabilityId,
    recipient: instruction.recipient,
    amount: instruction.amount,
    currency: instruction.currency,
    resource: instruction.resource,
    purpose: instruction.purpose,
    transaction: settled.transaction,
    at,
  };
}

export interface AuditEvent {
  readonly at?: number;
  readonly actor: string;
  readonly action: string;
  readonly authorityId?: string;
  readonly capabilityId?: string;
  /** Must stay secret-free. Host obligation; covered by secretness test. */
  readonly detail?: string;
  /**
   * Store revisions this entry was recorded under (ticket 03). Writers stamp
   * the post-save revisions so loads can prove the files were not rolled
   * back past recorded history; readers treat absent fields as
   * unconstrained (pre-revision lines).
   */
  readonly authorityRev?: number;
  readonly registryRev?: number;
}

export interface AuditEntry extends Required<
  Pick<AuditEvent, "at" | "actor" | "action">
> {
  readonly authorityId?: string;
  readonly capabilityId?: string;
  readonly detail?: string;
  readonly authorityRev?: number;
  readonly registryRev?: number;
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

export const GENESIS = "GENESIS";

function entryHash(
  prevHash: string,
  body: Omit<AuditEntry, "hash">,
  hmacKey?: Uint8Array
): string {
  const bytes = canonicalize({ ...body, prevHash });
  if (hmacKey === undefined) return sha256Hex(bytes);
  return createHmac("sha256", Buffer.from(hmacKey))
    .update(bytes, "utf8")
    .digest("hex");
}

/**
 * Append-only hash-chained audit. Unkeyed = tamper-detection; keyed (HMAC) =
 * tamper-evidence against readers without the key. The key must live outside
 * logs and code (OS keychain in production) — a host obligation. Genuine
 * third-party verifiability still needs independent anchoring (see ADR-0006).
 */
export class Audit {
  private readonly entries: AuditEntry[] = [];
  private readonly nowSec: () => number;
  private readonly hmacKey: Uint8Array | undefined;

  constructor(
    nowSec: () => number = () => Math.floor(Date.now() / 1000),
    opts: { readonly hmacKey?: Uint8Array } = {}
  ) {
    if (opts.hmacKey !== undefined && opts.hmacKey.length < 16) {
      throw new Error("audit: HMAC keys must be at least 16 bytes");
    }
    this.nowSec = nowSec;
    this.hmacKey =
      opts.hmacKey === undefined ? undefined : Uint8Array.from(opts.hmacKey);
  }

  append(event: AuditEvent): AuditEntry {
    for (const field of ["authorityRev", "registryRev"] as const) {
      const v: unknown = event[field];
      if (
        v !== undefined &&
        (typeof v !== "number" || !Number.isInteger(v) || v < 0)
      ) {
        throw new Error(`audit: ${field} must be a non-negative integer`);
      }
    }
    const prev =
      this.entries.length === 0
        ? GENESIS
        : (this.entries[this.entries.length - 1] as AuditEntry).hash;
    const body = {
      seq: this.entries.length,
      prevHash: prev,
      at: event.at ?? this.nowSec(),
      actor: event.actor,
      action: event.action,
      ...(event.authorityId !== undefined
        ? { authorityId: event.authorityId }
        : {}),
      ...(event.capabilityId !== undefined
        ? { capabilityId: event.capabilityId }
        : {}),
      ...(event.detail !== undefined ? { detail: event.detail } : {}),
      ...(event.authorityRev !== undefined
        ? { authorityRev: event.authorityRev }
        : {}),
      ...(event.registryRev !== undefined
        ? { registryRev: event.registryRev }
        : {}),
    };
    const entry: AuditEntry = {
      ...body,
      hash: entryHash(prev, body, this.hmacKey),
    };
    this.entries.push(entry);
    return entry;
  }

  /** Re-ingest one JSONL line (persistence lives with the host; core stays pure). */
  ingest(line: string): void {
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (
      typeof raw["hash"] !== "string" ||
      typeof raw["prevHash"] !== "string" ||
      typeof raw["seq"] !== "number" ||
      !Number.isInteger(raw["seq"] as number) ||
      typeof raw["at"] !== "number" ||
      typeof raw["actor"] !== "string" ||
      typeof raw["action"] !== "string" ||
      (raw["authorityId"] !== undefined &&
        typeof raw["authorityId"] !== "string") ||
      (raw["capabilityId"] !== undefined &&
        typeof raw["capabilityId"] !== "string") ||
      (raw["detail"] !== undefined && typeof raw["detail"] !== "string") ||
      (raw["authorityRev"] !== undefined &&
        (typeof raw["authorityRev"] !== "number" ||
          !Number.isInteger(raw["authorityRev"] as number) ||
          (raw["authorityRev"] as number) < 0)) ||
      (raw["registryRev"] !== undefined &&
        (typeof raw["registryRev"] !== "number" ||
          !Number.isInteger(raw["registryRev"] as number) ||
          (raw["registryRev"] as number) < 0))
    ) {
      throw new Error("audit: malformed entry");
    }
    const seq = raw["seq"] as number;
    if (seq !== this.entries.length) {
      throw new Error("audit: seq gap — refusing to ingest");
    }
    const expectedPrev =
      this.entries.length === 0
        ? GENESIS
        : (this.entries[this.entries.length - 1] as AuditEntry).hash;
    if (raw["prevHash"] !== expectedPrev) {
      throw new Error("audit: prevHash mismatch — refusing to ingest");
    }
    const { hash, ...body } = raw as unknown as AuditEntry & {
      readonly hash: string;
    };
    void hash;
    if (
      entryHash(
        raw["prevHash"] as string,
        body as Omit<AuditEntry, "hash">,
        this.hmacKey
      ) !== raw["hash"]
    ) {
      throw new Error("audit: hash mismatch — refusing forged entry");
    }
    this.entries.push(raw as unknown as AuditEntry);
  }

  verifyChain(): boolean {
    let prev = GENESIS;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i] as AuditEntry;
      if (e.seq !== i) return false;
      if (e.prevHash !== prev) return false;
      const { hash, ...body } = e;
      void hash;
      if (
        entryHash(
          e.prevHash,
          body as Omit<AuditEntry, "hash">,
          this.hmacKey
        ) !== e.hash
      )
        return false;
      prev = e.hash;
    }
    return true;
  }

  toJSONL(): string {
    return (
      this.entries.map((e) => canonicalize(e)).join("\n") +
      (this.entries.length > 0 ? "\n" : "")
    );
  }
}
