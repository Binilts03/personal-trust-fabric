import { canonicalize } from "../core/canonical.js";
import { randomHex } from "../core/crypto.js";
import { isNonEmptyString } from "./guards.js";
import type {
  PaymentExecutor,
  PaymentInstruction,
  Receipt,
} from "../core/execute.js";

/**
 * Protected provider seam (P0 slice 3).
 *
 * PTF decides; external rails execute. A `ProtectedProvider` moves value (or
 * books travel/retail/email/identity effects) per a capability-bound request
 * and returns an external reference the host verifies before it can enter a
 * receipt. Rail results are evidence, never authority (ADR-0005): hosts must
 * run the existing `x402`/`ap2` verifiers (`checkSettlement`,
 * `verifyMandatePair`) on provider output before trusting it.
 *
 * Requests carry handles only (`capabilityId`, `termsDigest`, ids, amounts) —
 * never raw secrets. Receipts reuse `Receipt` with `transaction=externalRef`
 * and a fixed field set, so non-propagation holds by construction for the
 * receipt itself; callers must keep free-text `context` handles secret-free
 * (same host obligation as `execute.ts` `detail`).
 *
 * Host glue (`providerAsExecutor`) adapts a payment provider to the existing
 * `PaymentExecutor` shape, so `executeAndReceipt` call sites are untouched.
 */

export type ProviderKind =
  "payment" | "travel" | "retail" | "email" | "identity";

export interface ProviderRequest {
  readonly capabilityId: string;
  readonly termsDigest: string;
  readonly action: `/${string}`;
  readonly recipient: string;
  readonly resource: string;
  readonly purpose: string;
  /** Handles only — ids, amounts, refs. Never secrets. */
  readonly context: Readonly<Record<string, unknown>>;
}

export interface ProviderSubmission {
  readonly kind: ProviderKind;
  readonly capabilityId: string;
  readonly termsDigest: string;
  readonly externalRef: string;
  readonly at: number;
}

export interface ProtectedProvider {
  readonly kind: ProviderKind;
  submit(req: ProviderRequest): Promise<ProviderSubmission>;
  verify(
    sub: ProviderSubmission,
    expected: { readonly capabilityId: string; readonly termsDigest: string }
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string };
}

function checkRequest(req: ProviderRequest): void {
  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    throw new Error("provider: request must be an object");
  }
  if (!isNonEmptyString(req.capabilityId) || req.capabilityId.length < 8) {
    throw new Error("provider: capabilityId required");
  }
  if (!isNonEmptyString(req.termsDigest) || req.termsDigest.length < 16) {
    throw new Error("provider: termsDigest required");
  }
  if (
    typeof req.action !== "string" ||
    !req.action.startsWith("/") ||
    req.action === "/"
  ) {
    throw new Error('provider: action must be a /-path ("/" forbidden)');
  }
  if (!isNonEmptyString(req.recipient))
    throw new Error("provider: recipient required");
  if (!isNonEmptyString(req.resource))
    throw new Error("provider: resource required");
  if (!isNonEmptyString(req.purpose))
    throw new Error("provider: purpose required");
  if (
    typeof req.context !== "object" ||
    req.context === null ||
    Array.isArray(req.context)
  ) {
    throw new Error("provider: context must be an object");
  }
  try {
    canonicalize(req.context);
  } catch {
    throw new Error("provider: context must be canonicalizable (handles only)");
  }
}

/** In-memory stand-in per kind. Records calls for assertions. Moves nothing. */
export class FakeProvider implements ProtectedProvider {
  readonly calls: ProviderRequest[] = [];
  constructor(
    readonly kind: ProviderKind,
    private readonly opts: {
      readonly prefix?: string;
      readonly nowSec?: () => number;
    } = {}
  ) {}

  async submit(req: ProviderRequest): Promise<ProviderSubmission> {
    checkRequest(req);
    this.calls.push({
      ...req,
      context: { ...req.context },
    });
    const prefix = this.opts.prefix ?? `fake-${this.kind}`;
    const now = this.opts.nowSec?.() ?? Math.floor(Date.now() / 1000);
    return {
      kind: this.kind,
      capabilityId: req.capabilityId,
      termsDigest: req.termsDigest,
      externalRef: `${prefix}-${randomHex(8)}`,
      at: now,
    };
  }

  verify(
    sub: ProviderSubmission,
    expected: { readonly capabilityId: string; readonly termsDigest: string }
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (typeof sub !== "object" || sub === null)
      return { ok: false, reason: "malformed submission" };
    if (sub.kind !== this.kind) return { ok: false, reason: "kind mismatch" };
    if (sub.capabilityId !== expected.capabilityId)
      return { ok: false, reason: "capability mismatch" };
    if (sub.termsDigest !== expected.termsDigest)
      return { ok: false, reason: "terms mismatch" };
    if (!isNonEmptyString(sub.externalRef))
      return { ok: false, reason: "missing externalRef" };
    return { ok: true };
  }
}

/** One canned fake per kind (each records its own calls, moves nothing). */
export function makeFakeProviders(
  opts: { readonly nowSec?: () => number } = {}
): Record<ProviderKind, FakeProvider> {
  return {
    payment: new FakeProvider("payment", opts),
    travel: new FakeProvider("travel", opts),
    retail: new FakeProvider("retail", opts),
    email: new FakeProvider("email", opts),
    identity: new FakeProvider("identity", opts),
  };
}

/**
 * Adapt a payment provider to the existing `PaymentExecutor` shape.
 * `executeAndReceipt` call sites stay untouched: they keep passing an
 * executor, an identity-free instruction, and a redemption proof.
 */
export function providerAsExecutor(
  provider: ProtectedProvider,
  binding: { readonly capabilityId: string; readonly termsDigest: string }
): PaymentExecutor {
  if (!isNonEmptyString(binding.capabilityId))
    throw new Error("provider: capabilityId required");
  if (!isNonEmptyString(binding.termsDigest))
    throw new Error("provider: termsDigest required");
  return {
    async executePayment(
      instruction: PaymentInstruction
    ): Promise<{ readonly ok: true; readonly transaction: string }> {
      if (instruction.capabilityId !== binding.capabilityId) {
        throw new Error(
          "provider: instruction is not bound to this capability"
        );
      }
      const req: ProviderRequest = {
        capabilityId: binding.capabilityId,
        termsDigest: binding.termsDigest,
        action: "/pay",
        recipient: instruction.recipient,
        resource: instruction.resource,
        purpose: instruction.purpose,
        context: { amount: instruction.amount, currency: instruction.currency },
      };
      const sub = await provider.submit(req);
      const checked = provider.verify(sub, binding);
      if (!checked.ok) throw new Error(`provider: ${checked.reason}`);
      return { ok: true, transaction: sub.externalRef };
    },
  };
}

/**
 * Generic provider execution with receipt. Requires proof of redemption
 * bound to the request (`chainId === capabilityId`) and pins `termsDigest`
 * through `verify` — a verify failure throws before any receipt exists.
 * `provider.verify` is provider-attested: independent rail settlement checks
 * (`checkSettlement`, `verifyMandatePair`) remain host duty before trusting
 * `externalRef` for value movement (ADR-0005). Receipt reuses `Receipt` with
 * `transaction=externalRef`; amount/currency must ride explicitly in context
 * (0 and explicit values allowed) so the receipt never invents terms the
 * demand did not carry.
 */
export async function executeViaProvider(
  provider: ProtectedProvider,
  req: ProviderRequest,
  redemption: { readonly ok: true; readonly chainId: string },
  at: number
): Promise<Receipt> {
  checkRequest(req);
  if (redemption.ok !== true)
    throw new Error("provider: redemption required before execution");
  if (redemption.chainId !== req.capabilityId) {
    throw new Error("provider: redemption is not bound to this request");
  }
  const sub = await provider.submit(req);
  const checked = provider.verify(sub, {
    capabilityId: req.capabilityId,
    termsDigest: req.termsDigest,
  });
  if (!checked.ok) throw new Error(`provider: ${checked.reason}`);
  const amountRaw: unknown = (req.context as Record<string, unknown>)["amount"];
  const currencyRaw: unknown = (req.context as Record<string, unknown>)[
    "currency"
  ];
  if (
    typeof amountRaw !== "number" ||
    !Number.isFinite(amountRaw) ||
    amountRaw < 0
  ) {
    throw new Error(
      "provider: receipt needs context.amount as a non-negative finite number (pass explicitly; 0 allowed)"
    );
  }
  if (typeof currencyRaw !== "string" || currencyRaw.length === 0) {
    throw new Error(
      "provider: receipt needs context.currency as a non-empty string (pass explicitly)"
    );
  }
  const amount: number = amountRaw;
  const currency: string = currencyRaw;
  return {
    receiptId: `rcpt-${randomHex(8)}`,
    capabilityId: req.capabilityId,
    recipient: req.recipient,
    amount,
    currency,
    resource: req.resource,
    purpose: req.purpose,
    transaction: sub.externalRef,
    at,
  };
}
