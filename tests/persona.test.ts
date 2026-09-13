import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assembleCapsule, renderAgentView } from "../src/index.js";

const SENTINEL = "PAN-SECRET-never-leaves-host-4111";

describe("Persona Capsule + Agent-safe view (v04/01)", () => {
  it("drops non-allow-listed fields; sentinel never appears in output", () => {
    const capsule = assembleCapsule(
      {
        attributes: {
          need: "pharmacy-directions",
          pan: SENTINEL,
          income: 900000,
        },
      },
      "buy-medicine",
      ["need"]
    );
    assert.deepEqual(capsule.claims, { need: "pharmacy-directions" });
    const view = renderAgentView(
      capsule,
      [{ proposal: "p" }],
      [{ receipt: "r" }]
    );
    const blob = JSON.stringify(view);
    assert.ok(!blob.includes(SENTINEL));
    assert.ok(!blob.includes("income"));
  });

  it("rejects empty purpose, empty allow-list, and over-request gracefully", () => {
    assert.throws(
      () => assembleCapsule({ attributes: { a: 1 } }, "", ["a"]),
      /purpose/
    );
    assert.throws(
      () => assembleCapsule({ attributes: { a: 1 } }, "p", []),
      /allow-list/
    );
    const capsule = assembleCapsule({ attributes: { a: 1 } }, "p", [
      "a",
      "missing",
    ]);
    assert.deepEqual(capsule.claims, { a: 1 });
  });
});
