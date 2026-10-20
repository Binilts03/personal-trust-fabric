export type PrivacyRecipientRole =
  "data-processor" | "data-fiduciary" | "third-party" | "other";

export interface ProcessingRecipient {
  readonly id: string;
  readonly role: PrivacyRecipientRole;
}

export type PrivacySubjectSelector =
  | { readonly kind: "exact"; readonly ref: string }
  | { readonly kind: "set"; readonly refs: readonly string[] }
  | { readonly kind: "any" };

export interface NoticeEvidence {
  readonly id: string;
  readonly controllerId: string;
  readonly dataPrincipalRef: string;
  readonly purpose: string;
  readonly dataCategories: readonly string[];
  readonly noticeRef: string;
  readonly noticeHash: string;
  readonly presentedAt: number;
  readonly assertedBy: string;
  readonly language?: string;
  readonly version?: string;
}

export interface ConsentEvidence {
  readonly id: string;
  readonly noticeId: string;
  readonly controllerId: string;
  readonly dataPrincipalRef: string;
  readonly purpose: string;
  readonly dataCategories: readonly string[];
  readonly givenAt: number;
  readonly method: string;
  readonly proofRef: string;
  readonly assertedBy: string;
  readonly withdrawnAt?: number;
  readonly withdrawalProofRef?: string;
  readonly withdrawnBy?: string;
}

export type ProcessingBasisEvidence =
  | {
      readonly kind: "consent";
      readonly id: string;
      readonly controllerId: string;
      readonly dataPrincipalRef: string;
      readonly purpose: string;
      readonly dataCategories: readonly string[];
      readonly consentId: string;
      readonly assertedBy: string;
      readonly nbf?: number;
      readonly exp?: number;
      readonly active: boolean;
    }
  | {
      readonly kind: "certain-legitimate-use";
      readonly id: string;
      readonly controllerId: string;
      readonly purpose: string;
      readonly dataCategories: readonly string[];
      readonly provisionRef: string;
      readonly evidenceRef: string;
      readonly assertedBy: string;
      readonly nbf?: number;
      readonly exp?: number;
      readonly active: boolean;
    };

export interface RetentionHold {
  readonly id: string;
  readonly dataPrincipalRef: string;
  readonly recordIds: readonly string[];
  readonly dataCategories: readonly string[];
  readonly reasonRef: string;
  readonly assertedBy: string;
  readonly effectiveAt: number;
  readonly retainUntil: number | null;
  readonly releasedAt?: number;
  readonly releasedBy?: string;
}

export interface ProcessingActivity {
  readonly id: string;
  readonly profileId: string;
  readonly authorityPrincipal: string;
  readonly controllerId: string;
  readonly subjects: PrivacySubjectSelector;
  readonly action: `/${string}`;
  readonly resourceType: string;
  readonly purpose: string;
  readonly dataCategories: readonly string[];
  readonly recipients: readonly ProcessingRecipient[];
  readonly basisId: string;
  readonly allowedTransferDestinations?: readonly string[];
  readonly nbf?: number;
  readonly exp?: number;
  readonly active: boolean;
}

/** True when every requested item is present in the allowed set. */
export function isSubset(
  requested: readonly string[],
  allowed: readonly string[]
): boolean {
  return requested.every((item) => allowed.includes(item));
}

export interface SubjectAssurance {
  readonly classification: "adult" | "child" | "guardian-assisted";
  readonly proofRef: string;
  readonly assertedBy: string;
}

export interface TrustedProcessingContext {
  readonly authorityPrincipal: string;
  readonly actor: string;
  readonly dataPrincipalRef: string;
  readonly controllerId: string;
  readonly action: `/${string}`;
  readonly resource: { readonly type: string; readonly id: string };
  readonly purpose: string;
  readonly dataCategories: readonly string[];
  readonly recipients: readonly ProcessingRecipient[];
  readonly subjectAssurance?: SubjectAssurance;
  readonly transferDestination?: string;
}

export const PRIVACY_DENY_REASONS = [
  "no-processing-activity",
  "activity-inactive",
  "principal-mismatch",
  "controller-mismatch",
  "purpose-mismatch",
  "action-mismatch",
  "resource-mismatch",
  "basis-missing",
  "basis-inactive",
  "basis-invalid",
  "data-category-forbidden",
  "recipient-forbidden",
  "guardian-evidence-required",
  "transfer-forbidden",
  "retention-restricted",
  "other",
] as const;

export type PrivacyDenyReason = (typeof PRIVACY_DENY_REASONS)[number];

export type PrivacyProfileDecision =
  | { readonly ok: true; readonly controlRefs: readonly string[] }
  | { readonly ok: false; readonly reason: PrivacyDenyReason };

export interface PrivacyProfile {
  readonly id: string;
  readonly revision: string;
  validate(input: {
    readonly activity: ProcessingActivity;
    readonly basis: ProcessingBasisEvidence;
    readonly notices: readonly NoticeEvidence[];
    readonly consents: readonly ConsentEvidence[];
    readonly context: TrustedProcessingContext;
    readonly nowSec: number;
  }): PrivacyProfileDecision;
}

export type PrivacyDecision =
  | {
      readonly allow: true;
      readonly activityId: string;
      readonly basisId: string;
      readonly profileId: string;
      readonly profileRevision: string;
      readonly controlRefs: readonly string[];
    }
  | { readonly allow: false; readonly reason: PrivacyDenyReason };

export interface PrivacySnapshot {
  readonly notices: readonly NoticeEvidence[];
  readonly consents: readonly ConsentEvidence[];
  readonly bases: readonly ProcessingBasisEvidence[];
  readonly activities: readonly ProcessingActivity[];
  readonly holds: readonly RetentionHold[];
  readonly revision: number;
}

export type ProcessingEventState =
  "PREPARED" | "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN";

export interface ProcessingEventPrepare {
  readonly profileId: string;
  readonly profileRevision: string;
  readonly dataPrincipalRef: string;
  readonly authorityPrincipal: string;
  readonly actor: string;
  readonly controllerId: string;
  readonly activityId: string;
  readonly basisId: string;
  readonly purpose: string;
  readonly action: `/${string}`;
  readonly resource: { readonly type: string; readonly id: string };
  readonly dataCategories: readonly string[];
  readonly recipients: readonly ProcessingRecipient[];
  readonly termsDigest: string;
  readonly authorityCitationIds: readonly string[];
  /** Stable per-attempt identifier; unique for each new effect, reused on retry. */
  readonly attemptRef?: string;
  readonly preparedAt: number;
}

export interface ProcessingEventFinalize {
  readonly finalizedAt: number;
  readonly evidenceRef?: string;
}

export interface ProcessingEventRecord extends ProcessingEventPrepare {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly state: ProcessingEventState;
  readonly finalizedAt?: number;
  readonly evidenceRef?: string;
}

export interface PreparedEventResolution {
  readonly state: "SUCCEEDED" | "FAILED_FINAL";
  readonly finalizedAt: number;
  readonly evidenceRef?: string;
}

export interface PrivacyEventRepository {
  prepare(input: ProcessingEventPrepare): ProcessingEventRecord;
  load(eventId: string): ProcessingEventRecord | null;
  transition(
    eventId: string,
    to: Exclude<ProcessingEventState, "PREPARED">,
    patch: ProcessingEventFinalize
  ): ProcessingEventRecord;
  findByKey(idempotencyKey: string): ProcessingEventRecord | null;
  listBySubject(dataPrincipalRef: string): readonly ProcessingEventRecord[];
  /**
   * Replay/reconciliation lookup by exact terms and attempt reference.
   * Optional so alternative backends can opt out; a caller that needs
   * conclusive evidence must treat an unsupported lookup as unavailable,
   * never as absence.
   */
  findByAttempt?(
    termsDigest: string,
    attemptRef: string
  ): readonly ProcessingEventRecord[];
  /**
   * Recover abandoned PREPARED events. A resolver may supply a proven
   * journal/provider outcome; otherwise the conservative result is
   * OUTCOME_UNKNOWN. Must run only while processing writers are stopped.
   */
  recoverPrepared(
    nowSec: number,
    resolve?: (event: ProcessingEventRecord) => PreparedEventResolution | null,
    opts?: { readonly includeUnknown?: boolean }
  ): readonly ProcessingEventRecord[];
}

/**
 * A syntax guard, not a proof of pseudonymity: the host must mint random
 * references and keep the subject-to-person mapping outside PTF.
 */
export function isOpaquePrivacySubjectRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^subject:[A-Za-z][A-Za-z0-9_-]{5,127}$/.test(value)
  );
}

export function assertOpaquePrivacySubjectRef(
  value: unknown
): asserts value is string {
  if (!isOpaquePrivacySubjectRef(value)) {
    throw new Error("privacy: opaque dataPrincipalRef required");
  }
}
