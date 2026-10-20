import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  FileAuditLog,
  RecipientRegistry,
  VaultStore,
  backupStore,
  claimsSubset,
  createProposal,
  createVaultDek,
  loadAuthority,
  restoreStore,
  saveAuthority,
  saveRegistry,
  saveVault,
  sealKeystore,
  VAULT_DEK_ALIAS,
} from "../src/index.js";
import {
  PrivacyStore,
  createPrivacyDek,
  savePrivacyStore,
} from "../src/store/privacy.js";
import { FilePrivacyEventRepository } from "../src/store/privacy-events.js";
import { run } from "../src/cli.js";

const NOW = 1_700_000_000;
const P = "did:test:owner";
const A = "did:test:agent";
const PASS = "test-pass-backup";

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Live store: grant + audit entry + vault record + keystore + proposal. */
function seedLive(): { dir: string; dek: Uint8Array } {
  const dir = tmp("ptf-backup-live-");
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "g1",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/disclose" },
    bounds: claimsSubset(["email"]),
    exp: NOW + 3600,
  });
  saveAuthority(dir, auth);
  const reg = new RecipientRegistry(() => NOW);
  saveRegistry(dir, reg);
  const audit = FileAuditLog.open(join(dir, "audit.jsonl"), () => NOW);
  audit.append({
    actor: "operator",
    action: "grant",
    authorityId: "g1",
    authorityRev: auth.loadedRevision(),
    registryRev: reg.loadedRevision(),
  });
  const dek = createVaultDek();
  const vault = new VaultStore(() => NOW);
  vault.putRecord({
    id: "r-email",
    owner: P,
    type: "email",
    value: "owner@example.com",
    sensitivity: "general",
    source: "user",
    allowedPurposes: ["support"],
    allowedAgents: [A],
    expiresAt: null,
  });
  saveVault(dir, vault, { dek });
  writeFileSync(
    join(dir, "keystore.json"),
    JSON.stringify(sealKeystore({ [VAULT_DEK_ALIAS]: dek }, PASS))
  );
  createProposal(
    dir,
    "ab".repeat(32),
    { principal: P, note: "seed" },
    600,
    NOW
  );
  return { dir, dek };
}

function testIo(): {
  io: { print: (l: string) => void; readLine: () => string; now: () => number };
  out: string[];
} {
  const out: string[] = [];
  return {
    out,
    io: {
      print: (l: string) => {
        out.push(l);
      },
      readLine: () => "yes",
      now: () => NOW,
    },
  };
}

describe("backup/restore privacy state", () => {
  it("copies and verifies encrypted privacy configuration and processing events as one unit", () => {
    const { dir: live, dek: vaultDek } = seedLive();
    const privacyDek = createPrivacyDek();
    const privacy = new PrivacyStore(() => NOW);
    privacy.addNotice({
      id: "notice-privacy",
      controllerId: "acme",
      dataPrincipalRef: "subject:opaque-backup",
      purpose: "support",
      dataCategories: ["email"],
      noticeRef: "notice://backup",
      noticeHash: "a".repeat(64),
      presentedAt: NOW,
      assertedBy: "privacy-office",
    });
    savePrivacyStore(live, privacy, { dek: privacyDek });
    const events = new FilePrivacyEventRepository({
      dir: live,
      dek: privacyDek,
      nowSec: () => NOW,
    });
    events.prepare({
      profileId: "IN-DPDP-2025",
      profileRevision: "2025-r1",
      dataPrincipalRef: "subject:opaque-backup",
      authorityPrincipal: P,
      actor: A,
      controllerId: "acme",
      activityId: "activity-backup",
      basisId: "basis-backup",
      purpose: "support",
      action: "/disclose",
      resource: { type: "vault", id: "personal-state" },
      dataCategories: ["email"],
      recipients: [{ id: "verifier", role: "third-party" }],
      termsDigest: "bc".repeat(32),
      authorityCitationIds: ["g1"],
      preparedAt: NOW,
    });

    const dest = join(tmpdir(), `ptf-backup-privacy-${Date.now()}`);
    const summary = backupStore(live, dest, { nowSec: () => NOW });
    assert.ok(summary.files.includes("privacy-state.json"));
    assert.equal(summary.privacyEvents, 1);
    assert.ok(
      !readFileSync(join(dest, "privacy-state.json"), "utf8").includes(
        "subject:opaque-backup"
      )
    );

    const restored = join(tmpdir(), `ptf-backup-privacy-rest-${Date.now()}`);
    const result = restoreStore(dest, restored, {
      nowSec: () => NOW,
      keys: {
        [VAULT_DEK_ALIAS]: vaultDek,
        "ptf/privacy-dek": privacyDek,
      },
    });
    assert.ok(result.files.includes("privacy-state.json"));
    const restoredEvents = new FilePrivacyEventRepository({
      dir: restored,
      dek: privacyDek,
      nowSec: () => NOW,
    });
    assert.equal(
      restoredEvents.listBySubject("subject:opaque-backup").length,
      1
    );

    // Deleting a whole event from an otherwise valid encrypted backup must
    // be detected. Decryption of the remaining files alone is not enough.
    const filenames = readdirSync(join(dest, "privacy-events"));
    assert.equal(filenames.length, 1);
    unlinkSync(join(dest, "privacy-events", filenames[0] as string));
    const tamperedRestore = join(
      tmpdir(),
      `ptf-privacy-event-missing-${Date.now()}`
    );
    assert.throws(
      () =>
        restoreStore(dest, tamperedRestore, {
          nowSec: () => NOW,
          keys: {
            [VAULT_DEK_ALIAS]: vaultDek,
            "ptf/privacy-dek": privacyDek,
          },
        }),
      /privacy event.*(manifest|integrity|missing|mismatch)/
    );
  });
});

describe("backup/restore as code (operations runbook)", () => {
  it("backs up as one unit with anchor; clean restore verifies + anchor matches", () => {
    const { dir: live, dek } = seedLive();
    const dest = join(tmpdir(), `ptf-backup-dest-${Date.now()}-a`);
    const summary = backupStore(live, dest, { nowSec: () => NOW });
    assert.ok(summary.files.includes("authority.json"));
    assert.ok(summary.files.includes("personal-state.json"));
    assert.ok(summary.files.includes("keystore.json"));
    assert.equal(summary.proposals, 1);
    assert.equal(summary.anchor.count, 1);
    assert.ok(!JSON.stringify(summary).includes("owner@example.com"));

    const restored = join(tmpdir(), `ptf-backup-rest-${Date.now()}-a`);
    const keys = { [VAULT_DEK_ALIAS]: dek };
    const res = restoreStore(dest, restored, { nowSec: () => NOW, keys });
    assert.equal(res.anchorChecked, true);
    assert.equal(res.anchorMatch, true);
    assert.equal(
      loadAuthority(restored, { nowSec: () => NOW }).loadedRevision(),
      0
    );
    assert.ok(
      FileAuditLog.open(join(restored, "audit.jsonl"), () => NOW).verifyChain()
    );
  });

  it("tampered backup audit fails restore on anchor mismatch", () => {
    const { dir: live, dek } = seedLive();
    const dest = join(tmpdir(), `ptf-backup-dest-${Date.now()}-b`);
    backupStore(live, dest, { nowSec: () => NOW });
    writeFileSync(join(dest, "audit.jsonl"), '{"forged":true}\n');
    const restored = join(tmpdir(), `ptf-backup-rest-${Date.now()}-b`);
    assert.throws(
      () =>
        restoreStore(dest, restored, {
          nowSec: () => NOW,
          keys: { [VAULT_DEK_ALIAS]: dek },
        }),
      /corrupt|mismatch|BROKEN/
    );
  });

  it("refuses non-empty destinations (never merge)", () => {
    const { dir: live, dek } = seedLive();
    const dest = join(tmpdir(), `ptf-backup-dest-${Date.now()}-c`);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "other.txt"), "x");
    assert.throws(() => backupStore(live, dest), /non-empty/);
    const dest2 = join(tmpdir(), `ptf-backup-dest-${Date.now()}-c2`);
    backupStore(live, dest2, { nowSec: () => NOW });
    assert.throws(
      () =>
        restoreStore(dest2, live, {
          nowSec: () => NOW,
          keys: { [VAULT_DEK_ALIAS]: dek },
        }),
      /non-empty/
    );
  });

  it("refuses to back up a passphrase file living inside the store", () => {
    const { dir: live } = seedLive();
    const pp = join(live, "ppfile");
    writeFileSync(pp, "sekret");
    const dest = join(tmpdir(), `ptf-backup-dest-${Date.now()}-d`);
    assert.throws(
      () => backupStore(live, dest, { passphraseFile: pp }),
      /passphrase file lives inside/
    );
  });

  it("missing anchor restores unverified; corrupt anchor fails closed", () => {
    const { dir: live, dek } = seedLive();
    const keys = { [VAULT_DEK_ALIAS]: dek };
    const dest = join(tmpdir(), `ptf-backup-dest-${Date.now()}-e`);
    backupStore(live, dest, { nowSec: () => NOW });
    // Old-style backup without anchor.json: restores point-in-time only.
    const noAnchor = join(tmpdir(), `ptf-backup-noanchor-${Date.now()}-e`);
    mkdirSync(noAnchor, { recursive: true });
    for (const name of [
      "authority.json",
      "registry.json",
      "personal-state.json",
      "keystore.json",
      "audit.jsonl",
    ] as const) {
      writeFileSync(join(noAnchor, name), readFileSync(join(dest, name)));
    }
    const restored = join(tmpdir(), `ptf-backup-rest-${Date.now()}-e`);
    const res = restoreStore(noAnchor, restored, { nowSec: () => NOW, keys });
    assert.equal(res.anchorChecked, false);
    assert.equal(res.anchorMatch, false);
    // Corrupt anchor file fails closed instead of silently skipping.
    writeFileSync(join(dest, "anchor.json"), "{nope");
    const restored2 = join(tmpdir(), `ptf-backup-rest2-${Date.now()}-e`);
    assert.throws(
      () => restoreStore(dest, restored2, { nowSec: () => NOW, keys }),
      /anchor corrupt/
    );
  });

  it("CLI backup + restore round-trip with passphrase env", async () => {
    const { dir: live } = seedLive();
    const dest = join(tmpdir(), `ptf-backup-dest-${Date.now()}-f`);
    const first = testIo();
    const backupCode = await run(
      ["--dir", live, "backup", "--to", dest],
      first.io,
      {},
      {}
    );
    assert.equal(backupCode, 0);
    assert.ok(first.out.some((l) => l.includes("anchor:")));
    const restored = join(tmpdir(), `ptf-backup-rest-${Date.now()}-f`);
    const second = testIo();
    const restoreCode = await run(
      ["--dir", restored, "restore", "--from", dest],
      second.io,
      { PTF_PASSPHRASE: PASS },
      {}
    );
    assert.equal(restoreCode, 0);
    assert.ok(second.out.some((l) => l.includes("anchor: MATCH")));
  });
});
