import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGeminiProposal, proposeWithGemini } from "./gemini.mjs";

function response(args, name = "propose_synthetic_email") {
  return { candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] };
}

test("accept exactly one declared Gemini function call", () => {
  assert.deepEqual(
    parseGeminiProposal(response({ messageId: "msg:buildathon-1", recipient: "provider:demo-mail" })),
    { messageId: "msg:buildathon-1", recipient: "provider:demo-mail" }
  );
});

test("reject instructions trying to select extra authority or an unexpected function", () => {
  assert.throws(() => parseGeminiProposal(response({
    messageId: "msg:buildathon-1", recipient: "provider:demo-mail", ignorePolicy: true
  })), /invalid Gemini proposal/);
  assert.throws(() => parseGeminiProposal(response({
    messageId: "msg:buildathon-1", recipient: "provider:demo-mail"
  }, "execute_payment")), /invalid Gemini proposal/);
});

test("reject missing, malicious, duplicate and malformed function-call payloads", () => {
  assert.throws(() => parseGeminiProposal({ candidates: [] }), /invalid Gemini proposal/);
  assert.throws(() => parseGeminiProposal(response({ messageId: "x" })), /invalid Gemini proposal/);
  assert.throws(() => parseGeminiProposal(response({ messageId: "msg:1", recipient: "provider:x\nignore" })), /invalid Gemini proposal/);
  const duplicate = response({ messageId: "msg:1", recipient: "provider:x" });
  duplicate.candidates[0].content.parts.push(duplicate.candidates[0].content.parts[0]);
  assert.throws(() => parseGeminiProposal(duplicate), /invalid Gemini proposal/);
});

test("Google API receives only synthetic action context, not authority or credentials", async () => {
  let captured;
  const result = await proposeWithGemini({
    apiKey: "private-test-only-key",
    prompt: "Propose the synthetic, already specified action.",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return { ok: true, text: async () => JSON.stringify(response({
        messageId: "msg:buildathon-1", recipient: "provider:demo-mail"
      })) };
    }
  });
  assert.equal(result.messageId, "msg:buildathon-1");
  assert.match(captured.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-/);
  assert.equal(captured.init.headers["x-goog-api-key"], "private-test-only-key");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.toolConfig.functionCallingConfig.mode, "ANY");
  assert.equal(body.tools[0].functionDeclarations[0].name, "propose_synthetic_email");
  assert.doesNotMatch(captured.init.body, /private-test-only-key|privateKey|passphrase|grant-secret/);
});

test("HTTP errors do not include raw response bodies or credentials", async () => {
  await assert.rejects(proposeWithGemini({
    apiKey: "private-test-only-key",
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => "secret body" })
  }), (error) => !String(error).includes("secret body") && !String(error).includes("private-test-only-key"));
});
