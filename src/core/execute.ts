import { createHmac } from "node:crypto";
import { canonicalize, sha256Hex } from "./canonical.js";
import { randomHex } from "./crypto.js";
import type { AuthorizedOperation, Redemption } from "./types.js";

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
  /** Must equal the authorized terms digest (ADR-0018). */
  readonly termsDigest: string;
}

export interface PaymentExecutor {
  executePayment(
    instruction: PaymentInstruction
  ): Promise<{ readonly ok: true; readonly transaction: string }>;
}

/** In-memory stand-in for a host-owned rail. Records calls for assertions. No money moves. */
export class FakePaymentExecutor implements PaymentExecutor {
  readonly calls: PaymentInstruction[] = [];
  async executePayment(
    instruction: PaymentInstruction
  ): Promise<{ readonly ok: true; readonly transaction: string }> {
    this.calls.push(instruction);
    return { ok: true, transaction: `fake-tx-${randomHex(8)}` };
  }
}

export interface Receipt extends ExecutionReceipt {
  readonly amount: number;
  readonly currency: string;
}

/**
 * Domain-neutral execution receipt (ADR-0018): every protected action —
 * payment, travel, email, signing — returns this shape, with payment
 * amounts living only on the `Receipt` extension in the payment profile.
 */
export interface ExecutionReceipt {
  readonly receiptId: string;
  readonly capabilityId: string;
  readonly recipient: string;
  readonly resource: string;
  readonly purpose: string;
  readonly transaction: string;
  readonly at: number;
  /** Terms digest the execution ran under (authorized === executed). */
  readonly termsDigest: string;
}

function fieldsEqual(a: unknown, b: unknown): boolean {
  try {
    return canonicalize(a) === canonicalize(b);
  } catch {
    return false;
  }
}

/**
 * Extract the exact authorized operation carried by a redemption, or throw.
 * Shared by signing and the provider seam so every execute path enforces
 * authorized_operation === executed_operation (ADR-0018).
 */
export function requireBoundOperation(
  redemption: unknown
): AuthorizedOperation {
  const op = (redemption as { operation?: unknown } | null | undefined)
    ?.operation;
  if (
    typeof op !== "object" ||
    op === null ||
    Array.isArray(op) ||
    typeof (op as Record<string, unknown>)["cmd"] !== "string" ||
    typeof (op as Record<string, unknown>)["recipient"] !== "string" ||
    typeof (op as Record<string, unknown>)["termsDigest"] !== "string" ||
    typeof (op as Record<string, unknown>)["args"] !== "object" ||
    (op as Record<string, unknown>)["args"] === null ||
    Array.isArray((op as Record<string, unknown>)["args"])
  ) {
    throw new Error(
      "unbound redemption — authorize must bind the exact operation (ADR-0018)"
    );
  }
  return op as AuthorizedOperation;
}

/**
 * Runs only with proof of redemption carrying the EXACT authorized
 * operation: pass the successful `authorize` result. The instruction must
 * deep-equal the authorized terms (recipient, amount, currency, resource,
 * purpose, terms digest) — a bare `{ok:true}` or a redemption for
 * different terms is rejected. (It cannot prove freshness — redeem
 * immediately before executing. Callers persist consumption BEFORE calling
 * this, so a crash/failing rail burns a use instead of double-spending.)
 */
export async function executeAndReceipt(
  executor: PaymentExecutor,
  instruction: PaymentInstruction,
  redemption: Redemption,
  at: number
): Promise<Receipt> {
  if (redemption.ok !== true)
    throw new Error("execute: redemption required before execution");
  // Binding first (nothing bound at all?), then redemption flags (a dry-run
  // check authorizes nothing executable) — distinct forgeries, distinct errors.
  const op = requireBoundOperation(redemption);
  if (redemption.consumed !== true || redemption.proofVerified !== true) {
    throw new Error(
      "execute: dry-run check cannot execute — redeem with proof first (ADR-0018)"
    );
  }
  if (redemption.chainId !== instruction.capabilityId) {
    throw new Error("execute: redemption is not bound to this instruction");
  }
  if (op.cmd !== "/pay" && !op.cmd.startsWith("/pay/")) {
    throw new Error("execute: authorized cmd is not a payment");
  }
  if (op.termsDigest !== instruction.termsDigest) {
    throw new Error("execute: terms digest mismatch — new approval required");
  }
  if (op.recipient !== instruction.recipient) {
    throw new Error("execute: recipient differs from authorized terms");
  }
  if (op.resource === undefined || op.resource !== instruction.resource) {
    throw new Error("execute: resource differs from authorized terms");
  }
  if (op.purpose === undefined || op.purpose !== instruction.purpose) {
    throw new Error("execute: purpose differs from authorized terms");
  }
  if (
    !fieldsEqual(op.args, {
      amount: instruction.amount,
      currency: instruction.currency,
    })
  ) {
    throw new Error("execute: amount/currency differ from authorized terms");
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
    termsDigest: instruction.termsDigest,
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
  readonly vaultRev?: number;
}

export interface AuditEntry extends Required<
  Pick<AuditEvent, "at" | "actor" | "action">
> {
  readonly authorityId?: string;
  readonly capabilityId?: string;
  readonly detail?: string;
  readonly authorityRev?: number;
  readonly registryRev?: number;
  readonly vaultRev?: number;
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
    for (const field of ["authorityRev", "registryRev", "vaultRev"] as const) {
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
      ...(event.vaultRev !== undefined ? { vaultRev: event.vaultRev } : {}),
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
          (raw["registryRev"] as number) < 0)) ||
      (raw["vaultRev"] !== undefined &&
        (typeof raw["vaultRev"] !== "number" ||
          !Number.isInteger(raw["vaultRev"] as number) ||
          (raw["vaultRev"] as number) < 0))
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
