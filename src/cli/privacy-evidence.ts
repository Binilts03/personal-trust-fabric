import type {
  ConsentEvidence,
  NoticeEvidence,
  ProcessingActivity,
  ProcessingBasisEvidence,
  RetentionHold,
} from "../privacy/model.js";
import {
  activityView,
  basisView,
  consentView,
  flag,
  holdView,
  loadStore,
  noticeView,
  persistMutation,
  printJson,
  readJson,
  withdrawConsent,
  type PrivacyCliContext,
} from "./privacy-shared.js";

/**
 * Evidence-configuration commands: the records an operator asserts about
 * notices, consents, bases, activities, and retention holds. Every command
 * writes through the encrypted privacy store and audits the revision.
 */

export async function privacyNoticeAdd(
  ctx: PrivacyCliContext
): Promise<number> {
  const store = loadStore(ctx);
  const value = store.addNotice(
    readJson(flag(ctx.flags, "file")) as NoticeEvidence
  );
  persistMutation(ctx, store, "privacy.notice.add");
  ctx.io.print(`notice added: ${value.id}`);
  return 0;
}

export async function privacyNoticeList(
  ctx: PrivacyCliContext
): Promise<number> {
  printJson(ctx, loadStore(ctx).snapshot().notices.map(noticeView));
  return 0;
}

export async function privacyConsentAdd(
  ctx: PrivacyCliContext
): Promise<number> {
  const store = loadStore(ctx);
  const value = store.addConsent(
    readJson(flag(ctx.flags, "file")) as ConsentEvidence
  );
  persistMutation(ctx, store, "privacy.consent.add");
  ctx.io.print(`consent added: ${value.id}`);
  return 0;
}

export async function privacyConsentList(
  ctx: PrivacyCliContext
): Promise<number> {
  printJson(ctx, loadStore(ctx).snapshot().consents.map(consentView));
  return 0;
}

export async function privacyConsentWithdraw(
  ctx: PrivacyCliContext
): Promise<number> {
  withdrawConsent(ctx, loadStore(ctx));
  return 0;
}

export async function privacyBasisAdd(ctx: PrivacyCliContext): Promise<number> {
  const store = loadStore(ctx);
  const value = store.addBasis(
    readJson(flag(ctx.flags, "file")) as ProcessingBasisEvidence
  );
  persistMutation(ctx, store, "privacy.basis.add");
  ctx.io.print(`basis added: ${value.id}`);
  return 0;
}

export async function privacyBasisList(
  ctx: PrivacyCliContext
): Promise<number> {
  printJson(ctx, loadStore(ctx).snapshot().bases.map(basisView));
  return 0;
}

export async function privacyActivityAdd(
  ctx: PrivacyCliContext
): Promise<number> {
  const store = loadStore(ctx);
  const value = store.addActivity(
    readJson(flag(ctx.flags, "file")) as ProcessingActivity
  );
  persistMutation(ctx, store, "privacy.activity.add");
  ctx.io.print(`activity added: ${value.id}`);
  return 0;
}

export async function privacyActivityList(
  ctx: PrivacyCliContext
): Promise<number> {
  printJson(ctx, loadStore(ctx).snapshot().activities.map(activityView));
  return 0;
}

export async function privacyHoldAdd(ctx: PrivacyCliContext): Promise<number> {
  const store = loadStore(ctx);
  const value = store.addHold(
    readJson(flag(ctx.flags, "file")) as RetentionHold
  );
  persistMutation(ctx, store, "privacy.hold.add");
  ctx.io.print(`hold added: ${value.id}`);
  return 0;
}

export async function privacyHoldRelease(
  ctx: PrivacyCliContext
): Promise<number> {
  const store = loadStore(ctx);
  const value = store.releaseHold(flag(ctx.flags, "id"), {
    at: ctx.io.now(),
    assertedBy: flag(ctx.flags, "asserted-by"),
  });
  persistMutation(ctx, store, "privacy.hold.release");
  ctx.io.print(`hold released: ${value.id}`);
  return 0;
}

export async function privacyHoldList(ctx: PrivacyCliContext): Promise<number> {
  printJson(ctx, loadStore(ctx).snapshot().holds.map(holdView));
  return 0;
}
