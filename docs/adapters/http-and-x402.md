---
layout: default
title: HTTP and x402 provider adapters
permalink: /adapters/http-and-x402/
---

# HTTP and x402 provider adapters

Two `ProtectedProvider` transports that speak real protocols over real HTTP.

| module                          | what it does                                       |
| ------------------------------- | -------------------------------------------------- |
| `src/adapters/http-provider.ts` | signed JSON over HTTP to one endpoint              |
| `src/adapters/x402-provider.ts` | the HTTP 402 agent-payment flow (x402 protocol v2) |

Both are transports. They carry an operation the approval already covered and
bring back a reference. They do not decide anything.

## Import paths

```ts
import { createHttpProvider } from "personal-trust-fabric/adapters/http";
import { createX402Provider } from "personal-trust-fabric/adapters/x402";
```

Both are also in the full barrel (`src/index.ts`). They are not in the curated
root barrel (`src/api.ts`): that surface stays the authority engine, the
vault, the approval presenter, and the provider seam.

## What leaves the host

The request body carries exactly three things:

- the **authorized terms** (`req.context`, which the provider seam already
  binds to the approved operation, field for field),
- the **capability id**,
- the **terms digest**.

Nothing else. No secret, no free-text note, no extra effect-bearing key. The
body is canonical JSON, so the bytes on the wire are the bytes the host
signed.

The credential never enters the body. It stays in the host's `sign`
callback, which turns the canonical body into auth headers. The adapter
never sees the credential value.

## Signed JSON over HTTP

```ts
import { createHmac } from "node:crypto";
import { createHttpProvider } from "personal-trust-fabric/adapters/http";

const key = process.env.MERCHANT_API_KEY ?? "";

const provider = createHttpProvider({
  kind: "payment",
  url: "https://api.razorpay.com/v1/payments",
  // The second argument is the canonical body — the exact bytes on the wire.
  sign: (_body, canonical) => ({
    authorization: `Bearer ${key}`,
    "x-ptf-signature": createHmac("sha256", key)
      .update(canonical)
      .digest("hex"),
  }),
  interpret: (response) => {
    const id = response["id"];
    if (typeof id !== "string") throw new Error("no payment id");
    return { externalRef: id, detail: { status: response["status"] } };
  },
  // Optional: check that the response attests the exact terms.
  verifyAttestation: (response, expected) =>
    response["termsDigest"] === expected.termsDigest
      ? { ok: true }
      : { ok: false, reason: "terms digest mismatch" },
  headers: { "x-api-version": "2026-10-01" },
  method: "POST",
  timeoutMs: 15_000,
});
```

The server verifies the signature over the body it received:

```js
const expected = createHmac("sha256", key).update(req.rawBody).digest("hex");
if (req.headers["x-ptf-signature"] !== expected) return res.sendStatus(401);
```

A Stripe-shaped endpoint works the same way: `sign` returns
`{ authorization: "Bearer sk_test_..." }`, `interpret` reads `response["id"]`.
A Razorpay-shaped endpoint usually needs a per-request signature over the
request id and timestamp rather than over the body; put that in `sign` and
keep the body untouched — the adapter does not care which scheme the host
signs with.

### Failure semantics

Every one of these is a **failed effect**: the call throws, no submission is
returned, and no receipt can be built from it.

| condition                                | error                                    |
| ---------------------------------------- | ---------------------------------------- |
| status outside 2xx                       | `unexpected status 500`                  |
| body is not JSON, or not a JSON object   | `response body is not JSON`              |
| `interpret` throws                       | `response rejected: <host message>`      |
| `interpret` returns an empty reference   | `response carried no usable externalRef` |
| `verifyAttestation` returns `{ok:false}` | `attestation failed: <reason>`           |
| network error, refused redirect          | `request failed`                         |
| timeout                                  | `request timed out after 15000ms`        |
| `sign` throws                            | `signing failed: <host message>`         |

Redirects are refused, not followed: a redirect would carry the signed
request to a host the terms never named.

The adapter never logs. There is no log line for a request or a response,
and the response body never reaches an error message. A host that wants
telemetry uses `onDiagnostic`, which reports the phase and the status only.

## x402 — HTTP 402 agent payment

Implemented from the x402 Foundation specification: **Protocol Version 2**,
`specs/x402-specification-v2.md` and `specs/transports-v2/http.md` (x402
Foundation, Linux Foundation). The v2 transport uses three headers, none of
them `X-` prefixed:

| header              | direction       | carries                     |
| ------------------- | --------------- | --------------------------- |
| `PAYMENT-REQUIRED`  | server → client | base64 `PaymentRequired`    |
| `PAYMENT-SIGNATURE` | client → server | base64 `PaymentPayload`     |
| `PAYMENT-RESPONSE`  | server → client | base64 `SettlementResponse` |

`X-PAYMENT` is v1 and is not sent. `WWW-Authenticate` is not part of x402
at any version and is not read. The challenge is read from
`PAYMENT-REQUIRED`; a JSON body carrying the challenge is the fallback for
a v1-style server.

### Amounts

`amount` and `authorization.value` are decimal strings in the **asset's own
atomic units**. The x402 core specification does not define an asset's
decimals and does not define a conversion between them. The adapter
therefore never converts, scales, or infers units. The host states the
exact authorised atomic amount and the challenge must match it exactly.

```ts
const provider = createX402Provider({
  url: "https://api.example.com/premium-data",
  authorizedAmount: "10000", // atomic units, exactly as authorised
  authorizedNetwork: "eip155:84532", // CAIP-2
  authorizedScheme: "exact", // optional, this is the default
  settle: async (challenge) => {
    // The host holds the wallet key. It signs and pays.
    const authorization = await signWithWallet(challenge.accepted);
    return {
      payload: {
        signature: authorization.signature,
        authorization: {
          from: authorization.from,
          to: challenge.accepted.payTo,
          value: challenge.accepted.amount,
          validAfter: authorization.validAfter,
          validBefore: authorization.validBefore,
          nonce: authorization.nonce,
        },
      },
    };
  },
});
```

The adapter builds the v2 `PaymentPayload` wrapper itself. The host returns
the signed authorization; the `accepted` block in the wire payload comes
from the challenge the adapter selected, so the terms that travel are the
terms that were matched.

### The flow

1. POST the authorized terms.
2. `402 Payment Required` → read the challenge from `PAYMENT-REQUIRED`.
3. Select the `accepts` entry whose scheme and network match the authorised
   ones and whose amount equals `authorizedAmount` exactly. No match: stop.
4. `settle(challenge)` → the signed authorization.
5. Retry **once** with `PAYMENT-SIGNATURE`.
6. Decode `PAYMENT-RESPONSE`: `success` must not be false, `transaction`
   must be non-empty, `network` must match the challenge.

### Failure semantics

| condition                                           | error                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| the challenge asks for more than authorised         | `the challenge demands more than the authorised amount — refusing to settle`   |
| the challenge asks for another amount               | `the challenge amount differs from the authorised amount — refusing to settle` |
| the challenge asks for another scheme               | `the challenge asks for an unsupported payment scheme — refusing to settle`    |
| the challenge asks for another network              | `the challenge asks for an unsupported network — refusing to settle`           |
| no challenge header and no challenge body           | `no payment challenge in the 402 response`                                     |
| the host's payment declares another amount          | `the payment amount differs from the authorised amount — refusing to settle`   |
| the signed authorization names another amount       | `the payment amount differs from the authorised amount — refusing to settle`   |
| the signed authorization names another payee        | `the payment payee differs from the challenged payee — refusing to settle`     |
| the server never challenged (2xx on the first POST) | `the server did not challenge with a payment requirement`                      |
| status outside 2xx after payment                    | `unexpected status 500 after payment`                                          |
| the settlement reports failure                      | `the settlement failed: insufficient_funds`                                    |
| the settlement carries no transaction               | `the settlement carries no transaction`                                        |
| the settlement reports another network              | `the settlement reports a different network than the authorised one`           |

Every refusal happens **before** `settle` is called, or before the payment is
sent. A refused challenge settles nothing and puts nothing on the wire.

The request terms are checked against the authorised terms too. If the
request context names an amount, a network, or a scheme that differs from
what the transport was configured with, the call is refused: the transport
and the approval must agree.

## Limits

- The adapter never sees the credential. The host signs; the adapter only
  forwards the headers `sign` returned.
- The adapter decides nothing about authority. It carries terms that were
  already approved and it reports what came back. PTF decides; the
  endpoint executes (ADR-0009).
- A rail result is evidence, not proof. Hosts that need settlement proof
  still run the independent checks (`checkSettlement`, `verifyMandatePair`)
  before trusting the reference.
- The response body is never logged and never copied into an error message.
- The `detail` the host's `interpret` returns is not part of the receipt.
  The receipt keeps a fixed field set.
- The x402 adapter settles through the host's `settle` callback. It has no
  wallet, no key, and no facilitator of its own.
- The x402 adapter never retries a payment. One challenge, one settlement
  attempt, one retry. A failed retry is a failed effect, and the host
  reconciles out of band.
- `redirect: "error"` applies to both adapters. A redirect is a refusal,
  not a hop.
