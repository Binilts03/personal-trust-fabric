# Deep read: agent payments (x402 v2, AP2, Verifiable Intent, Stripe ACP, Visa)

_Generated: 2026-09-09 | Sources: 8 primary | Confidence: High, except flagged UNVERIFIED items_

Supersedes the payments section of `2026-09-08-agentic-commerce-protocols.md`. Read from spec text, not summaries.

## 1. x402 v2 (Coinbase spec, raw markdown read in full)

- Transport headers: Server→Client `PAYMENT-REQUIRED` (b64 `PaymentRequired`); Client→Server `PAYMENT-SIGNATURE` (b64 `PaymentPayload`); Server→Client `PAYMENT-RESPONSE` (b64 `SettlementResponse`). Status: 402 = payment-required/failed, 400 = invalid, 500 = server-error, 200 = success. ([http transport](https://raw.githubusercontent.com/coinbase/x402/main/specs/transports-v2/http.md))
- `PaymentRequired`: `x402Version=2`, `error?`, `resource{url,description?,mimeType?}`, `accepts[]`, `extensions?{info,schema}`. `PaymentRequirements`: `scheme`, `network` (CAIP-2), `amount` (atomic-unit string), `asset`, `payTo`, `maxTimeoutSeconds`, `extra?`. ([v2 spec](https://raw.githubusercontent.com/coinbase/x402/main/specs/x402-specification-v2.md))
- `PaymentPayload`: `x402Version`, `resource?`, `accepted` (the chosen `PaymentRequirements`), `payload` (scheme-specific), `extensions?`. Exact-EVM payload: `signature` (EIP-712) + `authorization{from,to,value,validAfter,validBefore,nonce}`. ([v2 spec](https://raw.githubusercontent.com/coinbase/x402/main/specs/x402-specification-v2.md))
- Permit2 variant: `payload{signature, permit2Authorization{permitted{token,amount}, from, spender=proxy, nonce, deadline, witness{to,validAfter}}}`. ERC-7710 variant carries `delegationManager, permissionContext, delegator`. ([exact EVM scheme](https://raw.githubusercontent.com/coinbase/x402/main/specs/schemes/exact/scheme_exact_evm.md))
- Facilitator: `POST /verify` req `{x402Version,paymentPayload,paymentRequirements}` → resp `{isValid,invalidReason?,payer?}`; `POST /settle` same req → `{success,errorReason?,payer?,transaction,network,amount?}`; `GET /supported` → `{kinds[{x402Version,scheme,network,extra?}],extensions[],signers{pattern:[addr]}}`. ([v2 spec](https://raw.githubusercontent.com/coinbase/x402/main/specs/x402-specification-v2.md))
- Replay protection is fourfold: unique 32-byte `nonce` + EIP-3009 contract forbids reuse + `validAfter/validBefore` window + EIP-712 signature recovery to `from` + simulation. ([v2 spec](https://raw.githubusercontent.com/coinbase/x402/main/specs/x402-specification-v2.md))
- EIP-3009 (`transferWithAuthorization`) is recommended/gasless for USDC; Permit2 (`permitWitnessTransferFrom` via `x402ExactPermit2Proxy@0x402085c248EeA27D92E8b30b2C58ed07f9E20001`) is the universal fallback for any ERC-20 with spender=proxy and witness binding `to`. Default order: `eip3009` then `permit2`. ([exact EVM scheme](https://raw.githubusercontent.com/coinbase/x402/main/specs/schemes/exact/scheme_exact_evm.md))
- CDP facilitator networks: Base `eip155:8453`, Base-Sepolia `eip155:84532`, Polygon `eip155:137`, Arbitrum `eip155:42161`, World `eip155:480/4801` with `exact,upto,batch-settlement`; Solana `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (+devnet) with `exact` only; EIP-3009 (USDC/EURC) or Permit2 (any ERC-20). ([CDP network support](https://docs.cdp.coinbase.com/x402/network-support))
- Relying-party rule: the seller must itself check `accepted` matches its `accepts` exactly (amount/asset/payTo/network) plus facilitator `isValid/success` for that pair and `transaction/network/payer` on settle. Never outsource requirement-matching. ([v2 spec](https://raw.githubusercontent.com/coinbase/x402/main/specs/x402-specification-v2.md))

## 2. AP2 (Google spec + mandate docs, raw markdown read in full)

- Mandate types: closed `mandate.checkout.1` + `mandate.payment.1`, open `mandate.checkout.open.1` + `mandate.payment.open.1`, all as SD-JWT `vct`; open adds `constraints[]`, `cnf`, `iat`, `exp`. ([checkout mandate](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/checkout_mandate.md))
- Closed checkout: `{vct, checkout_jwt (merchant JWT), checkout_hash}`. Closed payment: `{vct, transaction_id (=checkout_hash), payee{id?,name,website}, payment_amount{amount,currency}, payment_instrument{id,type,description?}}`. ([payment mandate](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/payment_mandate.md))
- Cart→Intent binding: `checkout_hash = B64U(hash(value of checkout_jwt))` with `_sd_alg` or `sha-256`; verifier recomputes from `checkout_jwt` and checks `transaction_id == checkout_hash`. Open pair linked by `payment.reference.conditional_transaction_id` = hash of the open-checkout disclosure. ([checkout mandate](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/checkout_mandate.md))
- `cnf`: open mandates MUST include `cnf.jwk` P-256 agent key, identical across the checkout+payment pair. Autonomous closed mandates bound by agent `agent_sk` KeyBinding (`sd_hash`, aud, nonce); direct closed signed by `user_sk` on the Trusted Surface. ([specification](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/specification.md))
- `exp`: open SHOULD use the smallest workable `exp`; closed verified with chain + constraint evaluation; reject on `invalid_credential`/`invalid_mandate`, `unresolved_constraint` → fall back to human-present. ([specification](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/specification.md))
- Custody chain: Merchant MUST hold+verify the Checkout Mandate before completing checkout; Credential Provider/Network MUST hold+verify the Payment Mandate before issuing a credential; MPP MUST hold a scoped Payment Credential before charging. Each returns a signed Receipt `{iss,result,reference=hash(mandate),error?}`. ([specification](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/specification.md))
- Signatures: `ES256` SD-JWT/KB-JWT; `checkout_jwt` MUST be digitally signed (e.g. ECDSA) and NOT deterministic Ed25519, to block rainbow tables — UNVERIFIED, single source. ([agent authorization](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/agent_authorization.md))

## 3. Stripe ACP (official docs read)

- SharedPaymentToken scope: merchant-specific (`seller_details.network_business_profile`), amount-limited (`usage_limits{currency,max_amount}`), time-limited (`usage_limits.expires_at`); states `active/requires_action/deactivated`. "Single-use + ~30min" from a secondary tutorial — UNVERIFIED. ([SPT concepts](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent))
- Revocable anytime: `POST /v1/shared_payment/issued_tokens/{id}/revoke` → terminal `deactivated`; a deactivated/exhausted token causes synchronous PaymentIntent rejection. ([SPT concepts](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent))
- Hooks: order-approval + price/availability hooks, 4s timeout; approval timeout → decline, price timeout → fall back to feed and continue; non-2xx → `424` to the agent; endpoints must be idempotent; `checkout.session.completed` drives fulfillment. ([seller manage](https://docs.stripe.com/agentic-commerce/for-sellers/manage.md))
- Seller rule: verify the approval decision, `PaymentIntent` amount/capture, webhook signature, and SPT `status/next_action` itself. Never delegate approve/decline or fulfillment to the agent. ([seller manage](https://docs.stripe.com/agentic-commerce/for-sellers/manage.md))

## 4. Verifiable Intent (GitHub spec read; site is a JS app, unreadable to scrapers)

- Layers: L1 Issuer→User SD-JWT (`cnf` = user key, ~1yr); L2 User KB-SD-JWT Immediate (final values, no `cnf`, ~15m) or KB-SD-JWT+KB Autonomous (constraints + `cnf` = agent key, 24h–30d); L3a payment→Network + L3b checkout→Merchant KB-SD-JWT (~5m, `header.kid` = agent key, `transaction_id == checkout_hash`). ([README](https://raw.githubusercontent.com/agent-intent/verifiable-intent/main/README.md))
- 8 constraints (Autonomous only): `mandate.checkout.allowed_merchants`, `mandate.checkout.line_items` (minimum/exact), `mandate.payment.allowed_payees`, `mandate.payment.amount_range` (minor units + currency), `mandate.payment.budget` (cumulative max), `mandate.payment.recurrence` (ISO 20022), `mandate.payment.agent_recurrence` (`ON_DEMAND` + dates + max_occurrences, requires amount_range + budget), `mandate.payment.reference{conditional_transaction_id}`. ([constraints](https://raw.githubusercontent.com/agent-intent/verifiable-intent/main/spec/constraints.md))
- Verifier checklist: ES256-only, `sd_hash` chain on selective presentation, L2 `cnf.jwk` identical + L3 `kid` match, `vct`/`typ` by value, recompute `B64U(SHA256(ASCII(checkout_jwt)))`, all disclosed constraints, `nonce`/`aud`/`exp`/`iat`, one-L3-per-L2 + cumulative budget state. L3 MUST NOT contain `cnf`. ([credential format](https://raw.githubusercontent.com/agent-intent/verifiable-intent/main/spec/credential-format.md))

## 5. Visa (marketing page only — API schemas unverified)

- Agent-specific pass-through token + passkey-authenticated Payment Instruction; platform validates credential request vs instruction and enforces merchant+amount controls on VisaNet authorization; agent shares outcome signals for disputes. ([Visa Intelligent Commerce](https://developer.visa.com/capabilities/visa-intelligent-commerce))

## Key takeaways (→ ticket 04 x402 adapter)

- The PTF x402 adapter must parse `PAYMENT-REQUIRED.accepts[]`, match exactly against local policy (amount/asset/payTo/network), call `POST /verify` pre-execution and `POST /settle` with the same pair, and record `transaction/network/payer`. A swapped `payTo` or `accepted` entry must fail at the recipient/terms gate even if the facilitator says valid.
- The AP2/VI shape maps cleanly onto PTF: open mandate ≈ Standing Grant with constraints, closed mandate ≈ digest-bound Approval (`transaction_id == checkout_hash` is their termsDigest), `cnf.jwk` ≈ recipient/agent binding, receipts ≈ PTF receipts. Verify the full chain, never an agent-signed closed mandate alone.
- SPT semantics (single-merchant, amount/time-bounded, revocable) are the closest existing equivalent of a PTF payment capability — cite in design reviews.

## Sources

1. [x402 v2 spec](https://raw.githubusercontent.com/coinbase/x402/main/specs/x402-specification-v2.md) — protocol, facilitator, replay protection
2. [x402 HTTP transport v2](https://raw.githubusercontent.com/coinbase/x402/main/specs/transports-v2/http.md) — headers, status codes
3. [x402 exact EVM scheme](https://raw.githubusercontent.com/coinbase/x402/main/specs/schemes/exact/scheme_exact_evm.md) — EIP-3009/Permit2/ERC-7710 payloads
4. [CDP network support](https://docs.cdp.coinbase.com/x402/network-support) — chains and schemes
5. [AP2 specification](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/specification.md) — mandates, custody, receipts
6. [AP2 checkout/payment/agent-authorization docs](https://raw.githubusercontent.com/google-agentic-commerce/AP2/main/docs/ap2/checkout_mandate.md) — binding hashes, cnf rules
7. [Stripe SPT concepts + seller manage](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent) — scope, revocation, hooks
8. [Verifiable Intent README/constraints/credential-format](https://raw.githubusercontent.com/agent-intent/verifiable-intent/main/README.md) — layers, constraints, verifier checklist
9. [Visa Intelligent Commerce](https://developer.visa.com/capabilities/visa-intelligent-commerce) — platform controls (marketing-level only)

## Methodology

Four parallel subagents read primary sources via webfetch (raw markdown preferred), quoting field names; main session synthesized. UNVERIFIED tags mark single-source claims. Gaps: Stripe Agreement object semantics, ACP webhook field values beyond timeout/reject behavior, Visa API schemas, `verifiableintent.dev/spec/*` pages (JS app — GitHub raw used instead).

## Spot-verification (main session, 2026-09-09)

Raw `transports-v2/http.md` read in full: headers `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` (b64 JSON), status mapping 402 = required/failed, 400 = invalid, 500 = server error, 200 = success, all-headers-carry-protocol rule, and every example field name (`x402Version`, `resource{url,description,mimeType}`, `accepts[{scheme,network,amount,asset,payTo,maxTimeoutSeconds,extra}]`, `accepted`, `payload{signature,authorization{from,to,value,validAfter,validBefore,nonce}}`, settle `{success,transaction,network,payer}` / `{success:false,errorReason}`) confirmed verbatim. No corrections to §1.
