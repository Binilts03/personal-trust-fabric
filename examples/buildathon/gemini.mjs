// Gemini is an untrusted proposal source. This file owns no PTF authority,
// personal state, recipient keys, provider credentials or execution permissions.
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";
const TOOL = "propose_synthetic_email";
const DEFAULT_PROMPT = "A synthetic user requests the pre-approved demo message msg:buildathon-1 to provider:demo-mail. Propose that exact action; do not invent another recipient or message.";
const DECLARATION = {
  name: TOOL,
  description: "Propose a synthetic demo email action. This never sends a message or grants authority.",
  parameters: {
    type: "OBJECT",
    properties: {
      messageId: { type: "STRING", description: "Opaque reference msg:buildathon-1" },
      recipient: { type: "STRING", description: "Opaque provider handle provider:demo-mail" }
    },
    required: ["messageId", "recipient"]
  }
};

function invalid() {
  return new Error("invalid Gemini proposal; refused before PTF execution");
}

export function parseGeminiProposal(value) {
  const candidates = value?.candidates;
  if (!Array.isArray(candidates) || candidates.length !== 1) throw invalid();
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) throw invalid();
  const calls = parts.filter(part => part?.functionCall !== undefined);
  if (calls.length !== 1 || calls[0]?.functionCall?.name !== TOOL) throw invalid();
  const args = calls[0].functionCall.args;
  if (args === null || typeof args !== "object" || Array.isArray(args)) throw invalid();
  if (Object.keys(args).sort().join(",") !== "messageId,recipient") throw invalid();
  const { messageId, recipient } = args;
  if (typeof messageId !== "string" || !/^msg:[A-Za-z0-9_-]{1,60}$/.test(messageId) ||
      typeof recipient !== "string" || !/^provider:[a-z0-9_-]{1,80}$/.test(recipient)) throw invalid();
  return { messageId, recipient };
}

export async function proposeWithGemini({
  apiKey, prompt = DEFAULT_PROMPT, model = "gemini-2.5-flash",
  fetchImpl = fetch, timeoutMs = 15_000
} = {}) {
  if (typeof apiKey !== "string" || apiKey.length === 0)
    throw new Error("GEMINI_API_KEY is required for the live Gemini demo");
  if (typeof prompt !== "string" || prompt.length > 1024 ||
      !/^[a-zA-Z0-9_.-]+$/.test(model) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000)
    throw new Error("invalid Gemini demo configuration");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(ENDPOINT + model + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "You may only propose the described synthetic action. Do not request keys, permissions or real user data. The application must separately authorize any effect." }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ functionDeclarations: [DECLARATION] }],
        toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [TOOL] } }
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error("Gemini proposal request refused");
    const raw = await res.text();
    if (raw.length > 32_768) throw invalid();
    let json;
    try { json = JSON.parse(raw); } catch { throw invalid(); }
    return parseGeminiProposal(json);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Gemini proposal timed out");
    if (error?.message === "Gemini proposal request refused" ||
        error?.message === "invalid Gemini proposal; refused before PTF execution")
      throw error;
    throw new Error("Gemini proposal failed");
  } finally {
    clearTimeout(timer);
  }
}
