import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression gate for the DPDP consent-gateway vertical.
 *
 * The example is the artefact under test: it must run end to end with no
 * credentials and no network, exit 0, disclose only the minimised claim set,
 * stop the attempt that follows a consent withdrawal, erase the subject's
 * records, and print no personal value, no direct identifier and no internal
 * deny reason.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXAMPLE = join(ROOT, "examples", "dpdp-consent-gateway.mjs");

/** Synthetic sentinels: the values the example stores in the encrypted vault. */
const SECRETS = [
  "SENTINEL-HBA1C-9.1-DO-NOT-PRINT",
  "SENTINEL-ORDER-4417-DO-NOT-PRINT",
  "SENTINEL-PATIENT-NAME-DO-NOT-PRINT",
];

/** Internal privacy deny reasons. They belong on the operator surface only. */
const INTERNAL_REASONS = [
  "basis-inactive",
  "basis-invalid",
  "no-processing-activity",
  "activity-inactive",
  "recipient-forbidden",
  "data-category-forbidden",
  "purpose-mismatch",
  "consent-withdrawn",
];

interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

let cached: Run | undefined;

function runExample(): Run {
  if (cached !== undefined) return cached;
  try {
    const stdout = execFileSync(process.execPath, [EXAMPLE], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    cached = { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
    };
    cached = {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
  return cached;
}

describe("DPDP consent-gateway vertical", () => {
  it("runs end to end and exits 0", () => {
    const run = runExample();
    assert.equal(
      run.status,
      0,
      `the vertical must exit 0, stderr:\n${run.stderr}`
    );
    assert.ok(run.stdout.length > 0, "the vertical must print a transcript");
  });

  it("discloses the minimised claim set and records the evidence", () => {
    const { stdout } = runExample();
    assert.match(stdout, /disclosed: diagnostic-summary, lab-order-id/);
    assert.match(stdout, /withheld: patient-name/);
    assert.match(stdout, /evidence id: pev-[0-9a-f]{32}/);
    assert.match(stdout, /state: SUCCEEDED/);
    assert.match(stdout, /authority citations: g-disclose-lab/);
  });

  it("stops the attempt that follows the consent withdrawal", () => {
    const { stdout } = runExample();
    assert.match(stdout, /consent c-1: withdrawn/);
    assert.match(stdout, /FAILED_FINAL - a provable pre-effect failure/);
    assert.match(
      stdout,
      /the first disclosure stands; attempts 2 and 3 never reached the lab/
    );
  });

  it("erases the subject's records and reports the receipt", () => {
    const { stdout } = runExample();
    assert.match(stdout, /erasure: computed - 3 eligible, 0 held, 0 unscoped/);
    assert.match(
      stdout,
      /erased r-summary \(diagnostic-summary\) - receipt: id=r-summary type=diagnostic-summary version=1/
    );
    assert.match(stdout, /erased r-order \(lab-order-id\)/);
    assert.match(stdout, /erased r-name \(patient-name\)/);
  });

  it("prints no personal value, no direct identifier and no internal reason", () => {
    const { stdout } = runExample();
    for (const secret of SECRETS) {
      assert.ok(
        !stdout.includes(secret),
        `the transcript leaked a stored value: ${secret}`
      );
    }
    for (const reason of INTERNAL_REASONS) {
      assert.ok(
        !stdout.includes(reason),
        `the transcript leaked an internal deny reason: ${reason}`
      );
    }
    // The subject is identified only by the host's opaque reference.
    assert.match(stdout, /subject:opq-4a32c9/);
  });

  it("maps the steps to the DPDP obligations, and claims no record duty", () => {
    const { stdout } = runExample();
    assert.match(stdout, /Act s\.5 \(notice\); Act s\.6\(1\) \(consent\)/);
    assert.match(stdout, /Act s\.6\(4\)-s\.6\(6\) \(withdrawal\)/);
    assert.match(stdout, /Act s\.6\(10\) \(burden of proof\)/);
    assert.match(stdout, /Act s\.11 \(access summary\)/);
    assert.match(stdout, /Act s\.12 \(erasure\)/);
    assert.match(stdout, /Rules 4 \+ First Schedule Part B/);
    // Neither the Act nor the Rules impose a general record-of-processing-
    // activities duty; the transcript must not claim one.
    assert.ok(
      !stdout.includes("record of processing activities"),
      "the transcript must not claim a record-of-processing-activities duty"
    );
    // And it must never claim a legal determination.
    assert.ok(
      !/\bcompliant\b/i.test(stdout),
      "the transcript must not claim that anything is compliant"
    );
  });
});
