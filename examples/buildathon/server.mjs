// Synthetic-only Cloud Run presentation endpoint. Cloud Run IAM MUST enforce
// authentication; this app is not a public/multi-tenant authority service.
import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function respond(res, code, data) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(data));
}

export function createDemoServer({ runDemo, hasApiKey } = {}) {
  const ready = hasApiKey ?? (() => Boolean(process.env.GEMINI_API_KEY));
  const run = runDemo ?? (async () => {
    const { runScenario } = await import("./demo.mjs");
    return runScenario({ mode: "gemini" });
  });
  let inFlight = false;
  return createHttpServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      return respond(res, 200, { status: "ok", scope: "synthetic-only" });
    }
    if (req.url !== "/demo") return respond(res, 404, { error: "not-found" });
    if (req.method !== "POST") return respond(res, 405, { error: "method-not-allowed" });
    if (!ready()) return respond(res, 503, { error: "gemini-not-configured" });
    if (inFlight) return respond(res, 429, { error: "synthetic-demo-busy" });
    // No user-supplied documents, messages, instructions or personal data.
    let bodyBytes = 0;
    try {
      for await (const chunk of req) {
        bodyBytes += chunk.length;
        if (bodyBytes > 0) return respond(res, 413, { error: "request-body-forbidden" });
      }
      inFlight = true;
      const result = await run();
      // Explicit allowlist: no keys, full provider objects, model transcript or PII.
      return respond(res, 200, {
        outcome: result.outcome, mode: "gemini",
        providerCalls: result.providerCalls, authorityUses: result.authorityUses,
        ...(result.receipt ? {
          receipt: { receiptId: result.receipt.receiptId, termsDigest: result.receipt.termsDigest }
        } : {})
      });
    } catch {
      return respond(res, 502, { error: "synthetic-demo-failed" });
    } finally {
      inFlight = false;
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? "8080");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    console.error("invalid PORT");
    process.exit(2);
  }
  const server = createDemoServer();
  server.listen(port, "0.0.0.0", () => console.log("synthetic demo service listening"));
}
