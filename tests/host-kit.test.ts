import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHostConformanceScenario,
  createEffectBoundary,
  PrivacyOutcomeUnknownError,
  PrivacyPreEffectError,
  type HostConformanceScenario,
  type HostEffectBoundary,
  type HostPrivacyConfig,
} from "../src/hostkit/index.js";

/**
 * The host effect boundary, exercised through the public `./hostkit`
 * subpath. The scenarios come from the kit's own scenario builder, so the
 * tests run against a real encrypted privacy store, a real authority store
 * and a real Processing Event repository.
 */

const CONFIG: HostPrivacyConfig = {
  dataPrincipalRef: "subject:opaque-hostkit",
  controllerId: "example-india",
  recipientRoles: { "approved-merchant": "third-party" },
  actionCategories: { "/pay": ["payment"] },
};

async function withScratch<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "ptf-host-kit-"));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

type ScenarioOverrides = Omit<
  Parameters<typeof buildHostConformanceScenario>[0],
  "id" | "root" | "config"
>;

function scenario(
  root: string,
  id: string,
  overrides: ScenarioOverrides = {}
): HostConformanceScenario {
  return buildHostConformanceScenario({
    id,
    root,
    config: CONFIG,
    ...overrides,
  });
}

/** A boundary over the scenario, built the way the kit documents. */
function boundaryFor(
  subject: HostConformanceScenario,
  overrides: {
    readonly authorizedContext?: Readonly<Record<string, unknown>>;
    readonly callbackPath?: boolean;
  } = {}
): HostEffectBoundary {
  const callbackPath = overrides.callbackPath ?? false;
  return createEffectBoundary({
    dir: subject.dir,
    auth: subject.auth,
    ingress: subject.ingress,
    runtime: subject.runtime,
    gate: subject.gate,
    now: subject.now,
    authorizedContext: overrides.authorizedContext ?? subject.authorizedContext,
    ...(callbackPath
      ? {}
      : {
          provider: subject.provider,
          redemption: subject.redemption as NonNullable<
            HostConformanceScenario["redemption"]
          >,
        }),
    execute: subject.effect,
    persistAuthority: subject.persistAuthority,
  });
}

describe("host effect boundary", () => {
  it("runs the nine steps in order", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "order");
      const receipt = await boundaryFor(subject).run();

      // 5. the evidence is durable before the consumption is persisted.
      assert.equal(subject.observed.eventPreparedBeforeConsumption, true);
      // 6. the consumption is durable before the effect runs.
      assert.equal(subject.observed.authorityPersistedBeforeEffect, true);
      // 8. the effect ran, and 9. the evidence is final.
      assert.equal(subject.observed.effectRan, true);
      assert.equal(subject.observed.effectStarted, true);
      const events = subject.events.listBySubject(CONFIG.dataPrincipalRef);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.state, "SUCCEEDED");
      assert.equal(events[0]?.eventId, receipt.eventId);
      // The authority use was burned exactly once.
      assert.equal(subject.auth.snapshot().used.length, 1);
    });
  });

  it("check() is a dry run: no effect, no event, no consumption", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "dry-run");
      const decision = await boundaryFor(subject).check();
      assert.equal(decision.allow, true);
      assert.ok((decision.termsDigest ?? "").length > 0);
      assert.equal(subject.observed.effectRan, false);
      assert.equal(subject.auth.snapshot().used.length, 0);
      assert.equal(
        subject.events.listBySubject(CONFIG.dataPrincipalRef).length,
        0
      );
    });
  });

  it("refuses an effect context that differs from the authorized one", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "terms", { callbackPath: true });
      const boundary = boundaryFor(subject, {
        callbackPath: true,
        authorizedContext: { amount: 100, currency: "INR" },
      });
      const decision = await boundary.check();
      assert.equal(decision.allow, false);
      assert.equal(decision.reason, "terms-mismatch");

      await assert.rejects(
        () => boundary.run(),
        (error: unknown) => error instanceof PrivacyPreEffectError
      );
      assert.equal(subject.observed.effectRan, false);
      assert.equal(subject.auth.snapshot().used.length, 0);
      assert.equal(
        subject.events.listBySubject(CONFIG.dataPrincipalRef).length,
        0
      );
    });
  });

  it("the fence stops an attempt whose consent was withdrawn late", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "fence", { withdrawAtFence: true });
      await assert.rejects(
        () => boundaryFor(subject).run(),
        (error: unknown) => error instanceof PrivacyPreEffectError
      );
      assert.equal(subject.observed.consentWithdrawn, true);
      assert.equal(subject.observed.effectRan, false);
      const events = subject.events.listBySubject(CONFIG.dataPrincipalRef);
      assert.equal(events[0]?.state, "FAILED_FINAL");
      // The authority use was already burned when the fence denied: the
      // fence runs after the consumption, never before it.
      assert.equal(subject.auth.snapshot().used.length, 1);
    });
  });

  it("classifies a failure before the effect as a proven pre-effect failure", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "fail-before", {
        callbackPath: true,
        failBeforeStart: true,
      });
      await assert.rejects(
        () => boundaryFor(subject, { callbackPath: true }).run(),
        (error: unknown) => error instanceof PrivacyPreEffectError
      );
      const events = subject.events.listBySubject(CONFIG.dataPrincipalRef);
      assert.equal(events[0]?.state, "FAILED_FINAL");
    });
  });

  it("classifies a failure after the effect as an unknown outcome", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "fail-after", {
        callbackPath: true,
        failAfterStart: true,
      });
      await assert.rejects(
        () => boundaryFor(subject, { callbackPath: true }).run(),
        (error: unknown) => error instanceof PrivacyOutcomeUnknownError
      );
      const events = subject.events.listBySubject(CONFIG.dataPrincipalRef);
      assert.equal(events[0]?.state, "OUTCOME_UNKNOWN");
    });
  });

  it("keeps secrets and subject identifiers out of the receipt", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "secret-free");
      const receipt = await boundaryFor(subject).run();
      const rendered = JSON.stringify(receipt);
      assert.ok(!rendered.includes(CONFIG.dataPrincipalRef));
      assert.ok(!rendered.includes(CONFIG.controllerId));
      assert.ok(!rendered.includes(subject.ingress.id));
      assert.ok(!rendered.includes(subject.ingress.principal));
      const fields = Object.keys(receipt).sort();
      for (const field of fields) {
        assert.ok(
          [
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
          ].includes(field),
          `unexpected receipt field: ${field}`
        );
      }
      const events = subject.events.listBySubject(CONFIG.dataPrincipalRef);
      assert.match(
        events[0]?.dataPrincipalRef ?? "",
        /^subject:[A-Za-z][A-Za-z0-9_-]{5,127}$/
      );
    });
  });

  it("denies an unauthorised operation before the privacy plane answers", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "no-authority", { denyAuthority: true });
      const decision = await boundaryFor(subject).check();
      assert.equal(decision.allow, false);
      assert.equal(decision.reason, "authority-denied");
      assert.equal(subject.auth.snapshot().used.length, 0);
      assert.equal(subject.observed.effectRan, false);
    });
  });

  it("denies an operation the privacy plane refuses", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "no-privacy", { denyPrivacy: true });
      await assert.rejects(
        () => boundaryFor(subject).run(),
        (error: unknown) => error instanceof PrivacyPreEffectError
      );
      assert.equal(subject.observed.effectRan, false);
      assert.equal(subject.auth.snapshot().used.length, 0);
      assert.equal(
        subject.events.listBySubject(CONFIG.dataPrincipalRef).length,
        0
      );
    });
  });
});
