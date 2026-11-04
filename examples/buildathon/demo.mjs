#!/usr/bin/env node
// Buildathon reference: real PTF checks + signed recipient proof + fake provider.
// No email is sent; all identifiers are synthetic. Gemini proposes only.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Authority } from "personal-trust-fabric";
import { requestExecution } from "personal-trust-fabric/profiles/data";
import { createHostRedemptionChallenge, createProtectedEffect } from "personal-trust-fabric/hostkit";
import { makeFakeProviders } from "personal-trust-fabric/providers";
import { proposeWithGemini } from "./gemini.mjs";

const NOW = 1_800_000_000; // fixed synthetic clock for reproducibility
const PRINCIPAL = "owner:demo", ACTOR = "agent:gemini", RECIPIENT = "provider:demo-mail";
const MESSAGE_ID = "msg:buildathon-1";

function pair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x) throw new Error("Ed25519 public key unavailable");
  return { publicKeyRaw: Buffer.from(jwk.x, "base64url"), privateKey };
}

export async function runScenario({ mode = "offline", variant = "allowed" } = {}) {
  const proposal = mode === "gemini"
    ? await proposeWithGemini({ apiKey: process.env.GEMINI_API_KEY })
    : { messageId: MESSAGE_ID, recipient: variant === "recipient" ? "provider:unapproved" : RECIPIENT };
  const ingress = {
    id: variant === "actor" ? "agent:unapproved" : ACTOR,
    principal: PRINCIPAL, source: "synthetic-host-registration", proofRef: "synthetic-session"
  };
  const operation = {
    action: { name: "/email/send" },
    resource: { type: "email-message", id: proposal.messageId },
    context: { messageId: proposal.messageId, recipient: proposal.recipient },
    purpose: "delegated-email"
  };
  const dir = mkdtempSync(join(tmpdir(), "ptf-buildathon-"));
  const provider = makeFakeProviders({ nowSec: () => NOW }).email;
  try {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "grant:one-demo-action", principal: PRINCIPAL,
      actor: { kind: "exact", id: ACTOR },
      action: { name: "/email/send" },
      bounds: [
        { path: ".context.messageId", op: "==", value: MESSAGE_ID },
        { path: ".context.recipient", op: "==", value: RECIPIENT }
      ],
      exp: NOW + 300, maxUses: 1
    });
    const demand = {
      action: "/email/send", resourceType: "email-message",
      resourceId: proposal.messageId, context: operation.context,
      purpose: operation.purpose
    };
    const checked = requestExecution(auth, ingress, demand, { nowSec: NOW });
    if (!checked.decision.allow) {
      return {
        mode, outcome: "denied", reason: "authority-denied",
        processingMode: "synthetic-no-personal-data",
        providerCalls: provider.calls.length, authorityUses: auth.snapshot().used.length
      };
    }

    // Recipient proof is generated and verified by the trusted synthetic host;
    // the model receives neither party's private key nor the challenge signature.
    const owner = pair(), recipient = pair();
    const keys = new Map([[PRINCIPAL, owner.publicKeyRaw], [RECIPIENT, recipient.publicKeyRaw]]);
    const challenge = createHostRedemptionChallenge({
      operation, ingress, recipient: proposal.recipient,
      principalPrivateKey: owner.privateKey,
      resolveKey: id => keys.get(id) ?? null, nowSec: () => NOW
    });
    const redemption = challenge.redeem({
      key: recipient.publicKeyRaw,
      sig: sign(null, Buffer.from(challenge.cidHex, "hex"), recipient.privateKey)
    });
    const boundary = createProtectedEffect({
      dir, auth, ingress, operation,
      authorizedContext: operation.context,
      now: () => NOW,
      processing: { kind: "not-enforced", reason: "synthetic-no-personal-data" },
      effect: { kind: "provider", provider, redemption },
      // An explicitly synthetic local marker is NOT durable production custody.
      persistAuthority: state => {
        writeFileSync(join(dir, "authority-use.marker"), String(state.snapshot().used.length));
      }
    });
    const decision = await boundary.check();
    assert.equal(decision.allow, true, "PTF must permit the exact, proof-bound operation");
    const receipt = await boundary.run();
    const second = variant === "replay" ? await boundary.run() : undefined;
    return {
      mode, outcome: "executed", processingMode: "synthetic-no-personal-data",
      providerCalls: provider.calls.length, authorityUses: auth.snapshot().used.length,
      ...(second ? { replayedSameReceipt: second.receiptId === receipt.receiptId } : {}),
      receipt: {
        action: receipt.action, resource: receipt.resource,
        termsDigest: receipt.termsDigest, receiptId: receipt.receiptId,
        providerReference: receipt.transaction ?? null
      }
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && fileURLToPath(new URL("file://" + process.argv[1])) === thisFile) {
  const flag = process.argv[2] ?? "--offline";
  const allowed = ["--offline", "--gemini", "--denied-recipient", "--denied-actor", "--replay"];
  if (process.argv.length > 3 || !allowed.includes(flag)) {
    console.error("Usage: node examples/buildathon/demo.mjs [--offline|--gemini|--denied-recipient|--denied-actor|--replay]");
    process.exitCode = 2;
  } else {
    runScenario({
      mode: flag === "--gemini" ? "gemini" : "offline",
      variant: flag === "--denied-recipient" ? "recipient" :
        flag === "--denied-actor" ? "actor" :
          flag === "--replay" ? "replay" : "allowed"
    }).then(result => process.stdout.write(JSON.stringify(result) + "\n")).catch(error => {
      // Errors are deliberately not printed with stack/cause (potential secrets).
      console.error("Buildathon demonstration failed:", error?.message ?? "unknown error");
      process.exitCode = 1;
    });
  }
}
