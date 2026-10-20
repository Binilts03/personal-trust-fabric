import {
  assertOpaquePrivacySubjectRef,
  type ConsentEvidence,
  type ProcessingEventRecord,
  type ProcessingEventState,
  type ProcessingRecipient,
  type RetentionHold,
} from "./model.js";
import type { VaultRecordMetadata } from "../store/vault.js";

export interface ProcessingSummaryConsent {
  readonly consentId: string;
  readonly noticeId: string;
  readonly purpose: string;
  readonly status: "pending" | "given" | "withdrawn";
  readonly givenAt: number;
  readonly withdrawnAt?: number;
}

export type ProcessingSummaryErasure =
  | {
      readonly status: "not-computed";
      readonly reason: "owner-required" | "holds-required";
    }
  | {
      readonly status: "computed";
      readonly eligibleRecordIds: readonly string[];
      readonly heldRecords: readonly {
        readonly recordId: string;
        readonly holdIds: readonly string[];
      }[];
      readonly unscopedRecordIds: readonly string[];
    };

export interface ProcessingSummary {
  readonly dataPrincipalRef: string;
  readonly categories: readonly string[];
  readonly purposes: readonly string[];
  readonly recipients: readonly ProcessingRecipient[];
  readonly basisIds: readonly string[];
  readonly activityIds: readonly string[];
  readonly events: readonly {
    readonly eventId: string;
    readonly state: ProcessingEventState;
    readonly at: number;
  }[];
  readonly consentState: readonly ProcessingSummaryConsent[];
  readonly erasure: ProcessingSummaryErasure;
}

export interface ErasurePlanItem {
  readonly record: VaultRecordMetadata;
  readonly status: "eligible" | "held" | "unscoped";
  readonly holdIds: readonly string[];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function summarizeProcessing(
  events: readonly ProcessingEventRecord[],
  dataPrincipalRef: string,
  opts: {
    readonly consents?: readonly ConsentEvidence[];
    readonly records?: readonly VaultRecordMetadata[];
    readonly holds?: readonly RetentionHold[];
    readonly nowSec?: number;
  } = {}
): ProcessingSummary {
  assertOpaquePrivacySubjectRef(dataPrincipalRef);
  const relevant = events.filter(
    (event) => event.dataPrincipalRef === dataPrincipalRef
  );
  const recipientMap = new Map<string, ProcessingRecipient>();
  for (const event of relevant) {
    for (const recipient of event.recipients) {
      recipientMap.set(`${recipient.id}\0${recipient.role}`, { ...recipient });
    }
  }
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const consents = (opts.consents ?? [])
    .filter((consent) => consent.dataPrincipalRef === dataPrincipalRef)
    .map((consent) => ({
      consentId: consent.id,
      noticeId: consent.noticeId,
      purpose: consent.purpose,
      status:
        consent.givenAt > nowSec
          ? ("pending" as const)
          : consent.withdrawnAt !== undefined && consent.withdrawnAt <= nowSec
            ? ("withdrawn" as const)
            : ("given" as const),
      givenAt: consent.givenAt,
      ...(consent.withdrawnAt !== undefined
        ? { withdrawnAt: consent.withdrawnAt }
        : {}),
    }))
    .sort((a, b) => a.consentId.localeCompare(b.consentId));
  const plan =
    opts.records === undefined || opts.holds === undefined
      ? null
      : planErasure({
          records: opts.records,
          holds: opts.holds,
          dataPrincipalRef,
          nowSec,
        });
  return {
    dataPrincipalRef,
    categories: uniqueSorted(
      relevant.flatMap((event) => [...event.dataCategories])
    ),
    purposes: uniqueSorted(relevant.map((event) => event.purpose)),
    recipients: [...recipientMap.values()].sort((a, b) =>
      a.id === b.id ? a.role.localeCompare(b.role) : a.id.localeCompare(b.id)
    ),
    basisIds: uniqueSorted(relevant.map((event) => event.basisId)),
    activityIds: uniqueSorted(relevant.map((event) => event.activityId)),
    events: relevant
      .map((event) => ({
        eventId: event.eventId,
        state: event.state,
        at: event.finalizedAt ?? event.preparedAt,
      }))
      .sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId)),
    consentState: consents,
    erasure:
      plan === null
        ? {
            status: "not-computed",
            reason:
              opts.records === undefined ? "owner-required" : "holds-required",
          }
        : {
            status: "computed",
            eligibleRecordIds: plan
              .filter((item) => item.status === "eligible")
              .map((item) => item.record.id),
            heldRecords: plan
              .filter((item) => item.status === "held")
              .map((item) => ({
                recordId: item.record.id,
                holdIds: [...item.holdIds],
              })),
            unscopedRecordIds: plan
              .filter((item) => item.status === "unscoped")
              .map((item) => item.record.id),
          },
  };
}

function holdActive(hold: RetentionHold, nowSec: number): boolean {
  // Any active hold on the exact record or category blocks erasure (fail
  // closed); otherwise a typo in the subject reference could silently bypass
  // a legal hold. The hold's own subject ref is not used to narrow this.
  if (hold.effectiveAt > nowSec) return false;
  if (hold.releasedAt !== undefined && hold.releasedAt <= nowSec) return false;
  if (hold.retainUntil !== null && hold.retainUntil < nowSec) return false;
  return true;
}

export function planErasure(input: {
  readonly records: readonly VaultRecordMetadata[];
  readonly holds: readonly RetentionHold[];
  readonly dataPrincipalRef: string;
  readonly nowSec: number;
}): readonly ErasurePlanItem[] {
  assertOpaquePrivacySubjectRef(input.dataPrincipalRef);
  return input.records
    .filter(
      (record) =>
        record.dataPrincipalRef === input.dataPrincipalRef ||
        record.dataPrincipalRef === undefined
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((record) => {
      const holdIds = input.holds
        .filter((hold) => holdActive(hold, input.nowSec))
        .filter(
          (hold) =>
            hold.recordIds.includes(record.id) ||
            hold.dataCategories.includes(record.type)
        )
        .map((hold) => hold.id)
        .sort();
      return {
        record: {
          ...record,
          ...(record.dataPrincipalRef !== undefined
            ? { dataPrincipalRef: record.dataPrincipalRef }
            : {}),
          ...(record.resource !== undefined
            ? { resource: { ...record.resource } }
            : {}),
          allowedPurposes: [...record.allowedPurposes],
          allowedAgents: [...record.allowedAgents],
        },
        status:
          record.dataPrincipalRef === undefined
            ? ("unscoped" as const)
            : holdIds.length > 0
              ? ("held" as const)
              : ("eligible" as const),
        holdIds,
      };
    });
}
