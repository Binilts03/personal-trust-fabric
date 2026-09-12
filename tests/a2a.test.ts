import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  checkAgentCard,
  checkPushUrl,
  checkTaskTransition,
  generateEd25519Keypair,
  signAgentCard,
  verifyCardSignatures,
} from "../src/index.js";
import type { KeyObject } from "node:crypto";

function baseCard() {
  return {
    name: "Shop Agent",
    description: "Sells widgets",
    supportedInterfaces: [
      {
        url: "https://shop.example.com/a2a",
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    provider: { organization: "Shop Inc" },
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: true },
    securitySchemes: {
      oauth: { type: "oauth2", flows: ["clientCredentials"] },
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    skills: [{ id: "sell", name: "Sell", description: "Sells things" }],
  };
}

describe("A2A card, task, and push guards (ptf-v03/02)", () => {
  it("accepts a well-formed card and rejects structural violations", () => {
    checkAgentCard(baseCard());
    assert.throws(() => checkAgentCard({ ...baseCard(), name: "" }));
    assert.throws(() =>
      checkAgentCard({
        ...baseCard(),
        securitySchemes: { k: { type: "telepathy" } },
      })
    );
    assert.throws(() =>
      checkAgentCard({
        ...baseCard(),
        securitySchemes: { o: { type: "oauth2", flows: ["implicit"] } },
      })
    );
    assert.throws(() => checkAgentCard({ ...baseCard(), skills: [] }));
  });

  it("verifies card signatures and rejects forgeries and unknown keys", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const ed = generateEd25519Keypair();
    const card = baseCard() as Record<string, unknown>;
    const sigEc = signAgentCard(card, "ec-key-1", {
      alg: "ES256",
      privateKey: ec.privateKey,
    });
    const sigEd = signAgentCard(card, "ed-key-1", {
      alg: "EdDSA",
      privateKey: ed.privateKey,
    });
    const signed = { ...card, signatures: [sigEc, sigEd] };
    const resolve = (kid: string) => {
      if (kid === "ec-key-1")
        return { alg: "ES256" as const, key: ec.publicKey as KeyObject };
      if (kid === "ed-key-1")
        return { alg: "EdDSA" as const, key: ed.publicKeyRaw };
      return null;
    };
    assert.equal(verifyCardSignatures(signed, resolve).verified, 2);

    const forged = {
      ...card,
      description: "Sells widgets (totally legit)",
      signatures: [sigEc, sigEd],
    };
    assert.throws(() => verifyCardSignatures(forged, resolve));
    assert.throws(() => verifyCardSignatures(signed, () => null));
  });

  it("enforces the task-state machine with immutable terminals", () => {
    checkTaskTransition("SUBMITTED", "WORKING");
    checkTaskTransition("WORKING", "COMPLETED");
    checkTaskTransition("AUTH_REQUIRED", "WORKING");
    assert.throws(() => checkTaskTransition("COMPLETED", "WORKING"));
    assert.throws(() => checkTaskTransition("FAILED", "WORKING"));
    assert.throws(() => checkTaskTransition("REJECTED", "CANCELED"));
    assert.throws(() => checkTaskTransition("SUBMITTED", "COMPLETED"));
    assert.throws(() => checkTaskTransition("WORKING", "BOGUS" as never));
  });

  it("rejects unsafe push URLs", () => {
    checkPushUrl("https://client.example.com/hook");
    assert.throws(() => checkPushUrl("http://127.0.0.1:9/hook"));
    assert.throws(() => checkPushUrl("https://10.1.2.3/hook"));
    assert.throws(() => checkPushUrl("http://localhost:3000/hook"));
  });
});
