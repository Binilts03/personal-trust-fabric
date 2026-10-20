import type {
  ConsentEvidence,
  NoticeEvidence,
  PrivacyProfile,
  PrivacyProfileDecision,
  ProcessingBasisEvidence,
  ProcessingActivity,
  TrustedProcessingContext,
} from "./model.js";
import { isSubset as subset } from "./internal.js";

export const DPDP_PROFILE_ID = "IN-DPDP-2025" as const;
export const DPDP_PROFILE_REVISION = "2025-r1" as const;

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function transferAllowed(
  activity: ProcessingActivity,
  context: TrustedProcessingContext
): boolean {
  if (context.transferDestination === undefined) return true;
  if (activity.allowedTransferDestinations === undefined) return true;
  return activity.allowedTransferDestinations.includes(
    context.transferDestination
  );
}

function guardianEvidenceValid(context: TrustedProcessingContext): boolean {
  const assurance = context.subjectAssurance;
  if (assurance === undefined || assurance.classification === "adult")
    return true;
  return nonEmpty(assurance.proofRef) && nonEmpty(assurance.assertedBy);
}

function validateConsent(
  activity: ProcessingActivity,
  basis: Extract<ProcessingBasisEvidence, { kind: "consent" }>,
  notices: readonly NoticeEvidence[],
  consents: readonly ConsentEvidence[],
  context: TrustedProcessingContext,
  nowSec: number
): PrivacyProfileDecision {
  if (!nonEmpty(basis.assertedBy))
    return { ok: false, reason: "basis-invalid" };
  const consent = consents.find((c) => c.id === basis.consentId);
  if (consent === undefined) return { ok: false, reason: "basis-invalid" };
  if (consent.withdrawnAt !== undefined && consent.withdrawnAt <= nowSec) {
    return { ok: false, reason: "basis-inactive" };
  }
  if (
    consent.controllerId !== activity.controllerId ||
    consent.dataPrincipalRef !== context.dataPrincipalRef ||
    consent.purpose !== activity.purpose ||
    consent.givenAt > nowSec ||
    !nonEmpty(consent.method) ||
    !nonEmpty(consent.proofRef) ||
    !nonEmpty(consent.assertedBy) ||
    !subset(context.dataCategories, consent.dataCategories)
  ) {
    return { ok: false, reason: "basis-invalid" };
  }
  const notice = notices.find((n) => n.id === consent.noticeId);
  if (
    notice === undefined ||
    notice.controllerId !== activity.controllerId ||
    notice.dataPrincipalRef !== context.dataPrincipalRef ||
    notice.purpose !== activity.purpose ||
    notice.presentedAt > consent.givenAt ||
    !nonEmpty(notice.noticeRef) ||
    !nonEmpty(notice.noticeHash) ||
    !nonEmpty(notice.assertedBy) ||
    !subset(context.dataCategories, notice.dataCategories)
  ) {
    return { ok: false, reason: "basis-invalid" };
  }
  if (!guardianEvidenceValid(context)) {
    return { ok: false, reason: "guardian-evidence-required" };
  }
  return {
    ok: true,
    controlRefs: [
      "dpdp:consent",
      `notice:${notice.id}`,
      `consent:${consent.id}`,
    ],
  };
}

function validateCertainLegitimateUse(
  basis: Extract<ProcessingBasisEvidence, { kind: "certain-legitimate-use" }>
): PrivacyProfileDecision {
  if (
    !nonEmpty(basis.provisionRef) ||
    !nonEmpty(basis.evidenceRef) ||
    !nonEmpty(basis.assertedBy)
  ) {
    return { ok: false, reason: "basis-invalid" };
  }
  return {
    ok: true,
    controlRefs: ["dpdp:certain-legitimate-use", basis.provisionRef],
  };
}

export const dpdpProfile: PrivacyProfile = {
  id: DPDP_PROFILE_ID,
  revision: DPDP_PROFILE_REVISION,
  validate(input) {
    if (!transferAllowed(input.activity, input.context)) {
      return { ok: false, reason: "transfer-forbidden" };
    }
    if (input.basis.kind === "consent") {
      return validateConsent(
        input.activity,
        input.basis,
        input.notices,
        input.consents,
        input.context,
        input.nowSec
      );
    }
    return validateCertainLegitimateUse(input.basis);
  },
};
