import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  PRIVACY_DEK_ALIAS,
  PRIVACY_DEK_NEXT_ALIAS,
  PrivacyStore,
  createPrivacyDek,
  ensurePrivacyDek,
  privacyDekFingerprint,
  readPrivacyKid,
  resolvePrivacyDek,
  rotatePrivacyDek,
  savePrivacyStore,
} from "../store/privacy.js";
import {
  rotatePrivacyEventsDek,
  verifyPrivacyEvents,
} from "../store/privacy-events.js";
import {
  MCP_PRIVACY_DENIED_PATHS,
  MCP_PRIVACY_GATED_PATHS,
  MCP_PRIVACY_UNCOVERED_PATHS,
  resolveMcpPrivacyConfig,
} from "../privacy/mcp.js";
import {
  privacyActivityAdd,
  privacyActivityList,
  privacyBasisAdd,
  privacyBasisList,
  privacyConsentAdd,
  privacyConsentList,
  privacyConsentWithdraw,
  privacyHoldAdd,
  privacyHoldList,
  privacyHoldRelease,
  privacyNoticeAdd,
  privacyNoticeList,
} from "./privacy-evidence.js";
import {
  privacyCheck,
  privacyCorrection,
  privacyErase,
  privacyEventsReconcile,
  privacyEventsResolve,
  privacySummary,
} from "./privacy-rights.js";
import {
  loadStore,
  optional,
  printJson,
  privacyDek,
  readJson,
  type PrivacyCliContext,
} from "./privacy-shared.js";

export type { PrivacyCliContext } from "./privacy-shared.js";

/**
 * Router for the privacy operator commands. The command bodies live in
 * `privacy-evidence.ts` (notices, consents, bases, activities, holds) and
 * `privacy-rights.ts` (check, summary, erasure, event recovery); the shared
 * flag/store/view plumbing lives in `privacy-shared.ts`.
 */

async function privacyInit(ctx: PrivacyCliContext): Promise<number> {
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

async function privacyVerify(ctx: PrivacyCliContext): Promise<number> {
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
      deniedPaths: [...MCP_PRIVACY_DENIED_PATHS],
      uncoveredPaths: [...MCP_PRIVACY_UNCOVERED_PATHS],
      note:
        configPath === undefined
          ? "No MCP operator config inspected: store verification is not enforcement proof"
          : "Configuration is valid, but this CLI cannot attest a separately running MCP host",
    },
  });
  return 0;
}

async function privacyRekey(ctx: PrivacyCliContext): Promise<number> {
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

const COMMANDS: Readonly<
  Record<string, (ctx: PrivacyCliContext) => Promise<number>>
> = {
  init: privacyInit,
  "notice/add": privacyNoticeAdd,
  "notice/list": privacyNoticeList,
  "consent/add": privacyConsentAdd,
  "consent/list": privacyConsentList,
  "consent/withdraw": privacyConsentWithdraw,
  "basis/withdraw-consent": privacyConsentWithdraw,
  "basis/add": privacyBasisAdd,
  "basis/list": privacyBasisList,
  "activity/add": privacyActivityAdd,
  "activity/list": privacyActivityList,
  "hold/add": privacyHoldAdd,
  "hold/release": privacyHoldRelease,
  "hold/list": privacyHoldList,
  check: privacyCheck,
  summary: privacySummary,
  "erase/plan": privacyErase,
  "erase/apply": privacyErase,
  "events/reconcile": privacyEventsReconcile,
  "events/resolve": privacyEventsResolve,
  correction: privacyCorrection,
  verify: privacyVerify,
  rekey: privacyRekey,
};

export async function runPrivacyCommand(
  ctx: PrivacyCliContext
): Promise<number> {
  const command = COMMANDS[ctx.path];
  if (command === undefined) {
    throw new Error(`unknown privacy subcommand: ${ctx.path}`);
  }
  return command(ctx);
}
