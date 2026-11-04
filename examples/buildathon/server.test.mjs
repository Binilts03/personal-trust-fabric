import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "./server.mjs";

async function withServer(options, run) {
  const server = createDemoServer(options);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("unauthenticated-service health response reveals no internal state", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/healthz");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", scope: "synthetic-only" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("a missing Gemini key cannot silently fall back to a fake success", async () => {
  let calls = 0;
  await withServer({ hasApiKey: () => false, runDemo: async () => { calls++; } }, async base => {
    const response = await fetch(base + "/demo", { method: "POST" });
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  });
});

test("only body-free POST may run, and response excludes arbitrary callback secrets", async () => {
  let calls = 0;
  await withServer({
    hasApiKey: () => true,
    runDemo: async () => {
      calls++;
      return {
        outcome: "executed", providerCalls: 1, authorityUses: 1,
        privateKey: "not-visible",
        receipt: { receiptId: "r-1", termsDigest: "digest-1", privateKey: "not-visible" }
      };
    }
  }, async base => {
    const blocked = await fetch(base + "/demo", { method: "POST", body: "user-secret" });
    assert.equal(blocked.status, 413);
    const response = await fetch(base + "/demo", { method: "POST" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      outcome: "executed", mode: "gemini", providerCalls: 1, authorityUses: 1,
      receipt: { receiptId: "r-1", termsDigest: "digest-1" }
    });
    assert.equal(calls, 1);
  });
});

test("wrong endpoint and method cannot invoke a protected effect", async () => {
  let calls = 0;
  await withServer({ hasApiKey: () => true, runDemo: async () => { calls++; } }, async base => {
    assert.equal((await fetch(base + "/unknown", { method: "POST" })).status, 404);
    assert.equal((await fetch(base + "/demo")).status, 405);
    assert.equal(calls, 0);
  });
});
