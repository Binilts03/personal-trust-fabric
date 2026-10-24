import {
  digestForOperation,
  type Authority,
  type AuthorityOperation,
  type VerifiedIdentity,
} from "../core/authority.js";
import { evaluateProcessing } from "./engine.js";
import { PrivacyEventConflictError } from "./errors.js";
import { canonicalize, sha256Hex } from "../core/canonical.js";
import { randomUUID } from "node:crypto";
import type {
  PrivacyDecision,
  PrivacyDenyReason,
  PrivacyEventRepository,
  PrivacyProfile,
  PrivacySnapshot,
  ProcessingEventFinalize,
  ProcessingEventPrepare,
  ProcessingEventRecord,
  TrustedProcessingContext,
} from "./model.js";

export interface PrivacyRuntimeDeps {
  readonly loadPrivacy: () => PrivacySnapshot;
  readonly events: PrivacyEventRepository;
  readonly profile: PrivacyProfile;
  readonly nowSec?: () => number;
}

export interface PrivacyGateRequest {
  readonly authority: Authority;
  readonly ingress: VerifiedIdentity;
  readonly operation: AuthorityOperation;
  readonly processing: TrustedProcessingContext;
}

export type PrivacyGateResult =
  | {
      readonly allow: true;
      readonly privacy: Extract<PrivacyDecision, { allow: true }>;
      readonly termsDigest: string;
      readonly processingDigest: string;
      readonly authorityCitationIds: readonly string[];
    }
  | {
      readonly allow: false;
      readonly publicReason: "authority-denied" | "privacy-denied";
      readonly operatorReason?: PrivacyDenyReason;
    };

function contextMatchesRequest(req: PrivacyGateRequest): boolean {
  const { processing, ingress, operation } = req;
  return (
    processing.authorityPrincipal === ingress.principal &&
    processing.actor === ingress.id &&
    processing.action === operation.action.name &&
    processing.resource.type === operation.resource.type &&
    processing.resource.id === operation.resource.id &&
    processing.purpose === (operation.purpose ?? "")
  );
}

function boundForDigest(req: PrivacyGateRequest) {
  return {
    principal: req.ingress.principal,
    actor: req.ingress.id,
    ...(req.ingress.chain !== undefined
      ? { actorChain: [...req.ingress.chain] }
      : {}),
    action: req.operation.action,
    resource: req.operation.resource,
    context: req.operation.context,
    ...(req.operation.purpose !== undefined
      ? { purpose: req.operation.purpose }
      : {}),
  };
}

/**
 * Turn a denied gate into the coarse, agent-facing failure the privacy
 * surface uses. The detailed reason stays on the operator/audit surface.
 */
export function denyGate(
  result: Exclude<PrivacyGateResult, { allow: true }>
): never {
  throw new Error(
    result.publicReason === "authority-denied"
      ? "authority denied"
      : "privacy denied"
  );
}

export class PrivacyRuntime {
  private readonly loadPrivacy: () => PrivacySnapshot;
  private readonly events: PrivacyEventRepository;
  private readonly profile: PrivacyProfile;
  private readonly nowSec: () => number;

  constructor(deps: PrivacyRuntimeDeps) {
    this.loadPrivacy = deps.loadPrivacy;
    this.events = deps.events;
    this.profile = deps.profile;
    this.nowSec = deps.nowSec ?? (() => Math.floor(Date.now() / 1000));
  }

  now(): number {
    return this.nowSec();
  }

  preflight(
    req: PrivacyGateRequest,
    opts: { readonly operatorDetail?: boolean } = {}
  ): PrivacyGateResult {
    const authority = req.authority.evaluate(req.operation, req.ingress, {
      consume: false,
      nowSec: this.nowSec(),
    });
    if (!authority.allow) {
      return { allow: false, publicReason: "authority-denied" };
    }

    const privacy = this.evaluatePrivacy(req);
    if (!privacy.allow) {
      return {
        allow: false,
        publicReason: "privacy-denied",
        ...(opts.operatorDetail === true
          ? { operatorReason: privacy.reason }
          : {}),
      };
    }

    return {
      allow: true,
      privacy,
      termsDigest: digestForOperation(boundForDigest(req)),
      processingDigest: sha256Hex(canonicalize(req.processing)),
      authorityCitationIds: authority.citations.map((c) => c.authorityId),
    };
  }

  /**
   * Privacy-only decision. Authority is deliberately excluded so journal
   * recovery can reconstruct missing evidence after the grant was spent.
   */
  private evaluatePrivacy(req: PrivacyGateRequest): PrivacyDecision {
    if (!contextMatchesRequest(req)) {
      return { allow: false, reason: "other" };
    }
    const snapshot = this.loadPrivacy();
    return evaluateProcessing({
      activities: snapshot.activities,
      bases: snapshot.bases,
      notices: snapshot.notices,
      consents: snapshot.consents,
      holds: snapshot.holds,
      context: req.processing,
      profile: this.profile,
      nowSec: this.nowSec(),
    });
  }

  recheck(
    prior: Extract<PrivacyGateResult, { allow: true }>,
    req: PrivacyGateRequest
  ): Extract<PrivacyGateResult, { allow: true }> {
    const live = this.preflight(req, { operatorDetail: true });
    if (!live.allow) {
      const detail =
        live.publicReason === "privacy-denied" &&
        live.operatorReason !== undefined
          ? `: ${live.operatorReason}`
          : "";
      throw new Error(
        `privacy runtime: ${live.publicReason.replace("-", " ")}${detail}`
      );
    }
    if (
      live.termsDigest !== prior.termsDigest ||
      live.processingDigest !== prior.processingDigest ||
      live.privacy.activityId !== prior.privacy.activityId ||
      live.privacy.basisId !== prior.privacy.basisId ||
      live.privacy.profileId !== prior.privacy.profileId ||
      live.privacy.profileRevision !== prior.privacy.profileRevision
    ) {
      throw new Error(
        "privacy runtime: processing context changed since preflight"
      );
    }
    return live;
  }

  /**
   * The effect-boundary fence. The privacy decision is re-evaluated against
   * the current privacy state right before the effect: a withdrawal, a
   * deactivation, or a changed basis that lands after the recheck stops the
   * attempt instead of processing anyway. The message stays coarse - the
   * reason belongs to the operator surface.
   *
   * Only the privacy state is re-read. The authority decision was already
   * made and consumed for this attempt, so re-evaluating it would fail on
   * the spent use instead of on the privacy state.
   */
  fence(
    prior: Extract<PrivacyGateResult, { allow: true }>,
    req: PrivacyGateRequest
  ): void {
    const privacy = this.evaluatePrivacy(req);
    if (!privacy.allow) throw new Error("privacy denied");
    const same = [
      privacy.activityId === prior.privacy.activityId,
      privacy.basisId === prior.privacy.basisId,
      privacy.profileId === prior.privacy.profileId,
      privacy.profileRevision === prior.privacy.profileRevision,
    ];
    if (!same.every((equal) => equal)) {
      throw new Error("privacy denied");
    }
  }

  prepareEvent(
    allowed: Extract<PrivacyGateResult, { allow: true }>,
    req: PrivacyGateRequest,
    attemptRef: string = randomUUID()
  ): ProcessingEventRecord {
    // Bind the prepared evidence to the exact gate result, not just to the
    // mutable request object. Library callers cannot swap the action,
    // resource, identity or processing context after preflight/recheck.
    if (sha256Hex(canonicalize(req.processing)) !== allowed.processingDigest) {
      throw new Error(
        "privacy runtime: processing context changed before prepare"
      );
    }
    if (digestForOperation(boundForDigest(req)) !== allowed.termsDigest) {
      throw new Error("privacy runtime: operation changed before prepare");
    }
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(attemptRef)) {
      throw new Error("privacy runtime: invalid attempt reference");
    }
    const event = this.events.prepare(
      this.eventInput(allowed, req, attemptRef, this.nowSec())
    );
    if (event.state !== "PREPARED") {
      // Never run a new external effect against existing evidence. A retry
      // of the same attempt must be resolved from the journal/operator
      // reconciliation, not by treating this as a new denial.
      throw new PrivacyEventConflictError(event.eventId, event.state);
    }
    return event;
  }

  /**
   * Reconcile the Processing Event for one exact attempt from conclusive
   * journal evidence. This path never consults live authority for an
   * already-effected operation: the grant may be spent. It may reconstruct a
   * missing event from the still-valid privacy configuration, but does not
   * invent authority citations that cannot be recovered.
   */
  reconcileAttemptEvent(
    req: PrivacyGateRequest,
    opts: {
      readonly termsDigest: string;
      readonly attemptRef: string;
      readonly state: "SUCCEEDED" | "FAILED_FINAL";
      readonly finalizedAt: number;
      readonly evidenceRef?: string;
      readonly preparedAt?: number;
      readonly createIfMissing?: boolean;
    }
  ): "finalized" | "absent" {
    const event = this.locateAttemptEvent(req, opts);
    if (event === null) {
      if (opts.createIfMissing !== true) return "absent";
      return this.finalizeReconstructedEvent(req, opts);
    }
    return this.finalizeAttemptEvent(event, opts);
  }

  /**
   * Recover an event ID for legacy receipt projection only after journal
   * reconciliation has succeeded. This exact-identity lookup never creates
   * processing evidence or re-evaluates consumed Authority.
   */
  reconciledEventId(req: PrivacyGateRequest, termsDigest: string, attemptRef: string): string {
    const event = this.locateAttemptEvent(req, { termsDigest, attemptRef });
    if (event === null || event.state !== "SUCCEEDED") {
      throw new Error("privacy runtime: reconciled event evidence unavailable");
    }
    return event.eventId;
  }

  /**
   * The single event that covers this exact attempt, or null when there is
   * none. More than one match is ambiguous evidence, never a choice.
   */
  private locateAttemptEvent(
    req: PrivacyGateRequest,
    opts: { readonly termsDigest: string; readonly attemptRef: string }
  ): ProcessingEventRecord | null {
    const find = this.events.findByAttempt;
    if (find === undefined) {
      throw new Error("privacy runtime: attempt lookup unsupported");
    }
    const matches = find.call(this.events, opts.termsDigest, opts.attemptRef);
    if (matches.length > 1) {
      throw new Error("privacy runtime: ambiguous attempt evidence");
    }
    const event = matches[0];
    if (event === undefined) return null;
    const expected = [
      event.authorityPrincipal === req.ingress.principal,
      event.actor === req.ingress.id,
      event.dataPrincipalRef === req.processing.dataPrincipalRef,
      event.controllerId === req.processing.controllerId,
      event.action === req.processing.action,
      event.resource.type === req.processing.resource.type,
      event.resource.id === req.processing.resource.id,
      event.purpose === req.processing.purpose,
    ];
    if (!expected.every((same) => same)) {
      throw new Error("privacy runtime: attempt evidence identity mismatch");
    }
    return event;
  }

  /**
   * Rebuild a missing event for an attempt whose effect the journal already
   * proved. The privacy decision must still hold; authority citations are
   * best-effort because the grant may already be spent.
   */
  private finalizeReconstructedEvent(
    req: PrivacyGateRequest,
    opts: {
      readonly termsDigest: string;
      readonly attemptRef: string;
      readonly state: "SUCCEEDED" | "FAILED_FINAL";
      readonly finalizedAt: number;
      readonly evidenceRef?: string;
      readonly preparedAt?: number;
    }
  ): "finalized" {
    if (digestForOperation(boundForDigest(req)) !== opts.termsDigest) {
      throw new Error("privacy runtime: terms mismatch for recovered evidence");
    }
    const privacy = this.evaluatePrivacy(req);
    if (!privacy.allow) {
      throw new Error("privacy runtime: privacy denied for recovered evidence");
    }
    const recovered = {
      allow: true as const,
      privacy,
      termsDigest: opts.termsDigest,
      processingDigest: sha256Hex(canonicalize(req.processing)),
      authorityCitationIds: this.recoverableCitationIds(req),
    };
    const event = this.events.prepare(
      this.eventInput(
        recovered,
        req,
        opts.attemptRef,
        opts.preparedAt ?? this.nowSec()
      )
    );
    return this.finalizeAttemptEvent(event, opts);
  }

  /** Citations the live authority can still prove, if any. */
  private recoverableCitationIds(req: PrivacyGateRequest): string[] {
    try {
      const authority = req.authority.evaluate(req.operation, req.ingress, {
        consume: false,
        nowSec: this.nowSec(),
      });
      return authority.allow
        ? authority.citations.map((c) => c.authorityId)
        : [];
    } catch {
      // A consumed or unreadable authority cannot supply citations; the
      // journal receipt remains the effect evidence.
      return [];
    }
  }

  /** Terminal evidence is never overwritten; only open states resolve. */
  private finalizeAttemptEvent(
    event: ProcessingEventRecord,
    opts: {
      readonly state: "SUCCEEDED" | "FAILED_FINAL";
      readonly finalizedAt: number;
      readonly evidenceRef?: string;
    }
  ): "finalized" {
    if (event.state === opts.state) return "finalized";
    if (event.state !== "PREPARED" && event.state !== "OUTCOME_UNKNOWN") {
      throw new PrivacyEventConflictError(event.eventId, event.state);
    }
    this.events.transition(event.eventId, opts.state, {
      finalizedAt: opts.finalizedAt,
      ...(opts.evidenceRef !== undefined
        ? { evidenceRef: opts.evidenceRef }
        : {}),
    });
    return "finalized";
  }

  finalizeEvent(
    eventId: string,
    state: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN",
    outcome: ProcessingEventFinalize
  ): ProcessingEventRecord {
    return this.events.transition(eventId, state, outcome);
  }

  private eventInput(
    allowed: Extract<PrivacyGateResult, { allow: true }>,
    req: PrivacyGateRequest,
    attemptRef: string,
    preparedAt: number
  ): ProcessingEventPrepare {
    return {
      attemptRef,
      profileId: allowed.privacy.profileId,
      profileRevision: allowed.privacy.profileRevision,
      dataPrincipalRef: req.processing.dataPrincipalRef,
      authorityPrincipal: req.ingress.principal,
      actor: req.ingress.id,
      controllerId: req.processing.controllerId,
      activityId: allowed.privacy.activityId,
      basisId: allowed.privacy.basisId,
      purpose: req.processing.purpose,
      action: req.processing.action,
      resource: { ...req.processing.resource },
      dataCategories: [...req.processing.dataCategories],
      recipients: req.processing.recipients.map((r) => ({ ...r })),
      termsDigest: allowed.termsDigest,
      authorityCitationIds: [...allowed.authorityCitationIds],
      preparedAt,
    };
  }
}
