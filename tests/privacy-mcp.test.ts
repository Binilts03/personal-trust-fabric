import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveMcpPrivacyConfig,
  makeMcpPrivacyDisclosureGate,
  type AuthorityRequest,
  type VerifiedIdentity,
} from "../src/index.js";

const ingress: VerifiedIdentity = {
  id: "agent:1",
  principal: "principal:1",
  source: "local-registration",
  proofRef: "test",
};
const demand: AuthorityRequest = {
  principal: "principal:1",
  actor: "agent:1",
  action: { name: "/disclose" },
  resource: { type: "vault", id: "personal-state" },
  purpose: "support",
  context: { claims: ["email"], verifier: "seller:1" },
  termsDigest: "ab".repeat(32),
};

describe("MCP privacy host binding", () => {
  it("derives subject, controller, categories and recipient roles from trusted configuration", () => {
    const config = resolveMcpPrivacyConfig({
      dataPrincipalRef: "subject:opaque-1",
      controllerId: "acme",
      recipientRoles: { "seller:1": "third-party" },
    });
    const gate = makeMcpPrivacyDisclosureGate(config, ingress, demand);
    assert.equal(gate.processing.dataPrincipalRef, "subject:opaque-1");
    assert.equal(gate.processing.controllerId, "acme");
    assert.deepEqual(gate.processing.dataCategories, ["email"]);
    assert.deepEqual(gate.processing.recipients, [
      { id: "seller:1", role: "third-party" },
    ]);
    assert.equal(gate.operation.context["verifier"], "seller:1");
  });

  it("fails closed if the operator has not configured the recipient", () => {
    const config = resolveMcpPrivacyConfig({
      dataPrincipalRef: "subject:opaque-1",
      controllerId: "acme",
      recipientRoles: {},
    });
    assert.throws(
      () => makeMcpPrivacyDisclosureGate(config, ingress, demand),
      /privacy denied/
    );
  });

  it("rejects personal identifiers, arbitrary roles, and agent-authored privacy fields", () => {
    assert.throws(
      () => resolveMcpPrivacyConfig({
        dataPrincipalRef: "person@example.com",
        controllerId: "acme",
        recipientRoles: { "seller:1": "third-party" },
      }),
      /opaque/
    );
    assert.throws(
      () => resolveMcpPrivacyConfig({
        dataPrincipalRef: "subject:opaque-1",
        controllerId: "acme",
        recipientRoles: { "seller:1": "administrator" },
      }),
      /role/
    );
    assert.throws(
      () => resolveMcpPrivacyConfig({
        dataPrincipalRef: "subject:opaque-1",
        controllerId: "acme",
        recipientRoles: {},
        basisId: "made-up-by-agent",
      }),
      /unexpected/
    );
  });
});
