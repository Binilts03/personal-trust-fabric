import type {
  PrivacyDecision,
  PrivacyProfile,
  PrivacySubjectSelector,
  ProcessingActivity,
  ProcessingBasisEvidence,
  ProcessingRecipient,
  RetentionHold,
  TrustedProcessingContext,
  NoticeEvidence,
  ConsentEvidence,
} from "./model.js";
import { isOpaquePrivacySubjectRef } from "./model.js";
import { isSubset as subset } from "./internal.js";

function subjectMatches(sel: PrivacySubjectSelector, ref: string): boolean {
  switch (sel.kind) {
    case "exact":
      return sel.ref === ref;
    case "set":
      return sel.refs.includes(ref);
    case "any":
      return true;
  }
}

function inWindow(
  value: { readonly nbf?: number; readonly exp?: number },
  nowSec: number
): boolean {
  return (
    (value.nbf === undefined || nowSec >= value.nbf) &&
    (value.exp === undefined || nowSec <= value.exp)
  );
}

function recipientsSubset(
  requested: readonly ProcessingRecipient[],
  allowed: readonly ProcessingRecipient[]
): boolean {
  return requested.every((r) =>
    allowed.some((a) => a.id === r.id && a.role === r.role)
  );
}

function pickActivity(
  activities: readonly ProcessingActivity[],
  context: TrustedProcessingContext,
  profile: PrivacyProfile
): ProcessingActivity | null {
  const subjectMatchesList = activities.filter(
    (a) =>
      a.profileId === profile.id &&
      subjectMatches(a.subjects, context.dataPrincipalRef)
  );
  if (subjectMatchesList.length === 0) return null;
  return (
    subjectMatchesList.find(
      (a) =>
        a.action === context.action &&
        a.resourceType === context.resource.type &&
        a.purpose === context.purpose
    ) ??
    subjectMatchesList[0] ??
    null
  );
}

export function evaluateProcessing(input: {
  readonly activities: readonly ProcessingActivity[];
  readonly bases: readonly ProcessingBasisEvidence[];
  readonly notices: readonly NoticeEvidence[];
  readonly consents: readonly ConsentEvidence[];
  readonly holds: readonly RetentionHold[];
  readonly context: TrustedProcessingContext;
  readonly profile: PrivacyProfile;
  readonly nowSec: number;
}): PrivacyDecision {
  if (!isOpaquePrivacySubjectRef(input.context.dataPrincipalRef)) {
    return { allow: false, reason: "other" };
  }
  const activity = pickActivity(input.activities, input.context, input.profile);
  if (activity === null) {
    return { allow: false, reason: "no-processing-activity" };
  }
  if (!activity.active || !inWindow(activity, input.nowSec)) {
    return { allow: false, reason: "activity-inactive" };
  }
  if (activity.authorityPrincipal !== input.context.authorityPrincipal) {
    return { allow: false, reason: "principal-mismatch" };
  }
  if (activity.controllerId !== input.context.controllerId) {
    return { allow: false, reason: "controller-mismatch" };
  }
  if (activity.purpose !== input.context.purpose) {
    return { allow: false, reason: "purpose-mismatch" };
  }
  if (activity.action !== input.context.action) {
    return { allow: false, reason: "action-mismatch" };
  }
  if (activity.resourceType !== input.context.resource.type) {
    return { allow: false, reason: "resource-mismatch" };
  }
  if (!subset(input.context.dataCategories, activity.dataCategories)) {
    return { allow: false, reason: "data-category-forbidden" };
  }
  if (!recipientsSubset(input.context.recipients, activity.recipients)) {
    return { allow: false, reason: "recipient-forbidden" };
  }

  const basis = input.bases.find((b) => b.id === activity.basisId);
  if (basis === undefined) {
    return { allow: false, reason: "basis-missing" };
  }
  if (!basis.active || !inWindow(basis, input.nowSec)) {
    return { allow: false, reason: "basis-inactive" };
  }
  if (
    basis.controllerId !== activity.controllerId ||
    basis.purpose !== activity.purpose ||
    !subset(input.context.dataCategories, basis.dataCategories)
  ) {
    return { allow: false, reason: "basis-invalid" };
  }
  if (
    basis.kind === "consent" &&
    basis.dataPrincipalRef !== input.context.dataPrincipalRef
  ) {
    return { allow: false, reason: "basis-invalid" };
  }

  const profiled = input.profile.validate({
    activity,
    basis,
    notices: input.notices,
    consents: input.consents,
    context: input.context,
    nowSec: input.nowSec,
  });
  if (!profiled.ok) return { allow: false, reason: profiled.reason };
  return {
    allow: true,
    activityId: activity.id,
    basisId: basis.id,
    profileId: input.profile.id,
    profileRevision: input.profile.revision,
    controlRefs: [...profiled.controlRefs],
  };
}
