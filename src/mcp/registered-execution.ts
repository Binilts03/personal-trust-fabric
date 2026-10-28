import type { Authority, AuthorityRequest, VerifiedIdentity } from "../core/authority.js";
import type { RecipientRegistry } from "../core/identity.js";
import type { FileAuditLog } from "../store/files.js";
import { privateKeyFromPkcs8 } from "../core/crypto.js";
import type { KeyResolver } from "../core/types.js";
import { digestForOperation } from "../core/authority.js";
import {
  createHostRedemptionChallenge, createProtectedEffect,
  ProtectedEffectOutcomeUnknownError, type HostRedemptionChallenge,
  type ProcessingMode,
} from "../hostkit/index.js";
import { PrivacyOutcomeUnknownError } from "../privacy/errors.js";
import { inspectExecutionJournal } from "../store/execution-replay.js";
import { recoverExecutedProposal, transitionProposal } from "../store/challenges.js";
import type { RegisteredAction } from "./registered-actions.js";

/** Durable proposal input; the entire stored bound operation is untrusted until validated. */
export interface RegisteredProposal {
  readonly demand: AuthorityRequest;
  readonly status: "pending" | "denied" | "executed";
}
export interface RegisteredHostState {
  readonly auth: Authority;
  readonly reg: RecipientRegistry;
  readonly audit: FileAuditLog;
  readonly keys: Record<string, Uint8Array>;
}
export interface RegisteredProofArgs {
  readonly termsDigest: string;
  readonly recipientKeyHex?: string | undefined;
  readonly recipientSigHex?: string | undefined;
}
type TextResult = { content: { type: "text"; text: string }[] };
function answer(payload: Readonly<Record<string, unknown>>): TextResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
function denied(): never {
  throw new Error("registered action denied");
}
function snapshot(
  demand: AuthorityRequest,
  ingress: VerifiedIdentity,
  digest: string
): { readonly operation: Omit<AuthorityRequest, "principal" | "actor" | "termsDigest" | "actorChain">; readonly recipient: string } {
  if (demand.principal !== ingress.principal || demand.actor !== ingress.id) denied();
  const { termsDigest: _old, ...bound } = demand;
  void _old;
  if (digestForOperation(bound) !== digest) denied();
  const { principal: _principal, actor: _actor, actorChain: _chain, ...operation } = bound;
  void _principal; void _actor; void _chain;
  const recipient = operation.context["recipient"];
  if (typeof recipient !== "string" || recipient.length === 0) denied();
  if (typeof operation.purpose !== "string" || operation.purpose.length === 0) denied();
  return { operation, recipient };
}
export class RegisteredActionExecutor {
  private readonly pending = new Map<string, {
    readonly actor: string;
    readonly until: number;
    readonly challenge: HostRedemptionChallenge;
  }>();
  constructor(
    private readonly deps: {
      readonly dir: string;
      readonly now: () => number;
      readonly privacyConfigured: boolean;
      readonly actions: ReadonlyMap<string, RegisteredAction>;
      readonly resolveKey: (reg: RecipientRegistry, keys: Record<string, Uint8Array>) => KeyResolver;
    }
  ) {}

  private processing(
    registered: RegisteredAction,
    demand: AuthorityRequest,
    ingress: VerifiedIdentity,
    auth: Authority
  ): ProcessingMode {
    let mode: ProcessingMode;
    try {
      registered.validate(demand);
      mode = registered.processing(demand, ingress, auth);
    } catch { return denied(); }
    if (mode === undefined ||
        (mode.kind !== "enforced" && mode.kind !== "not-enforced") ||
        (this.deps.privacyConfigured && mode.kind !== "enforced")) denied();
    return mode;
  }

  /** No agent-supplied handler, provider, privacy flag, or personal-data field. */
  proposalAllowed(
    demand: AuthorityRequest,
    ingress: VerifiedIdentity,
    auth: Authority
  ): boolean {
    const registered = this.deps.actions.get(demand.action.name);
    if (registered === undefined) return !this.deps.privacyConfigured;
    try {
      const { operation } = snapshot(demand, ingress, demand.termsDigest ?? "");
      const mode = this.processing(registered, demand, ingress, auth);
      if (!auth.evaluate(operation, ingress, { nowSec: this.deps.now() }).allow) return false;
      if (mode.kind === "enforced") {
        return mode.runtime.preflight(mode.gate).allow;
      }
      return true;
    } catch { return false; }
  }

  async redeem(
    proposal: RegisteredProposal,
    args: RegisteredProofArgs,
    ingress: VerifiedIdentity,
    state: RegisteredHostState
  ): Promise<TextResult> {
    const { demand } = proposal;
    const registered = this.deps.actions.get(demand.action.name);
    if (registered === undefined) denied();
    const { operation, recipient } = snapshot(demand, ingress, args.termsDigest);
    const processing = this.processing(registered, demand, ingress, state.auth);
    const journal = inspectExecutionJournal({
      dir: this.deps.dir,
      namespace: registered.provider.namespace ?? registered.provider.kind,
      termsDigest: args.termsDigest,
      action: operation.action.name,
      recipient,
      resource: operation.resource.id,
      purpose: operation.purpose ?? "",
      context: operation.context
    });
    if (journal.kind === "succeeded") {
      let processingEvidence: "finalized" | "gap" = "finalized";
      if (processing.kind === "enforced") {
        try {
          processing.runtime.reconcileAttemptEvent(processing.gate, {
            termsDigest: args.termsDigest,
            attemptRef: args.termsDigest,
            state: "SUCCEEDED",
            finalizedAt: journal.receipt.at,
            evidenceRef: "execution-receipt:" + journal.receipt.receiptId,
            preparedAt: journal.record.createdAt,
            createIfMissing: true,
          });
        } catch {
          // The journal conclusively proves external success; missing privacy
          // evidence is an operator-visible gap, not an unknown provider outcome.
          processingEvidence = "gap";
        }
      }
      const receipt = { ...journal.receipt, action: operation.action.name };
      const result = processingEvidence === "gap"
        ? { ...receipt, status: "executed" as const, processingEvidence: "gap" as const }
        : receipt;
      try {
        if (processingEvidence === "gap") {
          state.audit.append({
            actor: ingress.id,
            action: "privacy-evidence-gap",
            capabilityId: receipt.capabilityId,
            detail: receipt.receiptId,
          });
        }
        recoverExecutedProposal(this.deps.dir, args.termsDigest, result, this.deps.now());
        state.audit.append({
          actor: ingress.id,
          action: "redeem",
          capabilityId: receipt.capabilityId,
          detail: receipt.transaction,
          authorityRev: state.auth.loadedRevision(),
          registryRev: state.reg.loadedRevision(),
        });
      } catch { /* journal still proves the effect, and never retransmits */ }
      return answer(result);
    }
    if (journal.kind === "unknown") {
      return answer({ status: "outcome_unknown", termsDigest: args.termsDigest });
    }
    if (journal.kind === "failed_final") denied();
    if (proposal.status !== "pending") denied();

    if (args.recipientKeyHex === undefined || args.recipientSigHex === undefined) {
      if (args.recipientKeyHex !== undefined || args.recipientSigHex !== undefined) denied();
      const preview = state.auth.evaluate(operation, ingress, { nowSec: this.deps.now() });
      if (!preview.allow) denied();
      if (processing.kind === "enforced" && !processing.runtime.preflight(processing.gate).allow) denied();
      const seed = state.keys[ingress.principal];
      if (seed === undefined) denied();
      let challenge: HostRedemptionChallenge;
      try {
        challenge = createHostRedemptionChallenge({
          operation, ingress, recipient,
          principalPrivateKey: privateKeyFromPkcs8(seed),
          resolveKey: this.deps.resolveKey(state.reg, state.keys),
          nowSec: this.deps.now
        });
      } catch { return denied(); }
      this.pending.set(args.termsDigest, {
        actor: ingress.id,
        until: this.deps.now() + 120,
        challenge
      });
      return answer({ needProof: true, cidHex: challenge.cidHex, recipient });
    }
    const pending = this.pending.get(args.termsDigest);
    this.pending.delete(args.termsDigest);
    if (pending === undefined || pending.actor !== ingress.id ||
        this.deps.now() > pending.until) denied();
    let redemption: ReturnType<HostRedemptionChallenge["redeem"]>;
    try {
      redemption = pending.challenge.redeem({
        key: new Uint8Array(Buffer.from(args.recipientKeyHex, "hex")),
        sig: new Uint8Array(Buffer.from(args.recipientSigHex, "hex")),
      });
    } catch { return denied(); }
    let receipt;
    try {
      const effect = createProtectedEffect({
        dir: this.deps.dir,
        auth: state.auth, ingress, operation,
        authorizedContext: operation.context,
        now: this.deps.now,
        processing,
        effect: { kind: "provider", provider: registered.provider, redemption },
        attemptRef: args.termsDigest
      });
      receipt = await effect.run();
    } catch (error) {
      if (error instanceof ProtectedEffectOutcomeUnknownError ||
          error instanceof PrivacyOutcomeUnknownError) {
        return answer({ status: "outcome_unknown", termsDigest: args.termsDigest });
      }
      return denied();
    }
    const result = { ...receipt };
    try {
      state.audit.append({
        actor: ingress.id,
        action: "redeem",
        ...(receipt.authorityId !== undefined ? { authorityId: receipt.authorityId } : {}),
        ...(receipt.capabilityId !== undefined ? { capabilityId: receipt.capabilityId } : {}),
        ...(receipt.transaction !== undefined ? { detail: receipt.transaction } : {}),
        authorityRev: state.auth.loadedRevision(),
        registryRev: state.reg.loadedRevision()
      });
      transitionProposal(this.deps.dir,args.termsDigest,"executed",JSON.parse(JSON.stringify(result)) as Record<string, unknown>,this.deps.now());
    } catch {
      // Effect already happened: preserve receipt, journal-first replay repairs
      // proposal status if a later re-redeem finds the stale pending record.
    }
    return answer(result);
  }
}
