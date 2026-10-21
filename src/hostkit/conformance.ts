import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Authority,
  digestForOperation,
  paymentBounds,
  type AuthorityOperation,
  type AuthorityRequest,
  type VerifiedIdentity,
} from "../core/authority.js";
import { canonicalize } from "../core/canonical.js";
import type { ExecutionReceipt } from "../core/execute.js";
import type { Redemption } from "../core/types.js";
import { type ProtectedProvider } from "../adapters/providers.js";
import { dpdpProfile } from "../privacy/dpdp.js";
import type { PrivacyRecipientRole } from "../privacy/model.js";
import {
  PrivacyOutcomeUnknownError,
  PrivacyPreEffectError,
} from "../privacy/errors.js";
import {
  privacyForHostOperation,
  type HostPrivacyConfig,
} from "../privacy/host.js";
import type { PrivacyGateRequest, PrivacyRuntime } from "../privacy/runtime.js";
import {
  PRIVACY_DEK_ALIAS,
  PrivacyStore,
  createPrivacyDek,
  loadPrivacyStore,
  savePrivacyStore,
} from "../store/privacy.js";
import { FilePrivacyEventRepository } from "../store/privacy-events.js";
import { loadAuthority, saveAuthority } from "../store/files.js";
import {
  createEffectBoundary,
  type HostEffectBoundary,
  type HostEffectContext,
  type HostEffectReceipt,
} from "./boundary.js";

/**
 * The host kit conformance suite.
 *
 * Nine executable checks over the effect boundary. Each check proves one
 * property of the ordering in `boundary.ts` and names the rule it proves.
 * A failing check is a result, not an exception: the operator sees which
 * property broke.
 *
 * The suite runs against synthetic scenario stores in a scratch directory.
 * It never touches the operator's store, and it never reaches the network.
 */

const NOW = 1_800_000_000;
const PRINCIPAL = "you";
const ACTOR = "shopper";
const RESOURCE = { type: "ptf-resource", id: "invoice:1" } as const;
const PURPOSE = "payment";
const AMOUNT = 100;
const CURRENCY = "INR";
const GRANT_ID = "grant-conformance";
const NOTICE_ID = "notice-conformance";
const CONSENT_ID = "consent-conformance";
const BASIS_ID = "basis-conformance";
const ACTIVITY_ID = "activity-conformance";
const CAPABILITY_ID = "c".repeat(64);
/** The categories used when the operator configuration names none. */
const DEFAULT_CATEGORIES = ["payment"] as const;

/** One check's outcome. A failing check is a result, never a throw. */
export interface HostConformanceResult {
  readonly id: string;
  readonly title: string;
  /** The rule this check proves. */
  readonly requirement: string;
  readonly ok: boolean;
  /** Why the check failed. Absent when the check passed. */
  readonly detail?: string;
}

/** What a scenario observed while the boundary ran. */
export interface HostConformanceObservations {
  /** The effect callback ran. */
  effectRan: boolean;
  /** The effect callback signalled that the effect started. */
  effectStarted: boolean;
  /** A Processing Event existed when the authority consumption was persisted. */
  eventPreparedBeforeConsumption: boolean;
  /** The durable authority file already showed the consumed use at effect time. */
  authorityPersistedBeforeEffect: boolean;
  /** The consent was withdrawn between the recheck and the fence. */
  consentWithdrawn: boolean;
  /** The authority consumption could not be persisted. */
  persistFailed: boolean;
}

/** One prepared scenario: a store, an authority, a gate and an effect. */
export interface HostConformanceScenario {
  readonly id: string;
  readonly dir: string;
  readonly auth: Authority;
  readonly ingress: VerifiedIdentity;
  readonly operation: AuthorityOperation;
  readonly demand: AuthorityRequest;
  readonly authorizedContext: Readonly<Record<string, unknown>>;
  readonly runtime: PrivacyRuntime;
  readonly gate: PrivacyGateRequest;
  readonly events: FilePrivacyEventRepository;
  readonly provider: ProtectedProvider;
  readonly redemption: Redemption | undefined;
  /** The recipient the scenario pays. Taken from the operator's roles. */
  readonly recipient: string;
  /** The observing effect callback. */
  readonly effect: (ctx: HostEffectContext) => Promise<ExecutionReceipt | void>;
  /** The durable authority persistence the boundary must use. */
  readonly persistAuthority: (auth: Authority) => void;
  readonly observed: HostConformanceObservations;
  readonly now: () => number;
  readonly dek: Uint8Array;
  readonly config: HostPrivacyConfig;
}

/** Builds the boundary under test from a scenario. */
export type HostConformanceBoundaryFactory = (
  scenario: HostConformanceScenario
) => HostEffectBoundary;

export interface HostConformanceScenarioOptions {
  readonly id: string;
  /** The scratch root the scenario store is created in. */
  readonly root: string;
  readonly config: HostPrivacyConfig;
  /** The declared authorized context. Defaults to the demand's context. */
  readonly authorizedContext?: Readonly<Record<string, unknown>>;
  /** The authority denies the operation. */
  readonly denyAuthority?: boolean;
  /** The consent is withdrawn before the run: the privacy plane denies. */
  readonly denyPrivacy?: boolean;
  /** Use the host callback instead of the journaled provider path. */
  readonly callbackPath?: boolean;
  /** The effect fails after it signalled that it started. */
  readonly failAfterStart?: boolean;
  /** The effect fails before it signalled that it started. */
  readonly failBeforeStart?: boolean;
  /** The consent is withdrawn between the recheck and the fence. */
  readonly withdrawAtFence?: boolean;
  /** The durable authority write fails, as a CAS conflict would. */
  readonly failPersist?: boolean;
}

function eventFiles(dir: string): number {
  const root = join(dir, "privacy-events");
  if (!existsSync(root)) return 0;
  return readdirSync(root).filter((name) => name.endsWith(".json")).length;
}

function authorityUsesOnDisk(dir: string, grantId: string): number {
  const path = join(dir, "authority.json");
  if (!existsSync(path)) return 0;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    readonly used?: unknown;
  };
  const used = parsed.used;
  if (Array.isArray(used)) {
    for (const entry of used) {
      if (Array.isArray(entry) && entry[0] === grantId) {
        const count = entry[1];
        return typeof count === "number" ? count : 0;
      }
    }
    return 0;
  }
  if (typeof used === "object" && used !== null) {
    const count = (used as Record<string, unknown>)[grantId];
    return typeof count === "number" ? count : 0;
  }
  return 0;
}

function writePrivacyState(
  dir: string,
  dek: Uint8Array,
  mutate: (store: PrivacyStore) => void
): void {
  const store = loadPrivacyStore(dir, { dek });
  mutate(store);
  savePrivacyStore(dir, store, { dek });
}

function seedPrivacyState(
  dir: string,
  dek: Uint8Array,
  config: HostPrivacyConfig,
  categories: readonly string[],
  recipient: string,
  recipientRole: PrivacyRecipientRole
): void {
  const store = new PrivacyStore(() => NOW);
  store.addNotice({
    id: NOTICE_ID,
    controllerId: config.controllerId,
    dataPrincipalRef: config.dataPrincipalRef,
    purpose: PURPOSE,
    dataCategories: [...categories],
    noticeRef: "notice:conformance",
    noticeHash: "sha256:conformance",
    presentedAt: NOW - 3600,
    assertedBy: "conformance-suite",
  });
  store.addConsent({
    id: CONSENT_ID,
    noticeId: NOTICE_ID,
    controllerId: config.controllerId,
    dataPrincipalRef: config.dataPrincipalRef,
    purpose: PURPOSE,
    dataCategories: [...categories],
    givenAt: NOW - 1800,
    method: "operator-recorded",
    proofRef: "consent-proof:conformance",
    assertedBy: "conformance-suite",
  });
  store.addBasis({
    id: BASIS_ID,
    kind: "consent",
    controllerId: config.controllerId,
    dataPrincipalRef: config.dataPrincipalRef,
    purpose: PURPOSE,
    dataCategories: [...categories],
    consentId: CONSENT_ID,
    assertedBy: "conformance-suite",
    active: true,
  });
  store.addActivity({
    id: ACTIVITY_ID,
    profileId: dpdpProfile.id,
    authorityPrincipal: PRINCIPAL,
    controllerId: config.controllerId,
    subjects: { kind: "exact", ref: config.dataPrincipalRef },
    action: "/pay",
    resourceType: RESOURCE.type,
    purpose: PURPOSE,
    dataCategories: [...categories],
    recipients: [{ id: recipient, role: recipientRole }],
    basisId: BASIS_ID,
    active: true,
  });
  savePrivacyStore(dir, store, { dek });
}

/**
 * Build one scenario store. Every scenario is isolated: its own directory,
 * its own authority, its own privacy records.
 */
export function buildHostConformanceScenario(
  options: HostConformanceScenarioOptions
): HostConformanceScenario {
  const now = (): number => NOW;
  const dir = join(options.root, options.id);
  mkdirSync(dir, { recursive: true });

  // The operator's configuration drives the scenario: the controller, the
  // opaque subject reference and the recipient roles are the host's own.
  const categories = options.config.actionCategories?.["/pay"] ?? [
    ...DEFAULT_CATEGORIES,
  ];
  const recipient = Object.keys(options.config.recipientRoles)[0] ?? "";
  if (recipient.length === 0) {
    throw new Error(
      "host conformance: the operator configuration names no recipient role"
    );
  }
  const recipientRole: PrivacyRecipientRole =
    options.config.recipientRoles[recipient] ?? "other";
  const dek = createPrivacyDek();
  const keys: Record<string, Uint8Array> = { [PRIVACY_DEK_ALIAS]: dek };
  seedPrivacyState(
    dir,
    dek,
    options.config,
    categories,
    recipient,
    recipientRole
  );
  if (options.denyPrivacy === true) {
    writePrivacyState(dir, dek, (store) => {
      store.withdrawConsent(CONSENT_ID, {
        at: NOW,
        proofRef: "conformance-suite:withdrawal",
        assertedBy: "conformance-suite",
      });
    });
  }

  const auth = new Authority({ nowSec: now });
  if (options.denyAuthority !== true) {
    auth.addGrant({
      id: GRANT_ID,
      principal: PRINCIPAL,
      actor: { kind: "exact", id: ACTOR },
      action: { name: "/pay" },
      resource: { type: RESOURCE.type, id: RESOURCE.id },
      purpose: PURPOSE,
      bounds: paymentBounds({ amountMax: 1000, currency: CURRENCY }),
      maxUses: 10,
    });
  }
  saveAuthority(dir, auth);
  // Reload so the instance carries the durable lineage the CAS needs.
  const loaded = loadAuthority(dir, { nowSec: now });

  const operation: AuthorityOperation = {
    action: { name: "/pay" },
    resource: { type: RESOURCE.type, id: RESOURCE.id },
    context: { amount: AMOUNT, currency: CURRENCY, recipient },
    purpose: PURPOSE,
  };
  const ingress: VerifiedIdentity = {
    id: ACTOR,
    principal: PRINCIPAL,
    source: "local-registration",
    proofRef: "conformance-suite",
  };
  const bound = { ...operation, principal: PRINCIPAL, actor: ACTOR };
  const demand: AuthorityRequest = {
    ...bound,
    termsDigest: digestForOperation(bound),
  };

  const scoped = privacyForHostOperation({
    dir,
    keys,
    auth: loaded,
    ingress,
    demand,
    config: options.config,
    now,
  });

  const redemption: Redemption | undefined =
    options.callbackPath === true
      ? undefined
      : {
          ok: true,
          remaining: 0,
          chainId: CAPABILITY_ID,
          operation: {
            cmd: "/pay",
            args: { ...operation.context },
            recipient,
            resource: RESOURCE.id,
            purpose: PURPOSE,
            termsDigest: demand.termsDigest,
          },
          consumed: true,
          proofVerified: true,
          redemptionId: "rdm-conformance",
        };

  const observed: HostConformanceObservations = {
    effectRan: false,
    effectStarted: false,
    eventPreparedBeforeConsumption: false,
    authorityPersistedBeforeEffect: false,
    consentWithdrawn: false,
    persistFailed: false,
  };

  const provider: ProtectedProvider = {
    kind: "payment",
    namespace: "conformance",
    async submit(req) {
      // The observations are taken here, at the rail boundary: the durable
      // authority state must already show the consumed use.
      observed.effectRan = true;
      observed.authorityPersistedBeforeEffect =
        authorityUsesOnDisk(dir, GRANT_ID) > 0;
      observed.effectStarted = true;
      return {
        kind: "payment",
        capabilityId: req.capabilityId,
        termsDigest: req.termsDigest,
        externalRef: "txn-conformance",
        at: now(),
      };
    },
    verify(sub, expected) {
      if (sub.kind !== "payment") {
        return { ok: false, reason: "kind mismatch" };
      }
      if (sub.capabilityId !== expected.capabilityId) {
        return { ok: false, reason: "capability mismatch" };
      }
      if (sub.termsDigest !== expected.termsDigest) {
        return { ok: false, reason: "terms mismatch" };
      }
      if (typeof sub.externalRef !== "string" || sub.externalRef.length === 0) {
        return { ok: false, reason: "missing externalRef" };
      }
      return { ok: true };
    },
  };

  const effect = async (
    ctx: HostEffectContext
  ): Promise<ExecutionReceipt | void> => {
    observed.effectRan = true;
    observed.authorityPersistedBeforeEffect =
      authorityUsesOnDisk(dir, GRANT_ID) > 0;
    if (options.failBeforeStart === true) {
      throw new Error("conformance: the effect failed before it started");
    }
    ctx.markEffectStarted();
    observed.effectStarted = true;
    if (options.failAfterStart === true) {
      throw new Error("conformance: the effect failed after it started");
    }
    return {
      receiptId: "rcpt-conformance",
      capabilityId: CAPABILITY_ID,
      recipient,
      resource: RESOURCE.id,
      purpose: PURPOSE,
      transaction: "txn-conformance",
      at: now(),
      termsDigest: demand.termsDigest,
    };
  };

  const persistAuthority = (instance: Authority): void => {
    observed.eventPreparedBeforeConsumption = eventFiles(dir) > 0;
    if (options.withdrawAtFence === true) {
      observed.consentWithdrawn = true;
      writePrivacyState(dir, dek, (store) => {
        store.withdrawConsent(CONSENT_ID, {
          at: now(),
          proofRef: "conformance-suite:withdrawal",
          assertedBy: "conformance-suite",
        });
      });
    }
    if (options.failPersist === true) {
      observed.persistFailed = true;
      throw new Error("authority store changed under us");
    }
    saveAuthority(dir, instance);
  };

  return {
    id: options.id,
    dir,
    auth: loaded,
    ingress,
    operation,
    demand,
    authorizedContext: options.authorizedContext ?? operation.context,
    runtime: scoped.runtime,
    gate: scoped.gate,
    events: new FilePrivacyEventRepository({ dir, dek, nowSec: now }),
    provider,
    redemption,
    recipient,
    effect,
    persistAuthority,
    observed,
    now,
    dek,
    config: options.config,
  };
}

/**
 * The reference composition: the boundary as the kit ships it. A host with
 * its own composition passes its own factory instead.
 */
export function referenceHostBoundary(
  scenario: HostConformanceScenario
): HostEffectBoundary {
  const redemption = scenario.redemption;
  return createEffectBoundary({
    dir: scenario.dir,
    auth: scenario.auth,
    ingress: scenario.ingress,
    runtime: scenario.runtime,
    gate: scenario.gate,
    now: scenario.now,
    authorizedContext: scenario.authorizedContext,
    ...(redemption !== undefined
      ? { provider: scenario.provider, redemption }
      : {}),
    execute: scenario.effect,
    persistAuthority: scenario.persistAuthority,
  });
}

export interface HostConformanceOptions {
  /** The operator's privacy configuration. */
  readonly config: HostPrivacyConfig;
  /** The scratch root for the scenario stores. */
  readonly tmpDir: string;
  /** The boundary under test. Defaults to the reference composition. */
  readonly boundary?: HostConformanceBoundaryFactory;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface CheckContext {
  readonly options: HostConformanceOptions;
  readonly boundary: HostConformanceBoundaryFactory;
  scenario(options: HostConformanceScenarioOptions): HostConformanceScenario;
}

interface HostCheck {
  readonly id: string;
  readonly title: string;
  readonly requirement: string;
  readonly run: (ctx: CheckContext) => Promise<void>;
}

/**
 * The nine checks. Each one runs a real boundary against a real store and
 * observes the durable state; none of them asserts a slogan.
 */
const CHECKS: readonly HostCheck[] = [
  {
    id: "authority-first",
    title: "the authority decides first and consumes nothing",
    requirement:
      "ADR-0024 §4: an unauthorised caller is denied by the authority before the privacy plane can allow anything, and the preflight consumes no authority use",
    async run(ctx): Promise<void> {
      const denied = ctx.scenario({
        id: "authority-first",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
        denyAuthority: true,
      });
      const decision = await ctx.boundary(denied).check();
      assert(
        decision.allow === false && decision.reason === "authority-denied",
        `an unauthorised operation must be denied by the authority, got: ${decision.reason ?? "allowed"}`
      );
      assert(
        denied.auth.snapshot().used.length === 0,
        "the authority preflight must not consume a use"
      );
      assert(
        denied.observed.effectRan === false,
        "the dry run must not reach the effect"
      );
      assert(
        eventFiles(denied.dir) === 0,
        "the dry run must not write a Processing Event"
      );
    },
  },
  {
    id: "dry-run-has-no-effect",
    title: "check() decides without consuming or evidencing",
    requirement:
      "ADR-0018: CHECK != REDEEM != EXECUTE - a dry-run result can never execute",
    async run(ctx): Promise<void> {
      const scenario = ctx.scenario({
        id: "dry-run",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
      });
      const decision = await ctx.boundary(scenario).check();
      assert(
        decision.allow === true,
        "the dry run must allow an authorised operation"
      );
      assert(
        typeof decision.termsDigest === "string" &&
          decision.termsDigest.length > 0,
        "the dry run must report the terms digest"
      );
      assert(
        scenario.observed.effectRan === false,
        "the dry run must not reach the effect"
      );
      assert(
        scenario.auth.snapshot().used.length === 0,
        "the dry run must not consume an authority use"
      );
      assert(
        eventFiles(scenario.dir) === 0,
        "the dry run must not write a Processing Event"
      );
      assert(
        authorityUsesOnDisk(scenario.dir, GRANT_ID) === 0,
        "the dry run must not persist a consumption"
      );
    },
  },
  {
    id: "privacy-denial-fails-closed",
    title: "a privacy denial stops the attempt before any consumption",
    requirement:
      "ADR-0024 §3 and §9: a privacy decision may deny an operation, and a denied attempt never consumes authority and never runs the effect",
    async run(ctx): Promise<void> {
      const scenario = ctx.scenario({
        id: "privacy-denied",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
        denyPrivacy: true,
      });
      let thrown: unknown;
      try {
        await ctx.boundary(scenario).run();
      } catch (error) {
        thrown = error;
      }
      assert(thrown !== undefined, "a withdrawn consent must deny the attempt");
      assert(
        thrown instanceof PrivacyPreEffectError,
        `the denial must be a pre-effect failure, got: ${describe(thrown)}`
      );
      assert(
        scenario.observed.effectRan === false,
        "a denied attempt must not run the effect"
      );
      assert(
        scenario.auth.snapshot().used.length === 0,
        "a denied attempt must not consume an authority use"
      );
      assert(
        eventFiles(scenario.dir) === 0,
        "a denial before the precommit must not leave evidence behind"
      );
    },
  },
  {
    id: "evidence-precommit-before-consumption",
    title: "the Processing Event is durable before the authority use is burned",
    requirement:
      "ADR-0024 §9: consequential processing precommits secret-free evidence before the processing boundary",
    async run(ctx): Promise<void> {
      const scenario = ctx.scenario({
        id: "precommit",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
      });
      const receipt = await ctx.boundary(scenario).run();
      assert(
        scenario.observed.eventPreparedBeforeConsumption === true,
        "the Processing Event must exist before the authority consumption is persisted"
      );
      const events = scenario.events.listBySubject(
        scenario.config.dataPrincipalRef
      );
      assert(
        events.length === 1,
        `exactly one Processing Event must cover the attempt, found ${events.length}`
      );
      assert(
        events[0]?.state === "SUCCEEDED",
        `the event must be finalised, got: ${events[0]?.state ?? "none"}`
      );
      assert(
        events[0]?.eventId === receipt.eventId,
        "the receipt must name the Processing Event that covers it"
      );
    },
  },
  {
    id: "consumption-before-effect",
    title: "the authority use is persisted before the effect runs",
    requirement:
      "invariant 9 and ADR-0018: durable authority consumption happens before an external effect",
    async run(ctx): Promise<void> {
      const scenario = ctx.scenario({
        id: "consume-first",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
      });
      await ctx.boundary(scenario).run();
      assert(
        scenario.observed.authorityPersistedBeforeEffect === true,
        "the durable authority file must already show the consumed use when the effect starts"
      );
      assert(
        authorityUsesOnDisk(scenario.dir, GRANT_ID) > 0,
        "the authority use must be persisted"
      );

      const blocked = ctx.scenario({
        id: "consume-conflict",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
        failPersist: true,
      });
      let thrown: unknown;
      try {
        await ctx.boundary(blocked).run();
      } catch (error) {
        thrown = error;
      }
      assert(
        thrown !== undefined,
        "a failed authority write must stop the attempt"
      );
      assert(
        blocked.observed.effectRan === false,
        "the effect must not run when the consumption could not be persisted"
      );
    },
  },
  {
    id: "fence-stops-late-withdrawal",
    title: "the effect boundary re-reads the privacy state",
    requirement:
      "ADR-0024 and ADR-0025 §3: the fence at the effect boundary stops an attempt whose consent was withdrawn after the recheck",
    async run(ctx): Promise<void> {
      const scenario = ctx.scenario({
        id: "fence",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
        withdrawAtFence: true,
      });
      let thrown: unknown;
      try {
        await ctx.boundary(scenario).run();
      } catch (error) {
        thrown = error;
      }
      assert(thrown !== undefined, "a late withdrawal must stop the attempt");
      assert(
        thrown instanceof PrivacyPreEffectError,
        `the fence denial must be a pre-effect failure, got: ${describe(thrown)}`
      );
      assert(
        scenario.observed.consentWithdrawn === true,
        "the scenario must have withdrawn the consent before the fence"
      );
      assert(
        scenario.observed.effectRan === false,
        "the effect must not run after the fence denies"
      );
      const events = scenario.events.listBySubject(
        scenario.config.dataPrincipalRef
      );
      assert(
        events[0]?.state === "FAILED_FINAL",
        `the event must be a proven pre-effect failure, got: ${events[0]?.state ?? "none"}`
      );
    },
  },
  {
    id: "terms-binding-is-exact",
    title: "the effect context equals the authorized context exactly",
    requirement:
      "ADR-0018: the executed operation deep-equals the authorized operation - no extra effect-bearing key rides along",
    async run(ctx): Promise<void> {
      const recipient = Object.keys(ctx.options.config.recipientRoles)[0] ?? "";
      const extra = ctx.scenario({
        id: "terms-authorized-extra",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
        callbackPath: true,
        authorizedContext: {
          amount: AMOUNT,
          currency: CURRENCY,
          recipient,
          extra: "smuggled",
        },
      });
      const decision = await ctx.boundary(extra).check();
      assert(
        decision.allow === false && decision.reason === "terms-mismatch",
        `an extra effect-bearing key must be refused, got: ${decision.reason ?? "allowed"}`
      );
      let thrown: unknown;
      try {
        await ctx.boundary(extra).run();
      } catch (error) {
        thrown = error;
      }
      assert(thrown !== undefined, "an unbound effect context must not run");
      assert(
        extra.observed.effectRan === false,
        "an unbound effect context must not reach the effect"
      );
      assert(
        extra.auth.snapshot().used.length === 0,
        "an unbound effect context must not consume an authority use"
      );

      const missing = ctx.scenario({
        id: "terms-authorized-missing",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
        callbackPath: true,
        authorizedContext: { amount: AMOUNT, currency: CURRENCY },
      });
      const missingDecision = await ctx.boundary(missing).check();
      assert(
        missingDecision.allow === false &&
          missingDecision.reason === "terms-mismatch",
        `an unauthorized effect context must be refused, got: ${missingDecision.reason ?? "allowed"}`
      );
    },
  },
  {
    id: "failure-classification",
    title:
      "a failure before the effect is proven, a failure after it is unknown",
    requirement:
      "ADR-0024 §9: an ambiguous crash stays visible as OUTCOME_UNKNOWN - a failure is never reported as a denial it cannot prove",
    async run(ctx): Promise<void> {
      const before = ctx.scenario({
        id: "fail-before",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
        callbackPath: true,
        failBeforeStart: true,
      });
      let beforeError: unknown;
      try {
        await ctx.boundary(before).run();
      } catch (error) {
        beforeError = error;
      }
      assert(beforeError !== undefined, "the failing effect must throw");
      assert(
        beforeError instanceof PrivacyPreEffectError,
        `a failure before the effect must be a pre-effect failure, got: ${describe(beforeError)}`
      );
      const beforeEvents = before.events.listBySubject(
        before.config.dataPrincipalRef
      );
      assert(
        beforeEvents[0]?.state === "FAILED_FINAL",
        `the event must be FAILED_FINAL, got: ${beforeEvents[0]?.state ?? "none"}`
      );

      const after = ctx.scenario({
        id: "fail-after",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
        callbackPath: true,
        failAfterStart: true,
      });
      let afterError: unknown;
      try {
        await ctx.boundary(after).run();
      } catch (error) {
        afterError = error;
      }
      assert(afterError !== undefined, "the failing effect must throw");
      assert(
        afterError instanceof PrivacyOutcomeUnknownError,
        `a failure after the effect must stay unknown, got: ${describe(afterError)}`
      );
      const afterEvents = after.events.listBySubject(
        after.config.dataPrincipalRef
      );
      assert(
        afterEvents[0]?.state === "OUTCOME_UNKNOWN",
        `the event must be OUTCOME_UNKNOWN, got: ${afterEvents[0]?.state ?? "none"}`
      );
    },
  },
  {
    id: "receipt-and-evidence-are-secret-free",
    title:
      "the receipt and the evidence carry no secret and no subject identifier",
    requirement:
      "invariant 3 and ADR-0018: use without possession - no personal value and no direct subject identifier reaches a receipt or an event",
    async run(ctx): Promise<void> {
      const scenario = ctx.scenario({
        id: "secret-free",
        root: ctx.options.tmpDir,
        config: ctx.options.config,
      });
      const receipt = await ctx.boundary(scenario).run();
      const rendered = canonicalize(receipt);
      for (const forbidden of [
        scenario.config.dataPrincipalRef,
        scenario.config.controllerId,
        scenario.ingress.id,
        scenario.ingress.principal,
      ]) {
        assert(
          !rendered.includes(forbidden),
          `the receipt must not carry ${forbidden}`
        );
      }
      const fields = Object.keys(receipt).sort();
      const allowed = [
        "action",
        "at",
        "authorityId",
        "capabilityId",
        "eventId",
        "purpose",
        "receiptId",
        "resource",
        "termsDigest",
        "transaction",
      ];
      assert(
        fields.every((field) => allowed.includes(field)),
        `the receipt must carry fixed fields only, got: ${fields.join(", ")}`
      );
      const events = scenario.events.listBySubject(
        scenario.config.dataPrincipalRef
      );
      const event = events[0];
      if (event === undefined) {
        throw new Error("the attempt must leave a Processing Event");
      }
      assert(
        /^subject:[A-Za-z][A-Za-z0-9_-]{5,127}$/.test(event.dataPrincipalRef),
        `the event must carry an opaque subject reference, got: ${event.dataPrincipalRef}`
      );
      assert(
        !event.dataPrincipalRef.includes("@") &&
          !event.dataPrincipalRef.includes(" "),
        "the event must not carry a direct subject identifier"
      );
      assert(
        canonicalize(event).indexOf("secret") === -1,
        "the event must not carry a secret"
      );
    },
  },
];

/**
 * Run the conformance suite. Returns one result per check; a failing check
 * is a result, never an exception.
 */
export async function runHostConformance(
  options: HostConformanceOptions
): Promise<HostConformanceResult[]> {
  const boundary = options.boundary ?? referenceHostBoundary;
  const ctx: CheckContext = {
    options,
    boundary,
    scenario: (scenarioOptions: HostConformanceScenarioOptions) =>
      buildHostConformanceScenario(scenarioOptions),
  };
  const results: HostConformanceResult[] = [];
  for (const check of CHECKS) {
    try {
      await check.run(ctx);
      results.push({
        id: check.id,
        title: check.title,
        requirement: check.requirement,
        ok: true,
      });
    } catch (error) {
      results.push({
        id: check.id,
        title: check.title,
        requirement: check.requirement,
        ok: false,
        detail: describe(error),
      });
    }
  }
  return results;
}
