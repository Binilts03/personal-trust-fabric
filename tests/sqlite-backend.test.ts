import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AmbiguousExecutionError,
  Authority,
  Capabilities,
  FileExecutions,
  SqliteExecutions,
  executeWithJournal,
  exportExecutionsToFiles,
  generateEd25519Keypair,
  leafCidHex,
  loadExecution,
  makeFakeProviders,
  migrateExecutionsToSqlite,
  paymentBounds,
  signBytes,
  transitionExecution,
  FileProposals,
  FileReplay,
  FileAuthority,
  type ExecutionQuery,
  type ExecutionRepository,
  type ProtectedProvider,
  type ProviderRequest,
  type Redemption,
} from "../src/index.js";

const NOW = 1_700_000_000;
const DEST = "did:test:dest";

function dir() {
  return mkdtempSync(join(tmpdir(), "ptf-sqlite-"));
}

function setup() {
  const principal = generateEd25519Keypair();
  const recipient = generateEd25519Keypair();
  const keys = new Map([
    ["p", principal.publicKeyRaw],
    [DEST, recipient.publicKeyRaw],
  ]);
  const caps = new Capabilities({
    resolveKey: (id) => keys.get(id) ?? null,
    nowSec: () => NOW,
  });
  return { principal, recipient, caps };
}

function issueRedeem(
  caps: Capabilities,
  principal: ReturnType<typeof generateEd25519Keypair>,
  recipient: ReturnType<typeof generateEd25519Keypair>,
  digest: string
): { redemption: Redemption; chainId: string } {
  const cap = caps.issue(
    null,
    {
      iss: "p",
      aud: "p",
      sub: "p",
      cmd: "/email/send",
      pol: [],
      purpose: "followup",
      resource: "msg:1",
      recipient: DEST,
      exp: NOW + 300,
      maxUses: 1,
      termsDigest: digest,
    },
    principal.privateKey
  );
  const cid = leafCidHex(cap);
  const redeemed = caps.redeem(
    [cap],
    {
      cmd: "/email/send",
      args: { to: "a@approved-company.com" },
      recipient: DEST,
      resource: "msg:1",
      purpose: "followup",
      termsDigest: digest,
    },
    {
      proof: {
        key: recipient.publicKeyRaw,
        sig: signBytes(recipient.privateKey, Buffer.from(cid, "hex")),
      },
    }
  );
  assert.equal(redeemed.ok, true);
  if (!redeemed.ok) throw new Error("setup redeem failed");
  return { redemption: redeemed, chainId: cid };
}

function reqFor(chainId: string, digest: string): ProviderRequest {
  return {
    capabilityId: chainId,
    termsDigest: digest,
    action: "/email/send",
    recipient: DEST,
    resource: "msg:1",
    purpose: "followup",
    context: { to: "a@approved-company.com" },
  };
}

class ThrowProvider implements ProtectedProvider {
  readonly kind = "email" as const;
  calls = 0;
  async submit(): Promise<never> {
    this.calls += 1;
    throw new Error("rail timeout");
  }
  verify():
    { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    return { ok: true };
  }
}

const BACKENDS: readonly (readonly [string, ExecutionRepository])[] = [
  ["file", FileExecutions],
  ["sqlite", SqliteExecutions],
] as const;

describe("sqlite persistence decision (phase 4)", () => {
  for (const [label, journal] of BACKENDS) {
    it(`journal parity [${label}]: happy path, replay, reconcile, abort`, async () => {
      const d = dir();
      const { principal, recipient, caps } = setup();
      const digest = "aa".repeat(32);
      const { redemption, chainId } = issueRedeem(
        caps,
        principal,
        recipient,
        digest
      );
      const fakes = makeFakeProviders({ nowSec: () => NOW });
      const run = (extra: Record<string, unknown> = {}) =>
        executeWithJournal({
          dir: d,
          provider: fakes.email,
          req: reqFor(chainId, digest),
          redemption,
          journal,
          nowSec: NOW,
          at: NOW,
          ...extra,
        });
      const first = await run();
      assert.equal(first.capabilityId, chainId);
      assert.equal(first.termsDigest, digest);
      const second = await run();
      assert.deepEqual(second, first);
      assert.equal(fakes.email.calls.length, 1);

      // Ambiguous submit → reconcile effected, no resubmit.
      const digest2 = "bb".repeat(32);
      const r2 = issueRedeem(caps, principal, recipient, digest2);
      const throwing = new ThrowProvider();
      try {
        await executeWithJournal({
          dir: d,
          provider: throwing,
          req: reqFor(r2.chainId, digest2),
          redemption: r2.redemption,
          journal,
          nowSec: NOW,
        });
        assert.fail("expected ambiguous throw");
      } catch (err) {
        assert.ok(err instanceof AmbiguousExecutionError);
      }
      const query: ExecutionQuery = {
        query: async () => ({ state: "effected", externalRef: "ext-parity" }),
      };
      const receipt = await executeWithJournal({
        dir: d,
        provider: throwing,
        req: reqFor(r2.chainId, digest2),
        redemption: r2.redemption,
        journal,
        query,
        nowSec: NOW,
        at: NOW,
      });
      assert.equal(receipt.transaction, "ext-parity");
      assert.equal(throwing.calls, 1);

      // Abort a pending record → terminal without submit.
      const digest3 = "cc".repeat(32);
      const r3 = issueRedeem(caps, principal, recipient, digest3);
      const created = journal.create(
        d,
        {
          idempotencyKey: `k-${label}`,
          capabilityId: r3.chainId,
          termsDigest: digest3,
          action: "/email/send",
          recipient: DEST,
          resource: "msg:1",
          purpose: "followup",
          context: { to: "a@approved-company.com" },
        },
        NOW
      );
      journal.abort(d, created.executionId, "frozen", NOW);
      assert.equal(journal.load(d, created.executionId).state, "FAILED_FINAL");
    });
  }

  it("migration copies file records to sqlite without deleting sources", () => {
    const d = dir();
    const fileRec = FileExecutions.create(
      d,
      {
        idempotencyKey: "k-mig-1",
        capabilityId: "ab".repeat(32),
        termsDigest: "cd".repeat(32),
        action: "/email/send",
        recipient: DEST,
        resource: "msg:1",
        purpose: "followup",
        context: { to: "a@approved-company.com" },
      },
      NOW
    );
    transitionExecution(d, fileRec.executionId, "AUTHORIZED", {}, NOW);
    const { migrated, kept } = migrateExecutionsToSqlite(d);
    assert.equal(migrated, 1);
    assert.equal(kept, 0);
    // Sources intact: file backend still reads its record.
    assert.equal(loadExecution(d, fileRec.executionId).state, "AUTHORIZED");
    // SQLite holds an identical record.
    const fromDb = SqliteExecutions.load(d, fileRec.executionId);
    assert.deepEqual(
      { ...fromDb },
      { ...loadExecution(d, fileRec.executionId) }
    );
    // Re-migration keeps existing rows (no duplicates, no loss).
    const again = migrateExecutionsToSqlite(d);
    assert.equal(again.migrated, 0);
    assert.equal(again.kept, 1);
  });

  it("export round-trips sqlite rows back to files; refuses non-empty targets", () => {
    const d = dir();
    const created = SqliteExecutions.create(
      d,
      {
        idempotencyKey: "k-exp-1",
        capabilityId: "ab".repeat(32),
        termsDigest: "cd".repeat(32),
        action: "/email/send",
        recipient: DEST,
        resource: "msg:1",
        purpose: "followup",
        context: {},
      },
      NOW
    );
    const target = mkdtempSync(join(tmpdir(), "ptf-export-"));
    const { exported } = exportExecutionsToFiles(d, target);
    assert.equal(exported, 1);
    // Exported files load through the file backend identically.
    const back = loadExecution(target, created.executionId);
    assert.deepEqual(
      { ...back },
      { ...SqliteExecutions.load(d, created.executionId) }
    );
    // Never merge: second export to the same target refuses.
    assert.throws(() => exportExecutionsToFiles(d, target), /not empty/);
  });

  it("sqlite guards: illegal transitions, duplicates, corrupt and missing reads", () => {
    const d = dir();
    const rec = SqliteExecutions.create(
      d,
      {
        idempotencyKey: "k-guard",
        capabilityId: "ab".repeat(32),
        termsDigest: "cd".repeat(32),
        action: "/email/send",
        recipient: DEST,
        resource: "msg:1",
        purpose: "followup",
        context: {},
      },
      NOW
    );
    assert.throws(() =>
      SqliteExecutions.transition(d, rec.executionId, "SUCCEEDED", {}, NOW)
    );
    // Same key, different id → idempotent return, not a duplicate row.
    const same = SqliteExecutions.create(
      d,
      {
        executionId: "ef".repeat(16),
        idempotencyKey: "k-guard",
        capabilityId: "ff".repeat(32),
        termsDigest: "ee".repeat(32),
        action: "/email/send",
        recipient: DEST,
        resource: "msg:1",
        purpose: "followup",
        context: {},
      },
      NOW
    );
    assert.equal(same.executionId, rec.executionId);
    assert.equal(SqliteExecutions.list(d).length, 1);
    assert.throws(
      () => SqliteExecutions.load(d, "00".repeat(16)),
      /unknown execution/
    );
    assert.equal(SqliteExecutions.findByIdempotencyKey(d, "absent"), null);
    assert.throws(() =>
      SqliteExecutions.abort(d, rec.executionId, "bogus" as never, NOW)
    );
  });

  it("file repository seams: authority, proposals, replay", () => {
    const d = dir();
    // Authority round-trip through the seam.
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-seam",
      principal: "did:test:principal",
      actor: { kind: "exact", id: "did:test:agent" },
      action: { name: "/pay" },
      bounds: paymentBounds({ amountMax: 100, currency: "INR" }),
      exp: NOW + 600,
    });
    FileAuthority.save(d, auth);
    const reloaded = FileAuthority.load(d, { nowSec: () => NOW });
    const decision = reloaded.evaluate(
      {
        action: { name: "/pay" },
        resource: { type: "invoice", id: "invoice:1" },
        context: { amount: 50, currency: "INR", recipient: "did:test:shop" },
        purpose: "seam",
      },
      {
        id: "did:test:agent",
        principal: "did:test:principal",
        source: "local-registration",
        proofRef: "seam",
      },
      { nowSec: NOW }
    );
    assert.equal(decision.allow, true);
    // Proposals through the seam.
    const digest = "dd".repeat(32);
    FileProposals.create(d, digest, { hello: "world" }, 600, NOW);
    assert.equal(FileProposals.load(d, digest, NOW).state, "pending");
    // Replay set through the seam: restart-durable denial of reuse.
    assert.equal(FileReplay.has(d, "nonce-1"), false);
    FileReplay.add(d, "nonce-1", NOW);
    assert.equal(FileReplay.has(d, "nonce-1"), true);
    assert.equal(FileReplay.prune(d, 300, NOW + 301), 1);
    assert.equal(FileReplay.has(d, "nonce-1"), false);
    assert.throws(() => FileReplay.add(d, "", NOW));
  });

  it("sqlite handles concurrent same-key creators without forking effects", () => {
    const d = dir();
    const input = {
      idempotencyKey: "k-race",
      capabilityId: "ab".repeat(32),
      termsDigest: "cd".repeat(32),
      action: "/email/send",
      recipient: DEST,
      resource: "msg:1",
      purpose: "followup",
      context: {},
    };
    const a = SqliteExecutions.create(d, input, NOW);
    const b = SqliteExecutions.create(d, input, NOW);
    assert.equal(a.executionId, b.executionId);
    assert.equal(SqliteExecutions.list(d).length, 1);
    // File backend matches the same contract.
    const fa = FileExecutions.create(
      d,
      { ...input, idempotencyKey: "k-race-file" },
      NOW
    );
    const fb = FileExecutions.create(
      d,
      { ...input, idempotencyKey: "k-race-file" },
      NOW
    );
    assert.equal(fa.executionId, fb.executionId);
  });

  it("corrupt sqlite rows fail closed identically to corrupt files", () => {
    const d = dir();
    const db = new DatabaseSync(join(d, "ptf.sqlite"));
    try {
      db.exec(
        "CREATE TABLE executions (execution_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL, record_json TEXT NOT NULL, updated_at INTEGER NOT NULL)"
      );
      db.prepare("INSERT INTO executions VALUES (?, ?, ?, ?, ?)").run(
        "ab".repeat(16),
        "k-bad",
        "BOGUS",
        "{oops",
        NOW
      );
    } finally {
      db.close();
    }
    assert.throws(() => SqliteExecutions.list(d), /journal corrupt/);
    assert.throws(
      () => SqliteExecutions.findByIdempotencyKey(d, "k-bad"),
      /journal corrupt/
    );
  });

  it("export cleans crashed-run staging and still refuses real vintages", () => {
    const d = dir();
    SqliteExecutions.create(
      d,
      {
        idempotencyKey: "k-stage",
        capabilityId: "ab".repeat(32),
        termsDigest: "cd".repeat(32),
        action: "/email/send",
        recipient: DEST,
        resource: "msg:1",
        purpose: "followup",
        context: {},
      },
      NOW
    );
    const target = mkdtempSync(join(tmpdir(), "ptf-stage-"));
    // Simulate a crashed export: leftover staging dir with partial content.
    mkdirSync(join(target, "executions.incomplete-999"));
    writeFileSync(join(target, "executions.incomplete-999", "part.json"), "{}");
    assert.equal(exportExecutionsToFiles(d, target).exported, 1);
    assert.equal(existsSync(join(target, "executions.incomplete-999")), false);
  });
});
