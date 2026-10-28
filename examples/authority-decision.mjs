#!/usr/bin/env node
// Domain-neutral Authority CHECK using only the curated, public package API.
// This script does not redeem a capability or perform any external effect.
import assert from "node:assert/strict";
import { Authority, requestExecution } from "../dist/src/api.js";

const now = 1_800_000_000;
const principal = "person", actor = "agent-a", recipient = "provider:tasks";

const authority = new Authority({ nowSec: () => now });
authority.addGrant({
  id: "one-task",
  principal,
  actor: { kind: "exact", id: actor },
  action: { name: "/tasks/submit" },
  bounds: [
    { path: ".context.taskId", op: "==", value: "task:7" },
    { path: ".context.recipient", op: "==", value: recipient },
  ],
  exp: now + 300,
  maxUses: 1,
});

// In a real host VerifiedIdentity MUST be authenticated out of band.
// These locally registered identities are synthetic and not remotely verified.
const ingress = (id) => ({
  id, principal, source: "local-registration", proofRef: "synthetic-only",
});
const action = {
  action: "/tasks/submit",
  resourceType: "task",
  resourceId: "task:7",
  purpose: "delegated-task",
  context: { taskId: "task:7", recipient },
};

const allowed = requestExecution(authority, ingress(actor), action, { nowSec: now });
assert.equal(allowed.decision.allow, true);
assert.equal(allowed.decision.citations[0]?.authorityId, "one-task");
console.log("ALLOW: exact operation for agent-a (grant: one-task)");

const otherActor = requestExecution(authority, ingress("agent-b"), action, { nowSec: now });
assert.equal(otherActor.decision.allow, false);
console.log("DENY: other actor");

const changedRecipient = requestExecution(authority, ingress(actor), {
  ...action,
  context: { ...action.context, recipient: "provider:unexpected" },
}, { nowSec: now });
assert.equal(changedRecipient.decision.allow, false);
console.log("DENY: changed recipient");

assert.equal(authority.snapshot().used.length, 0);
console.log("CHECK only: no authority consumed, no external effect");
