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
 * network, another scheme, another asset, another payee, another resource,
 * a failed settlement, a missing transaction — none of them may reach a
 * payment.
 */

const CAPABILITY_ID = "cid-x402-0001";
const TERMS_DIGEST = "cd".repeat(32);
const AUTHORIZED_AMOUNT = "10000";
const AUTHORIZED_NETWORK = "eip155:84532";
const AUTHORIZED_ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAYEE = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66";
const OTHER_ASSET = "0x0000000000000000000000000000000000000dead";
const OTHER_PAYEE = "0x0000000000000000000000000000000000000beef";
/** The resource the host expects to be challenged for. */
const RESOURCE = "https://example.invalid/v1/data";
const OTHER_RESOURCE = "https://example.invalid/v1/other";

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
    asset: AUTHORIZED_ASSET,
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
      payer: PAYER,
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
      asset: AUTHORIZED_ASSET,
      network: AUTHORIZED_NETWORK,
      scheme: "exact",
    },
  };
}

type Settle = (challenge: X402Challenge) => Promise<{
  payload: Record<string, unknown>;
  amount?: string;
  network?: string;
  asset?: string;
  reference?: string;
}>;

function providerOptions(serverUrl: string, settle: Settle) {
  return {
    url: `${serverUrl}/v1/data`,
    authorizedAmount: AUTHORIZED_AMOUNT,
    authorizedNetwork: AUTHORIZED_NETWORK,
    authorizedAsset: AUTHORIZED_ASSET,
    authorizedPayTo: PAYEE,
    resource: RESOURCE,
    settle,
    timeoutMs: 2000,
    allowInsecureHttp: true,
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("x402 provider transport (HTTP 402 agent payment, protocol v2)", () => {
  it("settles once, retries once with PAYMENT-SIGNATURE, and returns the transaction", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
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
    try {
      const challenges: X402Challenge[] = [];
      const provider = createX402Provider(
        providerOptions(server.url, async (challenge) => {
          challenges.push(challenge);
          return {
            payload: {
              signature: "0x2d6a75",
              authorization: {
                from: PAYER,
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
      assert.equal(second.headers["idempotency-key"], TERMS_DIGEST);
      // The retry carries the same authorized terms.
      assert.deepEqual(JSON.parse(first.body), JSON.parse(second.body));
      assert.deepEqual(JSON.parse(first.body), {
        amount: 10000,
        currency: "USDC",
        asset: AUTHORIZED_ASSET,
        network: AUTHORIZED_NETWORK,
        scheme: "exact",
        capabilityId: CAPABILITY_ID,
        termsDigest: TERMS_DIGEST,
      });

      // The wire payload is the v2 PaymentPayload shape, and it carries the
      // AUTHORISED asset and payee.
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
        asset: AUTHORIZED_ASSET,
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
      assert.equal(challenge.accepted.asset, AUTHORIZED_ASSET);
      assert.equal(challenge.accepted.payTo, PAYEE);
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
          RESOURCE
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
          RESOURCE
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

  it("a challenge naming a DIFFERENT asset is refused and settles nothing", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired(
          [accept({ asset: OTHER_ASSET })],
          RESOURCE
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
        /names another asset/
      );
      assert.equal(settled, 0, "nothing may be settled");
      assert.equal(server.requests.length, 1, "no payment may be sent");
    } finally {
      await server.close();
    }
  });

  it("a challenge naming a DIFFERENT payee is refused and settles nothing", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired(
          [accept({ payTo: OTHER_PAYEE })],
          RESOURCE
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
        /names another payee/
      );
      assert.equal(settled, 0, "nothing may be settled");
      assert.equal(server.requests.length, 1, "no payment may be sent");
    } finally {
      await server.close();
    }
  });

  it("a challenge for a different resource url is refused and settles nothing", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], OTHER_RESOURCE),
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
        /different resource/
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
          RESOURCE
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
          RESOURCE
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
          "payment-required": paymentRequired([accept()], RESOURCE),
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
          "payment-required": paymentRequired([accept()], RESOURCE),
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
          "payment-required": paymentRequired([accept()], RESOURCE),
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
        /the settlement failed: insufficient_funds/
      );
    } finally {
      await server.close();
    }
  });

  it("a settlement with NO success flag is a failed effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse({ success: undefined }),
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
        /does not report success/
      );
    } finally {
      await server.close();
    }
  });

  it("a settlement with no network is a failed effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse({ network: undefined }),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        }))
      );
      await assert.rejects(() => provider.submit(terms()), /names no network/);
    } finally {
      await server.close();
    }
  });

  it("a settlement on another network is a failed effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
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

  it("a settlement with a different payer is a failed effect when the host declared one", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse({ payer: OTHER_PAYEE }),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider({
        ...providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        })),
        authorizedPayer: PAYER,
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /different payer than the authorised one/
      );
    } finally {
      await server.close();
    }
  });

  it("a settlement with a different amount is a failed effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse({ amount: "50000" }),
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
        /different amount than the authorised one/
      );
    } finally {
      await server.close();
    }
  });

  it("a settlement error reason cannot smuggle a newline into the message", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse({
          success: false,
          errorReason: "insufficient\nfunds forged",
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
        (err: Error) => {
          assert.equal(err.message.includes("\n"), false);
          assert.equal(err.message.includes("\r"), false);
          assert.ok(err.message.length < 200);
          return true;
        }
      );
    } finally {
      await server.close();
    }
  });

  it("the host receives the checked settlement through onSettlement", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
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
      const seen: Record<string, unknown>[] = [];
      const provider = createX402Provider({
        ...providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        })),
        onSettlement: (settlement) => {
          seen.push(settlement);
        },
      });
      const sub = await provider.submit(terms());
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.["success"], true);
      assert.equal(seen[0]?.["transaction"], "0x1234567890abcdef");
      assert.equal(seen[0]?.["network"], AUTHORIZED_NETWORK);
      assert.equal(sub.externalRef, "0x1234567890abcdef");
    } finally {
      await server.close();
    }
  });

  it("a host that rejects the settlement fails the effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
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
      const provider = createX402Provider({
        ...providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        })),
        onSettlement: () => {
          throw new Error("payer mismatch");
        },
      });
      await assert.rejects(
        () => provider.submit(terms()),
        /rejected by the host: payer mismatch/
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
        "payment-required": paymentRequired([accept()], RESOURCE),
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

  it("a payment that declares another asset is refused before it is sent", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], RESOURCE),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
          asset: OTHER_ASSET,
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /payment asset differs from the authorised asset/
      );
      assert.equal(server.requests.length, 1, "no payment may be sent");
    } finally {
      await server.close();
    }
  });

  it("a payment that declares another network is refused before it is sent", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], RESOURCE),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
          network: "eip155:1",
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /payment network differs from the authorised network/
      );
      assert.equal(server.requests.length, 1, "no payment may be sent");
    } finally {
      await server.close();
    }
  });

  it("a response echoing another transaction is a failed effect", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
        });
        res.end("{}");
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": paymentResponse({ transaction: "0xother" }),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
          reference: "0x1234567890abcdef",
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /echoes a different transaction/
      );
    } finally {
      await server.close();
    }
  });

  it("a signed authorization for another payee is refused before it is sent", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], RESOURCE),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: {
            signature: "0x1",
            authorization: { to: OTHER_PAYEE, value: AUTHORIZED_AMOUNT },
          },
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /payment payee differs from the authorised payee/
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
        "payment-required": paymentRequired([accept()], RESOURCE),
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

  it("falls back to a v2 challenge in the JSON body when the header is absent", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        json(res, 402, {
          x402Version: 2,
          resource: { url: RESOURCE },
          accepts: [accept()],
        });
        return;
      }
      json(res, 200, {
        success: true,
        transaction: "0xbody",
        network: AUTHORIZED_NETWORK,
        payer: PAYER,
      });
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

  it("accepts a v1 challenge body (paymentRequirements, maxAmountRequired)", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        json(res, 402, {
          x402Version: 1,
          error: "X-PAYMENT header is required",
          resource: { url: RESOURCE },
          paymentRequirements: [
            {
              scheme: "exact",
              network: AUTHORIZED_NETWORK,
              maxAmountRequired: AUTHORIZED_AMOUNT,
              asset: AUTHORIZED_ASSET,
              payTo: PAYEE,
              maxTimeoutSeconds: 60,
            },
          ],
        });
        return;
      }
      json(res, 200, {
        success: true,
        transaction: "0xv1",
        network: AUTHORIZED_NETWORK,
        payer: PAYER,
      });
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        }))
      );
      const sub = await provider.submit(terms());
      assert.equal(sub.externalRef, "0xv1");
    } finally {
      await server.close();
    }
  });

  it("refuses a challenge body with an unsupported x402 version", async () => {
    const server = await startServer((_req, res) => {
      json(res, 402, {
        x402Version: 3,
        resource: { url: RESOURCE },
        accepts: [accept()],
      });
    });
    try {
      const provider = createX402Provider(
        providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        }))
      );
      await assert.rejects(
        () => provider.submit(terms()),
        /unsupported x402 version/
      );
    } finally {
      await server.close();
    }
  });

  it("refuses request terms that disagree with the authorised amount", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], RESOURCE),
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

  it("checkRequest rejects a short capability id on the direct-call path", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], RESOURCE),
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
        () => provider.submit({ ...terms(), capabilityId: "short" }),
        /capabilityId required/
      );
      assert.equal(server.requests.length, 0);
    } finally {
      await server.close();
    }
  });

  it("refuses a header value with a CR or LF", async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], RESOURCE),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider({
        ...providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        })),
        headers: { "x-bad": "ok\r\nX-Injected: 1" },
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
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], RESOURCE),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider({
        ...providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        })),
        headers: { "x-bad:name": "value" },
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
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], RESOURCE),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider({
        ...providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        })),
        headers: { "x-long": "v".repeat(5000) },
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
      res.writeHead(402, {
        "content-type": "application/json",
        "payment-required": paymentRequired([accept()], RESOURCE),
      });
      res.end("{}");
    });
    try {
      const provider = createX402Provider({
        ...providerOptions(server.url, async () => ({
          payload: { signature: "0x1" },
        })),
        headers: { "Content-Type": "text/plain" },
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

  it("refuses an http endpoint unless the host opts in", () => {
    assert.throws(
      () =>
        createX402Provider({
          url: "http://example.invalid/v1/data",
          authorizedAmount: AUTHORIZED_AMOUNT,
          authorizedNetwork: AUTHORIZED_NETWORK,
          authorizedAsset: AUTHORIZED_ASSET,
          authorizedPayTo: PAYEE,
          resource: "http://example.invalid/v1/data",
          settle: async () => ({ payload: { signature: "0x1" } }),
        }),
      /must be https/
    );
  });

  it("verify rejects a submission whose capability id or terms digest do not match", async () => {
    const server = await startServer((req, res) => {
      if (req.headers["payment-signature"] === undefined) {
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": paymentRequired([accept()], RESOURCE),
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
