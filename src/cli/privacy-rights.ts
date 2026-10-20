import { canonicalize, sha256Hex } from "../core/canonical.js";
import type {
  AuthorityOperation,
  VerifiedIdentity,
} from "../core/authority.js";
import { listExecutions } from "../store/execution.js";
import {
  eraseRecord,
  loadVault,
  readVaultKid,
  resolveVaultDek,
} from "../store/vault.js";
import { dpdpProfile } from "../privacy/dpdp.js";
import { evaluateProcessing } from "../privacy/engine.js";
import type {
  ProcessingEventPrepare,
  TrustedProcessingContext,
} from "../privacy/model.js";
import { planErasure, summarizeProcessing } from "../privacy/rights.js";
import { resolveJournalOutcome } from "../privacy/recovery.js";
import { PrivacyRuntime } from "../privacy/runtime.js";
import {
  flag,
  loadStore,
  optional,
  printJson,
  readJson,
  repo,
  type PrivacyCliContext,
} from "./privacy-shared.js";

/**
 * Rights commands: the dry-run privacy check, the processing summary,
 * subject-bound exact erasure, and the offline event recovery procedures.
 */

export async function privacyCheck(ctx: PrivacyCliContext): Promise<number> {
  const input = readJson(flag(ctx.flags, "file")) as {
    ingress: VerifiedIdentity;
    operation: AuthorityOperation;
    processing: TrustedProcessingContext;
  };
  const events = repo(ctx);
  const runtime = new PrivacyRuntime({
    loadPrivacy: () => loadStore(ctx).snapshot(),
    events,
    profile: dpdpProfile,
    nowSec: ctx.io.now,
  });
  printJson(
    ctx,
    runtime.preflight(
      {
        authority: ctx.auth,
        ingress: input.ingress,
        operation: input.operation,
        processing: input.processing,
      },
      { operatorDetail: true }
    )
  );
  return 0;
}

export async function privacySummary(ctx: PrivacyCliContext): Promise<number> {
  const subject = flag(ctx.flags, "subject-ref");
  const store = loadStore(ctx);
  const owner = optional(ctx.flags, "owner");
  const records =
    owner === undefined
      ? undefined
      : loadVault(ctx.dir, {
          nowSec: ctx.io.now,
          keys: ctx.keys,
        }).listMetadata(owner);
  printJson(
    ctx,
    summarizeProcessing(repo(ctx).listBySubject(subject), subject, {
      consents: store.snapshot().consents,
      ...(records !== undefined ? { records } : {}),
      holds: store.snapshot().holds,
      nowSec: ctx.io.now(),
    })
  );
  return 0;
}

export async function privacyErase(ctx: PrivacyCliContext): Promise<number> {
  const subject = flag(ctx.flags, "subject-ref");
  const owner = flag(ctx.flags, "owner");
  const store = loadStore(ctx);
  const vault = loadVault(ctx.dir, { nowSec: ctx.io.now, keys: ctx.keys });
  const plan = planErasure({
    records: vault.listMetadata(owner),
    holds: store.snapshot().holds,
    dataPrincipalRef: subject,
    nowSec: ctx.io.now(),
  });
  if (ctx.path === "erase/plan") {
    printJson(
      ctx,
      plan.map((item) => ({
        id: item.record.id,
        type: item.record.type,
        status: item.status,
        holdIds: [...item.holdIds],
      }))
    );
    return 0;
  }
  if (ctx.flags["yes"] !== true) {
    throw new Error("privacy erase apply requires --yes");
  }
  const ids = flag(ctx.flags, "ids")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0)
    throw new Error("privacy erase: --ids must be non-empty");
  // Re-plan immediately before deleting: a hold added after the plan
  // command (or a subject binding change) must still fail closed. Apply
  // from this freshly loaded instance, not the earlier plan snapshot.
  const liveVault = loadVault(ctx.dir, {
    nowSec: ctx.io.now,
    keys: ctx.keys,
  });
  const livePlan = planErasure({
    records: liveVault.listMetadata(owner),
    holds: loadStore(ctx).snapshot().holds,
    dataPrincipalRef: subject,
    nowSec: ctx.io.now(),
  });
  const byId = new Map(livePlan.map((item) => [item.record.id, item]));
  for (const id of ids) {
    const item = byId.get(id);
    if (item === undefined)
      throw new Error(`privacy erase: unknown record ${id}`);
    if (item.status === "unscoped")
      throw new Error(`privacy erase: record ${id} has no subject binding`);
    if (item.status !== "eligible") {
      throw new Error(`privacy erase: record ${id} is held`);
    }
  }
  const kid = readVaultKid(ctx.dir);
  if (kid === null) throw new Error("privacy erase: vault missing");
  const dek = resolveVaultDek(ctx.keys, kid);
  const receipts = ids.map((id) =>
    eraseRecord(
      ctx.dir,
      liveVault,
      { id, owner },
      { at: ctx.io.now(), audit: ctx.audit, dek }
    )
  );
  printJson(ctx, receipts);
  return 0;
}

export async function privacyEventsReconcile(
  ctx: PrivacyCliContext
): Promise<number> {
  // This is an OFFLINE recovery procedure. A sweep against a live writer
  // could classify an in-flight operation as ambiguous. No auto-startup
  // sweep: operators must quiesce hosts and explicitly acknowledge.
  if (ctx.flags["yes"] !== true) {
    throw new Error(
      "privacy events reconcile requires stopped writers and --yes"
    );
  }
  // Use the execution journal as the outcome oracle only when it proves
  // a unique terminal result for the exact action/terms/resource/purpose
  // and destination. Anything else stays conservatively UNKNOWN.
  const journal = listExecutions(ctx.dir);
  const includeUnknown = ctx.flags["include-unknown"] === true;
  const recovered = repo(ctx).recoverPrepared(
    ctx.io.now(),
    (event) => resolveJournalOutcome(event, journal),
    { includeUnknown }
  );
  for (const record of recovered) {
    ctx.audit.append({
      actor: "operator",
      action: "privacy.events.reconcile",
      detail: `${record.eventId}:${record.state}:${record.evidenceRef ?? "-"}`,
    });
  }
  ctx.audit.append({
    actor: "operator",
    action: "privacy.events.reconcile.summary",
    detail: `count:${recovered.length}:includeUnknown:${includeUnknown}`,
  });
  printJson(ctx, {
    recovered: recovered.length,
    eventIds: recovered.map((r) => r.eventId),
    resolved: recovered.map((r) => ({
      eventId: r.eventId,
      state: r.state,
    })),
    note: "Only journal-proven outcomes are final; the rest remain OUTCOME_UNKNOWN",
  });
  return 0;
}

export async function privacyEventsResolve(
  ctx: PrivacyCliContext
): Promise<number> {
  if (ctx.flags["yes"] !== true) {
    throw new Error(
      "privacy events resolve requires stopped writers and --yes"
    );
  }
  const eventId = flag(ctx.flags, "id");
  const state = flag(ctx.flags, "state");
  const evidenceRef = flag(ctx.flags, "evidence-ref");
  if (state !== "SUCCEEDED" && state !== "FAILED_FINAL") {
    throw new Error(
      "privacy events resolve: state must be SUCCEEDED or FAILED_FINAL"
    );
  }
  if (!/^[A-Za-z0-9._:/#-]{1,200}$/.test(evidenceRef)) {
    throw new Error(
      "privacy events resolve: evidence-ref must be an opaque identifier"
    );
  }
  const events = repo(ctx);
  const current = events.load(eventId);
  if (current === null)
    throw new Error("privacy events resolve: unknown event");
  if (current.state !== "OUTCOME_UNKNOWN") {
    throw new Error(
      "privacy events resolve: only OUTCOME_UNKNOWN may be resolved"
    );
  }
  const resolved = events.transition(eventId, state, {
    finalizedAt: ctx.io.now(),
    evidenceRef,
  });
  ctx.audit.append({
    actor: "operator",
    action: "privacy.events.resolve",
    detail: `${eventId}:${resolved.state}`,
  });
  printJson(ctx, {
    eventId: resolved.eventId,
    state: resolved.state,
    evidenceRef: resolved.evidenceRef,
  });
  return 0;
}

interface CorrectionTarget {
  readonly id: string;
  readonly owner: string;
  readonly subject: string;
  readonly activityId: string;
  readonly basisId: string;
  readonly requestRef: string;
  readonly previousVersion: number;
}

/** The operator's correction identifiers, validated before any store read. */
function correctionTarget(ctx: PrivacyCliContext): CorrectionTarget {
  const requestRef = flag(ctx.flags, "request-ref");
  if (!/^[A-Za-z0-9._:/#-]{1,160}$/.test(requestRef)) {
    throw new Error("privacy correction: request-ref must be opaque");
  }
  const previousVersionRaw = flag(ctx.flags, "previous-version");
  if (!/^[0-9]+$/.test(previousVersionRaw)) {
    throw new Error("privacy correction: previous-version must be an integer");
  }
  const previousVersion = Number(previousVersionRaw);
  if (!Number.isSafeInteger(previousVersion)) {
    throw new Error("privacy correction: previous-version is too large");
  }
  return {
    id: flag(ctx.flags, "id"),
    owner: flag(ctx.flags, "owner"),
    subject: flag(ctx.flags, "subject-ref"),
    activityId: flag(ctx.flags, "activity-id"),
    basisId: flag(ctx.flags, "basis-id"),
    requestRef,
    previousVersion,
  };
}

export async function privacyCorrection(
  ctx: PrivacyCliContext
): Promise<number> {
  // Correction itself stays an operator-controlled vault-put (exact
  // record versioning). This command records the DPDP evidence for that
  // correction; it never reads or prints the corrected value.
  const target = correctionTarget(ctx);
  const store = loadStore(ctx);
  const snap = store.snapshot();
  const activity = snap.activities.find(
    (value) => value.id === target.activityId
  );
  const basis = snap.bases.find((value) => value.id === target.basisId);
  if (activity === undefined || basis === undefined) {
    throw new Error("privacy correction: unknown activity or basis");
  }
  if (activity.basisId !== basis.id) {
    throw new Error("privacy correction: activity basis does not match");
  }
  if (activity.action !== "/correct") {
    throw new Error("privacy correction: activity action must be /correct");
  }
  if (activity.profileId !== dpdpProfile.id) {
    throw new Error("privacy correction: activity profile is not DPDP");
  }
  const record = loadVault(ctx.dir, {
    nowSec: ctx.io.now,
    keys: ctx.keys,
  })
    .listMetadata(target.owner)
    .find((value) => value.id === target.id);
  if (record === undefined) {
    throw new Error("privacy correction: unknown vault record");
  }
  if (record.owner !== activity.authorityPrincipal) {
    throw new Error("privacy correction: record owner is outside the activity");
  }
  if (record.dataPrincipalRef === undefined) {
    throw new Error("privacy correction: record has no opaque subject binding");
  }
  if (record.dataPrincipalRef !== target.subject) {
    throw new Error(
      "privacy correction: subject is outside the record binding"
    );
  }
  if (record.version !== target.previousVersion + 1) {
    throw new Error(
      "privacy correction: record version does not prove the correction write"
    );
  }
  const now = ctx.io.now();
  const context: TrustedProcessingContext = {
    authorityPrincipal: activity.authorityPrincipal,
    actor: "operator",
    dataPrincipalRef: target.subject,
    controllerId: activity.controllerId,
    purpose: activity.purpose,
    action: "/correct",
    resource: { type: activity.resourceType, id: record.id },
    dataCategories: [record.type],
    recipients: [],
  };
  const decision = evaluateProcessing({
    ...snap,
    context,
    profile: dpdpProfile,
    nowSec: now,
  });
  if (!decision.allow) {
    throw new Error(`privacy correction denied: ${decision.reason}`);
  }
  if (
    decision.activityId !== target.activityId ||
    decision.basisId !== target.basisId
  ) {
    throw new Error(
      "privacy correction: engine did not select the supplied activity/basis"
    );
  }
  const evidenceRef =
    optional(ctx.flags, "evidence-ref") ??
    `correction:${target.requestRef}:vault-record:${record.id}:v${target.previousVersion}-v${record.version}`;
  if (!/^[A-Za-z0-9._:/#-]{1,300}$/.test(evidenceRef)) {
    throw new Error(
      "privacy correction: evidence-ref must be an opaque identifier"
    );
  }
  const termsDigest = sha256Hex(
    canonicalize({
      action: "/correct",
      requestRef: target.requestRef,
      recordId: record.id,
      previousVersion: target.previousVersion,
      recordVersion: record.version,
      dataPrincipalRef: target.subject,
      activityId: target.activityId,
      basisId: target.basisId,
    })
  );
  const input: ProcessingEventPrepare = {
    profileId: dpdpProfile.id,
    profileRevision: dpdpProfile.revision,
    dataPrincipalRef: target.subject,
    authorityPrincipal: activity.authorityPrincipal,
    actor: "operator",
    controllerId: activity.controllerId,
    activityId: target.activityId,
    basisId: target.basisId,
    purpose: activity.purpose,
    action: "/correct",
    resource: { type: activity.resourceType, id: record.id },
    dataCategories: [record.type],
    recipients: [],
    termsDigest,
    authorityCitationIds: [],
    attemptRef: `correction:${termsDigest}`,
    preparedAt: now,
  };
  const events = repo(ctx);
  const prepared = events.prepare(input);
  if (prepared.state === "SUCCEEDED") {
    printJson(ctx, {
      eventId: prepared.eventId,
      state: prepared.state,
      recordId: record.id,
      recordVersion: record.version,
      evidenceRef: prepared.evidenceRef,
    });
    return 0;
  }
  if (prepared.state !== "PREPARED") {
    throw new Error(`privacy correction: existing event is ${prepared.state}`);
  }
  const event = events.transition(prepared.eventId, "SUCCEEDED", {
    finalizedAt: now,
    evidenceRef,
  });
  if (event.state !== "SUCCEEDED") {
    throw new Error("privacy correction: event did not finalize");
  }
  ctx.audit.append({
    actor: "operator",
    action: "privacy.correction",
    detail: `${record.id}:${event.eventId}:${target.requestRef}`,
  });
  printJson(ctx, {
    eventId: event.eventId,
    state: event.state,
    recordId: record.id,
    recordVersion: record.version,
    evidenceRef: event.evidenceRef,
  });
  return 0;
}
