import { readFileSync } from "node:fs";
import type { Authority } from "../core/authority.js";
import type { FileAuditLog } from "../store/files.js";
import {
  PrivacyStore,
  loadPrivacyStore,
  readPrivacyKid,
  resolvePrivacyDek,
  savePrivacyStore,
} from "../store/privacy.js";
import { FilePrivacyEventRepository } from "../store/privacy-events.js";
import type {
  ConsentEvidence,
  NoticeEvidence,
  ProcessingActivity,
  ProcessingBasisEvidence,
  RetentionHold,
} from "../privacy/model.js";

/**
 * Shared plumbing for the privacy operator commands. The command modules
 * (`privacy-evidence.ts`, `privacy-rights.ts`) and the router
 * (`privacy.ts`) all use these helpers, so the flag vocabulary, the store
 * loading, and the metadata-only views stay in one place.
 */
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

export function flag(
  flags: Record<string, string | boolean>,
  name: string
): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`usage: --${name} is required`);
  }
  return value;
}

export function optional(
  flags: Record<string, string | boolean>,
  name: string
): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function readJson(path: string): unknown {
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

export function printJson(ctx: PrivacyCliContext, value: unknown): void {
  ctx.io.print(JSON.stringify(value, null, 2));
}

export function privacyDek(ctx: PrivacyCliContext): Uint8Array {
  const kid = readPrivacyKid(ctx.dir);
  if (kid === null)
    throw new Error("privacy: not initialized (run: ptf privacy init)");
  return resolvePrivacyDek(ctx.keys, kid);
}

export function loadStore(ctx: PrivacyCliContext): PrivacyStore {
  return loadPrivacyStore(ctx.dir, {
    keys: ctx.keys,
    nowSec: ctx.io.now,
  });
}

export function persistMutation(
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

export function repo(
  ctx: PrivacyCliContext,
  dek = privacyDek(ctx)
): FilePrivacyEventRepository {
  return new FilePrivacyEventRepository({
    dir: ctx.dir,
    dek,
    nowSec: ctx.io.now,
  });
}

/** Metadata-only views: evidence bodies never reach the operator surface. */
export function noticeView(value: NoticeEvidence) {
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

export function consentView(value: ConsentEvidence) {
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

export function basisView(value: ProcessingBasisEvidence) {
  return {
    id: value.id,
    kind: value.kind,
    controllerId: value.controllerId,
    purpose: value.purpose,
    dataCategories: [...value.dataCategories],
    active: value.active,
  };
}

export function activityView(value: ProcessingActivity) {
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

export function holdView(value: RetentionHold) {
  return {
    id: value.id,
    recordIds: [...value.recordIds],
    dataCategories: [...value.dataCategories],
    effectiveAt: value.effectiveAt,
    retainUntil: value.retainUntil,
    ...(value.releasedAt !== undefined ? { releasedAt: value.releasedAt } : {}),
  };
}

export function withdrawConsent(
  ctx: PrivacyCliContext,
  store: PrivacyStore
): void {
  const value = store.withdrawConsent(flag(ctx.flags, "id"), {
    at: ctx.io.now(),
    proofRef: flag(ctx.flags, "proof-ref"),
    assertedBy: flag(ctx.flags, "asserted-by"),
  });
  persistMutation(ctx, store, "privacy.consent.withdraw");
  ctx.io.print(`consent withdrawn: ${value.id}`);
}
