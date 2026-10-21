import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runHostConformance,
  PrivacyOutcomeUnknownError,
  PrivacyPreEffectError,
  type HostConformanceBoundaryFactory,
  type HostConformanceScenario,
  type HostEffectBoundary,
  type HostEffectReceipt,
  type HostPrivacyConfig,
} from "../src/hostkit/index.js";

/**
 * The kit's own conformance suite.
 *
 * Two properties matter: the suite passes against a correctly composed
 * boundary, and a deliberately broken boundary fails the check that names
 * its defect - not every check.
 */

const CONFIG: HostPrivacyConfig = {
  dataPrincipalRef: "subject:opaque-conformance",
  controllerId: "example-india",
  recipientRoles: { "approved-merchant": "third-party" },
  actionCategories: { "/pay": ["payment"] },
};

async function withScratch<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "ptf-host-conformance-"));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Deep equality over the flat term bags the boundary compares. */
function sameTerms(a: unknown, b: unknown): boolean {
  const render = (value: unknown): string => {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(render).join(",")}]`;
    }
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${render(rec[key])}`)
      .join(",")}}`;
  };
  return render(a) === render(b);
}

/**
 * A boundary that follows the ordering but omits the fence: the effect
 * boundary never re-reads the privacy state. Every other property holds.
 */
const boundaryWithoutFence: HostConformanceBoundaryFactory = (
  subject: HostConformanceScenario
): HostEffectBoundary => {
  const termsMatch = (): boolean =>
    sameTerms(subject.operation.context, subject.authorizedContext);
  return {
    async check() {
      if (!termsMatch()) return { allow: false, reason: "terms-mismatch" };
      const first = subject.runtime.preflight(subject.gate);
      if (!first.allow) {
        return { allow: false, reason: first.publicReason };
      }
      return { allow: true, termsDigest: first.termsDigest };
    },
    async run(): Promise<HostEffectReceipt> {
      if (!termsMatch()) {
        throw new PrivacyPreEffectError("the effect context differs");
      }
      const first = subject.runtime.preflight(subject.gate);
      if (!first.allow) {
        throw new PrivacyPreEffectError(
          first.publicReason === "authority-denied"
            ? "authority denied"
            : "privacy denied"
        );
      }
      const live = subject.runtime.recheck(first, subject.gate);
      const event = subject.runtime.prepareEvent(live, subject.gate);
      const consumed = subject.auth.evaluate(
        subject.operation,
        subject.ingress,
        { consume: true, nowSec: subject.now() }
      );
      if (!consumed.allow) {
        subject.runtime.finalizeEvent(event.eventId, "FAILED_FINAL", {
          finalizedAt: subject.now(),
        });
        throw new PrivacyPreEffectError(
          `authority denied at redeem time: ${consumed.reason}`
        );
      }
      subject.persistAuthority(subject.auth);
      // The defect: no fence. A late withdrawal does not stop the attempt.
      let started = false;
      let raw;
      try {
        raw = await subject.effect({
          operation: subject.operation,
          termsDigest: live.termsDigest,
          attemptRef: event.attemptRef ?? "attempt",
          markEffectStarted: () => {
            started = true;
          },
        });
      } catch (error) {
        subject.runtime.finalizeEvent(
          event.eventId,
          started ? "OUTCOME_UNKNOWN" : "FAILED_FINAL",
          { finalizedAt: subject.now() }
        );
        if (started) throw new PrivacyOutcomeUnknownError(error);
        throw new PrivacyPreEffectError("the effect failed before the effect");
      }
      const at = subject.now();
      subject.runtime.finalizeEvent(event.eventId, "SUCCEEDED", {
        finalizedAt: at,
      });
      return {
        receiptId: "rcpt-broken",
        action: subject.operation.action.name,
        resource: subject.operation.resource.id,
        purpose: subject.operation.purpose ?? "",
        termsDigest: live.termsDigest,
        at,
        eventId: event.eventId,
      };
    },
  };
};

describe("host kit conformance suite", () => {
  it("passes every check against the reference composition", async () => {
    await withScratch(async (root) => {
      const results = await runHostConformance({
        config: CONFIG,
        tmpDir: root,
      });
      assert.equal(results.length, 9);
      for (const result of results) {
        assert.ok(
          result.ok,
          `${result.id} failed: ${result.detail ?? "no detail"}`
        );
        assert.ok(result.requirement.length > 0, `${result.id} cites no rule`);
      }
    });
  });

  it("fails the fence check - and only that check - without the fence", async () => {
    await withScratch(async (root) => {
      const results = await runHostConformance({
        config: CONFIG,
        tmpDir: root,
        boundary: boundaryWithoutFence,
      });
      const failed = results.filter((result) => !result.ok);
      assert.deepEqual(
        failed.map((result) => result.id),
        ["fence-stops-late-withdrawal"],
        `unexpected failures: ${failed
          .map((r) => `${r.id}: ${r.detail ?? ""}`)
          .join("; ")}`
      );
    });
  });
});
