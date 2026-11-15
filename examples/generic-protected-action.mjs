#!/usr/bin/env node
// Synthetic, offline, non-payment PTF host example. No email is sent.
// Uses only the published package entry points, never internal source paths.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { Authority } from "personal-trust-fabric";
import { createProtectedEffect, createHostRedemptionChallenge } from "personal-trust-fabric/hostkit";
import { requestExecution } from "personal-trust-fabric/profiles/data";
import { makeFakeProviders } from "personal-trust-fabric/providers";

const NOW = 1_800_000_000;
const P = "owner", A = "email-agent", M = "provider:email";
function pair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x;
  if (!x) throw Error("missing Ed25519 public key");
  return { publicKeyRaw: Buffer.from(x, "base64url"), privateKey };
}
const owner = pair(), providerKey = pair();
const keys = new Map([[P, owner.publicKeyRaw], [M, providerKey.publicKeyRaw]]);
const ingress = { id: A, principal: P, source: "local-registration", proofRef: "synthetic-host" };
const operation = {
  action: { name: "/email/send" },
  resource: { type: "email-message", id: "msg:1" },
  context: { messageId: "msg:1", recipient: M },
  purpose: "delegated-email",
};
const dir = mkdtempSync(join(tmpdir(), "ptf-email-reference-"));
try {
  const auth = new Authority({ nowSec: () => NOW });
  auth.addGrant({
    id: "email-only", principal: P, actor: { kind: "exact", id: A },
    action: { name: "/email/send" },
    bounds: [
      { path: ".context.messageId", op: "==", value: "msg:1" },
      { path: ".context.recipient", op: "==", value: M },
    ],
    exp: NOW + 300, maxUses: 1,
  });
  const proposed = requestExecution(auth, ingress, {
    action: "/email/send",
    resourceType: "email-message", resourceId: "msg:1",
    context: operation.context, purpose: operation.purpose,
  }, { nowSec: NOW });
  assert.equal(proposed.decision.allow, true, "proposal must be authorized");
  const challenge = createHostRedemptionChallenge({
    operation, ingress, recipient: M, principalPrivateKey: owner.privateKey,
    resolveKey: (id) => keys.get(id) ?? null, nowSec: () => NOW,
  });
  const redeemed = challenge.redeem({
    key: providerKey.publicKeyRaw,
    sig: sign(null, Buffer.from(challenge.cidHex, "hex"), providerKey.privateKey),
  });
  const provider = makeFakeProviders({ nowSec: () => NOW }).email;
  const boundary = createProtectedEffect({
    dir, auth, ingress, operation,
    authorizedContext: operation.context,
    now: () => NOW,
    processing: { kind: "not-enforced", reason: "synthetic-no-personal-data" },
    effect: { kind: "provider", provider, redemption: redeemed },
    // This synthetic host persists its authority-use observation itself.
    // Production implementations must use durable CAS/transactional storage.
    persistAuthority: (state) => {
      writeFileSync(join(dir, "authority-use.marker"), String(state.snapshot().used.length));
    },
  });
  const checked = await boundary.check();
  assert.equal(checked.allow, true, "dry run must allow without consuming");
  const receipt = await boundary.run();
  assert.equal(readFileSync(join(dir, "authority-use.marker"), "utf8"), "1");
  assert.equal(provider.calls.length, 1, "one verified fake provider call");
  assert.equal(receipt.action, "/email/send");
  assert.equal(receipt.privacyEventId, undefined);
  assert.equal("eventId" in receipt, false);
  assert.ok(!JSON.stringify(receipt).includes("privateKey"));
  console.log("email receipt:", receipt.transaction, "(synthetic; no message sent)");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
