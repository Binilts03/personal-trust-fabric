#!/usr/bin/env node
/**
 * Production-capable PTF PDP bin (ticket 13).
 *
 * READ-ONLY evaluation: every request reloads authority via `loadAuthority`
 * and decides via `evaluateAuthZen` WITHOUT `consume` — this process NEVER
 * writes to the store (no `saveAuthority`, no audit append, no use-count
 * mutation). The server therefore cannot race itself; concurrent requests
 * share nothing but per-key rate buckets. Mutations stay CLI/single-writer
 * (see `src/cli.ts` + the single-writer ceiling in `src/store/files.ts`).
 * Revokes land without restart because state is reloaded per request.
 *
 * TLS: the server refuses to start without `PTF_PDP_TLS_KEY` +
 * `PTF_PDP_TLS_CERT` unless `PTF_PDP_ALLOW_PLAINTEXT=1` (loopback tests
 * only). Reason: PEP credentials are bearer keys — over plaintext HTTP any
 * network observer steals them and replays decisions as the victim PEP.
 * Termination in-process keeps the default closed; external terminators are
 * a host decision and must preserve that property.
 *
 * RATE LIMITING: in-memory token bucket per key id, lazy interval refill
 * (`tokens += elapsed * rpm / 60000`, capped at `rpm`). Buckets are
 * PER-PROCESS: N replicas allow ~N×RPM. Real deployments needing a global
 * cap must share state (gateway quota / Redis cell) — host duty. Ticket 14
 * should decide whether that shared limiter lives in front of this bin.
 *
 * LOGGING: one structured JSON line per DECISION to stdout —
 * `{ at, keyId, decision, reason?, authorityId? }` (citations are reduced to
 * their `authorityId`; digests would be equally fine). The key id identifies
 * the PEP; the key NEVER appears. Request bodies are NEVER echoed (they may
 * carry amounts/recipients/context an attacker could mine from logs), nor
 * are secrets, TLS material, or digests-as-proof. Transport errors
 * (401/404/405/400/413/429/500) log nothing — only `evaluateAuthZen`
 * verdicts do, so a log line always means a decision happened.
 *
 * DEV REFERENCE: `examples/pdp-server.mjs` is the loopback AuthZEN-shape
 * reference (single API key mapped to a configured identity — same ingress
 * model as here). This bin is the production-shaped sibling:
 * multi-key auth, mandatory TLS, per-key rate limits, read-only discipline.
 */
import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { evaluateAuthZen } from "./adapters/authzen.js";
import type { AuthZenEvaluationRequest } from "./adapters/authzen.js";
import type { VerifiedIdentity } from "./core/authority.js";
import { loadAuthority } from "./store/files.js";

interface PdpKey {
  readonly id: string;
  readonly key: string;
  /** Verified principal every request on this key is evaluated as. */
  readonly principal: string;
  /** Verified actor every request on this key is evaluated as. */
  readonly actor: string;
}

interface Bucket {
  tokens: number;
  last: number;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
  throw new Error(message);
}

function requiredEnv(name: string): string {
  const value: string | undefined = process.env[name];
  if (value === undefined || value.length === 0) {
    fail(`pdp-server: ${name} is required`);
  }
  return value;
}

function parsePort(raw: string): number {
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    fail("pdp-server: PTF_PDP_PORT must be 0-65535");
  }
  return port;
}

function parsePositiveInt(raw: string, name: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n <= 0) {
    fail(`pdp-server: ${name} must be a positive integer`);
  }
  return n;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadKeys(file: string): readonly PdpKey[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    fail(`pdp-server: cannot read PTF_PDP_KEYS_FILE: ${file}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    fail(`pdp-server: PTF_PDP_KEYS_FILE is not valid JSON: ${file}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail(
      "pdp-server: PTF_PDP_KEYS_FILE must be a non-empty JSON array [{id,key,principal,actor}]"
    );
  }
  const out: PdpKey[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      fail(
        "pdp-server: PTF_PDP_KEYS_FILE entries must be {id,key,principal,actor} objects"
      );
    }
    const id: unknown = entry["id"];
    const key: unknown = entry["key"];
    const principal: unknown = entry["principal"];
    const actor: unknown = entry["actor"];
    if (typeof id !== "string" || id.length === 0) {
      fail("pdp-server: every keys-file entry needs a non-empty string id");
    }
    if (typeof key !== "string" || key.length < 16) {
      fail("pdp-server: every keys-file key must be a string >= 16 chars");
    }
    if (typeof principal !== "string" || principal.length === 0) {
      fail(
        "pdp-server: every keys-file entry needs a non-empty string principal"
      );
    }
    if (typeof actor !== "string" || actor.length === 0) {
      fail("pdp-server: every keys-file entry needs a non-empty string actor");
    }
    out.push({ id, key, principal, actor });
  }
  const seen = new Set<string>();
  for (const k of out) {
    if (seen.has(k.id)) {
      fail(`pdp-server: duplicate key id in keys file: ${k.id}`);
    }
    seen.add(k.id);
  }
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function findKey(header: unknown, keys: readonly PdpKey[]): PdpKey | null {
  if (typeof header !== "string") return null;
  const m = /^Bearer (.+)$/.exec(header);
  if (m === null) return null;
  const presented: string | undefined = m[1];
  if (presented === undefined || presented.length === 0) return null;
  for (const k of keys) {
    if (safeEqual(presented, k.key)) return k;
  }
  return null;
}

/**
 * Request-subject equality (ADR-0013): the API key maps to a fixed verified
 * identity, so any present subject hints must equal it — otherwise 400
 * "identity mismatch" (fail-closed, never evaluated). Absent hints are fine
 * (generic PEP): the mapped identity binds everything.
 */
function subjectMatchesIdentity(
  body: unknown,
  ingress: VerifiedIdentity
): boolean {
  if (!isRecord(body)) return true;
  const subject: unknown = body["subject"];
  if (!isRecord(subject)) return true;
  const idHint: unknown = subject["id"];
  if (typeof idHint === "string" && idHint !== ingress.principal) return false;
  const props: unknown = subject["properties"];
  if (isRecord(props)) {
    const actorHint: unknown = props["actor"];
    if (typeof actorHint === "string" && actorHint !== ingress.id) return false;
  }
  return true;
}

/**
 * X-Request-ID echo: a non-empty request id of ≤128 printable-ASCII chars
 * is mirrored on the response for PEP correlation. Anything else (absent,
 * empty, over-long, non-printable) is silently dropped — never reflected.
 */
function echoRequestId(value: unknown): Record<string, string> {
  if (typeof value !== "string") return {};
  if (value.length === 0 || value.length > 128) return {};
  if (!/^[\x20-\x7e]+$/.test(value)) return {};
  return { "x-request-id": value };
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra?: Record<string, string>
): void {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": bytes.length,
    ...(extra ?? {}),
  });
  res.end(bytes);
}

function main(): void {
  const storeDir = requiredEnv("PTF_PDP_STORE_DIR");
  const keysFile = requiredEnv("PTF_PDP_KEYS_FILE");
  const keys = loadKeys(keysFile);
  const portRaw: string | undefined = process.env["PTF_PDP_PORT"];
  const port =
    portRaw === undefined || portRaw.length === 0 ? 0 : parsePort(portRaw);
  const rpmRaw: string | undefined = process.env["PTF_PDP_RPM"];
  const rpm =
    rpmRaw === undefined || rpmRaw.length === 0
      ? 60
      : parsePositiveInt(rpmRaw, "PTF_PDP_RPM");
  const maxBodyRaw: string | undefined = process.env["PTF_PDP_MAX_BODY"];
  const maxBody =
    maxBodyRaw === undefined || maxBodyRaw.length === 0
      ? 1_048_576
      : parsePositiveInt(maxBodyRaw, "PTF_PDP_MAX_BODY");
  const allowPlaintext = process.env["PTF_PDP_ALLOW_PLAINTEXT"] === "1";

  const buckets = new Map<string, Bucket>();

  const checkRate = (
    keyId: string,
    now: number
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly retryAfterSec: number } => {
    let b = buckets.get(keyId);
    if (b === undefined) {
      b = { tokens: rpm, last: now };
      buckets.set(keyId, b);
    }
    const elapsed = Math.max(0, now - b.last);
    b.tokens = Math.min(rpm, b.tokens + (elapsed * rpm) / 60000);
    b.last = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true };
    }
    const deficit = 1 - b.tokens;
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((deficit * 60000) / rpm / 1000)),
    };
  };

  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    const rid = echoRequestId(req.headers["x-request-id"]);
    if (req.url !== "/access/v1/evaluation") {
      sendJson(res, 404, { error: "unknown endpoint" }, rid);
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method not allowed" }, rid);
      return;
    }
    const entry = findKey(req.headers["authorization"], keys);
    if (entry === null) {
      sendJson(res, 401, { error: "unauthorized" }, rid);
      return;
    }
    const keyId = entry.id;
    // API key → verified ingress (ADR-0013): the key is the authentication,
    // the keys-file principal/actor is the identity. Callers cannot choose.
    const ingress: VerifiedIdentity = {
      id: entry.actor,
      principal: entry.principal,
      source: "api-key",
      proofRef: entry.id,
    };
    const rl = checkRate(keyId, Date.now());
    if (!rl.ok) {
      sendJson(
        res,
        429,
        { error: "rate limited" },
        { ...rid, "retry-after": String(rl.retryAfterSec) }
      );
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    let responded = false;
    req.on("data", (chunk: Buffer) => {
      if (responded) return;
      size += chunk.length;
      if (size > maxBody) {
        responded = true;
        try {
          sendJson(res, 413, { error: "body too large" }, rid);
        } catch {
          // Response already on its way out; destroy is the point.
        }
        try {
          req.destroy();
        } catch {
          // Already torn down.
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (responded) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      } catch {
        sendJson(res, 400, { error: "malformed body" }, rid);
        return;
      }
      if (!subjectMatchesIdentity(parsed, ingress)) {
        sendJson(res, 400, { error: "identity mismatch" }, rid);
        return;
      }
      let auth;
      try {
        auth = loadAuthority(storeDir);
      } catch {
        sendJson(res, 500, { error: "authority unavailable" }, rid);
        return;
      }
      let decision;
      try {
        decision = evaluateAuthZen(
          auth,
          parsed as AuthZenEvaluationRequest,
          ingress,
          {
            nowSec: Math.floor(Date.now() / 1000),
          }
        );
      } catch {
        sendJson(res, 400, { error: "malformed evaluation request" }, rid);
        return;
      }
      sendJson(
        res,
        200,
        { decision: decision.decision, context: decision.context },
        rid
      );
      const ctx: Record<string, unknown> = isRecord(decision.context)
        ? decision.context
        : {};
      let reason: string | undefined;
      let authorityId: string | undefined;
      const reasonRaw: unknown = ctx["reason"];
      if (typeof reasonRaw === "string") reason = reasonRaw;
      const authIdRaw: unknown = ctx["authorityId"];
      if (typeof authIdRaw === "string") authorityId = authIdRaw;
      if (decision.decision === true) {
        const citRaw: unknown = ctx["citations"];
        if (Array.isArray(citRaw)) {
          const first: unknown = citRaw[0];
          if (isRecord(first)) {
            const aid: unknown = first["authorityId"];
            if (typeof aid === "string") authorityId = aid;
          }
        }
      }
      process.stdout.write(
        `${JSON.stringify({
          at: new Date().toISOString(),
          keyId,
          decision: decision.decision,
          ...(reason !== undefined ? { reason } : {}),
          ...(authorityId !== undefined ? { authorityId } : {}),
        })}\n`
      );
    });
    req.on("error", () => {
      if (responded) return;
      responded = true;
      try {
        sendJson(res, 400, { error: "malformed body" }, rid);
      } catch {
        // Socket already gone.
      }
    });
  };

  const onListening = (address: unknown): void => {
    const actual =
      typeof address === "object" && address !== null && "port" in address
        ? (address as { readonly port: number }).port
        : port;
    process.stdout.write(`PTF_PDP_LISTENING port=${actual}\n`);
  };

  if (allowPlaintext) {
    const server = createHttpServer(listener);
    server.listen(port, "127.0.0.1", () => {
      onListening(server.address());
    });
    return;
  }
  const keyPath: string | undefined = process.env["PTF_PDP_TLS_KEY"];
  const certPath: string | undefined = process.env["PTF_PDP_TLS_CERT"];
  if (
    keyPath === undefined ||
    keyPath.length === 0 ||
    certPath === undefined ||
    certPath.length === 0
  ) {
    fail(
      "pdp-server: refusing to start without TLS — set PTF_PDP_TLS_KEY + PTF_PDP_TLS_CERT, or PTF_PDP_ALLOW_PLAINTEXT=1 for loopback tests only"
    );
  }
  let key: Buffer;
  let cert: Buffer;
  try {
    key = readFileSync(keyPath);
    cert = readFileSync(certPath);
  } catch {
    fail("pdp-server: cannot read TLS key/cert files");
  }
  const server = createHttpsServer({ key, cert }, listener);
  server.listen(port, "127.0.0.1", () => {
    onListening(server.address());
  });
}

if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("pdp-server.js")
) {
  main();
}
