import { randomUUID } from "node:crypto";
import {
  digestForOperation,
  type Authority,
  type AuthorityOperation,
  type VerifiedIdentity,
} from "../core/authority.js";
import { evaluateProcessing } from "./engine.js";
import { canonicalize, sha256Hex } from "../core/canonical.js";
import type {
  PrivacyDecision,
  PrivacyDenyReason,
  PrivacyEventRepository,
  PrivacyProfile,
  PrivacySnapshot,
  ProcessingEventFinalize,
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

    if (!contextMatchesRequest(req)) {
      return {
        allow: false,
        publicReason: "privacy-denied",
        ...(opts.operatorDetail === true ? { operatorReason: "other" as const } : {}),
      };
    }

    const snapshot = this.loadPrivacy();
    const privacy = evaluateProcessing({
      activities: snapshot.activities,
      bases: snapshot.bases,
      notices: snapshot.notices,
      consents: snapshot.consents,
      holds: snapshot.holds,
      context: req.processing,
      profile: this.profile,
      nowSec: this.nowSec(),
    });
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

  recheck(
    prior: Extract<PrivacyGateResult, { allow: true }>,
    req: PrivacyGateRequest
  ): Extract<PrivacyGateResult, { allow: true }> {
    const live = this.preflight(req, { operatorDetail: true });
    if (!live.allow) {
      const detail =
        live.publicReason === "privacy-denied" && live.operatorReason !== undefined
          ? `: ${live.operatorReason}`
          : "";
      throw new Error(`privacy runtime: ${live.publicReason.replace("-", " ")}${detail}`);
    }
    if (
      live.termsDigest !== prior.termsDigest ||
      live.processingDigest !== prior.processingDigest ||
      live.privacy.activityId !== prior.privacy.activityId ||
      live.privacy.basisId !== prior.privacy.basisId ||
      live.privacy.profileId !== prior.privacy.profileId ||
      live.privacy.profileRevision !== prior.privacy.profileRevision
    ) {
      throw new Error("privacy runtime: processing context changed since preflight");
    }
    return live;
  }

  prepareEvent(
    allowed: Extract<PrivacyGateResult, { allow: true }>,
    req: PrivacyGateRequest,
    attemptRef: string = randomUUID()
  ): ProcessingEventRecord {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(attemptRef)) {
      throw new Error("privacy runtime: invalid attempt reference");
    }
    return this.events.prepare({
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
      preparedAt: this.nowSec(),
    });
  }

  finalizeEvent(
    eventId: string,
    state: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN",
    outcome: ProcessingEventFinalize
  ): ProcessingEventRecord {
    return this.events.transition(eventId, state, outcome);
  }
}
