import type {
  ProcessingEventRecord,
  ProcessingEventState,
  ProcessingRecipient,
  RetentionHold,
} from "./model.js";
import type { VaultRecordMetadata } from "../store/vault.js";

export interface ProcessingSummary {
  readonly dataPrincipalRef: string;
  readonly categories: readonly string[];
  readonly purposes: readonly string[];
  readonly recipients: readonly ProcessingRecipient[];
  readonly basisIds: readonly string[];
  readonly events: readonly {
    readonly eventId: string;
    readonly state: ProcessingEventState;
    readonly at: number;
  }[];
}

export interface ErasurePlanItem {
  readonly record: VaultRecordMetadata;
  readonly status: "eligible" | "held";
  readonly holdIds: readonly string[];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function summarizeProcessing(
  events: readonly ProcessingEventRecord[],
  dataPrincipalRef: string
): ProcessingSummary {
  const relevant = events.filter((event) => event.dataPrincipalRef === dataPrincipalRef);
  const recipientMap = new Map<string, ProcessingRecipient>();
  for (const event of relevant) {
    for (const recipient of event.recipients) {
      recipientMap.set(`${recipient.id}\0${recipient.role}`, { ...recipient });
    }
  }
  return {
    dataPrincipalRef,
    categories: uniqueSorted(relevant.flatMap((event) => [...event.dataCategories])),
    purposes: uniqueSorted(relevant.map((event) => event.purpose)),
    recipients: [...recipientMap.values()].sort((a, b) =>
      a.id === b.id ? a.role.localeCompare(b.role) : a.id.localeCompare(b.id)
    ),
    basisIds: uniqueSorted(relevant.map((event) => event.basisId)),
    events: relevant
      .map((event) => ({
        eventId: event.eventId,
        state: event.state,
        at: event.finalizedAt ?? event.preparedAt,
      }))
      .sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId)),
  };
}

function holdActive(hold: RetentionHold, dataPrincipalRef: string, nowSec: number): boolean {
  if (hold.dataPrincipalRef !== dataPrincipalRef) return false;
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
  return [...input.records]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((record) => {
      const holdIds = input.holds
        .filter((hold) => holdActive(hold, input.dataPrincipalRef, input.nowSec))
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
          ...(record.resource !== undefined
            ? { resource: { ...record.resource } }
            : {}),
          allowedPurposes: [...record.allowedPurposes],
          allowedAgents: [...record.allowedAgents],
        },
        status: holdIds.length > 0 ? "held" as const : "eligible" as const,
        holdIds,
      };
    });
}
