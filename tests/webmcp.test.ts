import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkToolRegistration,
  isExposedTo,
  markUntrusted,
  requiresConfirmation,
} from "../src/index.js";

const BASE = {
  description: "Post a comment",
  origin: "https://app.example.com",
};

describe("WebMCP edge guards (ptf-v03/01)", () => {
  it("rejects malformed tool registrations", () => {
    assert.throws(() =>
      checkToolRegistration({ ...BASE, name: "", origin: BASE.origin })
    );
    assert.throws(() =>
      checkToolRegistration({
        ...BASE,
        name: "a".repeat(129),
        origin: BASE.origin,
      })
    );
    assert.throws(() =>
      checkToolRegistration({ ...BASE, name: "has space", origin: BASE.origin })
    );
    assert.throws(() =>
      checkToolRegistration({
        ...BASE,
        name: "semi;colon",
        origin: BASE.origin,
      })
    );
    assert.throws(() =>
      checkToolRegistration({
        ...BASE,
        name: "ok-name",
        description: "",
        origin: BASE.origin,
      })
    );
    checkToolRegistration({
      ...BASE,
      name: "postComment_1.v2-ok",
      origin: BASE.origin,
    });
  });

  it("defaults to same-origin exposure and honors explicit grants", () => {
    const tool = {
      ...BASE,
      name: "postComment",
      origin: "https://app.example.com",
    };
    assert.equal(isExposedTo(tool, "https://app.example.com"), true);
    assert.equal(isExposedTo(tool, "https://evil.example.com"), false);
    const shared = { ...tool, exposedTo: ["https://agent.example.com"] };
    assert.equal(isExposedTo(shared, "https://agent.example.com"), true);
    assert.equal(isExposedTo(shared, "https://evil.example.com"), false);
    assert.throws(() =>
      checkToolRegistration({ ...tool, exposedTo: ["not-a-url"] })
    );
  });

  it("requires confirmation for consequential hints and marks outputs untrusted", () => {
    assert.equal(requiresConfirmation({ consequentialHint: true }), true);
    assert.equal(requiresConfirmation({ consequentialHint: false }), false);
    assert.equal(requiresConfirmation({}), false);
    assert.equal(requiresConfirmation(undefined), false);
    const out = markUntrusted("<script>steal()</script>");
    assert.equal(out.text, "<script>steal()</script>");
    assert.equal((out as { __untrusted?: boolean }).__untrusted, true);
  });
});
