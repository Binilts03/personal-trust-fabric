import type {
  Authority,
  AuthorityRequest,
  VerifiedIdentity,
} from "../core/authority.js";
import { FilePrivacyEventRepository } from "../store/privacy-events.js";
import {
  loadPrivacyStore,
  readPrivacyKid,
  resolvePrivacyDek,
} from "../store/privacy.js";
import { dpdpProfile } from "./dpdp.js";
import { PrivacyEventConflictError } from "./errors.js";
import {
  makeMcpPrivacyDisclosureGate,
  makeMcpPrivacyPaymentGate,
  type McpPrivacyConfig,
} from "./mcp.js";
import {
  inspectPaymentJournal,
  type PaymentJournalReplay,
  type PaymentReceipt,
} from "./payment-replay.js";
import { PrivacyRuntime, type PrivacyGateRequest } from "./runtime.js";

/**
 * Host wiring for the reference MCP server. Policy construction stays in
 * `mcp.ts`; this module binds it to the encrypted host stores and owns the
 * journal-replay orchestration. The MCP server keeps routing and the
 * agent-facing response mapping. It is intentionally not re-exported from
 * the curated public privacy API.
 */
export function privacyForOperation(opts: {
  readonly dir: string;
  readonly keys: Record<string, Uint8Array>;
  readonly auth: Authority;
  readonly ingress: VerifiedIdentity;
  readonly demand: AuthorityRequest;
  readonly config: McpPrivacyConfig;
  readonly now: () => number;
}): { runtime: PrivacyRuntime; gate: PrivacyGateRequest } {
  let binding: Omit<PrivacyGateRequest, "authority">;
  if (opts.demand.action.name === "/pay") {
    binding = makeMcpPrivacyPaymentGate(opts.config, opts.ingress, opts.demand);
  } else if (opts.demand.action.name === "/disclose") {
    binding = makeMcpPrivacyDisclosureGate(
      opts.config,
      opts.ingress,
      opts.demand
    );
  } else {
    throw new Error("privacy denied");
  }
  const kid = readPrivacyKid(opts.dir);
  if (kid === null) throw new Error("privacy denied");
  const dek = resolvePrivacyDek(opts.keys, kid);
  return {
    gate: { ...binding, authority: opts.auth },
    runtime: new PrivacyRuntime({
      loadPrivacy: () =>
        loadPrivacyStore(opts.dir, {
          keys: opts.keys,
          nowSec: opts.now,
        }).snapshot(),
      events: new FilePrivacyEventRepository({
        dir: opts.dir,
        dek,
        nowSec: opts.now,
      }),
      profile: dpdpProfile,
      nowSec: opts.now,
    }),
  };
}

/** The exact payment terms a stored demand carries, or null when malformed. */
function paymentTerms(demand: AuthorityRequest): {
  readonly amount: number;
  readonly currency: string;
  readonly recipient: string;
  readonly resource: string;
  readonly purpose: string;
} | null {
  if (demand.action.name !== "/pay") return null;
  const amount: unknown = demand.context["amount"];
  const currency: unknown = demand.context["currency"];
  const recipient: unknown = demand.context["recipient"];
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  if (typeof currency !== "string" || currency.length === 0) return null;
  if (typeof recipient !== "string" || recipient.length === 0) return null;
  return {
    amount,
    currency,
    recipient,
    resource: demand.resource.id,
    purpose: demand.purpose ?? "payment",
  };
}

/**
 * The journal lookup terms for a stored demand. One builder for every call
 * site: the read-only status tools and the live redeem path must never
 * consult the journal under different terms.
 */
function paymentJournalTerms(
  dir: string,
  termsDigest: string,
  demand: AuthorityRequest
): {
  readonly dir: string;
  readonly termsDigest: string;
  readonly action: "/pay";
  readonly recipient: string;
  readonly resource: string;
  readonly purpose: string;
  readonly context: Readonly<Record<string, unknown>>;
} | null {
  const terms = paymentTerms(demand);
  if (terms === null) return null;
  return {
    dir,
    termsDigest,
    action: "/pay",
    recipient: terms.recipient,
    resource: terms.resource,
    purpose: terms.purpose,
    context: { amount: terms.amount, currency: terms.currency },
  };
}

/** Read-only journal inspection for a stored proposal. */
export function inspectProposalJournal(
  dir: string,
  termsDigest: string,
  demand: AuthorityRequest
): PaymentJournalReplay {
  const expectation = paymentJournalTerms(dir, termsDigest, demand);
  if (expectation === null) return { kind: "none" };
  return inspectPaymentJournal(expectation);
}

/**
 * The outcome of a journal-first payment replay.
 *
 * `none` means the journal has no conclusive record, so the caller
 * continues with the live path. `receipt` is a conclusive success: the
 * effect happened, and `evidence` says whether the Processing Event could
 * be reconciled (`gap` means it could not, and the operator must reconcile
 * it - the payment outcome itself stays proven).
 */
export type McpPaymentReplay =
  | { readonly kind: "none" }
  | {
      readonly kind: "receipt";
      readonly receipt: PaymentReceipt;
      readonly evidence: "finalized" | "gap";
    }
  | {
      readonly kind: "unknown";
      /**
       * `unsubmitted`: the journal row never reached the provider, so no
       * effect happened and the spent authority use cannot be reused.
       * Every other reason is genuinely ambiguous.
       */
      readonly reason:
        "corrupt" | "live" | "mismatch" | "reconciled" | "unsubmitted";
    }
  | { readonly kind: "failed_final" }
  | { readonly kind: "evidence_conflict"; readonly state: string };

/**
 * Journal-first replay for a `/pay` attempt. A conclusive journal record is
 * history, not authority: it never spends an authority use, never mints a
 * capability, and never starts a second effect.
 */
export function replayPaymentAttempt(opts: {
  readonly dir: string;
  readonly keys: Record<string, Uint8Array>;
  readonly auth: Authority;
  readonly ingress: VerifiedIdentity;
  readonly demand: AuthorityRequest;
  readonly config: McpPrivacyConfig | undefined;
  readonly now: () => number;
}): McpPaymentReplay {
  const termsDigest = opts.demand.termsDigest;
  if (termsDigest === undefined) return { kind: "none" };
  const replay = inspectProposalJournal(opts.dir, termsDigest, opts.demand);
  if (replay.kind === "none") return { kind: "none" };
  if (replay.kind === "unknown") {
    return { kind: "unknown", reason: replay.reason };
  }
  if (replay.kind === "failed_final") return { kind: "failed_final" };
  let evidence: "finalized" | "gap" = "finalized";
  if (opts.config !== undefined) {
    try {
      const scoped = privacyForOperation({
        dir: opts.dir,
        keys: opts.keys,
        auth: opts.auth,
        ingress: opts.ingress,
        demand: opts.demand,
        config: opts.config,
        now: opts.now,
      });
      scoped.runtime.reconcileAttemptEvent(scoped.gate, {
        termsDigest,
        attemptRef: termsDigest,
        state: "SUCCEEDED",
        finalizedAt: replay.receipt.at,
        evidenceRef: `journal:${replay.receipt.receiptId}`,
        preparedAt: replay.record.createdAt,
        createIfMissing: true,
      });
    } catch (error) {
      if (error instanceof PrivacyEventConflictError) {
        return { kind: "evidence_conflict", state: error.state };
      }
      // The journal proves the payment; the processing evidence could not
      // be reconciled (for example the operator deactivated the basis after
      // the effect). The gap is reported to the operator - the payment
      // outcome is never downgraded to "unknown".
      evidence = "gap";
    }
  }
  return { kind: "receipt", receipt: replay.receipt, evidence };
}
