import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkAgentCard,
  assertSafeUrl,
  canonicalJcs,
  requestToDisclosureDemand,
  resolveSelector,
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

  it("resolveSelector denies prototype traversal (ticket 17)", () => {
    // `__proto__` / `constructor` / `prototype` never resolve, even though
    // every object inherits them — fail-closed, never inherited values.
    const obj = { amount: 10, nested: { currency: "INR" } };
    assert.deepEqual(resolveSelector(obj, ".__proto__"), { found: false });
    assert.deepEqual(resolveSelector(obj, ".constructor"), { found: false });
    assert.deepEqual(resolveSelector(obj, ".prototype"), { found: false });
    assert.deepEqual(resolveSelector(obj, ".nested.constructor"), {
      found: false,
    });
    // Ordinary own properties still resolve.
    assert.deepEqual(resolveSelector(obj, ".amount"), {
      found: true,
      value: 10,
    });
    // The deny-list wins even over own data: a bound path can never be
    // smuggled through an own `constructor` key.
    assert.deepEqual(
      resolveSelector({ constructor: "own-value" }, ".constructor"),
      { found: false }
    );
    assert.deepEqual(resolveSelector(obj, ".nested.currency"), {
      found: true,
      value: "INR",
    });
    assert.deepEqual(resolveSelector(obj, ".missing"), { found: false });
  });
});
