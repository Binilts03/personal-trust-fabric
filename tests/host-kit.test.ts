import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHostConformanceScenario,
  createEffectBoundary,
  PrivacyEventConflictError,
  PrivacyOutcomeUnknownError,
  PrivacyPreEffectError,
  type HostConformanceScenario,
  type HostEffectBoundary,
  type HostEffectBoundaryOptions,
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
    readonly execute?: HostEffectBoundaryOptions["execute"];
    readonly persistAuthority?: HostEffectBoundaryOptions["persistAuthority"];
    readonly attemptRef?: string;
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
    ...(overrides.attemptRef !== undefined
      ? { attemptRef: overrides.attemptRef }
      : {}),
    ...(callbackPath
      ? {}
      : {
          provider: subject.provider,
          redemption: subject.redemption as NonNullable<
            HostConformanceScenario["redemption"]
          >,
        }),
    execute: overrides.execute ?? subject.effect,
    persistAuthority: overrides.persistAuthority ?? subject.persistAuthority,
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
      // The authority use was burned exactly once. `used` is [grant, count]
      // pairs, so `.length` alone would count grants touched, not uses.
      assert.equal(subject.auth.snapshot().used[0]?.[1], 1);
    });
  });

  it("awaits an asynchronous authority persistence before the effect", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "async-persist", { callbackPath: true });
      const order: string[] = [];
      const boundary = boundaryFor(subject, {
        callbackPath: true,
        persistAuthority: async (auth) => {
          order.push("persist:start");
          await new Promise((resolve) => setTimeout(resolve, 5));
          subject.persistAuthority(auth);
          order.push("persist:done");
        },
        execute: async (ctx) => {
          order.push("effect");
          return subject.effect(ctx);
        },
      });
      await boundary.run();
      assert.deepEqual(order, ["persist:start", "persist:done", "effect"]);
    });
  });

  it("does not run the effect when an asynchronous persistence rejects", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "async-reject", { callbackPath: true });
      const boundary = boundaryFor(subject, {
        callbackPath: true,
        persistAuthority: async () => {
          throw new Error("authority store changed under us");
        },
      });
      await assert.rejects(
        () => boundary.run(),
        (error: unknown) =>
          error instanceof Error &&
          error.message === "authority store changed under us"
      );
      assert.equal(subject.observed.effectRuns, 0);
      const events = subject.events.listBySubject(CONFIG.dataPrincipalRef);
      assert.equal(events[0]?.state, "FAILED_FINAL");
    });
  });

  it("treats a retry of the same terms as the same attempt", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "retry", { callbackPath: true });
      const boundary = boundaryFor(subject, { callbackPath: true });
      await boundary.run();
      await assert.rejects(
        () => boundary.run(),
        (error: unknown) => error instanceof PrivacyEventConflictError
      );
      assert.equal(subject.observed.effectRuns, 1);
      assert.equal(subject.auth.snapshot().used[0]?.[1], 1);
      assert.equal(
        subject.events.listBySubject(CONFIG.dataPrincipalRef).length,
        1
      );
    });
  });

  it("refuses an over-long attempt reference before consuming authority", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "retry-too-long", { callbackPath: true });
      const boundary = boundaryFor(subject, {
        callbackPath: true,
        attemptRef: "a".repeat(201),
      });
      await assert.rejects(
        () => boundary.run(),
        (error: unknown) => error instanceof PrivacyPreEffectError
      );
      assert.equal(subject.observed.effectRuns, 0);
      assert.equal(subject.auth.snapshot().used[0]?.[1] ?? 0, 0);
    });
  });

  it("denies an unauthorized run with a coarse pre-effect error", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "deny-authority", { denyAuthority: true });
      await assert.rejects(
        () => boundaryFor(subject).run(),
        (error: unknown) =>
          error instanceof PrivacyPreEffectError &&
          error.message === "authority denied"
      );
      assert.equal(subject.observed.privacyReads, 0);
      assert.equal(subject.observed.effectRuns, 0);
    });
  });

  it("binds the receipt to the authorized terms, not the host's", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "receipt-binding", { callbackPath: true });
      const boundary = boundaryFor(subject, {
        callbackPath: true,
        execute: async () => ({
          receiptId: "host-receipt",
          capabilityId: "c".repeat(64),
          recipient: "someone-else",
          resource: "another-resource",
          purpose: "another-purpose",
          termsDigest: "another-terms",
          transaction: "host-transaction",
          at: "receipt-secret" as unknown as number,
        }),
      });
      const receipt = await boundary.run();
      assert.equal(receipt.resource, subject.operation.resource.id);
      assert.equal(receipt.purpose, subject.operation.purpose);
      assert.equal(receipt.termsDigest, subject.demand.termsDigest);
      assert.equal(receipt.at, subject.now());
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
      assert.equal(subject.auth.snapshot().used[0]?.[1], 1);
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
