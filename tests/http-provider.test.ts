import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHttpProvider, canonicalize } from "../src/index.js";

/**
 * The HTTP provider transport against a REAL local server (node:http,
 * ephemeral port). The point of these tests is the wire: what the adapter
 * puts on it, what it refuses, and what it never does (invent a success,
 * print a body, carry a secret, follow a redirect).
 */

const CAPABILITY_ID = "cid-http-0001";
const TERMS_DIGEST = "ab".repeat(32);
const HOST_SECRET = "sk_live_host_side_only_never_in_the_body";

interface Captured {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

async function startServer(
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
    body: string
  ) => void | Promise<void>
): Promise<{
  url: string;
  requests: Captured[];
  close: () => Promise<void>;
}> {
  const requests: Captured[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      });
      void handler(req, res, body);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

function terms() {
  return {
    capabilityId: CAPABILITY_ID,
    termsDigest: TERMS_DIGEST,
    action: "/pay" as const,
    recipient: "did:test:merchant",
    resource: "invoice:7",
    purpose: "widgets",
    context: { amount: 500, currency: "INR", panRef: "r-pan" },
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("http provider transport (signed JSON over HTTP)", () => {
  it("sends exactly the authorized terms plus the binding, and the signed headers", async () => {
    const key = "host-hmac-key";
    const server = await startServer((req, res, body) => {
      // The server verifies the signature over the bytes it received: the
      // signed material IS the canonical body.
      const expected = createHmac("sha256", key).update(body).digest("hex");
      assert.equal(
        req.headers["x-ptf-signature"],
        expected,
        "server could not verify the signature"
      );
      json(res, 200, { id: "pi_123", status: "captured" });
    });
    try {
      const seen: { body?: unknown; canonical?: string } = {};
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: (body, canonical) => {
          seen.body = body;
          seen.canonical = canonical;
          return {
            authorization: `Bearer ${HOST_SECRET}`,
            "x-ptf-signature": createHmac("sha256", key)
              .update(canonical)
              .digest("hex"),
          };
        },
        interpret: (response) => ({
          externalRef: response["id"] as string,
          detail: { status: response["status"] },
        }),
        timeoutMs: 2000,
        nowSec: () => 1_700_000_000,
      });

      const sub = await provider.submit(terms());

      assert.equal(server.requests.length, 1);
      const sent = server.requests[0] as Captured;
      assert.equal(sent.method, "POST");
      assert.equal(sent.url, "/v1/payments");
      assert.equal(
        sent.headers["authorization"],
        `Bearer ${HOST_SECRET}`,
        "the host's signed headers must be sent"
      );
      assert.equal(
        sent.headers["x-ptf-signature"],
        createHmac("sha256", key).update(sent.body).digest("hex")
      );
      assert.equal(sent.headers["content-type"], "application/json");

      // The body carries the authorized terms and the two binding fields.
      // Nothing else: no secret, no extra effect-bearing key.
      const parsed = JSON.parse(sent.body) as Record<string, unknown>;
      assert.deepEqual(parsed, {
        amount: 500,
        currency: "INR",
        panRef: "r-pan",
        capabilityId: CAPABILITY_ID,
        termsDigest: TERMS_DIGEST,
      });
      assert.equal(sent.body.includes(HOST_SECRET), false);
      assert.equal(sent.body.includes("sk_live"), false);
      assert.equal(
        sent.body,
        canonicalize(parsed),
        "the body must be the canonical form the host signed"
      );
      assert.deepEqual(seen.body, parsed);
      assert.equal(seen.canonical, sent.body);

      assert.equal(sub.kind, "payment");
      assert.equal(sub.externalRef, "pi_123");
      assert.equal(sub.capabilityId, CAPABILITY_ID);
      assert.equal(sub.termsDigest, TERMS_DIGEST);
      assert.equal(sub.at, 1_700_000_000);
    } finally {
      await server.close();
    }
  });

  it("sends the terms digest as the idempotency key, and the host may override it", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: (response) => ({ externalRef: response["id"] as string }),
        timeoutMs: 2000,
      });
      await provider.submit(terms());
      assert.equal(
        (server.requests[0] as Captured).headers["idempotency-key"],
        TERMS_DIGEST
      );

      const overridden = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: (response) => ({ externalRef: response["id"] as string }),
        idempotencyKey: "host-key-1",
        timeoutMs: 2000,
      });
      await overridden.submit(terms());
      assert.equal(
        (server.requests[1] as Captured).headers["idempotency-key"],
        "host-key-1"
      );
    } finally {
      await server.close();
    }
  });

  it("a 500 response is a failed effect", async () => {
    const server = await startServer((_req, res) => {
      json(res, 500, { error: "boom" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /unexpected status 500/
      );
    } finally {
      await server.close();
    }
  });

  it("a malformed JSON body is a failed effect", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("<html>not json</html>");
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 2000,
      });
      await assert.rejects(() => provider.submit(terms()), /not JSON/);
    } finally {
      await server.close();
    }
  });

  it("a missing externalRef is a failed effect", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "" }),
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /no usable externalRef/
      );
    } finally {
      await server.close();
    }
  });

  it("an interpreter that throws is a failed effect", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => {
          throw new Error("terms do not match the receipt");
        },
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /terms do not match the receipt/
      );
    } finally {
      await server.close();
    }
  });

  it("a refused attestation is a failed effect", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "pi_123" }),
        verifyAttestation: (response, expected) =>
          response["capabilityId"] === expected.capabilityId
            ? { ok: true }
            : { ok: false, reason: "capability id mismatch" },
        timeoutMs: 2000,
      });
      await assert.rejects(
        () =>
          provider.submit({
            ...terms(),
            capabilityId: "cid-http-other",
          }),
        /attestation failed: capability id mismatch/
      );
    } finally {
      await server.close();
    }
  });

  it("a network error is a failed effect", async () => {
    const server = await startServer(() => {});
    const dead = server.url;
    await server.close();
    const provider = createHttpProvider({
      kind: "payment",
      url: `${dead}/v1/payments`,
      allowInsecureHttp: true,
      sign: () => ({ authorization: "Bearer t" }),
      interpret: () => ({ externalRef: "should-never-happen" }),
      timeoutMs: 2000,
    });
    await assert.rejects(() => provider.submit(terms()), /request failed/);
  });

  it("a timeout is a failed effect", async () => {
    const server = await startServer(() => {
      // Never answers: the adapter's timeout must end the call.
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 60,
      });
      await assert.rejects(() => provider.submit(terms()), /timed out/);
    } finally {
      await server.close();
    }
  });

  it("a redirect is refused, not followed", async () => {
    const server = await startServer((req, res) => {
      if (req.url === "/v1/payments") {
        res.writeHead(302, { location: "/v1/elsewhere" });
        res.end();
        return;
      }
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 2000,
      });
      await assert.rejects(() => provider.submit(terms()), /request failed/);
      assert.equal(
        server.requests.length,
        1,
        "the redirect target must never be requested"
      );
    } finally {
      await server.close();
    }
  });

  it("verify rejects a submission whose capability id or terms digest do not match", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: (response) => ({ externalRef: response["id"] as string }),
        timeoutMs: 2000,
      });
      const sub = await provider.submit(terms());
      assert.equal(
        provider.verify(sub, {
          capabilityId: CAPABILITY_ID,
          termsDigest: TERMS_DIGEST,
        }).ok,
        true
      );
      assert.equal(
        provider.verify(sub, {
          capabilityId: "cid-http-other",
          termsDigest: TERMS_DIGEST,
        }).ok,
        false
      );
      assert.equal(
        provider.verify(sub, {
          capabilityId: CAPABILITY_ID,
          termsDigest: "cd".repeat(32),
        }).ok,
        false
      );
    } finally {
      await server.close();
    }
  });

  it("never logs the response body", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123", secretish: "sensitive-payload" });
    });
    const lines: string[] = [];
    const original = {
      log: console.log,
      error: console.error,
      warn: console.warn,
    };
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: (response) => ({ externalRef: response["id"] as string }),
        timeoutMs: 2000,
      });
      await provider.submit(terms());
    } finally {
      console.log = original.log;
      console.error = original.error;
      console.warn = original.warn;
      await server.close();
    }
    assert.deepEqual(lines, []);
  });

  it("honours the PUT method and the host's static headers", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "travel",
        url: `${server.url}/v1/bookings`,
        allowInsecureHttp: true,
        method: "PUT",
        headers: { "x-api-version": "2026-10-01" },
        sign: () => ({ authorization: "Bearer t" }),
        interpret: (response) => ({ externalRef: response["id"] as string }),
        timeoutMs: 2000,
      });
      const sub = await provider.submit({
        ...terms(),
        action: "/book",
        context: { seat: "12A" },
      });
      const sent = server.requests[0] as Captured;
      assert.equal(sent.method, "PUT");
      assert.equal(sent.headers["x-api-version"], "2026-10-01");
      assert.equal(sub.kind, "travel");
    } finally {
      await server.close();
    }
  });

  it("refuses a header value with a CR or LF", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer ok\r\nX-Injected: 1" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /invalid header value/
      );
      assert.equal(server.requests.length, 0);
    } finally {
      await server.close();
    }
  });

  it("refuses a header name with a colon", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ "x-bad:name": "value" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /invalid header name/
      );
      assert.equal(server.requests.length, 0);
    } finally {
      await server.close();
    }
  });

  it("refuses an oversized header value", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ "x-long": "v".repeat(5000) }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /header value too long/
      );
      assert.equal(server.requests.length, 0);
    } finally {
      await server.close();
    }
  });

  it("refuses a host-supplied content type", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        headers: { "Content-Type": "text/plain" },
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /the adapter sets the content type/
      );
      assert.equal(server.requests.length, 0);
    } finally {
      await server.close();
    }
  });

  it("refuses a context that carries a binding field", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 2000,
      });
      await assert.rejects(
        () =>
          provider.submit({
            ...terms(),
            context: { amount: 500, capabilityId: "spoofed" },
          }),
        /must not carry capabilityId/
      );
      await assert.rejects(
        () =>
          provider.submit({
            ...terms(),
            context: { amount: 500, termsDigest: "spoofed" },
          }),
        /must not carry termsDigest/
      );
      assert.equal(server.requests.length, 0);
    } finally {
      await server.close();
    }
  });

  it("checkRequest rejects a short capability id on the direct-call path", async () => {
    const server = await startServer((_req, res) => {
      json(res, 200, { id: "pi_123" });
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 2000,
      });
      await assert.rejects(
        () => provider.submit({ ...terms(), capabilityId: "short" }),
        /capabilityId required/
      );
      await assert.rejects(
        () => provider.submit({ ...terms(), termsDigest: "ab" }),
        /termsDigest required/
      );
      assert.equal(server.requests.length, 0);
    } finally {
      await server.close();
    }
  });

  it("refuses an oversized response body", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "pi_123", pad: "x".repeat(1_500_000) }));
    });
    try {
      const provider = createHttpProvider({
        kind: "payment",
        url: `${server.url}/v1/payments`,
        allowInsecureHttp: true,
        sign: () => ({ authorization: "Bearer t" }),
        interpret: () => ({ externalRef: "should-never-happen" }),
        timeoutMs: 5000,
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /response body exceeds/
      );
    } finally {
      await server.close();
    }
  });

  it("refuses an http endpoint unless the host opts in", () => {
    assert.throws(
      () =>
        createHttpProvider({
          kind: "payment",
          url: "http://example.invalid/v1/payments",
          sign: () => ({ authorization: "Bearer t" }),
          interpret: () => ({ externalRef: "x" }),
        }),
      /must be https/
    );
    assert.throws(
      () =>
        createHttpProvider({
          kind: "payment",
          url: "ftp://example.invalid/v1/payments",
          sign: () => ({ authorization: "Bearer t" }),
          interpret: () => ({ externalRef: "x" }),
        }),
      /must be https/
    );
  });
});
