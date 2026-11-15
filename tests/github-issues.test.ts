import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AmbiguousExecutionError,
  Authority,
  Capabilities,
  createGitHubIssueProvider,
  digestForOperation,
  executeWithJournal,
  findByIdempotencyKey,
  generateEd25519Keypair,
  githubIssueOutcomeQuery,
  leafCidHex,
  saveAuthority,
  signBytes,
} from "../src/index.js";

const REPO = "ptf-sandbox/ptf-integration";
const DEST = "github:" + REPO;
const TITLE = "PTF integration probe";
const BODY = "Authorized test issue";
const TOKEN = "ghp_HOST_ONLY_123456";
const NOW = 1_800_000_000;

function request() {
  return {
    capabilityId: "cid-github-123456",
    termsDigest: "ab".repeat(32),
    action: "/github/issues/create" as const,
    recipient: DEST,
    resource: REPO,
    purpose: "integration-test",
    context: { title: TITLE, body: BODY },
  };
}

function issueResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 987,
    number: 23,
    title: TITLE,
    body: BODY,
    repository_url: "https://api.github.com/repos/" + REPO,
    url: "https://api.github.com/repos/" + REPO + "/issues/23",
    html_url: "https://github.com/" + REPO + "/issues/23",
    ...overrides,
  };
}

function successFetch(
  capture: Array<{ url: string; init: RequestInit }>,
  response: Record<string, unknown> = issueResponse(),
  status = 201
): typeof fetch {
  return async (url, init) => {
    capture.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

function provider(fetchImpl: typeof fetch) {
  return createGitHubIssueProvider({
    repository: REPO,
    token: TOKEN,
    fetchImpl,
    nowSec: () => NOW,
  });
}

describe("GitHub Issues real REST provider / protected-effect seam", () => {
  it("only sends an exact, bound issue to GitHub; token stays in the host header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const p = provider(successFetch(calls));
    const sub = await p.submit(request());
    assert.equal(calls.length, 1);
    const sent = calls[0]!;
    assert.equal(sent.url, "https://api.github.com/repos/" + REPO + "/issues");
    assert.equal(sent.init.method, "POST");
    assert.equal(sent.init.redirect, "error");
    const headers = sent.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer " + TOKEN);
    assert.equal(headers["x-github-api-version"], "2022-11-28");
    assert.deepEqual(JSON.parse(String(sent.init.body)), { title: TITLE, body: BODY });
    assert.equal(String(sent.init.body).includes(TOKEN), false);
    assert.equal(sub.kind, "task");
    assert.equal(sub.externalRef, "github:" + REPO + "#23");
    assert.equal(sub.termsDigest, request().termsDigest);
    assert.equal(p.verify(sub, {
      capabilityId: request().capabilityId,
      termsDigest: request().termsDigest,
    }).ok, true);
    assert.equal(p.verify({ ...sub, externalRef: "github:other/repo#23" }, {
      capabilityId: request().capabilityId,
      termsDigest: request().termsDigest,
    }).ok, false);
  });

  it("refuses wrong action, recipient, resource, extra fields, and invalid secrets before HTTP", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const p = provider(successFetch(calls));
    for (const req of [
      { ...request(), action: "/github/issues/delete" as const },
      { ...request(), recipient: "github:other/repo" },
      { ...request(), resource: "other/repo" },
      { ...request(), context: { title: TITLE, body: BODY, labels: ["admin"] } },
      { ...request(), context: { title: TITLE, body: BODY, assignees: ["admin"] } },
      { ...request(), context: { title: "", body: BODY } },
      { ...request(), context: { title: TITLE, body: BODY, token: TOKEN } },
    ]) {
      await assert.rejects(() => p.submit(req));
    }
    assert.equal(calls.length, 0);
    assert.throws(() => createGitHubIssueProvider({
      repository: "../other",
      token: TOKEN,
      fetchImpl: successFetch(calls),
    }));
    assert.throws(() => createGitHubIssueProvider({
      repository: REPO,
      token: "token\r\nInjected: yes",
      fetchImpl: successFetch(calls),
    }));
    assert.equal(calls.length, 0);
  });

  it("rejects wrong-provider receipts, altered issue data, missing references and non-201 statuses", async () => {
    for (const response of [
      issueResponse({ title: "changed" }),
      issueResponse({ body: "changed" }),
      issueResponse({ repository_url: "https://api.github.com/repos/other/repo" }),
      issueResponse({ number: 0 }),
      issueResponse({ url: "https://api.github.com/repos/other/repo/issues/23" }),
      issueResponse({ html_url: "https://evil.example/issue/23" }),
      issueResponse({ pull_request: { url: "https://api.github.com/pulls/23" } }),
    ]) {
      const p = provider(successFetch([], response));
      await assert.rejects(() => p.submit(request()), /github-issues:/);
    }
    for (const status of [200, 302, 401, 403, 422, 503]) {
      await assert.rejects(
        () => provider(successFetch([], issueResponse(), status)).submit(request()),
        /github-issues:/
      );
    }
    const evil = provider(async () => { throw new Error("SECRET: " + TOKEN); });
    await assert.rejects(async () => {
      try {
        await evil.submit(request());
      } catch (err) {
        assert.equal(String(err).includes(TOKEN), false);
        throw err;
      }
    }, /github-issues:/);
  });

  it("requires true redemption and journal replays a successful effect without second POST", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-github-"));
    const pkey = generateEd25519Keypair();
    const recipient = generateEd25519Keypair();
    const keys = new Map([["person", pkey.publicKeyRaw], [DEST, recipient.publicKeyRaw]]);
    const caps = new Capabilities({ resolveKey: id => keys.get(id) ?? null, nowSec: () => NOW });
    const digest = digestForOperation({
      principal: "person",
      actor: "agent",
      action: { name: "/github/issues/create" },
      resource: { type: "repository", id: REPO },
      context: { title: TITLE, body: BODY },
      purpose: "integration-test",
    });
    const cap = caps.issue(null, {
      iss: "person", aud: "agent", sub: "person", cmd: "/github/issues/create",
      pol: [], purpose: "integration-test", resource: REPO, recipient: DEST,
      exp: NOW + 300, maxUses: 1, termsDigest: digest,
    }, pkey.privateKey);
    const cid = leafCidHex(cap);
    const redeemed = caps.redeem([cap], {
      cmd: "/github/issues/create", args: { title: TITLE, body: BODY },
      recipient: DEST, resource: REPO, purpose: "integration-test", termsDigest: digest,
    }, { proof: { key: recipient.publicKeyRaw, sig: signBytes(recipient.privateKey, Buffer.from(cid, "hex")) } });
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("capability redemption denied");

    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "one-github-issue", principal: "person",
      actor: { kind: "exact", id: "agent" },
      action: { name: "/github/issues/create" },
      bounds: [
        { path: ".resource.id", op: "==", value: REPO },
        { path: ".context.title", op: "==", value: TITLE },
        { path: ".context.body", op: "==", value: BODY },
      ],
      exp: NOW + 300, maxUses: 1,
    });
    const ingress = { id: "agent", principal: "person", source: "local-registration" as const, proofRef: "test" };
    const op = {
      action: { name: "/github/issues/create" as const },
      resource: { type: "repository", id: REPO },
      context: { title: TITLE, body: BODY },
      purpose: "integration-test",
    };
    assert.equal(auth.evaluate({ ...op, context: { title: "different", body: BODY } }, ingress, { nowSec: NOW }).allow, false);
    assert.equal(auth.evaluate(op, { ...ingress, id: "attacker" }, { nowSec: NOW }).allow, false);
    assert.equal(auth.evaluate(op, ingress, { consume: true, nowSec: NOW }).allow, true);
    saveAuthority(dir, auth);
    assert.equal(auth.evaluate(op, ingress, { nowSec: NOW }).allow, false);

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const p = provider(successFetch(calls));
    const req = { ...request(), capabilityId: cid, termsDigest: digest };
    const first = await executeWithJournal({
      dir, provider: p, req, redemption: redeemed, nowSec: NOW, query: githubIssueOutcomeQuery,
    });
    const replayed = await executeWithJournal({
      dir, provider: p, req, redemption: redeemed, nowSec: NOW, query: githubIssueOutcomeQuery,
    });
    assert.deepEqual(replayed, first);
    assert.equal(calls.length, 1);
    assert.equal(first.transaction, "github:" + REPO + "#23");
    const record = findByIdempotencyKey(dir, "ptf-" + digest + "-github-issues");
    assert.equal(record?.state, "SUCCEEDED");
    await assert.rejects(() => executeWithJournal({
      dir, provider: p, req: { ...req, context: { title: "attacker", body: BODY } },
      redemption: redeemed, nowSec: NOW,
    }), /context differs/);
    assert.equal(calls.length, 1);
  });

  it("quarantines an ambiguous write: no replay, no optimistic absent result, no leaked token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-github-unknown-"));
    const pkey = generateEd25519Keypair();
    const recipient = generateEd25519Keypair();
    const keys = new Map([["person", pkey.publicKeyRaw], [DEST, recipient.publicKeyRaw]]);
    const caps = new Capabilities({ resolveKey: id => keys.get(id) ?? null, nowSec: () => NOW });
    const digest = digestForOperation({
      principal: "person", actor: "agent", action: { name: "/github/issues/create" },
      resource: { type: "repository", id: REPO }, context: { title: TITLE, body: BODY },
      purpose: "integration-test",
    });
    const cap = caps.issue(null, {
      iss: "person", aud: "agent", sub: "person", cmd: "/github/issues/create",
      pol: [], purpose: "integration-test", resource: REPO, recipient: DEST,
      exp: NOW + 300, maxUses: 1, termsDigest: digest,
    }, pkey.privateKey);
    const cid = leafCidHex(cap);
    const redeemed = caps.redeem([cap], {
      cmd: "/github/issues/create", args: { title: TITLE, body: BODY },
      recipient: DEST, resource: REPO, purpose: "integration-test", termsDigest: digest,
    }, { proof: { key: recipient.publicKeyRaw, sig: signBytes(recipient.privateKey, Buffer.from(cid, "hex")) } });
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw Error("redeem");
    let calls = 0;
    const p = provider(async () => {
      calls++;
      throw new Error("timeout after a real create");
    });
    const opts = {
      dir, provider: p,
      req: { ...request(), capabilityId: cid, termsDigest: digest },
      redemption: redeemed, nowSec: NOW,
    };
    await assert.rejects(() => executeWithJournal(opts), AmbiguousExecutionError);
    await assert.rejects(() => executeWithJournal(opts), AmbiguousExecutionError);
    assert.equal(calls, 1);
    await assert.rejects(
      () => executeWithJournal({ ...opts, query: githubIssueOutcomeQuery }),
      AmbiguousExecutionError
    );
    assert.equal(calls, 1);
    assert.equal(
      findByIdempotencyKey(dir, "ptf-" + digest + "-github-issues")?.state,
      "RECONCILED"
    );
  });
});
