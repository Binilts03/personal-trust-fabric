import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Authority } from "../core/authority.js";
import type { FileAuditLog } from "../store/files.js";
import {
  PRIVACY_DEK_ALIAS,
  PRIVACY_DEK_NEXT_ALIAS,
  PrivacyStore,
  createPrivacyDek,
  ensurePrivacyDek,
  loadPrivacyStore,
  privacyDekFingerprint,
  readPrivacyKid,
  resolvePrivacyDek,
  rotatePrivacyDek,
  savePrivacyStore,
} from "../store/privacy.js";
import {
  FilePrivacyEventRepository,
  rotatePrivacyEventsDek,
  verifyPrivacyEvents,
} from "../store/privacy-events.js";
import { listExecutions } from "../store/execution.js";
import {
  eraseRecord,
  loadVault,
  readVaultKid,
  resolveVaultDek,
} from "../store/vault.js";
import { dpdpProfile } from "../privacy/dpdp.js";
import { PrivacyRuntime } from "../privacy/runtime.js";
import {
  resolveMcpPrivacyConfig,
  MCP_PRIVACY_GATED_PATHS,
  MCP_PRIVACY_UNCOVERED_PATHS,
} from "../privacy/mcp.js";
import { planErasure, summarizeProcessing } from "../privacy/rights.js";
import type {
  ConsentEvidence,
  NoticeEvidence,
  ProcessingActivity,
  ProcessingBasisEvidence,
  ProcessingEventPrepare,
  RetentionHold,
  TrustedProcessingContext,
} from "../privacy/model.js";
import { canonicalize, sha256Hex } from "../core/canonical.js";
import type {
  AuthorityOperation,
  VerifiedIdentity,
} from "../core/authority.js";

export interface PrivacyCliContext {
  readonly dir: string;
  readonly path: string;
  readonly flags: Record<string, string | boolean>;
  readonly auth: Authority;
  readonly audit: FileAuditLog;
  readonly keys: Record<string, Uint8Array>;
  readonly io: {
    readonly now: () => number;
    readonly print: (line: string) => void;
    readonly readLine: () => string;
  };
  readonly persistKeys: () => void;
}

function flag(flags: Record<string, string | boolean>, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`usage: --${name} is required`);
  }
  return value;
}

function optional(
  flags: Record<string, string | boolean>,
  name: string
): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function readJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`privacy: cannot read input file: ${path}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`privacy: input file is not valid JSON: ${path}`);
  }
}

function printJson(ctx: PrivacyCliContext, value: unknown): void {
  ctx.io.print(JSON.stringify(value, null, 2));
}

function privacyDek(ctx: PrivacyCliContext): Uint8Array {
  const kid = readPrivacyKid(ctx.dir);
  if (kid === null)
    throw new Error("privacy: not initialized (run: ptf privacy init)");
  return resolvePrivacyDek(ctx.keys, kid);
}

function loadStore(ctx: PrivacyCliContext): PrivacyStore {
  return loadPrivacyStore(ctx.dir, {
    keys: ctx.keys,
    nowSec: ctx.io.now,
  });
}

function persistMutation(
  ctx: PrivacyCliContext,
  store: PrivacyStore,
  action: string
): void {
  const dek = privacyDek(ctx);
  savePrivacyStore(ctx.dir, store, { dek });
  ctx.audit.append({
    actor: "operator",
    action,
    stateRevisions: { privacy: store.loadedRevision() },
  });
}

function repo(
  ctx: PrivacyCliContext,
  dek = privacyDek(ctx)
): FilePrivacyEventRepository {
  return new FilePrivacyEventRepository({
    dir: ctx.dir,
    dek,
    nowSec: ctx.io.now,
  });
}

function noticeView(value: NoticeEvidence) {
  return {
    id: value.id,
    controllerId: value.controllerId,
    purpose: value.purpose,
    dataCategories: [...value.dataCategories],
    presentedAt: value.presentedAt,
    ...(value.language !== undefined ? { language: value.language } : {}),
    ...(value.version !== undefined ? { version: value.version } : {}),
  };
}

function consentView(value: ConsentEvidence) {
  return {
    id: value.id,
    noticeId: value.noticeId,
    controllerId: value.controllerId,
    purpose: value.purpose,
    dataCategories: [...value.dataCategories],
    givenAt: value.givenAt,
    ...(value.withdrawnAt !== undefined
      ? { withdrawnAt: value.withdrawnAt }
      : {}),
  };
}

function basisView(value: ProcessingBasisEvidence) {
  return {
    id: value.id,
    kind: value.kind,
    controllerId: value.controllerId,
    purpose: value.purpose,
    dataCategories: [...value.dataCategories],
    active: value.active,
  };
}

function activityView(value: ProcessingActivity) {
  return {
    id: value.id,
    profileId: value.profileId,
    authorityPrincipal: value.authorityPrincipal,
    controllerId: value.controllerId,
    action: value.action,
    resourceType: value.resourceType,
    purpose: value.purpose,
    dataCategories: [...value.dataCategories],
    recipients: value.recipients.map((r) => ({ ...r })),
    basisId: value.basisId,
    active: value.active,
  };
}

function holdView(value: RetentionHold) {
  return {
    id: value.id,
    recordIds: [...value.recordIds],
    dataCategories: [...value.dataCategories],
    effectiveAt: value.effectiveAt,
    retainUntil: value.retainUntil,
    ...(value.releasedAt !== undefined ? { releasedAt: value.releasedAt } : {}),
  };
}

function withdrawConsent(ctx: PrivacyCliContext, store: PrivacyStore): void {
  const value = store.withdrawConsent(flag(ctx.flags, "id"), {
    at: ctx.io.now(),
    proofRef: flag(ctx.flags, "proof-ref"),
    assertedBy: flag(ctx.flags, "asserted-by"),
  });
  persistMutation(ctx, store, "privacy.consent.withdraw");
  ctx.io.print(`consent withdrawn: ${value.id}`);
}

export async function runPrivacyCommand(
  ctx: PrivacyCliContext
): Promise<number> {
  switch (ctx.path) {
    case "init": {
      if (existsSync(join(ctx.dir, "privacy-state.json"))) {
        throw new Error("privacy: already initialized");
      }
      const hadKey = ctx.keys[PRIVACY_DEK_ALIAS] !== undefined;
      const dek = ensurePrivacyDek(ctx.keys);
      if (!hadKey) ctx.persistKeys();
      const store = new PrivacyStore(ctx.io.now);
      savePrivacyStore(ctx.dir, store, { dek });
      ctx.audit.append({
        actor: "operator",
        action: "privacy.init",
        stateRevisions: { privacy: store.loadedRevision() },
      });
      ctx.io.print("privacy state initialized");
      return 0;
    }

    case "notice/add": {
      const store = loadStore(ctx);
      const value = store.addNotice(
        readJson(flag(ctx.flags, "file")) as NoticeEvidence
      );
      persistMutation(ctx, store, "privacy.notice.add");
      ctx.io.print(`notice added: ${value.id}`);
      return 0;
    }
    case "notice/list":
      printJson(ctx, loadStore(ctx).snapshot().notices.map(noticeView));
      return 0;

    case "consent/add": {
      const store = loadStore(ctx);
      const value = store.addConsent(
        readJson(flag(ctx.flags, "file")) as ConsentEvidence
      );
      persistMutation(ctx, store, "privacy.consent.add");
      ctx.io.print(`consent added: ${value.id}`);
      return 0;
    }
    case "consent/list":
      printJson(ctx, loadStore(ctx).snapshot().consents.map(consentView));
      return 0;
    case "consent/withdraw":
    case "basis/withdraw-consent": {
      withdrawConsent(ctx, loadStore(ctx));
      return 0;
    }

    case "basis/add": {
      const store = loadStore(ctx);
      const value = store.addBasis(
        readJson(flag(ctx.flags, "file")) as ProcessingBasisEvidence
      );
      persistMutation(ctx, store, "privacy.basis.add");
      ctx.io.print(`basis added: ${value.id}`);
      return 0;
    }
    case "basis/list":
      printJson(ctx, loadStore(ctx).snapshot().bases.map(basisView));
      return 0;

    case "activity/add": {
      const store = loadStore(ctx);
      const value = store.addActivity(
        readJson(flag(ctx.flags, "file")) as ProcessingActivity
      );
      persistMutation(ctx, store, "privacy.activity.add");
      ctx.io.print(`activity added: ${value.id}`);
      return 0;
    }
    case "activity/list":
      printJson(ctx, loadStore(ctx).snapshot().activities.map(activityView));
      return 0;

    case "hold/add": {
      const store = loadStore(ctx);
      const value = store.addHold(
        readJson(flag(ctx.flags, "file")) as RetentionHold
      );
      persistMutation(ctx, store, "privacy.hold.add");
      ctx.io.print(`hold added: ${value.id}`);
      return 0;
    }
    case "hold/release": {
      const store = loadStore(ctx);
      const value = store.releaseHold(flag(ctx.flags, "id"), {
        at: ctx.io.now(),
        assertedBy: flag(ctx.flags, "asserted-by"),
      });
      persistMutation(ctx, store, "privacy.hold.release");
      ctx.io.print(`hold released: ${value.id}`);
      return 0;
    }
    case "hold/list":
      printJson(ctx, loadStore(ctx).snapshot().holds.map(holdView));
      return 0;

    case "check": {
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

    case "summary": {
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

    case "erase/plan":
    case "erase/apply": {
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
      const byId = new Map(plan.map((item) => [item.record.id, item]));
      for (const id of ids) {
        const item = byId.get(id);
        if (item === undefined)
          throw new Error(`privacy erase: unknown record ${id}`);
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
          vault,
          { id, owner },
          { at: ctx.io.now(), audit: ctx.audit, dek }
        )
      );
      printJson(ctx, receipts);
      return 0;
    }

    case "events/reconcile": {
      // This is an OFFLINE recovery procedure. A sweep against a live writer
      // could classify an in-flight operation as ambiguous. No auto-startup
      // sweep: operators must quiesce hosts and explicitly acknowledge.
      if (ctx.flags["yes"] !== true) {
        throw new Error(
          "privacy events reconcile requires stopped writers and --yes"
        );
      }
      // Use the execution journal as the outcome oracle when it can prove a
      // terminal result for the exact terms. Anything else stays conservatively
      // OUTCOME_UNKNOWN; this sweep never guesses.
      const journal = new Map(
        listExecutions(ctx.dir).map((record) => [record.termsDigest, record])
      );
      const recovered = repo(ctx).recoverPrepared(ctx.io.now(), (event) => {
        const record =
          journal.get(event.attemptRef ?? "") ?? journal.get(event.termsDigest);
        if (record === undefined) return null;
        if (record.state === "SUCCEEDED" && record.receiptId !== undefined) {
          return {
            state: "SUCCEEDED",
            finalizedAt: record.receiptAt ?? ctx.io.now(),
            evidenceRef: `execution-receipt:${record.receiptId}`,
          };
        }
        if (record.state === "FAILED_FINAL") {
          return { state: "FAILED_FINAL", finalizedAt: record.updatedAt };
        }
        return null;
      });
      ctx.audit.append({
        actor: "operator",
        action: "privacy.events.reconcile",
        detail: `count:${recovered.length}`,
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

    case "events/resolve": {
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

    case "correction": {
      // Correction itself stays an operator-controlled vault-put (exact
      // record versioning). This command records the DPDP evidence for that
      // correction; it never reads or prints the corrected value.
      const id = flag(ctx.flags, "id");
      const owner = flag(ctx.flags, "owner");
      const subject = flag(ctx.flags, "subject-ref");
      const activityId = flag(ctx.flags, "activity-id");
      const basisId = flag(ctx.flags, "basis-id");
      const store = loadStore(ctx);
      const snap = store.snapshot();
      const activity = snap.activities.find((value) => value.id === activityId);
      const basis = snap.bases.find((value) => value.id === basisId);
      if (activity === undefined || basis === undefined) {
        throw new Error("privacy correction: unknown activity or basis");
      }
      if (activity.basisId !== basis.id) {
        throw new Error("privacy correction: activity basis does not match");
      }
      if (!activity.active || !basis.active) {
        throw new Error(
          "privacy correction: activity and basis must be active"
        );
      }
      if (
        (activity.subjects.kind === "exact" &&
          activity.subjects.ref !== subject) ||
        (activity.subjects.kind === "set" &&
          !activity.subjects.refs.includes(subject))
      ) {
        throw new Error(
          "privacy correction: subject is outside the activity scope"
        );
      }
      const record = loadVault(ctx.dir, {
        nowSec: ctx.io.now,
        keys: ctx.keys,
      })
        .listMetadata(owner)
        .find((value) => value.id === id);
      if (record === undefined) {
        throw new Error("privacy correction: unknown vault record");
      }
      if (
        !activity.dataCategories.includes(record.type) ||
        !basis.dataCategories.includes(record.type)
      ) {
        throw new Error(
          "privacy correction: record category is outside the basis"
        );
      }
      const now = ctx.io.now();
      const evidenceRef =
        optional(ctx.flags, "evidence-ref") ??
        `vault-record:${record.id}:v${record.version}`;
      if (!/^[A-Za-z0-9._:/#-]{1,200}$/.test(evidenceRef)) {
        throw new Error(
          "privacy correction: evidence-ref must be an opaque identifier"
        );
      }
      const termsDigest = sha256Hex(
        canonicalize({
          action: "/correct",
          recordId: record.id,
          recordVersion: record.version,
          dataPrincipalRef: subject,
          activityId,
          basisId,
        })
      );
      const input: ProcessingEventPrepare = {
        profileId: activity.profileId,
        profileRevision: dpdpProfile.revision,
        dataPrincipalRef: subject,
        authorityPrincipal: activity.authorityPrincipal,
        actor: "operator",
        controllerId: activity.controllerId,
        activityId,
        basisId,
        purpose: activity.purpose,
        action: "/correct",
        resource: { type: record.type, id: record.id },
        dataCategories: [record.type],
        recipients: [],
        termsDigest,
        authorityCitationIds: [],
        attemptRef: `correction:${termsDigest}`,
        preparedAt: now,
      };
      const events = repo(ctx);
      const prepared = events.prepare(input);
      const event =
        prepared.state === "PREPARED"
          ? events.transition(prepared.eventId, "SUCCEEDED", {
              finalizedAt: now,
              evidenceRef,
            })
          : prepared;
      ctx.audit.append({
        actor: "operator",
        action: "privacy.correction",
        detail: `${record.id}:${event.eventId}`,
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

    case "verify": {
      const dek = privacyDek(ctx);
      const store = loadStore(ctx);
      const eventCount = verifyPrivacyEvents(ctx.dir, dek);
      const configPath = optional(ctx.flags, "mcp-config");
      if (configPath !== undefined) {
        resolveMcpPrivacyConfig(readJson(configPath));
      }
      printJson(ctx, {
        privacyRevision: store.loadedRevision(),
        processingEvents: eventCount,
        verified: true,
        enforcement: {
          mode:
            configPath === undefined
              ? "not-inspected"
              : "configured-reference-host",
          runtimeAttested: false,
          coveredPaths: [...MCP_PRIVACY_GATED_PATHS],
          uncoveredPaths: [...MCP_PRIVACY_UNCOVERED_PATHS],
          note:
            configPath === undefined
              ? "No MCP operator config inspected: store verification is not enforcement proof"
              : "Configuration is valid, but this CLI cannot attest a separately running MCP host",
        },
      });
      return 0;
    }

    case "rekey": {
      const store = loadStore(ctx);
      let newDek = ctx.keys[PRIVACY_DEK_NEXT_ALIAS];
      if (newDek === undefined) {
        newDek = createPrivacyDek();
        ctx.keys[PRIVACY_DEK_NEXT_ALIAS] = newDek;
        ctx.persistKeys();
      }
      const kid = readPrivacyKid(ctx.dir);
      if (kid === null) throw new Error("privacy: state missing");
      const openingDek = resolvePrivacyDek(ctx.keys, kid);
      if (privacyDekFingerprint(openingDek) !== privacyDekFingerprint(newDek)) {
        rotatePrivacyDek(ctx.dir, store, { dek: openingDek, newDek });
      }
      rotatePrivacyEventsDek(ctx.dir, { keys: ctx.keys, newDek });
      ctx.keys[PRIVACY_DEK_ALIAS] = newDek;
      delete ctx.keys[PRIVACY_DEK_NEXT_ALIAS];
      ctx.persistKeys();
      ctx.audit.append({
        actor: "operator",
        action: "privacy.rekey",
        stateRevisions: { privacy: store.loadedRevision() },
      });
      ctx.io.print("privacy state rekeyed");
      return 0;
    }

    default:
      throw new Error(`unknown privacy subcommand: ${ctx.path}`);
  }
}
