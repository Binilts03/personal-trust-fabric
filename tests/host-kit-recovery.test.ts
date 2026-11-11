import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  type HostPrivacyConfig,
} from "../src/hostkit/index.js";
import type {
  ExecutionQuery,
  ProtectedProvider,
} from "../src/adapters/providers.js";
import { deriveIdempotencyKey } from "../src/store/execution.js";

/**
 * The recovery seam of the host effect boundary.
 *
 * `run()` can end in `OUTCOME_UNKNOWN`: the effect crossed the submit
 * boundary and its response was lost. The journal knows more than the caller
 * does, but the boundary had no way to ask it. These tests cover the two new
 * operations:
 *
 *   - `inspect()` — observation only. It never submits, never writes a
 *     journal row and never finalizes an event.
 *   - `reconcile()` — the authorized resolver. It adopts an effect the
 *     provider confirms, under the journal's own attestation, and finalizes
 *     the Processing Event.
 *
 * The rule both must keep: a second effect is never possible. The provider
 * that receives the released claims is the only one that can move value, and
 * the journaled executor re-uses the attempt's idempotency key.
 */

const CONFIG: HostPrivacyConfig = {
  dataPrincipalRef: "subject:opaque-recovery",
  controllerId: "example-india",
  recipientRoles: { "approved-merchant": "third-party" },
  actionCategories: { "/pay": ["payment"] },
};

async function withScratch<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "ptf-host-kit-recovery-"));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scenario(
  root: string,
  id: string,
  overrides: Partial<Parameters<typeof buildHostConformanceScenario>[0]> = {}
): HostConformanceScenario {
  return buildHostConformanceScenario({
    id,
    root,
    config: CONFIG,
    ...overrides,
  });
}

/**
 * A provider whose first submit takes effect and then loses the response:
 * the journal records `SUBMITTED_UNKNOWN` and the caller sees an ambiguous
 * outcome.
 */
function lossyProvider(subject: HostConformanceScenario): ProtectedProvider {
  const inner = subject.provider;
  let lose = true;
  return {
    kind: inner.kind,
    ...(inner.namespace !== undefined ? { namespace: inner.namespace } : {}),
    async submit(req) {
      const outcome = await inner.submit(req);
      if (lose) {
        lose = false;
        throw new Error("recovery: the provider response was lost");
      }
      return outcome;
    },
    verify: (sub, expected) => inner.verify(sub, expected),
  };
}

/** The key the journal and the provider were called with. */
function journalKeyOf(
  subject: HostConformanceScenario,
  provider: ProtectedProvider
): string {
  return deriveIdempotencyKey(
    subject.redemption?.operation.termsDigest ?? "",
    provider.namespace ?? provider.kind
  );
}

function boundaryFor(
  subject: HostConformanceScenario,
  options: {
    readonly provider?: ProtectedProvider;
    readonly query?: ExecutionQuery;
    readonly callbackPath?: boolean;
    readonly attemptRef?: string;
  } = {}
): HostEffectBoundary {
  const callbackPath = options.callbackPath ?? false;
  return createEffectBoundary({
    dir: subject.dir,
    auth: subject.auth,
    ingress: subject.ingress,
    runtime: subject.runtime,
    gate: subject.gate,
    now: subject.now,
    authorizedContext: subject.authorizedContext,
    ...(options.attemptRef !== undefined
      ? { attemptRef: options.attemptRef }
      : {}),
    ...(callbackPath
      ? {}
      : {
          provider: options.provider ?? subject.provider,
          redemption: subject.redemption as NonNullable<
            HostConformanceScenario["redemption"]
          >,
        }),
    ...(options.query !== undefined ? { query: options.query } : {}),
    execute: subject.effect,
    persistAuthority: subject.persistAuthority,
  });
}

describe("host effect boundary — recovery seam", () => {
  it("inspect() reports an observed effect without submitting anything", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "inspect-effected");
      const provider = lossyProvider(subject);
      const seen: string[] = [];
      const query: ExecutionQuery = {
        async query(input) {
          seen.push(input.idempotencyKey);
          return { state: "effected", externalRef: "txn-conformance" };
        },
      };
      const boundary = boundaryFor(subject, { provider, query });

      await assert.rejects(
        () => boundary.run(),
        (error: unknown) => error instanceof PrivacyOutcomeUnknownError
      );
      assert.equal(subject.observed.effectRuns, 1);

      const inspection = await boundary.inspect();
      assert.equal(inspection.kind, "effected");
      if (inspection.kind === "effected") {
        assert.equal(inspection.externalRef, "txn-conformance");
      }
      // The query is asked with the key the provider was called with.
      assert.deepEqual(seen, [journalKeyOf(subject, provider)]);
      // Observation only: no new submit, and the journal is untouched.
      assert.equal(subject.observed.effectRuns, 1);
    });
  });

  it("inspect() reports an absent record without inventing an outcome", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "inspect-absent");
      const query: ExecutionQuery = {
        async query() {
          throw new Error("the query must not be asked without a record");
        },
      };
      const inspection = await boundaryFor(subject, { query }).inspect();
      assert.equal(inspection.kind, "absent");
      assert.equal(subject.observed.effectRuns, 0);
    });
  });

  it("inspect() treats a corrupt journal record as unknown, never as absent", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "inspect-corrupt");
      mkdirSync(join(subject.dir, "executions"), { recursive: true });
      writeFileSync(
        join(subject.dir, "executions", "corrupt.json"),
        "{not json",
        "utf8"
      );
      const inspection = await boundaryFor(subject).inspect();
      assert.equal(inspection.kind, "unknown");
      if (inspection.kind === "unknown") {
        assert.equal(inspection.reason, "corrupt");
      }
      assert.equal(subject.observed.effectRuns, 0);
    });
  });

  it("reconcile() adopts the observed effect without a second submit", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "reconcile-effected");
      const provider = lossyProvider(subject);
      const query: ExecutionQuery = {
        async query() {
          return { state: "effected", externalRef: "txn-conformance" };
        },
      };
      const boundary = boundaryFor(subject, { provider, query });

      await assert.rejects(
        () => boundary.run(),
        (error: unknown) => error instanceof PrivacyOutcomeUnknownError
      );
      assert.equal(subject.observed.effectRuns, 1);

      const receipt = await boundary.reconcile();
      assert.equal(receipt.transaction, "txn-conformance");
      // Exactly one provider submit for the whole lifetime of the attempt.
      assert.equal(subject.observed.effectRuns, 1);
      const events = subject.events.listBySubject(CONFIG.dataPrincipalRef);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.state, "SUCCEEDED");
    });
  });

  it("reconcile() quarantines an unknown outcome instead of resubmitting", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "reconcile-unknown");
      const provider = lossyProvider(subject);
      const query: ExecutionQuery = {
        async query() {
          return { state: "unknown" };
        },
      };
      const boundary = boundaryFor(subject, { provider, query });

      await assert.rejects(
        () => boundary.run(),
        (error: unknown) => error instanceof PrivacyOutcomeUnknownError
      );

      await assert.rejects(
        () => boundary.reconcile(),
        (error: unknown) => error instanceof PrivacyOutcomeUnknownError
      );
      // The provider was never asked to submit again.
      assert.equal(subject.observed.effectRuns, 1);
      const events = subject.events.listBySubject(CONFIG.dataPrincipalRef);
      assert.equal(events[0]?.state, "OUTCOME_UNKNOWN");
    });
  });

  it("reconcile() refuses without a query and without a journal record", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "reconcile-refusals");
      const provider = lossyProvider(subject);

      // A live attempt: the effect crossed the submit boundary and the
      // response was lost.
      await assert.rejects(
        () => boundaryFor(subject, { provider }).run(),
        (error: unknown) => error instanceof PrivacyOutcomeUnknownError
      );

      // Without a provider outcome query the live attempt cannot be resolved.
      await assert.rejects(
        () => boundaryFor(subject, { provider }).reconcile(),
        (error: unknown) =>
          error instanceof Error && /outcome query/.test(error.message)
      );

      // Without a journal record there is nothing to reconcile.
      const fresh = scenario(root, "reconcile-no-record");
      await assert.rejects(
        () => boundaryFor(fresh).reconcile(),
        (error: unknown) =>
          error instanceof Error && /no journal record/.test(error.message)
      );
      assert.equal(subject.observed.effectRuns, 1);
    });
  });

  it("the callback path has no recovery seam and says so", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "callback-path", { callbackPath: true });
      const boundary = boundaryFor(subject, { callbackPath: true });
      const inspection = await boundary.inspect();
      assert.equal(inspection.kind, "unknown");
      if (inspection.kind === "unknown") {
        assert.equal(inspection.reason, "unsupported-path");
      }
      await assert.rejects(
        () => boundary.reconcile(),
        (error: unknown) =>
          error instanceof Error &&
          /requires a (provider|redemption)/.test(error.message)
      );
      assert.equal(subject.observed.effectRuns, 0);
    });
  });

  it("a fresh attempt still runs normally and a retry still conflicts", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "normal-run");
      const boundary = boundaryFor(subject);
      const receipt = await boundary.run();
      assert.equal(receipt.transaction, "txn-conformance");
      assert.equal(subject.observed.effectRuns, 1);

      // Callers that do not opt into recovery keep the old behaviour.
      await assert.rejects(
        () => boundary.run(),
        (error: unknown) => error instanceof PrivacyEventConflictError
      );
      assert.equal(subject.observed.effectRuns, 1);
    });
  });

  it("an unbound effect path is still refused before anything runs", async () => {
    await withScratch(async (root) => {
      const subject = scenario(root, "no-effect-path");
      assert.throws(
        () =>
          createEffectBoundary({
            dir: subject.dir,
            auth: subject.auth,
            ingress: subject.ingress,
            runtime: subject.runtime,
            gate: subject.gate,
            now: subject.now,
            authorizedContext: subject.authorizedContext,
          }),
        (error: unknown) =>
          error instanceof PrivacyPreEffectError || error instanceof Error
      );
      assert.equal(subject.observed.effectRuns, 0);
    });
  });
});
