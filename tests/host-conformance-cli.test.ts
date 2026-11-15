import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run } from "../src/cli.js";

/**
 * The `ptf host-conformance --boundary` seam.
 *
 * The conformance suite is only an adoption gate if it runs against the
 * ADOPTER's composition. Without `--boundary` the command always exercises
 * the kit's own reference boundary, so a green run says nothing about the
 * host's code. These tests drive the operator command with a real module on
 * disk and assert that the host's boundary is the one under test.
 */

const DIST_HOSTKIT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "hostkit",
  "index.js"
);

const CONFIG = {
  dataPrincipalRef: "subject:opaque-cli-conformance",
  controllerId: "example-india",
  recipientRoles: { "approved-merchant": "third-party" },
  actionCategories: { "/pay": ["payment"] },
};

/**
 * A boundary that follows the ordering but omits the fence: the effect
 * boundary never re-reads the privacy state, so a late withdrawal does not
 * stop the attempt. Every other property holds.
 */
const BOUNDARY_WITHOUT_FENCE = `
import {
  PrivacyOutcomeUnknownError,
  PrivacyPreEffectError,
} from ${JSON.stringify(pathToFileURL(DIST_HOSTKIT).href)};

function sameTerms(a, b) {
  const render = (v) => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(render).join(",") + "]";
    const rec = Object.fromEntries(
      Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    );
    return "{" + Object.entries(rec).map(([k, val]) => JSON.stringify(k) + ":" + render(val)).join(",") + "}";
  };
  return render(a) === render(b);
}

export function boundary(subject) {
  const termsMatch = () => sameTerms(subject.operation.context, subject.authorizedContext);
  return {
    async check() {
      if (!termsMatch()) return { allow: false, reason: "terms-mismatch" };
      const first = subject.runtime.preflight(subject.gate);
      if (!first.allow) return { allow: false, reason: first.publicReason };
      return { allow: true, termsDigest: first.termsDigest };
    },
    async run() {
      if (!termsMatch()) throw new PrivacyPreEffectError("the effect context differs");
      const first = subject.runtime.preflight(subject.gate);
      if (!first.allow) {
        throw new PrivacyPreEffectError(
          first.publicReason === "authority-denied" ? "authority denied" : "privacy denied"
        );
      }
      const live = subject.runtime.recheck(first, subject.gate);
      const event = subject.runtime.prepareEvent(live, subject.gate);
      const consumed = subject.auth.evaluate(subject.operation, subject.ingress, {
        consume: true,
        nowSec: subject.now(),
      });
      if (!consumed.allow) {
        subject.runtime.finalizeEvent(event.eventId, "FAILED_FINAL", { finalizedAt: subject.now() });
        throw new PrivacyPreEffectError("authority denied at redeem time: " + consumed.reason);
      }
      subject.persistAuthority(subject.auth);
      // The defect under test: no fence.
      let started = false;
      let raw;
      try {
        raw = await subject.effect({
          operation: subject.operation,
          termsDigest: live.termsDigest,
          attemptRef: event.attemptRef ?? "attempt",
          markEffectStarted: () => { started = true; },
        });
      } catch (error) {
        subject.runtime.finalizeEvent(event.eventId, started ? "OUTCOME_UNKNOWN" : "FAILED_FINAL", {
          finalizedAt: subject.now(),
        });
        if (started) throw new PrivacyOutcomeUnknownError(error);
        throw new PrivacyPreEffectError("the effect failed before the effect");
      }
      const at = subject.now();
      subject.runtime.finalizeEvent(event.eventId, "SUCCEEDED", { finalizedAt: at });
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
}
`;

/** A boundary that is the kit's own composition: it passes every check. */
const BOUNDARY_REFERENCE = `
import { createEffectBoundary } from ${JSON.stringify(pathToFileURL(DIST_HOSTKIT).href)};
export function boundary(scenario) {
  return createEffectBoundary({
    dir: scenario.dir,
    auth: scenario.auth,
    ingress: scenario.ingress,
    runtime: scenario.runtime,
    gate: scenario.gate,
    now: scenario.now,
    authorizedContext: scenario.authorizedContext,
    execute: scenario.effect,
    persistAuthority: scenario.persistAuthority,
  });
}
`;

interface Harness {
  readonly dir: string;
  readonly out: string[];
  readonly io: {
    print: (line: string) => void;
    readLine: () => string;
    now: () => number;
  };
  readonly env: Record<string, string>;
}

function harness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), "ptf-host-conf-cli-"));
  const out: string[] = [];
  return {
    dir,
    out,
    io: {
      print: (line: string) => out.push(line),
      readLine: () => "yes",
      now: () => 1_700_000_000,
    },
    env: { PTF_PASSPHRASE: "conformance-pass" },
  };
}

/**
 * Fresh store plus initialized privacy state, for every conformance run.
 * The operator's store is read, never written; the suite keeps its own.
 */
async function initScratch(h: Harness): Promise<string> {
  assert.equal(await run(["--dir", h.dir, "init"], h.io, h.env), 0);
  assert.equal(await run(["--dir", h.dir, "privacy", "init"], h.io, h.env), 0);
  return h.dir;
}

function configFile(dir: string): string {
  const path = join(dir, "privacy-config.json");
  writeFileSync(path, JSON.stringify(CONFIG));
  return path;
}

function moduleFile(dir: string, name: string, source: string): string {
  const path = join(dir, name);
  writeFileSync(path, source);
  return path;
}

describe("host-conformance --boundary (the adopter is the thing under test)", () => {
  it("runs the host's own boundary and fails on the defect it names", async () => {
    const h = harness();
    try {
      const dir = await initScratch(h);
      const cfg = configFile(dir);
      const mod = moduleFile(dir, "host-boundary.mjs", BOUNDARY_WITHOUT_FENCE);

      const code = await run(
        [
          "--dir",
          dir,
          "host-conformance",
          "--privacy-config",
          cfg,
          "--boundary",
          mod,
        ],
        h.io,
        h.env
      );
      const text = h.out.join("\n");
      assert.equal(code, 1, `expected a failing run; output was:\n${text}`);
      // Exactly the fence check names the defect: FAIL line, and one failure.
      assert.match(text, /^fence-stops-late-withdrawal  FAIL/m);
      assert.match(text, /8\/9 checks passed/);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });

  it("passes when the host's own boundary is correct", async () => {
    const h = harness();
    try {
      const dir = await initScratch(h);
      const cfg = configFile(dir);
      const mod = moduleFile(dir, "host-boundary.mjs", BOUNDARY_REFERENCE);

      const code = await run(
        [
          "--dir",
          dir,
          "host-conformance",
          "--privacy-config",
          cfg,
          "--boundary",
          mod,
        ],
        h.io,
        h.env
      );
      const text = h.out.join("\n");
      assert.equal(code, 0, `expected a passing run; output was:\n${text}`);
      assert.match(text, /9\/9 checks passed/);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });

  it("names the boundary under test so a green run is attributable", async () => {
    const h = harness();
    try {
      const dir = await initScratch(h);
      const cfg = configFile(dir);
      const mod = moduleFile(dir, "host-boundary.mjs", BOUNDARY_REFERENCE);

      await run(
        [
          "--dir",
          dir,
          "host-conformance",
          "--privacy-config",
          cfg,
          "--boundary",
          mod,
        ],
        h.io,
        h.env
      );
      const text = h.out.join("\n");
      assert.match(text, /boundary: host-supplied/);
      assert.match(text, /host-boundary\.mjs/);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });

  it("refuses a module that exports no boundary", async () => {
    const h = harness();
    try {
      const dir = await initScratch(h);
      const cfg = configFile(dir);
      const mod = moduleFile(
        dir,
        "host-boundary.mjs",
        "export const notABoundary = 1;\n"
      );

      await assert.rejects(
        () =>
          run(
            [
              "--dir",
              dir,
              "host-conformance",
              "--privacy-config",
              cfg,
              "--boundary",
              mod,
            ],
            h.io,
            h.env
          ),
        /exports no boundary factory/
      );
      // A refused module never reaches the suite: no check is reported.
      assert.equal(h.out.join("\n").includes("checks passed"), false);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });

  it("resolves a bare specifier from the working directory, not from PTF", async () => {
    // The host's module owns the dependency: a bare specifier must resolve
    // against the operator's project, so the module's own imports of PTF
    // resolve from the host's side too.
    const h = harness();
    const originalCwd = process.cwd();
    try {
      const dir = await initScratch(h);
      const cfg = configFile(dir);

      const pkgDir = join(dir, "node_modules", "my-host-kit");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "my-host-kit",
          version: "1.0.0",
          type: "module",
          exports: { ".": "./index.mjs" },
        })
      );
      writeFileSync(join(pkgDir, "index.mjs"), BOUNDARY_REFERENCE);

      process.chdir(dir);
      const code = await run(
        [
          "--dir",
          dir,
          "host-conformance",
          "--privacy-config",
          cfg,
          "--boundary",
          "my-host-kit",
        ],
        h.io,
        h.env
      );
      const text = h.out.join("\n");
      assert.equal(code, 0, `expected a passing run; output was:\n${text}`);
      assert.match(text, /boundary: host-supplied \(my-host-kit\)/);
    } finally {
      process.chdir(originalCwd);
      rmSync(h.dir, { recursive: true, force: true });
    }
  });

  it("defaults to the kit's own reference boundary when no flag is given", async () => {
    // The reference default is itself part of the contract: without the flag
    // the operator gets the kit's composition, and the output must say so.
    const h = harness();
    try {
      const dir = await initScratch(h);
      const cfg = configFile(dir);

      const code = await run(
        ["--dir", dir, "host-conformance", "--privacy-config", cfg],
        h.io,
        h.env
      );
      const text = h.out.join("\n");
      assert.equal(code, 0, `expected a passing run; output was:\n${text}`);
      assert.match(text, /boundary: reference \(the kit's own composition\)/);
      assert.match(text, /9\/9 checks passed/);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });
});
