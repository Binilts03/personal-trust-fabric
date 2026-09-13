import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkAgentCard,
  assertSafeUrl,
  canonicalJcs,
  requestToDisclosureDemand,
} from "../src/index.js";

describe("adapter hardening round (v04/06)", () => {
  it("rejects userinfo URLs, jku cards, lone surrogates, claim_sets, mdoc", () => {
    assert.throws(
      () => assertSafeUrl("https://user:pass@example.com/", "t"),
      /userinfo/
    );
    assert.throws(
      () =>
        checkAgentCard({
          name: "n",
          description: "d",
          version: "1",
          supportedInterfaces: [
            {
              url: "https://a.example.com/",
              protocolBinding: "x",
              protocolVersion: "1",
            },
          ],
          provider: { organization: "o" },
          defaultInputModes: ["text"],
          defaultOutputModes: ["text"],
          skills: [{ id: "s", name: "n", description: "d" }],
          jku: "https://evil.example/keys",
        }),
      /jku/i
    );
    assert.throws(() => canonicalJcs("lone-\ud800-surrogate"), /surrogate/);
    assert.throws(
      () =>
        requestToDisclosureDemand(
          {
            response_type: "vp_token",
            client_id: "redirect_uri:https://v.example.com/cb",
            response_mode: "fragment",
            nonce: "0123456789abcdef",
            dcql_query: {
              credentials: [{ id: "c", format: "mso_mdoc", claims: [] }],
              claim_sets: [[{ id: "c" }]],
            },
          },
          { allowed: ["redirect_uri"] }
        ),
      /claim_sets|mdoc/
    );
  });
});
