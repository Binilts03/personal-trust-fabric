#!/usr/bin/env node
// Run: node examples/pdp-server.mjs <storeDir> [port]
// Env: PTF_PDP_API_KEY (required) — the only PEP credential this reference knows.
//      PTF_PDP_PRINCIPAL (required) + PTF_PDP_ACTOR (required) — the fixed
//      verified identity every request on the key is evaluated as (ADR-0013).
//
// DEV-ONLY REFERENCE — not a product surface (no bin, not exported from the
// package). It speaks real AuthZEN 1.0 wire shapes over HTTP so a PEP can
// integrate without inventing a protocol, but production duties stay
// host-owned: TLS termination, real PEP auth (this checks one API key with a
// timing-safe compare and nothing else), rate limiting, logging/redaction,
// single-writer locking on the store, and port exposure. Binds 127.0.0.1
// only and refuses to start without an API key plus the mapped identity.
// Single endpoint: POST /access/v1/evaluation (boxcarred evaluations +
// search APIs are out of scope). Deny is 200 + {decision:false}; 401 means
// the PEP failed PDP auth, never a denied subject. Malformed bodies and
// request-subject mismatches against the mapped identity are 400 transport
// errors — fail-closed, never a decision.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { evaluateAuthZen, loadAuthority } from "../dist/src/index.js";

const dir = process.argv[2];
const portRaw = process.argv[3] ?? "0";
const apiKey = process.env["PTF_PDP_API_KEY"] ?? "";
const principal = process.env["PTF_PDP_PRINCIPAL"] ?? "";
const actor = process.env["PTF_PDP_ACTOR"] ?? "";
if (dir === undefined || dir.length === 0) {
  process.stderr.write(
    "usage: node examples/pdp-server.mjs <storeDir> [port]\n"
  );
  process.exit(2);
}
if (apiKey.length < 16) {
  process.stderr.write("pdp-server: set PTF_PDP_API_KEY (>= 16 chars) first\n");
  process.exit(2);
}
if (principal.length === 0 || actor.length === 0) {
  process.stderr.write(
    "pdp-server: set PTF_PDP_PRINCIPAL and PTF_PDP_ACTOR first\n"
  );
  process.exit(2);
}
const port = Number.parseInt(portRaw, 10);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write("pdp-server: port must be 0-65535\n");
  process.exit(2);
}

// Single-key ingress (ADR-0013): the API key authenticates, the env-mapped
// principal/actor is the verified identity. Key id is "default".
const ingress = {
  id: actor,
  principal,
  source: "api-key",
  proofRef: "default",
};

const MAX_BODY = 1_048_576; // 1 MiB — oversized payloads are a transport reject.

function authorized(header) {
  if (typeof header !== "string") return false;
  const m = /^Bearer (.+)$/.exec(header);
  if (m === null) return false;
  const presented = Buffer.from(m[1], "utf8");
  const expected = Buffer.from(apiKey, "utf8");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Request-subject equality: any present subject hint must equal the mapped
// identity, otherwise 400 "identity mismatch". Absent hints are fine
// (generic PEP): the mapped identity binds everything.
function subjectMatchesIdentity(body) {
  if (!isRecord(body)) return true;
  const subject = body["subject"];
  if (!isRecord(subject)) return true;
  const idHint = subject["id"];
  if (typeof idHint === "string" && idHint !== ingress.principal) return false;
  const props = subject["properties"];
  if (isRecord(props)) {
    const actorHint = props["actor"];
    if (typeof actorHint === "string" && actorHint !== ingress.id) return false;
  }
  return true;
}

// X-Request-ID echo: mirror a non-empty id of <=128 printable-ASCII chars
// for PEP correlation; drop anything else silently, never reflect it.
function echoRequestId(value) {
  if (typeof value !== "string") return undefined;
  if (value.length === 0 || value.length > 128) return undefined;
  if (!/^[\x20-\x7e]+$/.test(value)) return undefined;
  return value;
}

function json(res, status, body, requestId) {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": bytes.length,
    ...(requestId !== undefined ? { "x-request-id": requestId } : {}),
  });
  res.end(bytes);
}

const server = createServer((req, res) => {
  const requestId = echoRequestId(req.headers["x-request-id"]);
  if (req.url !== "/access/v1/evaluation") {
    json(res, 404, { error: "unknown endpoint" }, requestId);
    return;
  }
  if (req.method !== "POST") {
    json(res, 405, { error: "method not allowed" }, requestId);
    return;
  }
  if (!authorized(req.headers["authorization"])) {
    json(res, 401, { error: "unauthorized" }, requestId);
    return;
  }
  let size = 0;
  const chunks = [];
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("close", () => {
    if (!req.complete) {
      return;
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      json(res, 400, { error: "malformed body" }, requestId);
      return;
    }
    if (!subjectMatchesIdentity(body)) {
      json(res, 400, { error: "identity mismatch" }, requestId);
      return;
    }
    // Fresh load per request: revokes land without restarts (dev scale only;
    // production needs locking — the threat model calls last-write-wins a
    // deployment bug, and this reference does not fix that).
    let decision;
    try {
      const auth = loadAuthority(dir);
      decision = evaluateAuthZen(auth, body, ingress, {
        nowSec: Math.floor(Date.now() / 1000),
      });
    } catch {
      json(res, 400, { error: "malformed evaluation request" }, requestId);
      return;
    }
    json(
      res,
      200,
      { decision: decision.decision, context: decision.context },
      requestId
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  const actual = typeof addr === "object" && addr !== null ? addr.port : port;
  process.stdout.write(`PTF_PDP_LISTENING port=${actual}\n`);
});
