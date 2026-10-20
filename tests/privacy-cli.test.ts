import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createExecution,
  openKeystore,
  transitionExecution,
} from "../src/index.js";
import { PRIVACY_DEK_ALIAS, loadPrivacyStore } from "../src/store/privacy.js";
import { FilePrivacyEventRepository } from "../src/store/privacy-events.js";
import { parseArgs, run } from "../src/cli.js";

const NOW = 1_700_000_000;
const PASS = "privacy-cli-test-pass";

function io() {
  const out: string[] = [];
  return {
    out,
    value: {
      print: (line: string) => out.push(line),
      readLine: () => "yes",
      now: () => NOW,
    },
  };
}

function jsonFile(dir: string, name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}

function keys(dir: string) {
  return openKeystore(
    JSON.parse(readFileSync(join(dir, "keystore.json"), "utf8")) as Parameters<
      typeof openKeystore
    >[0],
    PASS
  );
}

describe("privacy operator CLI", () => {
  it("parses nested privacy subcommands without allowing arbitrary positionals", () => {
    const parsed = parseArgs([
      "--dir",
      "/tmp/x",
      "privacy",
      "notice",
      "add",
      "--file",
      "/tmp/n.json",
    ]);
    assert.equal(parsed.command, "privacy");
    assert.equal(parsed.flags["path"], "notice/add");
    assert.equal(parsed.flags["file"], "/tmp/n.json");
    assert.throws(
      () => parseArgs(["privacy", "nonsense", "extra", "garbage"]),
      /unknown privacy subcommand|usage/
    );
  });

  it("never lets a --path flag re-target the privacy subcommand", () => {
    // The subcommand is positional and validated up front; a flag must not
    // be able to re-dispatch a different operator action.
    assert.throws(
      () => parseArgs(["privacy", "init", "--path", "erase/apply"]),
      /unknown flag --path/
    );
    const parsed = parseArgs(["privacy", "erase", "plan", "--owner", "p"]);
    assert.equal(parsed.flags["path"], "erase/plan");
  });

  it("initializes encrypted privacy state and records evidence without printing evidence bodies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-cli-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    assert.equal(await run(["--dir", dir, "privacy", "init"], t.value, env), 0);

    const notice = {
      id: "notice-1",
      controllerId: "acme",
      dataPrincipalRef: "subject:opaque-1",
      purpose: "support",
      dataCategories: ["email"],
      noticeRef: "SENSITIVE-NOTICE-REF",
      noticeHash: "a".repeat(64),
      presentedAt: NOW - 10,
      assertedBy: "privacy-office",
    };
    const consent = {
      id: "consent-1",
      noticeId: "notice-1",
      controllerId: "acme",
      dataPrincipalRef: "subject:opaque-1",
      purpose: "support",
      dataCategories: ["email"],
      givenAt: NOW - 5,
      method: "web",
      proofRef: "SENSITIVE-CONSENT-PROOF",
      assertedBy: "privacy-office",
    };
    const basis = {
      kind: "consent",
      id: "basis-1",
      controllerId: "acme",
      dataPrincipalRef: "subject:opaque-1",
      purpose: "support",
      dataCategories: ["email"],
      consentId: "consent-1",
      assertedBy: "privacy-office",
      active: true,
    };
    const activity = {
      id: "activity-1",
      profileId: "IN-DPDP-2025",
      authorityPrincipal: "did:test:owner",
      controllerId: "acme",
      subjects: { kind: "exact", ref: "subject:opaque-1" },
      action: "/disclose",
      resourceType: "vault",
      purpose: "support",
      dataCategories: ["email"],
      recipients: [{ id: "verifier", role: "third-party" }],
      basisId: "basis-1",
      active: true,
    };

    for (const [path, file] of [
      ["notice/add", jsonFile(dir, "notice.json", notice)],
      ["consent/add", jsonFile(dir, "consent.json", consent)],
      ["basis/add", jsonFile(dir, "basis.json", basis)],
      ["activity/add", jsonFile(dir, "activity.json", activity)],
    ] as const) {
      const [a, b] = path.split("/");
      assert.equal(
        await run(
          ["--dir", dir, "privacy", a!, b!, "--file", file],
          t.value,
          env
        ),
        0
      );
    }

    const encrypted = readFileSync(join(dir, "privacy-state.json"), "utf8");
    assert.ok(!encrypted.includes("SENSITIVE-NOTICE-REF"));
    assert.ok(!encrypted.includes("SENSITIVE-CONSENT-PROOF"));

    t.out.length = 0;
    assert.equal(
      await run(["--dir", dir, "privacy", "notice", "list"], t.value, env),
      0
    );
    assert.ok(t.out.some((line) => line.includes("notice-1")));
    assert.ok(!t.out.join("\n").includes("SENSITIVE-NOTICE-REF"));

    assert.equal(
      await run(
        [
          "--dir",
          dir,
          "privacy",
          "consent",
          "withdraw",
          "--id",
          "consent-1",
          "--proof-ref",
          "withdraw:1",
          "--asserted-by",
          "subject",
        ],
        t.value,
        env
      ),
      0
    );
    const ks = keys(dir);
    const store = loadPrivacyStore(dir, { keys: ks });
    assert.equal(store.snapshot().consents[0]?.withdrawnAt, NOW);
    assert.ok(ks[PRIVACY_DEK_ALIAS] instanceof Uint8Array);
  });

  it("records a correction event without reading or printing the corrected value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-correction-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    await run(["--dir", dir, "privacy", "init"], t.value, env);
    const basis = {
      kind: "certain-legitimate-use",
      id: "basis-1",
      controllerId: "acme",
      purpose: "support",
      dataCategories: ["email"],
      provisionRef: "consent-rule:1",
      evidenceRef: "privacy-office:1",
      assertedBy: "privacy-office",
      active: true,
    };
    const activity = {
      id: "activity-1",
      profileId: "IN-DPDP-2025",
      authorityPrincipal: "did:test:owner",
      controllerId: "acme",
      subjects: { kind: "exact", ref: "subject:opaque-1" },
      action: "/correct",
      resourceType: "vault",
      purpose: "support",
      dataCategories: ["email"],
      recipients: [],
      basisId: "basis-1",
      active: true,
    };
    for (const [path, value] of [
      ["basis/add", basis],
      ["activity/add", activity],
    ] as const) {
      const [a, b] = path.split("/");
      assert.equal(
        await run(
          [
            "--dir",
            dir,
            "privacy",
            a!,
            b!,
            "--file",
            jsonFile(dir, `${a}.json`, value),
          ],
          t.value,
          env
        ),
        0
      );
    }
    const valueFile = join(dir, "record-value.txt");
    writeFileSync(valueFile, "SENSITIVE-CORRECTED-VALUE\n", { mode: 0o600 });
    assert.equal(
      await run(
        [
          "--dir",
          dir,
          "vault-put",
          "--id",
          "rec-1",
          "--owner",
          "did:test:owner",
          "--type",
          "email",
          "--sensitivity",
          "general",
          "--source",
          "user",
          "--subject-ref",
          "subject:opaque-1",
          "--purposes",
          "support",
          "--agents",
          "agent-1",
          "--value-file",
          valueFile,
        ],
        t.value,
        env
      ),
      0
    );
    t.out.length = 0;
    assert.equal(
      await run(
        [
          "--dir",
          dir,
          "privacy",
          "correction",
          "--id",
          "rec-1",
          "--owner",
          "did:test:owner",
          "--subject-ref",
          "subject:opaque-1",
          "--activity-id",
          "activity-1",
          "--basis-id",
          "basis-1",
          "--request-ref",
          "dsar-1",
          "--previous-version",
          "0",
        ],
        t.value,
        env
      ),
      0
    );
    assert.ok(!t.out.join("\n").includes("SENSITIVE-CORRECTED-VALUE"));
    const events = new FilePrivacyEventRepository({
      dir,
      dek: keys(dir)[PRIVACY_DEK_ALIAS] as Uint8Array,
      nowSec: () => NOW,
    });
    const correction = events.listBySubject("subject:opaque-1")[0];
    assert.equal(correction?.action, "/correct");
    assert.equal(correction?.state, "SUCCEEDED");
    assert.equal(
      correction?.evidenceRef,
      "correction:dsar-1:vault-record:rec-1:v0-v1"
    );
    await assert.rejects(
      () =>
        run(
          [
            "--dir",
            dir,
            "privacy",
            "correction",
            "--id",
            "rec-1",
            "--owner",
            "did:test:owner",
            "--subject-ref",
            "subject:opaque-1",
            "--activity-id",
            "activity-1",
            "--basis-id",
            "basis-1",
            "--request-ref",
            "dsar-1",
            "--previous-version",
            "1",
          ],
          t.value,
          env
        ),
      /does not prove the correction write/
    );
    await assert.rejects(
      () =>
        run(
          [
            "--dir",
            dir,
            "privacy",
            "correction",
            "--id",
            "rec-1",
            "--owner",
            "did:test:owner",
            "--subject-ref",
            "subject:opaque-1",
            "--activity-id",
            "missing",
            "--basis-id",
            "basis-1",
            "--request-ref",
            "dsar-1",
            "--previous-version",
            "0",
          ],
          t.value,
          env
        ),
      /unknown activity or basis/
    );
  });

  it("erases only records bound to the requested subject", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-erase-subject-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    await run(["--dir", dir, "privacy", "init"], t.value, env);
    for (const [id, subject] of [
      ["rec-a", "subject:opaque-1"],
      ["rec-b", "subject:opaque-2"],
    ] as const) {
      const valueFile = join(dir, `${id}.txt`);
      writeFileSync(valueFile, `value-${id}\n`, { mode: 0o600 });
      assert.equal(
        await run(
          [
            "--dir",
            dir,
            "vault-put",
            "--id",
            id,
            "--owner",
            "did:test:owner",
            "--type",
            "email",
            "--sensitivity",
            "general",
            "--source",
            "user",
            "--subject-ref",
            subject,
            "--purposes",
            "support",
            "--agents",
            "agent-1",
            "--value-file",
            valueFile,
          ],
          t.value,
          env
        ),
        0
      );
    }
    t.out.length = 0;
    await run(
      [
        "--dir",
        dir,
        "privacy",
        "erase",
        "plan",
        "--owner",
        "did:test:owner",
        "--subject-ref",
        "subject:opaque-1",
      ],
      t.value,
      env
    );
    const plan = JSON.parse(t.out.at(-1) as string) as Array<{
      id: string;
      status: string;
    }>;
    assert.deepEqual(
      plan.map((item) => [item.id, item.status]),
      [["rec-a", "eligible"]]
    );
    await assert.rejects(
      () =>
        run(
          [
            "--dir",
            dir,
            "privacy",
            "erase",
            "apply",
            "--owner",
            "did:test:owner",
            "--subject-ref",
            "subject:opaque-1",
            "--ids",
            "rec-b",
            "--yes",
          ],
          t.value,
          env
        ),
      /unknown record/
    );
    assert.equal(
      await run(
        [
          "--dir",
          dir,
          "privacy",
          "erase",
          "apply",
          "--owner",
          "did:test:owner",
          "--subject-ref",
          "subject:opaque-1",
          "--ids",
          "rec-a",
          "--yes",
        ],
        t.value,
        env
      ),
      0
    );
    t.out.length = 0;
    await run(
      [
        "--dir",
        dir,
        "privacy",
        "erase",
        "plan",
        "--owner",
        "did:test:owner",
        "--subject-ref",
        "subject:opaque-2",
      ],
      t.value,
      env
    );
    const remaining = JSON.parse(t.out.at(-1) as string) as Array<{
      id: string;
      status: string;
    }>;
    assert.deepEqual(
      remaining.map((item) => [item.id, item.status]),
      [["rec-b", "eligible"]]
    );
  });

  it("blocks erasure while a retention hold covers the record, and allows it after release", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-erase-hold-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    await run(["--dir", dir, "privacy", "init"], t.value, env);
    const valueFile = join(dir, "held.txt");
    writeFileSync(valueFile, "value-held\n", { mode: 0o600 });
    await run(
      [
        "--dir",
        dir,
        "vault-put",
        "--id",
        "rec-held",
        "--owner",
        "did:test:owner",
        "--type",
        "email",
        "--sensitivity",
        "general",
        "--source",
        "user",
        "--subject-ref",
        "subject:opaque-1",
        "--purposes",
        "support",
        "--agents",
        "agent-1",
        "--value-file",
        valueFile,
      ],
      t.value,
      env
    );
    const holdFile = join(dir, "hold.json");
    writeFileSync(
      holdFile,
      JSON.stringify({
        id: "hold-1",
        dataPrincipalRef: "subject:opaque-1",
        recordIds: ["rec-held"],
        dataCategories: [],
        reasonRef: "litigation-hold:1",
        assertedBy: "operator",
        effectiveAt: NOW - 10,
        retainUntil: null,
      })
    );
    assert.equal(
      await run(
        ["--dir", dir, "privacy", "hold", "add", "--file", holdFile],
        t.value,
        env
      ),
      0
    );
    // The hold wins: the plan reports the record as held, and the apply
    // path refuses it even with --yes.
    t.out.length = 0;
    await run(
      [
        "--dir",
        dir,
        "privacy",
        "erase",
        "plan",
        "--owner",
        "did:test:owner",
        "--subject-ref",
        "subject:opaque-1",
      ],
      t.value,
      env
    );
    const plan = JSON.parse(t.out.at(-1) as string) as Array<{
      id: string;
      status: string;
      holdIds: string[];
    }>;
    assert.deepEqual(
      plan.map((item) => [item.id, item.status]),
      [["rec-held", "held"]]
    );
    await assert.rejects(
      () =>
        run(
          [
            "--dir",
            dir,
            "privacy",
            "erase",
            "apply",
            "--owner",
            "did:test:owner",
            "--subject-ref",
            "subject:opaque-1",
            "--ids",
            "rec-held",
            "--yes",
          ],
          t.value,
          env
        ),
      /is held/
    );
    // Release the hold, then the same erase succeeds.
    assert.equal(
      await run(
        [
          "--dir",
          dir,
          "privacy",
          "hold",
          "release",
          "--id",
          "hold-1",
          "--asserted-by",
          "operator",
        ],
        t.value,
        env
      ),
      0
    );
    assert.equal(
      await run(
        [
          "--dir",
          dir,
          "privacy",
          "erase",
          "apply",
          "--owner",
          "did:test:owner",
          "--subject-ref",
          "subject:opaque-1",
          "--ids",
          "rec-held",
          "--yes",
        ],
        t.value,
        env
      ),
      0
    );
  });

  it("requires explicit offline operator recovery and evidence-bound reconciliation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-reconcile-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    await run(["--dir", dir, "privacy", "init"], t.value, env);
    const eventRepo = new FilePrivacyEventRepository({
      dir,
      dek: keys(dir)[PRIVACY_DEK_ALIAS] as Uint8Array,
      nowSec: () => NOW,
    });
    const pending = eventRepo.prepare({
      profileId: "IN-DPDP-2025",
      profileRevision: "2025-r1",
      dataPrincipalRef: "subject:opaque-1",
      authorityPrincipal: "owner",
      actor: "agent",
      controllerId: "acme",
      activityId: "act",
      basisId: "basis",
      purpose: "support",
      action: "/disclose",
      resource: { type: "vault", id: "personal-state" },
      dataCategories: ["email"],
      recipients: [{ id: "verifier", role: "third-party" }],
      termsDigest: "ab".repeat(32),
      authorityCitationIds: ["g1"],
      preparedAt: NOW,
    });
    await assert.rejects(
      () => run(["--dir", dir, "privacy", "events", "reconcile"], t.value, env),
      /--yes/
    );
    assert.equal(eventRepo.load(pending.eventId)?.state, "PREPARED");
    assert.equal(
      await run(
        ["--dir", dir, "privacy", "events", "reconcile", "--yes"],
        t.value,
        env
      ),
      0
    );
    assert.equal(eventRepo.load(pending.eventId)?.state, "OUTCOME_UNKNOWN");
    await assert.rejects(
      () =>
        run(
          [
            "--dir",
            dir,
            "privacy",
            "events",
            "resolve",
            "--id",
            pending.eventId,
            "--state",
            "SUCCEEDED",
            "--yes",
          ],
          t.value,
          env
        ),
      /evidence-ref/
    );
    assert.equal(
      await run(
        [
          "--dir",
          dir,
          "privacy",
          "events",
          "resolve",
          "--id",
          pending.eventId,
          "--state",
          "SUCCEEDED",
          "--evidence-ref",
          "external-journal:confirmed-1",
          "--yes",
        ],
        t.value,
        env
      ),
      0
    );
    assert.equal(eventRepo.load(pending.eventId)?.state, "SUCCEEDED");
    await assert.rejects(
      () =>
        run(
          [
            "--dir",
            dir,
            "privacy",
            "events",
            "resolve",
            "--id",
            pending.eventId,
            "--state",
            "FAILED_FINAL",
            "--evidence-ref",
            "external-journal:contrary",
            "--yes",
          ],
          t.value,
          env
        ),
      /only OUTCOME_UNKNOWN/
    );
  });

  it("uses the execution journal as a proven reconcile oracle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-journal-reconcile-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    await run(["--dir", dir, "privacy", "init"], t.value, env);
    const dek = keys(dir)[PRIVACY_DEK_ALIAS] as Uint8Array;
    const terms = "cd".repeat(32);
    const events = new FilePrivacyEventRepository({
      dir,
      dek,
      nowSec: () => NOW,
    });
    const pending = events.prepare({
      profileId: "IN-DPDP-2025",
      profileRevision: "2025-r1",
      dataPrincipalRef: "subject:opaque-1",
      authorityPrincipal: "owner",
      actor: "agent",
      controllerId: "acme",
      activityId: "act",
      basisId: "basis",
      purpose: "support",
      action: "/disclose",
      resource: { type: "vault", id: "personal-state" },
      dataCategories: ["email"],
      recipients: [{ id: "verifier", role: "third-party" }],
      termsDigest: terms,
      authorityCitationIds: ["g1"],
      preparedAt: NOW,
      attemptRef: terms,
    });
    const execution = createExecution(
      dir,
      {
        executionId: "a".repeat(32),
        idempotencyKey: `ptf-${terms}-test`,
        capabilityId: "cap-1",
        termsDigest: terms,
        action: "/disclose",
        recipient: "verifier",
        resource: "vault:personal-state",
        purpose: "support",
        context: {},
      },
      NOW
    );
    transitionExecution(dir, execution.executionId, "AUTHORIZED", {}, NOW);
    transitionExecution(dir, execution.executionId, "SUBMITTING", {}, NOW);
    transitionExecution(
      dir,
      execution.executionId,
      "SUCCEEDED",
      {
        receiptId: "receipt-1",
        receiptAt: NOW,
      },
      NOW
    );

    assert.equal(
      await run(
        ["--dir", dir, "privacy", "events", "reconcile", "--yes"],
        t.value,
        env
      ),
      0
    );
    const reconciled = events.load(pending.eventId);
    assert.equal(reconciled?.state, "SUCCEEDED");
    assert.equal(reconciled?.finalizedAt, NOW);
    assert.equal(reconciled?.evidenceRef, "execution-receipt:receipt-1");

    // Same terms, different action: a /pay journal row must never prove a
    // /use event.
    const mismatch = events.prepare({
      profileId: "IN-DPDP-2025",
      profileRevision: "2025-r1",
      dataPrincipalRef: "subject:opaque-1",
      authorityPrincipal: "owner",
      actor: "agent",
      controllerId: "acme",
      activityId: "act",
      basisId: "basis",
      purpose: "support",
      action: "/use",
      resource: { type: "vault-record", id: "r-pan" },
      dataCategories: ["pan"],
      recipients: [],
      termsDigest: terms,
      authorityCitationIds: ["g1"],
      attemptRef: "mismatch-action",
      preparedAt: NOW,
    });
    const pay = createExecution(
      dir,
      {
        executionId: "b".repeat(32),
        idempotencyKey: `ptf-${terms}-pay`,
        capabilityId: "cap-1",
        termsDigest: terms,
        action: "/pay",
        recipient: "verifier",
        resource: "ptf-resource:order-1",
        purpose: "support",
        context: {},
      },
      NOW
    );
    transitionExecution(dir, pay.executionId, "AUTHORIZED", {}, NOW);
    transitionExecution(dir, pay.executionId, "SUBMITTING", {}, NOW);
    transitionExecution(
      dir,
      pay.executionId,
      "SUCCEEDED",
      { receiptId: "receipt-2", receiptAt: NOW },
      NOW
    );
    assert.equal(
      await run(
        ["--dir", dir, "privacy", "events", "reconcile", "--yes"],
        t.value,
        env
      ),
      0
    );
    assert.equal(events.load(mismatch.eventId)?.state, "OUTCOME_UNKNOWN");

    // A journal result that appears after the first sweep is adopted only
    // when the operator explicitly asks to revisit unknown outcomes.
    const unknownTerms = "ef".repeat(32);
    const upgrade = events.prepare({
      profileId: "IN-DPDP-2025",
      profileRevision: "2025-r1",
      dataPrincipalRef: "subject:opaque-1",
      authorityPrincipal: "owner",
      actor: "agent",
      controllerId: "acme",
      activityId: "act",
      basisId: "basis",
      purpose: "support",
      action: "/pay",
      resource: { type: "ptf-resource", id: "order-9" },
      dataCategories: ["payment"],
      recipients: [{ id: "seller:1", role: "third-party" }],
      termsDigest: unknownTerms,
      authorityCitationIds: ["g1"],
      attemptRef: "unknown-upgrade",
      preparedAt: NOW,
    });
    assert.equal(
      await run(
        ["--dir", dir, "privacy", "events", "reconcile", "--yes"],
        t.value,
        env
      ),
      0
    );
    assert.equal(events.load(upgrade.eventId)?.state, "OUTCOME_UNKNOWN");
    const later = createExecution(
      dir,
      {
        executionId: "c".repeat(32),
        idempotencyKey: `ptf-${unknownTerms}-pay`,
        capabilityId: "cap-1",
        termsDigest: unknownTerms,
        action: "/pay",
        recipient: "seller:1",
        resource: "ptf-resource:order-9",
        purpose: "support",
        context: {},
      },
      NOW
    );
    transitionExecution(dir, later.executionId, "AUTHORIZED", {}, NOW);
    transitionExecution(dir, later.executionId, "SUBMITTING", {}, NOW);
    transitionExecution(
      dir,
      later.executionId,
      "SUCCEEDED",
      { receiptId: "receipt-3", receiptAt: NOW + 5 },
      NOW + 5
    );
    await run(
      ["--dir", dir, "privacy", "events", "reconcile", "--yes"],
      t.value,
      env
    );
    assert.equal(events.load(upgrade.eventId)?.state, "OUTCOME_UNKNOWN");
    await run(
      [
        "--dir",
        dir,
        "privacy",
        "events",
        "reconcile",
        "--yes",
        "--include-unknown",
      ],
      t.value,
      env
    );
    const upgraded = events.load(upgrade.eventId);
    assert.equal(upgraded?.state, "SUCCEEDED");
    assert.equal(upgraded?.finalizedAt, NOW + 5);
    assert.equal(upgraded?.evidenceRef, "execution-receipt:receipt-3");
  });

  it("reports configured MCP coverage without claiming running-host attestation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-verify-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    await run(["--dir", dir, "privacy", "init"], t.value, env);
    const config = jsonFile(dir, "mcp-operator.json", {
      dataPrincipalRef: "subject:opaque-1",
      controllerId: "acme",
      recipientRoles: { verifier: "third-party" },
    });
    t.out.length = 0;
    await run(["--dir", dir, "privacy", "verify"], t.value, env);
    const baseline = JSON.parse(t.out.at(-1) as string);
    assert.equal(baseline.enforcement.mode, "not-inspected");
    assert.equal(baseline.enforcement.runtimeAttested, false);
    t.out.length = 0;
    await run(
      ["--dir", dir, "privacy", "verify", "--mcp-config", config],
      t.value,
      env
    );
    const diagnostic = JSON.parse(t.out.at(-1) as string);
    assert.equal(diagnostic.enforcement.mode, "configured-reference-host");
    assert.equal(diagnostic.enforcement.runtimeAttested, false);
    assert.ok(diagnostic.enforcement.coveredPaths.includes("ptf_present_data"));
    assert.ok(
      diagnostic.enforcement.deniedPaths.includes("ptf_request_action")
    );
    assert.ok(
      diagnostic.enforcement.uncoveredPaths.includes("operator-cli-pay")
    );
  });

  it("summarizes processing evidence without exposing subject data values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-cli-summary-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    await run(["--dir", dir, "privacy", "init"], t.value, env);
    const ks = keys(dir);
    const dek = ks[PRIVACY_DEK_ALIAS] as Uint8Array;
    const events = new FilePrivacyEventRepository({
      dir,
      dek,
      nowSec: () => NOW,
    });
    const event = events.prepare({
      profileId: "IN-DPDP-2025",
      profileRevision: "2025-r1",
      dataPrincipalRef: "subject:opaque-1",
      authorityPrincipal: "owner",
      actor: "agent",
      controllerId: "acme",
      activityId: "act",
      basisId: "basis",
      purpose: "support",
      action: "/disclose",
      resource: { type: "vault", id: "personal-state" },
      dataCategories: ["email"],
      recipients: [{ id: "verifier", role: "third-party" }],
      termsDigest: "ab".repeat(32),
      authorityCitationIds: ["g1"],
      preparedAt: NOW,
    });
    events.transition(event.eventId, "SUCCEEDED", {
      finalizedAt: NOW,
      evidenceRef: "presentation:1",
    });
    t.out.length = 0;
    assert.equal(
      await run(
        [
          "--dir",
          dir,
          "privacy",
          "summary",
          "--subject-ref",
          "subject:opaque-1",
        ],
        t.value,
        env
      ),
      0
    );
    const rendered = t.out.join("\n");
    assert.ok(rendered.includes("email"));
    assert.ok(rendered.includes("SUCCEEDED"));
    assert.ok(!rendered.includes("owner@example.com"));
    const summary = JSON.parse(t.out.at(-1) as string) as {
      activityIds: string[];
      erasure: { status: string };
    };
    assert.deepEqual(summary.activityIds, ["act"]);
    assert.equal(summary.erasure.status, "not-computed");
  });
});
