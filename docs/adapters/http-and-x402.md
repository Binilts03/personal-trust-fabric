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

Three things travel beside the body, as headers:

- `content-type: application/json` — set by the adapter. A host that
  supplies its own content type is refused: the adapter decides what the
  server parses.
- `idempotency-key: <termsDigest>` — the default. A header, not a body key,
  because the body stays exactly the terms plus the binding fields. The
  host may override it with `idempotencyKey`.
- the auth headers the host's `sign` returned.

Host-supplied headers are checked before they reach the socket: a CR or LF
in a name or a value, a colon in a name, a name longer than 64 characters, a
value longer than 4096 characters, the `host`, `content-length`,
`transfer-encoding`, and `connection` headers, and any `content-type` are all
refused.

## Signed JSON over HTTP

```ts
import { createHmac } from "node:crypto";
import { createHttpProvider } from "personal-trust-fabric/adapters/http";

const key = process.env.MERCHANT_API_KEY ?? "";

const provider = createHttpProvider({
  kind: "payment",
  // A host constant, never a request term. `https:` only, unless the host
  // sets `allowInsecureHttp` for a local test server.
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
| body larger than 1 MiB                   | `response body exceeds 1048576 bytes`    |
| `interpret` throws                       | `response rejected: <host message>`      |
| `interpret` returns an empty reference   | `response carried no usable externalRef` |
| `verifyAttestation` returns `{ok:false}` | `attestation failed: <reason>`           |
| network error, refused redirect          | `request failed`                         |
| timeout                                  | `request timed out after 15000ms`        |
| `sign` throws                            | `signing failed: <host message>`         |
| a refused header                         | `the <name> header is not allowed`       |

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
`PAYMENT-REQUIRED`; a JSON body carrying the challenge is the fallback, and
both the v1 body shape (`paymentRequirements`, `maxAmountRequired`) and the
v2 body shape (`accepts`, `amount`) are accepted. The version marker the
server sent is checked, never rewritten.

### Amounts, asset, payee

`amount` and `authorization.value` are decimal strings in the **asset's own
atomic units**. The x402 core specification does not define an asset's
decimals and does not define a conversion between them. The adapter
therefore never converts, scales, or infers units. The host states the
exact authorised atomic amount and the challenge must match it exactly.

The asset and the payee are bound the same way. An atomic count on its own
does not say what is being paid: `payTo` and the amount alone cannot tell
USDC on Base from a worthless token with the same count. So the host states
the asset it authorised (the token contract address, or the fiat currency
code) and the payee it authorised, and a challenge naming another asset or
another payee is refused before anything is signed.

```ts
const provider = createX402Provider({
  url: "https://api.example.com/premium-data",
  // A host constant, never a request term.
  authorizedAmount: "10000", // atomic units, exactly as authorised
  authorizedNetwork: "eip155:84532", // CAIP-2
  authorizedAsset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC
  authorizedPayTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  resource: "https://api.example.com/premium-data", // the challenged resource
  authorizedScheme: "exact", // optional, this is the default
  // The payer the host authorised, when it knows one.
  authorizedPayer: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
  settle: async (challenge) => {
    // SIGN ONLY. Never broadcast, never submit, never move value: the
    // adapter decides whether the signed payload is sent. The signature
    // must cover the AUTHORISED asset, payee, and amount — a payload that
    // names anything else is refused.
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
  // The checked settlement, before the submission is returned. The host
  // runs its own rail check here.
  onSettlement: (settlement) => {
    const checked = checkSettlement(settlement, {
      network: "eip155:84532",
      payer: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
      amount: "10000",
    });
    if (!checked.ok) throw new Error(checked.reason);
  },
});
```

The adapter builds the v2 `PaymentPayload` wrapper itself. The host returns
the signed authorization; the `accepted` block in the wire payload carries
the **authorised** amount, scheme, network, asset, and payee — never the
server's.

### The flow

1. POST the authorized terms.
2. `402 Payment Required` → read the challenge from `PAYMENT-REQUIRED`.
3. Select the `accepts` entry whose amount equals `authorizedAmount`
   exactly and whose scheme, network, asset, and payee are the authorised
   ones. The challenge's resource must be the authorised `resource`. No
   match: stop, before anything is signed.
4. `settle(challenge)` signs the authorization and returns it.
5. Retry **once** with `PAYMENT-SIGNATURE`.
6. Decode `PAYMENT-RESPONSE` and check it: `success` must be true, the
   `transaction` must be non-empty, the `network` must be the authorised
   one, and the `payer` and `amount` must match when the server sent them
   and the host declared them.
7. `onSettlement` hands the checked settlement to the host, which runs its
   own rail check.

### Failure semantics

Before anything is signed (nothing is paid, nothing is on the wire):

| condition                                     | error                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| the challenge asks for more than authorised   | `the challenge demands more than the authorised amount — refusing to pay`   |
| the challenge asks for another amount         | `the challenge amount differs from the authorised amount — refusing to pay` |
| the challenge asks for another scheme         | `the challenge asks for an unsupported payment scheme — refusing to pay`    |
| the challenge asks for another network        | `the challenge asks for an unsupported network — refusing to pay`           |
| the challenge names another asset             | `the challenge names another asset — refusing to pay`                       |
| the challenge names another payee             | `the challenge names another payee — refusing to pay`                       |
| the challenge is for another resource         | `the challenge is for a different resource — refusing to pay`               |
| no challenge header and no challenge body     | `no payment challenge in the 402 response`                                  |
| the server never challenged (2xx on the POST) | `the server did not challenge with a payment requirement`                   |

After the signature, before the payment is sent:

| condition                                     | error                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| the host's payment declares another amount    | `the payment amount differs from the authorised amount — refusing to send the payment`   |
| the host's payment declares another network   | `the payment network differs from the authorised network — refusing to send the payment` |
| the host's payment declares another asset     | `the payment asset differs from the authorised asset — refusing to send the payment`     |
| the signed authorization names another amount | `the payment amount differs from the authorised amount — refusing to send the payment`   |
| the signed authorization names another payee  | `the payment payee differs from the authorised payee — refusing to send the payment`     |

After the payment, the settlement is what it is. These say what was wrong;
they do not say "refusing to settle", because the settlement already
happened:

| condition                              | error                                                                |
| -------------------------------------- | -------------------------------------------------------------------- |
| status outside 2xx after payment       | `unexpected status 500 after payment`                                |
| the settlement reports no success      | `the settlement does not report success`                             |
| the settlement reports failure         | `the settlement failed: insufficient_funds`                          |
| the settlement carries no transaction  | `the settlement carries no transaction`                              |
| the settlement names no network        | `the settlement names no network`                                    |
| the settlement reports another network | `the settlement reports a different network than the authorised one` |
| the settlement reports another payer   | `the settlement reports a different payer than the authorised one`   |
| the settlement reports another amount  | `the settlement reports a different amount than the authorised one`  |
| the host rejects the settlement        | `the settlement was rejected by the host: <reason>`                  |

A settlement that fails these checks is a failed effect: the money may have
moved, so the host reconciles out of band, and no receipt is minted from a
settlement nobody verified.

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
- A rail result is evidence, not proof. `onSettlement` is where the host
  runs the independent check (`checkSettlement`); the adapter's own checks
  are a floor, not the proof.
- The response body is never logged and never copied into an error message.
  A server string that reaches an error message is stripped of control
  characters and truncated to 80 characters.
- The `detail` the host's `interpret` returns is not part of the receipt.
  The receipt keeps a fixed field set.
- The x402 adapter signs through the host's `settle` callback and never
  moves value itself. It has no wallet, no key, and no facilitator.
- The x402 adapter never retries a payment. One challenge, one signature,
  one retry. A failed retry is a failed effect.
- The whole submit has one deadline (30s by default), so the challenge
  request and the retry together cannot take twice the timeout. A response
  body over 1 MiB is refused, not buffered.
- `redirect: "error"` applies to both adapters. A redirect is a refusal,
  not a hop.
- The endpoint url must be `https:` unless the host sets
  `allowInsecureHttp`. It is a host constant, never a request term: a
  request term that chooses the endpoint is a request that chooses where
  the money goes.
