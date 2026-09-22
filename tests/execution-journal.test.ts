import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AmbiguousExecutionError,
  Capabilities,
  ExecutionError,
  abortExecution,
  createExecution,
  deriveIdempotencyKey,
  executeWithJournal,
  findByIdempotencyKey,
  generateEd25519Keypair,
  isTerminal,
  leafCidHex,
  listExecutions,
  loadExecution,
  makeFakeProviders,
  recoverUnsettled,
  signBytes,
  transitionExecution,
  type ExecutionQuery,
  type ProviderRequest,
  type ProtectedProvider,
  type Redemption,
} from "../src/index.js";

const NOW = 1_700_000_000;
const DEST = "did:test:dest";

function dir() {
  return mkdtempSync(join(tmpdir(), "ptf-journal-"));
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

class RejectProvider implements ProtectedProvider {
  readonly kind = "email" as const;
  calls = 0;
  async submit(req: ProviderRequest) {
    this.calls += 1;
    return {
      kind: "email" as const,
      capabilityId: req.capabilityId,
      termsDigest: req.termsDigest,
      externalRef: "ext-nope",
      at: NOW,
    };
  }
  verify(): { readonly ok: false; readonly reason: string } {
    return { ok: false, reason: "declined" };
  }
}

function queryStub(
  state: "effected" | "absent" | "unknown",
  externalRef = "ext-query-1"
): ExecutionQuery & { calls: number } {
  const q = {
    calls: 0,
    async query() {
      q.calls += 1;
      if (state === "effected") return { state, externalRef } as const;
      return { state } as const;
    },
  };
  return q;
}

describe("durable execution journal (phase 3)", () => {
  it("happy path persists SUCCEEDED with stable idempotency key", async () => {
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
    const receipt = await executeWithJournal({
      dir: d,
      provider: fakes.email,
      req: reqFor(chainId, digest),
      redemption,
      nowSec: NOW,
      at: NOW,
    });
    assert.equal(receipt.capabilityId, chainId);
    assert.ok(receipt.transaction.startsWith("fake-email-"));
    assert.equal(receipt.termsDigest, digest);
    const key = deriveIdempotencyKey(digest, "email");
    assert.equal(fakes.email.calls[0]?.metadata?.["idempotencyKey"], key);
    const rec = findByIdempotencyKey(d, key);
    assert.ok(rec);
    assert.equal(rec?.state, "SUCCEEDED");
    assert.equal(rec?.attempts, 1);
    assert.equal(rec?.externalRef, receipt.transaction);
  });

  it("idempotent replay returns the stored receipt without touching the provider", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "bb".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const first = await executeWithJournal({
      dir: d,
      provider: fakes.email,
      req: reqFor(chainId, digest),
      redemption,
      nowSec: NOW,
      at: NOW,
    });
    const second = await executeWithJournal({
      dir: d,
      provider: fakes.email,
      req: reqFor(chainId, digest),
      redemption,
      nowSec: NOW,
      at: NOW,
    });
    assert.deepEqual(second, first);
    assert.equal(fakes.email.calls.length, 1);
  });

  it("dry-run checks and mutated requests never reach the journal", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "cc".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const checked = caps.check(
      [
        caps.issue(
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
        ),
      ],
      {
        cmd: "/email/send",
        args: { to: "a@approved-company.com" },
        recipient: DEST,
        resource: "msg:1",
        purpose: "followup",
        termsDigest: digest,
      }
    );
    assert.equal(checked.ok, true);
    await assert.rejects(() =>
      executeWithJournal({
        dir: d,
        provider: fakes.email,
        req: reqFor(chainId, digest),
        redemption: checked as never,
        nowSec: NOW,
      })
    );
    await assert.rejects(() =>
      executeWithJournal({
        dir: d,
        provider: fakes.email,
        req: { ...reqFor(chainId, digest), recipient: "did:test:attacker" },
        redemption,
        nowSec: NOW,
      })
    );
    assert.deepEqual(listExecutions(d), []);
    assert.equal(fakes.email.calls.length, 0);
  });

  it("attestation failure routes to reconcile, never to a hidden terminal", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "dd".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const provider = new RejectProvider();
    try {
      await executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
    }
    // The effect may still have happened: unknown, not failed.
    const key = deriveIdempotencyKey(digest, "email");
    assert.equal(findByIdempotencyKey(d, key)?.state, "SUBMITTED_UNKNOWN");
    // A rail that will not attest the adopted ref quarantines instead of
    // adopting blindly (D1.1 settlement gate).
    await assert.rejects(
      executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        query: queryStub("effected", "ext-late-confirm"),
        nowSec: NOW,
        at: NOW,
      }),
      /quarantined/
    );
    assert.equal(findByIdempotencyKey(d, key)?.state, "RECONCILED");
  });

  it("reconcile adopts an attested ref without resubmitting", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "dd".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const rejecting = new RejectProvider();
    try {
      await executeWithJournal({
        dir: d,
        provider: rejecting,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
    }
    // A provider that attests the adopted ref confirms the effect: adopts
    // it with zero new submits.
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const receipt = await executeWithJournal({
      dir: d,
      provider: fakes.email,
      req: reqFor(chainId, digest),
      redemption,
      query: queryStub("effected", "ext-late-confirm"),
      nowSec: NOW,
      at: NOW,
    });
    assert.equal(receipt.transaction, "ext-late-confirm");
    assert.equal(fakes.email.calls.length, 0);
    assert.equal(rejecting.calls, 1);
  });

  it("explicit abort fails pending executions without submitting", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "ab".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const key = deriveIdempotencyKey(digest, "email");
    const created = createExecution(
      d,
      {
        idempotencyKey: key,
        capabilityId: chainId,
        termsDigest: digest,
        action: "/email/send",
        recipient: DEST,
        resource: "msg:1",
        purpose: "followup",
        context: { to: "a@approved-company.com" },
      },
      NOW
    );
    const aborted = abortExecution(d, created.executionId, "frozen", NOW);
    assert.equal(aborted.state, "FAILED_FINAL");
    await assert.rejects(
      executeWithJournal({
        dir: d,
        provider: fakes.email,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      }),
      /already failed/
    );
    assert.equal(fakes.email.calls.length, 0);
    // Aborting live or terminal records throws.
    assert.throws(() =>
      abortExecution(d, created.executionId, "cancelled", NOW)
    );
  });

  it("ambiguous submit persists SUBMITTED_UNKNOWN with the execution id", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "ee".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const provider = new ThrowProvider();
    let executionId = "";
    try {
      await executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
      executionId = err.executionId;
    }
    // Fresh handle after "restart": still unknown, provider untouched since.
    const reloaded = loadExecution(d, executionId);
    assert.equal(reloaded.state, "SUBMITTED_UNKNOWN");
    assert.equal(provider.calls, 1);
  });

  it("resume without a query refuses to guess", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "ff".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const provider = new ThrowProvider();
    let executionId = "";
    try {
      await executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
      executionId = err.executionId;
    }
    await assert.rejects(
      executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      }),
      /reconcile required/
    );
    assert.equal(loadExecution(d, executionId).state, "SUBMITTED_UNKNOWN");
    assert.equal(provider.calls, 1);
  });

  it("reconcile effected adopts the external ref without resubmitting", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "11".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const provider = new ThrowProvider();
    try {
      await executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
    }
    const query = queryStub("effected", "ext-confirmed-9");
    const receipt = await executeWithJournal({
      dir: d,
      provider,
      req: reqFor(chainId, digest),
      redemption,
      query,
      nowSec: NOW,
      at: NOW,
    });
    assert.equal(receipt.transaction, "ext-confirmed-9");
    assert.equal(query.calls, 1);
    assert.equal(provider.calls, 1);
    const key = deriveIdempotencyKey(digest, "email");
    assert.equal(findByIdempotencyKey(d, key)?.state, "SUCCEEDED");
  });

  it("reconcile queries are read-only: one submit, N queries, never two submits", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "66".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    let submits = 0;
    const flaky: ProtectedProvider = {
      kind: "email",
      async submit(req) {
        submits += 1;
        if (submits === 1) throw new Error("rail timeout");
        return {
          kind: "email" as const,
          capabilityId: req.capabilityId,
          termsDigest: req.termsDigest,
          externalRef: "ext-retry-2",
          at: NOW,
        };
      },
      verify: () => ({ ok: true as const }),
    };
    try {
      await executeWithJournal({
        dir: d,
        provider: flaky,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
    }
    let queries = 0;
    const countingQuery = {
      async query() {
        queries += 1;
        return { state: "absent" } as const;
      },
    };
    const receipt = await executeWithJournal({
      dir: d,
      provider: flaky,
      req: reqFor(chainId, digest),
      redemption,
      query: countingQuery,
      nowSec: NOW,
      at: NOW,
    });
    assert.equal(receipt.transaction, "ext-retry-2");
    // Exactly two submits (initial + one confirmed-absent retry) against
    // one read-only reconcile query — crash replay never double-submits.
    assert.equal(submits, 2);
    assert.equal(queries, 1);
  });

  it("distinct rail namespaces isolate identical terms", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "99".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const first = await executeWithJournal({
      dir: d,
      provider: fakes.email,
      req: reqFor(chainId, digest),
      redemption,
      nowSec: NOW,
      at: NOW,
    });
    // Same terms, second rail of the same kind: must execute independently,
    // never adopt the first rail's receipt.
    const railB: ProtectedProvider = {
      kind: "email",
      namespace: "email-b",
      submit: async (req) => fakes.email.submit(req),
      verify: (sub, exp) => fakes.email.verify(sub, exp),
    };
    const second = await executeWithJournal({
      dir: d,
      provider: railB,
      req: reqFor(chainId, digest),
      redemption,
      nowSec: NOW,
      at: NOW,
    });
    assert.notEqual(second.transaction, first.transaction);
    assert.equal(fakes.email.calls.length, 2);
  });

  it("reconcile absent retries with the SAME idempotency key, then succeeds", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "22".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    let calls = 0;
    const flaky: ProtectedProvider = {
      kind: "email",
      async submit(req) {
        calls += 1;
        if (calls === 1) throw new Error("rail timeout");
        return {
          kind: "email" as const,
          capabilityId: req.capabilityId,
          termsDigest: req.termsDigest,
          externalRef: "ext-retry-2",
          at: NOW,
        };
      },
      verify: () => ({ ok: true as const }),
    };
    try {
      await executeWithJournal({
        dir: d,
        provider: flaky,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
    }
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const query = queryStub("absent");
    // Resume with a working provider: must resubmit under the same key.
    const receipt = await executeWithJournal({
      dir: d,
      provider: {
        kind: "email",
        submit: async (req) => fakes.email.submit(req),
        verify: (sub, exp) => fakes.email.verify(sub, exp),
      },
      req: reqFor(chainId, digest),
      redemption,
      query,
      nowSec: NOW,
      at: NOW,
    });
    assert.ok(receipt.transaction.startsWith("fake-email-"));
    const key = deriveIdempotencyKey(digest, "email");
    assert.equal(fakes.email.calls[0]?.metadata?.["idempotencyKey"], key);
    const rec = findByIdempotencyKey(d, key);
    assert.equal(rec?.attempts, 2);
    assert.equal(rec?.state, "SUCCEEDED");
  });

  it("reconcile unknown quarantines; quarantined runs never resubmit", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "33".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const provider = new ThrowProvider();
    let executionId = "";
    try {
      await executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
      executionId = err.executionId;
    }
    await assert.rejects(
      executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        query: queryStub("unknown"),
        nowSec: NOW,
      }),
      /quarantined/
    );
    assert.equal(loadExecution(d, executionId).state, "RECONCILED");
    const callsBefore = provider.calls;
    await assert.rejects(
      executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        query: queryStub("absent"),
        nowSec: NOW,
      }),
      /quarantined/
    );
    assert.equal(provider.calls, callsBefore);
  });

  it("attempt budget is fixed at create and cannot be re-armed on resume", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "44".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const provider = new ThrowProvider();
    try {
      await executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
        maxAttempts: 1,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
    }
    // attempts is already 1 (one SUBMITTING entry); resume with a LARGER
    // budget must still honor the stored budget of 1 → quarantine.
    await assert.rejects(
      executeWithJournal({
        dir: d,
        provider,
        req: reqFor(chainId, digest),
        redemption,
        query: queryStub("absent"),
        nowSec: NOW,
        maxAttempts: 99,
      }),
      /quarantined/
    );
    assert.equal(provider.calls, 1);
  });

  it("illegal transitions, duplicates, and corrupt records fail closed", () => {
    const d = dir();
    const rec = createExecution(
      d,
      {
        idempotencyKey: "k1",
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
    assert.equal(isTerminal(rec), false);
    assert.throws(() =>
      transitionExecution(d, rec.executionId, "SUCCEEDED", {}, NOW)
    );
    // Explicit executionId reuse under a DIFFERENT key is a caller bug.
    assert.throws(() =>
      createExecution(
        d,
        {
          executionId: rec.executionId,
          idempotencyKey: "k-other",
          capabilityId: "ab".repeat(32),
          termsDigest: "cd".repeat(32),
          action: "/email/send",
          recipient: DEST,
          resource: "msg:1",
          purpose: "followup",
          context: {},
        },
        NOW
      )
    );
    const ok = transitionExecution(d, rec.executionId, "AUTHORIZED", {}, NOW);
    assert.equal(isTerminal(ok), false);
    assert.throws(() => loadExecution(d, "00".repeat(16)), /unknown execution/);
    assert.throws(() => loadExecution(d, "zz"));
    // Validation parity with the SQLite backend: non-string notes and
    // unknown abort reasons throw on both.
    transitionExecution(d, rec.executionId, "SUBMITTING", {}, NOW);
    assert.throws(() =>
      transitionExecution(d, rec.executionId, "SUBMITTED_UNKNOWN", {
        lastError: 123 as never,
      })
    );
    assert.throws(() =>
      abortExecution(d, rec.executionId, "bogus" as never, NOW)
    );
    // Creation is idempotent on the key: same terms return the record.
    const same = createExecution(
      d,
      {
        idempotencyKey: "k1",
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
    assert.equal(same.executionId, ok.executionId);
    assert.equal(findByIdempotencyKey(d, "nope"), null);
    assert.equal(findByIdempotencyKey(dir(), "nope"), null);
    assert.throws(() => deriveIdempotencyKey("xyz", "email"));
    assert.throws(() => deriveIdempotencyKey("cd".repeat(32), "EMAIL"));
    assert.throws(() => deriveIdempotencyKey("cd".repeat(32), ""));
    // Stable derivation: same inputs, same key.
    assert.equal(
      deriveIdempotencyKey("cd".repeat(32), "email"),
      deriveIdempotencyKey("cd".repeat(32), "email")
    );
    // Remint stability: the key carries no capability identity, so a
    // reminted capability reconciles instead of forking a second effect.
    const stable = deriveIdempotencyKey("cd".repeat(32), "email");
    assert.ok(!stable.includes("ab".repeat(32)));
    // Scope separation: same terms through different providers → different
    // keys, so one provider's outcome never satisfies another's.
    assert.notEqual(
      deriveIdempotencyKey("cd".repeat(32), "email"),
      deriveIdempotencyKey("cd".repeat(32), "payment")
    );
  });

  it("recoverUnsettled marks crash leftovers unknown without retrying", () => {
    const d = dir();
    const rec = createExecution(
      d,
      {
        idempotencyKey: "k-crash",
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
    transitionExecution(d, rec.executionId, "AUTHORIZED", {}, NOW);
    transitionExecution(d, rec.executionId, "SUBMITTING", {}, NOW);
    const unsettled = recoverUnsettled(d, NOW);
    assert.equal(unsettled.length, 1);
    assert.equal(unsettled[0]?.state, "SUBMITTED_UNKNOWN");
    assert.equal(loadExecution(d, rec.executionId).state, "SUBMITTED_UNKNOWN");
    // Terminal records are untouched.
    assert.deepEqual(recoverUnsettled(dir(), NOW), []);
  });

  it("overlong provider refs fail closed instead of entering the journal", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "55".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    const big: ProtectedProvider = {
      kind: "email",
      async submit(req) {
        return {
          kind: "email" as const,
          capabilityId: req.capabilityId,
          termsDigest: req.termsDigest,
          externalRef: "x".repeat(257),
          at: NOW,
        };
      },
      verify: () => ({ ok: true as const }),
    };
    try {
      await executeWithJournal({
        dir: d,
        provider: big,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
    }
    const key = deriveIdempotencyKey(digest, "email");
    assert.equal(findByIdempotencyKey(d, key)?.state, "SUBMITTED_UNKNOWN");
  });

  it("journal record carries no secrets and fixed-vocabulary notes", () => {
    const d = dir();
    const rec = createExecution(
      d,
      {
        idempotencyKey: "k-clean",
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
    const blob = JSON.stringify(rec);
    assert.ok(!blob.includes("secret"));
    assert.ok(!blob.includes("token"));
    assert.throws(() =>
      transitionExecution(d, rec.executionId, "AUTHORIZED", {
        lastError: "x".repeat(257),
      })
    );
  });

  it("adoption trusts provider attestation: a lying confirmer is host failure", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "77".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    let submits = 0;
    const liar: ProtectedProvider = {
      kind: "email",
      async submit(req) {
        submits += 1;
        throw new Error("rail timeout");
      },
      // Dishonest attestation: confirms refs it never produced.
      verify: () => ({ ok: true as const }),
    };
    try {
      await executeWithJournal({
        dir: d,
        provider: liar,
        req: reqFor(chainId, digest),
        redemption,
        nowSec: NOW,
      });
      assert.fail("expected ambiguous throw");
    } catch (err) {
      assert.ok(err instanceof AmbiguousExecutionError);
    }
    // PTF ran attestation and adopted per its result; the lie is the
    // host's verify implementation, not a journal bypass. No resubmit.
    const receipt = await executeWithJournal({
      dir: d,
      provider: liar,
      req: reqFor(chainId, digest),
      redemption,
      query: queryStub("effected", "ext-liar-confirm"),
      nowSec: NOW,
      at: NOW,
    });
    assert.equal(receipt.transaction, "ext-liar-confirm");
    assert.equal(submits, 1);
  });

  it("AUTHORIZED leftovers resume to exactly one submit", async () => {
    const d = dir();
    const { principal, recipient, caps } = setup();
    const digest = "88".repeat(32);
    const { redemption, chainId } = issueRedeem(
      caps,
      principal,
      recipient,
      digest
    );
    // Crash between AUTHORIZED and SUBMITTING: craft the leftover directly.
    const key = deriveIdempotencyKey(digest, "email");
    const created = createExecution(
      d,
      {
        idempotencyKey: key,
        capabilityId: chainId,
        termsDigest: digest,
        action: "/email/send",
        recipient: DEST,
        resource: "msg:1",
        purpose: "followup",
        context: { to: "a@approved-company.com" },
      },
      NOW
    );
    transitionExecution(d, created.executionId, "AUTHORIZED", {}, NOW);
    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const receipt = await executeWithJournal({
      dir: d,
      provider: fakes.email,
      req: reqFor(chainId, digest),
      redemption,
      nowSec: NOW,
      at: NOW,
    });
    assert.ok(receipt.transaction.startsWith("fake-email-"));
    assert.equal(fakes.email.calls.length, 1);
    assert.equal(findByIdempotencyKey(d, key)?.attempts, 1);
  });

  it("journal creation fails closed at capacity with named repair", () => {
    const d = dir();
    const base = {
      capabilityId: "ab".repeat(32),
      termsDigest: "cd".repeat(32),
      action: "/email/send",
      recipient: DEST,
      resource: "msg:1",
      purpose: "followup",
      context: {},
    };
    // Fill directly (createExecution per record would be O(n^2) scans).
    mkdirSync(join(d, "executions"), { recursive: true });
    for (let i = 0; i < 5000; i += 1) {
      const id = i.toString(16).padStart(32, "0");
      writeFileSync(
        join(d, "executions", `${id}.json`),
        JSON.stringify({
          ...base,
          executionId: id,
          idempotencyKey: `k-fill-${i}`,
          state: "SUCCEEDED",
          createdAt: NOW,
          updatedAt: NOW,
          attempts: 1,
          maxAttempts: 3,
        })
      );
    }
    assert.throws(
      () => createExecution(d, { ...base, idempotencyKey: "k-overflow" }, NOW),
      /journal full/
    );
  });
});
