import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createX402Provider, type X402Challenge } from "../src/index.js";

/**
 * The 402 agent-payment transport against a REAL local server (node:http,
 * ephemeral port), speaking x402 Protocol Version 2:
 * `PAYMENT-REQUIRED` (challenge), `PAYMENT-SIGNATURE` (payment),
 * `PAYMENT-RESPONSE` (settlement). No `X-` prefix, no `X-PAYMENT`,
 * no `WWW-Authenticate`.
 *
 * The refusals matter most here: a challenge for another amount, another
 * network, another scheme, a failed settlement, a missing transaction —
 * none of them may reach a payment.
 */

const CAPABILITY_ID = "cid-x402-0001";
const TERMS_DIGEST = "cd".repeat(32);
const AUTHORIZED_AMOUNT = "10000";
const AUTHORIZED_NETWORK = "eip155:84532";
const PAYEE = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

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

/** One `accepts` entry of a v2 `PaymentRequired`. */
function accept(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    scheme: "exact",
    network: AUTHORIZED_NETWORK,
    amount: AUTHORIZED_AMOUNT,
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: PAYEE,
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  };
}

/** The v2 challenge, base64 JSON in the `PAYMENT-REQUIRED` header. */
function paymentRequired(accepts: unknown[], resource: string): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      error: "PAYMENT-SIGNATURE header is required",
      resource: {
        url: resource,
        description: "premium data",
        mimeType: "application/json",
      },
      accepts,
      extensions: {},
    }),
    "utf8"
  ).toString("base64");
}

/** The v2 settlement, base64 JSON in the `PAYMENT-RESPONSE` header. */
function paymentResponse(overrides: Record<string, unknown> = {}): string {
  return Buffer.from(
    JSON.stringify({
      success: true,
      transaction: "0x1234567890abcdef",
      network: AUTHORIZED_NETWORK,
      payer: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
      ...overrides,
    }),
    "utf8"
  ).toString("base64");
}

function terms() {
  return {
    capabilityId: CAPABILITY_ID,
    termsDigest: TERMS_DIGEST,
    action: "/pay" as const,
    recipient: PAYEE,
    resource: "dataset:7",
    purpose: "research",
    context: {
      amount: 10000,
      currency: "USDC",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      network: AUTHORIZED_NETWORK,
      scheme: "exact",
    },
  };
}

function providerOptions(
  serverUrl: string,
  settle: (challenge: X402Challenge) => Promise<{
    payload: Record<string, unknown>;
    amount?: string;
    network?: string;
    reference?: string;
  }>
) {
  return {
    url: `${serverUrl}/v1/data`,
    authorizedAmount: AUTHORIZED_AMOUNT,
    authorizedNetwork: AUTHORIZED_NETWORK,
    settle,
    timeoutMs: 2000,
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("x402 provider transport (HTTP 402 agent payment, protocol v2)", () => {
  it("settles once, retries once with PAYMENT-SIGNATURE, and returns the transaction", async () => {
    let baseUrl = "";
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], `${baseUrl}/v1/data`),
        });
        res.end(JSON.stringify({ error: "payment required" }));
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse(),
      });
      res.end("{}");
    });
    baseUrl = server.url;
    try {
      const challenges: X402Challenge[] = [];
      const provider = createX402Provider(
        providerOptions(server.url, async (challenge) => {
          challenges.push(challenge);
          return {
            payload: {
              signature: "0x2d6a75",
              authorization: {
                from: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
                to: PAYEE,
                value: AUTHORIZED_AMOUNT,
                validAfter: "1740672089",
                validBefore: "1740672154",
                nonce: "0xf374",
              },
            },
          };
        })
      );

      const sub = await provider.submit(terms());

      assert.equal(server.requests.length, 2, "one challenge, one retry");
      const first = server.requests[0] as Captured;
      const second = server.requests[1] as Captured;
      assert.equal(first.headers["payment-signature"], undefined);
      assert.equal(first.headers["x-payment"], undefined, "v1 header is dead");
      assert.equal(
        typeof second.headers["payment-signature"],
        "string",
        "the retry must carry PAYMENT-SIGNATURE"
      );
      // The retry carries the same authorized terms.
      assert.deepEqual(JSON.parse(first.body), JSON.parse(second.body));
      assert.deepEqual(JSON.parse(first.body), {
        amount: 10000,
        currency: "USDC",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        network: AUTHORIZED_NETWORK,
        scheme: "exact",
        capabilityId: CAPABILITY_ID,
        termsDigest: TERMS_DIGEST,
      });

      // The wire payload is the v2 PaymentPayload shape.
      const wire = JSON.parse(
        Buffer.from(
          second.headers["payment-signature"] as string,
          "base64"
        ).toString("utf8")
      ) as Record<string, any>;
      assert.equal(wire["x402Version"], 2);
      assert.deepEqual(wire["accepted"], {
        scheme: "exact",
        network: AUTHORIZED_NETWORK,
        amount: AUTHORIZED_AMOUNT,
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: PAYEE,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      });
      assert.equal(wire["payload"]["authorization"]["value"], "10000");

      assert.equal(challenges.length, 1);
      const challenge = challenges[0] as X402Challenge;
      assert.equal(challenge.accepted.amount, AUTHORIZED_AMOUNT);
      assert.equal(challenge.accepted.network, AUTHORIZED_NETWORK);
      assert.equal(challenge.accepted.scheme, "exact");
      assert.equal(challenge.accepts.length, 1);

      assert.equal(sub.kind, "payment");
      assert.equal(sub.externalRef, "0x1234567890abcdef");
      assert.equal(sub.capabilityId, CAPABILITY_ID);
      assert.equal(sub.termsDigest, TERMS_DIGEST);
    } finally {
      await server.close();
    }
  });

  it("a 402 without a challenge header is a failed effect and settles nothing", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "payment required" }));
    });
    try {
      let settled = 0;
      const provider = createX402Provider(
        providerOptions(server.url, async () => {
          settled += 1;
          return { payload: { signature: "0x1" } };
        })
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /no payment challenge/
      );
      assert.equal(settled, 0);
      assert.equal(server.requests.length, 1);
    } finally {
      await server.close();
    }
  });

  it("a challenge for a LARGER amount is refused and settles nothing", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired(
          [accept({ amount: "50000" })],
          "http://x/v1/data"
        ),
      });
      res.end("{}");
    });
    try {
      let settled = 0;
      const provider = createX402Provider(
        providerOptions(server.url, async () => {
          settled += 1;
          return { payload: { signature: "0x1" } };
        })
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /demands more than the authorised amount/
      );
      assert.equal(settled, 0, "nothing may be settled");
      assert.equal(server.requests.length, 1, "no payment may be sent");
    } finally {
      await server.close();
    }
  });

  it("a challenge for a DIFFERENT network is refused and settles nothing", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired(
          [accept({ network: "eip155:1" })],
          "http://x/v1/data"
        ),
      });
      res.end("{}");
    });
    try {
      let settled = 0;
      const provider = createX402Provider(
        providerOptions(server.url, async () => {
          settled += 1;
          return { payload: { signature: "0x1" } };
        })
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /unsupported network/
      );
      assert.equal(settled, 0, "nothing may be settled");
      assert.equal(server.requests.length, 1, "no payment may be sent");
    } finally {
      await server.close();
    }
  });

  it("a challenge for a different amount is refused", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired(
          [accept({ amount: "9999" })],
          "http://x/v1/data"
        ),
      });
      res.end("{}");
    });
    try {
      let settled = 0;
      const provider = createX402Provider(
        providerOptions(server.url, async () => {
          settled += 1;
          return { payload: { signature: "0x1" } };
        })
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /differs from the authorised amount/
      );
      assert.equal(settled, 0);
      assert.equal(server.requests.length, 1);
    } finally {
      await server.close();
    }
  });

  it("a challenge for an unsupported scheme is refused", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired(
          [accept({ scheme: "upto" })],
          "http://x/v1/data"
        ),
      });
      res.end("{}");
    });
    try {
      let settled = 0;
      const provider = createX402Provider(
        providerOptions(server.url, async () => {
          settled += 1;
          return { payload: { signature: "0x1" } };
        })
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /unsupported payment scheme/
      );
      assert.equal(settled, 0);
      assert.equal(server.requests.length, 1);
    } finally {
      await server.close();
    }
  });

  it("a non-2xx answer after payment is a failed effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], "http://x/v1/data"),
        });
        res.end("{}");
        return;
      }
      json(res, 500, { error: "settlement failed" });
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /unexpected status 500 after payment/
      );
      assert.equal(server.requests.length, 2);
    } finally {
      await server.close();
    }
  });

  it("a settlement without a transaction is a failed effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], "http://x/v1/data"),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse({ transaction: "" }),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /carries no transaction/
      );
    } finally {
      await server.close();
    }
  });

  it("a failed settlement is a failed effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], "http://x/v1/data"),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse({
          success: false,
          errorReason: "insufficient_funds",
          transaction: "",
        }),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /settlement failed: insufficient_funds/
      );
    } finally {
      await server.close();
    }
  });

  it("a settlement on another network is a failed effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], "http://x/v1/data"),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse({ network: "eip155:1" }),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /different network than the authorised one/
      );
    } finally {
      await server.close();
    }
  });

  it("a server that never challenges is a failed effect", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse(),
      });
      res.end("{}");
    });
    try {
      let settled = 0;
      const provider = createX402Provider(
        providerOptions(server.url, async () => {
          settled += 1;
          return { payload: { signature: "0x1" } };
        })
      );
      await assert.rejects(() => provider.submit(terms()), /did not challenge/);
      assert.equal(settled, 0);
      assert.equal(server.requests.length, 1);
    } finally {
      await server.close();
    }
  });

  it("a payment that declares another amount is refused before it is sent", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], "http://x/v1/data"),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
          amount: "90000",
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /payment amount differs from the authorised amount/
      );
      assert.equal(server.requests.length, 1, "no payment may be sent");
    } finally {
      await server.close();
    }
  });

  it("a signed authorization for another amount is refused before it is sent", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], "http://x/v1/data"),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: {
            signature: "0x1",
            authorization: { to: PAYEE, value: "50000" },
          },
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /payment amount differs from the authorised amount/
      );
      assert.equal(server.requests.length, 1, "no payment may be sent");
    } finally {
      await server.close();
    }
  });

  it("falls back to the challenge in the JSON body when the header is absent", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        json(res, 402, {
          x402Version: 1,
          error: "X-PAYMENT header is required",
          resource: { url: "http://x/v1/data" },
          accepts: [accept()],
        });
        return;
      }
      json(res, 200, { transaction: "0xbody" });
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        }))
      );
      const sub = await provider.submit(terms());
      assert.equal(sub.externalRef, "0xbody");
    } finally {
      await server.close();
    }
  });

  it("refuses a challenge for a resource the host did not name", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], "http://x/other"),
      });
      res.end("{}");
    });
    try {
      let settled = 0;
      const provider = createX402Provider({
        ...providerOptions(server.url, async () => {
          settled += 1;
          return { payload: { signature: "0x1" } };
        }),
        resource: "http://x/v1/data",
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /different resource/
      );
      assert.equal(settled, 0);
    } finally {
      await server.close();
    }
  });

  it("refuses request terms that disagree with the authorised amount", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], "http://x/v1/data"),
      });
      res.end("{}");
    });
    try {
      let settled = 0;
      const provider = createX402Provider(
        providerOptions(server.url, async () => {
          settled += 1;
          return { payload: { signature: "0x1" } };
        })
      );
      await assert.rejects(
        () =>
          provider.submit({
            ...terms(),
            context: { ...terms().context, amount: 500 },
          }),
        /different amount than the authorised amount/
      );
      assert.equal(settled, 0);
    } finally {
      await server.close();
    }
  });

  it("verify rejects a submission whose capability id or terms digest do not match", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], "http://x/v1/data"),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse(),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        }))
      );
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
          capabilityId: "cid-x402-other",
          termsDigest: TERMS_DIGEST,
        }).ok,
        false
      );
      assert.equal(
        provider.verify(sub, {
          capabilityId: CAPABILITY_ID,
          termsDigest: "ef".repeat(32),
        }).ok,
        false
      );
    } finally {
      await server.close();
    }
  });
});
