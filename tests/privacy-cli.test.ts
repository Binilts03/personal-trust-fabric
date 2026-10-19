import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRIVACY_DEK_ALIAS,
  FilePrivacyEventRepository,
  loadPrivacyStore,
  openKeystore,
} from "../src/index.js";
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
      "--dir", "/tmp/x", "privacy", "notice", "add", "--file", "/tmp/n.json",
    ]);
    assert.equal(parsed.command, "privacy");
    assert.equal(parsed.flags["path"], "notice/add");
    assert.equal(parsed.flags["file"], "/tmp/n.json");
    assert.throws(
      () => parseArgs(["privacy", "nonsense", "extra", "garbage"]),
      /unknown privacy subcommand|usage/
    );
  });

  it("initializes encrypted privacy state and records evidence without printing evidence bodies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-cli-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    assert.equal(await run(["--dir", dir, "privacy", "init"], t.value, env), 0);

    const notice = {
      id: "notice-1", controllerId: "acme", dataPrincipalRef: "subject:opaque-1",
      purpose: "support", dataCategories: ["email"],
      noticeRef: "SENSITIVE-NOTICE-REF", noticeHash: "a".repeat(64),
      presentedAt: NOW - 10, assertedBy: "privacy-office",
    };
    const consent = {
      id: "consent-1", noticeId: "notice-1", controllerId: "acme",
      dataPrincipalRef: "subject:opaque-1", purpose: "support",
      dataCategories: ["email"], givenAt: NOW - 5, method: "web",
      proofRef: "SENSITIVE-CONSENT-PROOF", assertedBy: "privacy-office",
    };
    const basis = {
      kind: "consent", id: "basis-1", controllerId: "acme",
      dataPrincipalRef: "subject:opaque-1", purpose: "support",
      dataCategories: ["email"], consentId: "consent-1",
      assertedBy: "privacy-office", active: true,
    };
    const activity = {
      id: "activity-1", profileId: "IN-DPDP-2025",
      authorityPrincipal: "did:test:owner", controllerId: "acme",
      subjects: { kind: "exact", ref: "subject:opaque-1" },
      action: "/disclose", resourceType: "vault", purpose: "support",
      dataCategories: ["email"],
      recipients: [{ id: "verifier", role: "third-party" }],
      basisId: "basis-1", active: true,
    };

    for (const [path, file] of [
      ["notice/add", jsonFile(dir, "notice.json", notice)],
      ["consent/add", jsonFile(dir, "consent.json", consent)],
      ["basis/add", jsonFile(dir, "basis.json", basis)],
      ["activity/add", jsonFile(dir, "activity.json", activity)],
    ] as const) {
      const [a, b] = path.split("/");
      assert.equal(
        await run(["--dir", dir, "privacy", a!, b!, "--file", file], t.value, env),
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
      await run([
        "--dir", dir, "privacy", "consent", "withdraw",
        "--id", "consent-1", "--proof-ref", "withdraw:1",
        "--asserted-by", "subject",
      ], t.value, env),
      0
    );
    const ks = keys(dir);
    const store = loadPrivacyStore(dir, { keys: ks });
    assert.equal(store.snapshot().consents[0]?.withdrawnAt, NOW);
    assert.ok(ks[PRIVACY_DEK_ALIAS] instanceof Uint8Array);
  });

  it("requires explicit offline operator recovery and evidence-bound reconciliation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-reconcile-"));
    const t = io();
    const env = { PTF_PASSPHRASE: PASS };
    await run(["--dir", dir, "init"], t.value, env);
    await run(["--dir", dir, "privacy", "init"], t.value, env);
    const eventRepo = new FilePrivacyEventRepository({
      dir, dek: keys(dir)[PRIVACY_DEK_ALIAS] as Uint8Array, nowSec: () => NOW,
    });
    const pending = eventRepo.prepare({
      profileId: "IN-DPDP-2025", profileRevision: "2025-r1",
      dataPrincipalRef: "subject:opaque-1", authorityPrincipal: "owner",
      actor: "agent", controllerId: "acme", activityId: "act", basisId: "basis",
      purpose: "support", action: "/disclose",
      resource: { type: "vault", id: "personal-state" },
      dataCategories: ["email"],
      recipients: [{ id: "verifier", role: "third-party" }],
      termsDigest: "ab".repeat(32), authorityCitationIds: ["g1"], preparedAt: NOW,
    });
    await assert.rejects(
      () => run(["--dir",dir,"privacy","events","reconcile"],t.value,env),
      /--yes/
    );
    assert.equal(eventRepo.load(pending.eventId)?.state, "PREPARED");
    assert.equal(await run(
      ["--dir",dir,"privacy","events","reconcile","--yes"],t.value,env
    ),0);
    assert.equal(eventRepo.load(pending.eventId)?.state, "OUTCOME_UNKNOWN");
    await assert.rejects(
      () => run([
        "--dir",dir,"privacy","events","resolve",
        "--id",pending.eventId,"--state","SUCCEEDED","--yes"
      ],t.value,env),
      /evidence-ref/
    );
    assert.equal(await run([
      "--dir",dir,"privacy","events","resolve",
      "--id",pending.eventId,"--state","SUCCEEDED",
      "--evidence-ref","external-journal:confirmed-1","--yes"
    ],t.value,env),0);
    assert.equal(eventRepo.load(pending.eventId)?.state,"SUCCEEDED");
    await assert.rejects(
      () => run([
        "--dir",dir,"privacy","events","resolve",
        "--id",pending.eventId,"--state","FAILED_FINAL",
        "--evidence-ref","external-journal:contrary","--yes"
      ],t.value,env),
      /only OUTCOME_UNKNOWN/
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
    const events = new FilePrivacyEventRepository({ dir, dek, nowSec: () => NOW });
    const event = events.prepare({
      profileId: "IN-DPDP-2025", profileRevision: "2025-r1",
      dataPrincipalRef: "subject:opaque-1", authorityPrincipal: "owner",
      actor: "agent", controllerId: "acme", activityId: "act", basisId: "basis",
      purpose: "support", action: "/disclose",
      resource: { type: "vault", id: "personal-state" },
      dataCategories: ["email"], recipients: [{ id: "verifier", role: "third-party" }],
      termsDigest: "ab".repeat(32), authorityCitationIds: ["g1"], preparedAt: NOW,
    });
    events.transition(event.eventId, "SUCCEEDED", {
      finalizedAt: NOW, evidenceRef: "presentation:1",
    });
    t.out.length = 0;
    assert.equal(
      await run([
        "--dir", dir, "privacy", "summary",
        "--subject-ref", "subject:opaque-1",
      ], t.value, env),
      0
    );
    const rendered = t.out.join("\n");
    assert.ok(rendered.includes("email"));
    assert.ok(rendered.includes("SUCCEEDED"));
    assert.ok(!rendered.includes("owner@example.com"));
  });
});
