import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Authority } from "../src/index.js";
import { createProtectedEffect } from "../src/hostkit/index.js";

const NOW = 1_800_000_000;
const ingress = { id: "agent-a", principal: "owner", source: "local-registration" as const, proofRef: "test" };
const operation = {
  action: { name: "/email/send" as const },
  resource: { type: "email-message", id: "msg:1" },
  purpose: "delegated-email",
  context: { messageId: "msg:1", recipient: "provider:email" },
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "ptf-no-privacy-"));
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "email-grant",
    principal: "owner",
    actor: { kind: "exact", id: "agent-a" },
    action: { name: "/email/send" },
    exp: NOW + 600,
    maxUses: 1,
  });
  return { dir, auth };
}

describe("domain-neutral protected effect", () => {
  it("executes a host-owned non-payment operation without DPDP state", async () => {
    const { dir, auth } = fixture();
    try {
      let effects = 0;
      let persisted = false;
      const effect = createProtectedEffect({
        dir, auth, ingress, operation,
        authorizedContext: operation.context,
        now: () => NOW,
        processing: { kind: "not-enforced", reason: "synthetic-no-personal-data" },
        effect: {
          kind: "trusted-callback",
          execute: async (ctx) => {
            assert.equal(persisted, true, "authority must persist before the effect");
            assert.equal(ctx.operation.action.name, "/email/send");
            ctx.markEffectStarted();
            effects += 1;
            return {
              receiptId: "r-email-1", capabilityId: "host-only",
              recipient: "provider:email", resource: "msg:1",
              purpose: "delegated-email", transaction: "fake-email-1",
              termsDigest: ctx.termsDigest, at: NOW,
            };
          }
        },
        persistAuthority: () => { persisted = true; },
      });
      assert.equal((await effect.check()).allow, true);
      assert.equal(effects, 0);
      const receipt = await effect.run();
      assert.equal(effects, 1);
      assert.equal(receipt.action, "/email/send");
      assert.equal(receipt.transaction, "fake-email-1");
      assert.equal(receipt.privacyEventId, undefined);
      assert.equal("eventId" in receipt, false);
      assert.equal(auth.snapshot().used.length, 1);
    } finally { rmSync(dir, {recursive:true, force:true}); }
  });
  it("rejects effect-bearing context mutation before consumption", async () => {
    const { dir, auth } = fixture();
    try {
      let calls = 0;
      const effect = createProtectedEffect({
        dir, auth, ingress, operation,
        authorizedContext: { messageId: "msg:evil", recipient: "provider:email" },
        now: () => NOW,
        processing: { kind: "not-enforced", reason: "synthetic-no-personal-data" },
        effect: { kind: "trusted-callback", execute: async () => { calls++; } },
        persistAuthority: () => { throw Error("must not persist"); },
      });
      assert.deepEqual(await effect.check(), {allow:false, reason:"terms-mismatch"});
      await assert.rejects(() => effect.run(), /effect context differs/);
      assert.equal(calls, 0);
      assert.equal(auth.snapshot().used.length, 0);
    } finally { rmSync(dir, {recursive:true, force:true}); }
  });
});
