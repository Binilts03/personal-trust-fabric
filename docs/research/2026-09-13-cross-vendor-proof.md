# Cross-vendor proof: independent verifiers + counterparties

_Generated: 2026-09-13 | Sources: 20+ primary | Confidence: High, except flagged GAPS_

Question: what outside PTF can check our shapes offline, and who on the outside is worth proving against? Read from spec text, package registries, and repo READMEs — not summaries.

## 1. Independent verifiers runnable offline (dev-only conformance)

Rule for all of §1: these are `devDependencies`/test-harness only. Core stays zero-dep (`node:crypto`); nothing here ships in `dist`.

### 1a. `jose` — standard JWTs yes, SD-JWT no

- Current line is **v6.x** (6.2.12 seen 2026-09-05; 6.2.8 on npm page), **MIT**, **0 dependencies**, unpacked **~251.6 kB / 88 files**, universal ESM (CJS `require` works on Node `^20.19 || ^22.12 || >=23`). Node.js is a listed supported runtime. (https://www.npmjs.com/package/jose) (https://registry.npmjs.org/jose)
- API for offline standard-JWT verification: `jwtVerify` (+ `SignJWT`, `decodeJwt`, `EmbeddedJWK`, JWK thumbprint utils), with `createLocalJWKSet` for fully offline keys vs `createRemoteJWKSet` for network JWKS. (https://github.com/panva/jose/blob/HEAD/docs/README.md) (https://jsr.io/@panva/jose/doc)
- **Load-bearing negative:** `jose` covers JWT/JWS/JWE/JWK/JWKS only — its API docs list no SD-JWT/SD-JWT+KB module. It can verify the Issuer-signed JWT _component_ and KB-JWT _as plain JWTs_ (signature + `aud`/`nonce`/`iat` claims), but it does **not** implement digest-recomputation, disclosure-membership, duplicate-digest rejection, or `sd_hash` binding. Do not cite `jose` as an SD-JWT verifier. (https://github.com/panva/jose/blob/HEAD/docs/README.md)
- CI/offline verdict: yes — zero-dep, local keys, no network. Use it to cross-check PTF's JWT claim handling (`aud`/`exp`/`iat`/`typ`), never SD-JWT semantics.

### 1b. `@sd-jwt/core` (OpenWallet Foundation `sd-jwt-js`) — the real SD-JWT cross-check

- **Apache-2.0**, framework-agnostic TS, compliant with **RFC 9901** and **SD-JWT-VC draft-15**; README claims the full §7.1 verifier checklist including **duplicate-digest rejection, unreferenced-disclosure rejection, claim-name collision detection**. Prereqs: **Node >= 20, pnpm >= 9**. (https://github.com/openwallet-foundation/sd-jwt-js/)
- API: `SDJwtInstance` with `issue` / `present` / `verify` (fail-fast) / `safeVerify` (collect-all-errors with codes incl. `KEY_BINDING_SD_HASH_INVALID`, `KEY_BINDING_SIGNATURE_INVALID`, `JWT_EXPIRED`). (https://github.com/openwallet-foundation/sd-jwt-js/blob/main/packages/core/README.md)
- **Bring-your-own-crypto** (`signer`/`verifier`/`hasher`/`saltGenerator` interfaces; README example wires `node:crypto` Ed25519 directly) — so the harness can run with zero third-party crypto and stays offline. Companion `@sd-jwt/sd-jwt-vc` (npm 0.19.0) adds `vct`/`cnf`/issuer-metadata handling. (https://github.com/openwallet-foundation/sd-jwt-js/) (https://www.npmjs.com/package/@sd-jwt/sd-jwt-vc)
- CI/offline verdict: yes — pure local computation. This is verifier #1 for PTF disclosures: issue with PTF → verify with `@sd-jwt/core`, and vice versa.

### 1c. AuthZEN PDP/PEP harness — interop suites yes, certification still baking

- The `openid/authzen` repo ships **spec + interop harness, not a reference PDP**: per-spec-version conformance suites (`authorization-api-1_0-00/01/02`) driven against a shared **Todo-app** scenario; the TS Todo backend POSTs to `/access/v1/evaluation` (and `/evaluations`) with bearer/basic API keys. Runnable locally (localhost POSTs once checked out). (https://github.com/openid/authzen) (https://raw.githubusercontent.com/openid/authzen/main/interop/authzen-todo-backend/README.md)
- **Certification scenario exists but is not GA:** issue #433 / PR #511 (merged June 2026) defines Basic / Batch / Search / Discovery levels with an 8-rule fixture; conformance is protocol-only (never policy-correctness). WG notes say the OIDF certification team is still wiring it into the Java harness with dry-runs pending ("Awaiting feedback from cert team", "Edmund will start adding to the harness"). (https://github.com/openid/authzen/issues/433) (https://github.com/openid/authzen/pull/511) (https://hackmd.io/@oidf-wg-authzen/wg-meeting-20260305)
- Separately, OIDF announced an **independent conformance test program launching Q2 2026** (BixeLab, Fime, FIDO Alliance, Raidiam, TrustID) — scoped to OID4VC first; AuthZEN cert rides the same machinery later. (https://openid.net/leading-organisations-join-oidf-independent-conformance-test-program/)
- CI/offline verdict: partial — the Todo suites run against localhost and can gate PTF's AuthZEN _façade_ shapes offline, but there is **no runnable formal PDP certification today**. GAP: `certification/` dir and authzen-interop.net result matrix not re-checked in this pass.

### 1d. RFC 8693 — vectors in the RFC, no standalone `act` library needed

- **Test vectors are RFC Appendix A itself:** §A.2.1 (exchange request with `subject_token` + `actor_token`), §A.2.2/A.2.3 (decoded subject/actor claims), §A.2.5 (issued token with `act: {sub: admin@example.net}`), plus Fig. 5 (single `act`) and Fig. 6 (nested `act` delegation chain). Normative nesting rule: outermost `act` = current actor; inner = history, informational only for access decisions. (https://datatracker.ietf.org/doc/html/rfc8693)
- Libraries parse the _exchange_, not the claim: `@jmondi/oauth2-server` (TS, JSR) implements `TokenExchangeGrant` with `actor_token`/`actor_token_type` validation; `@apeleghq/hydra-rfc8693` (zero-dep, runtime-agnostic) implements the endpoint for Ory Hydra; Auth0's `auth0-auth-js` Custom Token Exchange extracts `act` via `jose`'s `decodeJwt`. No JS library exists whose job is "parse nested `act`" — correctly so, since `act` is an ordinary JSON object inside a verified JWT. (https://jsr.io/@jmondi/oauth2-server/4.3.0/src/grants/token_exchange.grant.ts) (https://www.npmjs.com/package/@apeleghq/hydra-rfc8693) (https://github.com/auth0/auth0-auth-js/pull/175)
- CI/offline verdict: yes — hand-encode Appendix A Figs. 5/6 as fixtures, verify with `jose` + a ~20-line recursive `act` walker. GAP: `@jmondi/oauth2-server` license not line-verified; irrelevant if we only borrow the vectors, which are RFC text.

### 1e. DPoP (RFC 9449) — small helpers, or hand-roll on `jose`

- `@kuboon/dpop` (JSR, Web-Crypto): client proof generation + `server.ts` `verifyDpopProof` / `verifyDpopProofFromRequest` implementing §4.2 header/payload checks (`typ: dpop+jwt`, asymmetric `alg`, embedded `jwk`, `htm`/`htu`/`jti`/`iat`, optional `ath`, `jkt`-vs-`cnf.jkt` binding for §7). Explicit non-goals: no token issuance, no JWT-claims verification (pair with `jose`), **no replay cache** (caller supplies `checkReplay`), no `DPoP-Nonce` flow. (https://jsr.io/@kuboon/dpop) (https://jsr.io/@kuboon/dpop/doc/server.ts)
- Normative field table cross-checked against Keycloak's DPoP guide (header `typ`/`alg`/`jwk`, body `jti`/`htm`/`htu`/`iat`/`ath`/`nonce`, `cnf.jkt` thumbprint binding). (https://github.com/keycloak/keycloak/blob/213ff926/docs/guides/securing-apps/dpop.adoc)
- CI/offline verdict: yes — either `@kuboon/dpop/server.ts` or a hand-rolled `jose` check (verify proof JWS against embedded JWK, compare `htm`/`htu`, window-check `iat`, uniqueness-check `jti`). GAP: `@kuboon/dpop` license + unpacked size not verified from a primary registry page in this pass; hand-roll avoids the question entirely.

## 2. Counterparties for a real cross-vendor proof

### 2a. Bitwarden Agent Access SDK — real, open, still early-preview

- **Status: early preview, APIs/protocols subject to change** (banner on README). Open protocol + Rust SDK + `aac` CLI + demo/dev relay; examples for Python (UniFFI), JS/WASM, Rust. **License: Apache-2.0** (LICENSE.txt line-verified). (https://github.com/bitwarden/agent-access)
- What integration actually requires: provider side runs `aac listen` (Bitwarden-CLI-backed, unlock vault, mint **pairing token**); agent side runs `aac connect --token … --domain … --output json` (or `--id` for exact item); `aac run --env … -- <cmd>` injects credential fields as env vars into the child **without touching stdout/disk**. Default relay `wss://ap.lesspassword.dev`. Agent never sees the vault — one credential per approved request, tunnel closed after use; unknown-device prompts give human-in-the-loop approval. (https://github.com/bitwarden/agent-access) (https://bitwarden.com/blog/introducing-agent-access-sdk/)
- What the agent never sees: everything except the single released credential's fields (`username/password/totp/uri/notes/domain/credential_id`); Bitwarden's own guidance is env-injection (`aac run`), never pasting secrets into model context. (https://github.com/bitwarden/agent-access/blob/main/examples/skills/agent-access/SKILL.md)
- Demo verdict: genuinely runnable today (prebuilt `aac` binaries incl. Windows x86_64), but preview-status means pin a release hash and expect churn. No orphan risk of note: Apache-2.0 + open protocol.

### 2b. Google AP2 — runnable samples + SDK tests, no public conformance

- Repo `google-agentic-commerce/AP2`, **Apache-2.0**: `code/sdk/python` (Pydantic models, mandate wrappers, **chain verification**, SD-JWT helpers, constraints) with unit tests (`chain_tests`, `kb_sd_jwt_tests`, `constraints_tests`, …); `code/samples` (Python/Go/Android roles: shopping agent, merchant, credentials provider, payment processor) each with `run.sh` starting local agents on ports 8001–8003; `code/samples/certs` test CA for SD-JWT trust. (https://github.com/google-agentic-commerce/AP2) (https://github.com/google-agentic-commerce/AP2/blob/main/code/README.md)
- Catch: **no PyPI package** ("install via `uv pip install git+…@main`"), **no formal conformance suite or public test-merchant endpoint** — the samples _are_ the interop surface. The shopping-agent scenario needs `GOOGLE_API_KEY`/Vertex (network + key), so only the SDK tests + role servers are offline-runnable. Standardization is moving into FIDO working groups. (https://github.com/google-agentic-commerce/AP2/blob/main/README.md) (https://ap2-protocol.org/)
- Demo verdict: the SDK's chain-verifier tests are the chewable piece — feed a PTF-minted mandate-shaped SD-JWT at them (and vice versa) without running the whole bazaar.

### 2c. AuthZEN interop events — active program, next doors are EIC + the WG call

- Track record verified: **7 public interops since 2024** (Identiverse, Gartner IAM London/Grapevine), 9→20+ vendors, live results at authzen-interop.net; spec Final Jan 2026; Identiverse 2026 ran a full masterclass + main talk with COAZ/ARAP as the agent-era edges. (https://openid.net/authzen-at-identiverse-2026-authorization-in-the-agent-era/) (https://andrewdoering.org/blog/2026/authzen-shared-signals-framework-part-4-implementation/)
- Announced 2026 activity found in WG notes: **EIC Berlin (May 2026)** sessions + WG breakout room, Identiverse session/workshop (TBD at note time — since delivered, see above), Authenticate TBD, possible Forrester-hosted interop; **weekly Thursday 1pm PT WG call** open. No post-June-2026 plugfest date (e.g. Gartner Grapevine Dec 2026) found on a primary page — GAP. (https://hackmd.io/@oidf-wg-authzen/wg-meeting-20260129) (https://openid.net/wg/authzen/)
- Join verdict: cheapest entry is remote — weekly call + run the Todo interop suite against a PTF PDP façade locally; physical plugfest is a later, travel-cost step with no announced date to book.

### 2d. 1Password CLI + service accounts — GA, scriptable today, not marketing

- Service accounts (`op service-account create --vault NAME:read_items[,write_items] --expires-in …`, token via `OP_SERVICE_ACCOUNT_TOKEN`, CLI ≥ 2.18) support non-interactive `op read` (`op://vault/item/field`), `op inject`, `op run`, `op item get/list/create`, `op vault create` — with documented per-command request counts and rate limits. Cannot touch Personal/Private/Employee vaults; scope to a dedicated demo vault. (https://www.1password.dev/service-accounts/get-started) (https://www.1password.dev/service-accounts/use-with-1password-cli)
- Demo verdict: the only counterparty here that is a **shipping product with stable CLI semantics** — usable as the external vault in a use-without-possession demo this week. Cost: needs a 1Password account/subscription + a throwaway vault.

## 3. Options table

| Option                                                                                                                              | Maturity                                                  | Offline-runnable                                 | Effort         | Falsifies what                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A. Dev-only conformance ring (`@sd-jwt/core` + `jose` + RFC 8693 App. A fixtures + DPoP proof checks, vitest/node:test, no network) | High (RFC 9901 final; OWF lib production-labelled)        | Yes                                              | 2–3 days       | "PTF shapes verify elsewhere" — a cross-verify failure means our disclosure encoding / `sd_hash` / KB binding is nonstandard |
| B. 1Password service-account vault demo (scoped vault, `op read` inside execute boundary only)                                      | GA product                                                | Demo needs account; assertions offline           | 1–2 days       | ADR-0006 "use without possession" — any raw secret in agent view, receipt, log, or audit fails the thesis end-to-end         |
| C. AP2 SDK cross-check (PTF mandate ⇄ AP2 `chain_tests`/verifier)                                                                   | Medium (samples+tests, no conformance)                    | SDK tests yes; full scenarios no (needs API key) | 3–5 days       | "Our mandate ≈ their mandate" — `transaction_id == checkout_hash` / `cnf.jwk` / constraint semantics diverge                 |
| D. Bitwarden Agent Access pairing pilot (`aac listen` + `aac run` as PTF's credential edge)                                         | Early preview, Apache-2.0                                 | Local relay yes                                  | 3–5 days       | Same ADR-0006 bite as B but through a third-party pairing/approval UX; churn risk, not spec risk                             |
| E. AuthZEN plugfest / certification                                                                                                 | Program active, cert still baking, no announced 2026 date | Todo suites locally yes                          | Weeks + travel | Interop posture, not the thesis — defer until cert harness is dry-run                                                        |

## 4. Ranked recommendation

1. **Do A first.** It is the only option that can _refute_ PTF shapes in CI with no accounts, no network, no travel — and a failure is unambiguous (their verifier rejects our bytes). It also de-risks C and E later.
2. **Do B second.** It is the cheapest live counterparty (GA, 1–2 days) and directly exercises the golden rule most likely to embarrass us in public (rule 3: no raw secret crosses to agent view).
3. Explicitly **defer D** until the protocol stabilises (watch releases; re-evaluate on first stable tag) and **defer E** until the certification harness passes dry-runs — meanwhile join the Thursday WG call (free) and keep the Todo-suite façade green.

### Minimal experiments (top 2)

**Exp 1 — cross-verify ring (A), 2–3 days.** Who runs what: PTF mints SD-JWT(+KB) presentations from its own disclose path; a dev-only harness verifies them with `@sd-jwt/core` `verify` (strict: KB required, `aud`/`nonce`/`sd_hash` checked) and verifies the Issuer/KB JWTs with `jose` `jwtVerify` against a local JWKS; the reverse direction (OWF-issued → PTF verify) runs the same vectors. RFC 8693 Figs. 5/6 are hand-encoded as nested-`act` fixtures parsed by PTF's delegation reader; DPoP proofs minted per RFC 9449 §4.2 are checked by the hand-rolled/`@kuboon/dpop` verifier. Boundary: only test vectors cross, no network. **Falsifier:** any systematic reject (digest mismatch, `sd_hash` mismatch, `act`-chain misread) = PTF's canonical bytes are wrong and the thesis "we speak standard shapes" fails. Cost: 2–3 days, $0.

**Exp 2 — external-vault demo (B), 1–2 days.** Who runs what: a throwaway 1Password vault holds one test login; a service account scoped to that vault only (`read_items`); PTF's execute path resolves `op://demo-vault/test-login/password` via `op read` _inside_ the execution boundary and injects it as an env var into a child `curl`-login; the agent side holds only the _reference_, never the value. Boundary crossed: the secret value moves vault→child-process only. **Falsifier:** the value (or a derivative) appears in agent-visible transcripts, receipts, logs, or the audit anchor = ADR-0006 violated and "use without possession" is marketing. Cost: 1–2 days + a 1Password account; no code changes to core (adapter-edge only).

### Drafted next ticket

**Title:** Dev-only cross-verification ring: `@sd-jwt/core` + `jose` + RFC 8693/DPoP fixtures (offline, CI-gated)

Acceptance criteria:

1. `npm i -D @sd-jwt/core jose` (or vendored equivalents); core `package.json` `dependencies` unchanged and zero-dep check still passes.
2. PTF-minted SD-JWT and SD-JWT+KB presentations verify under `@sd-jwt/core` strict verify, and OWF-minted presentations verify under PTF's verifier, for a matrix of {0,1,N} disclosures × {KB required, KB absent→reject}.
3. RFC 8693 Figs. 5/6 fixtures round-trip through PTF's delegation reader with correct current-actor (outermost `act`) vs informational inner chain.
4. DPoP proof fixtures (RFC 9449 §4.2 shapes) verify offline; tampered `htm`/`htu`/replayed `jti` are rejected.
5. Whole suite runs in CI with network disabled; failures print the exact diverging bytes/fields.

## Sources

1. [jose on npm](https://www.npmjs.com/package/jose) — version, MIT, 0 deps
2. [jose registry metadata](https://registry.npmjs.org/jose) — size (251.6 kB), Node support
3. [jose API docs](https://github.com/panva/jose/blob/HEAD/docs/README.md) — scope: JWT/JWS/JWE/JWK/JWKS, no SD-JWT
4. [sd-jwt-js repo](https://github.com/openwallet-foundation/sd-jwt-js/) — Apache-2.0, RFC 9901, BYO crypto, Node>=20
5. [@sd-jwt/core README](https://github.com/openwallet-foundation/sd-jwt-js/blob/main/packages/core/README.md) — verify/safeVerify API + error codes
6. [@sd-jwt/sd-jwt-vc on npm](https://www.npmjs.com/package/@sd-jwt/sd-jwt-vc) — VC layer version 0.19.0
7. [openid/authzen repo](https://github.com/openid/authzen) — spec+harness, no reference PDP
8. [Todo-backend README](https://raw.githubusercontent.com/openid/authzen/main/interop/authzen-todo-backend/README.md) — TS PEP wire reality
9. [Certification scenario #433](https://github.com/openid/authzen/issues/433) — levels, fixture, protocol-only scope
10. [Cert PR #511](https://github.com/openid/authzen/pull/511) — merged June 2026, published artifact path
11. [OIDF independent conformance program](https://openid.net/leading-organisations-join-oidf-independent-conformance-test-program/) — Q2 2026 launch, OID4VC first
12. [RFC 8693](https://datatracker.ietf.org/doc/html/rfc8693) — act/may_act, nesting, Appendix A vectors
13. [@jmondi/oauth2-server TokenExchangeGrant](https://jsr.io/@jmondi/oauth2-server/4.3.0/src/grants/token_exchange.grant.ts) — TS actor-token handling
14. [@apeleghq/hydra-rfc8693](https://www.npmjs.com/package/@apeleghq/hydra-rfc8693) — zero-dep Hydra endpoint impl
15. [@kuboon/dpop](https://jsr.io/@kuboon/dpop) + [server.ts](https://jsr.io/@kuboon/dpop/doc/server.ts) — DPoP helpers + non-goals
16. [Keycloak DPoP guide](https://github.com/keycloak/keycloak/blob/213ff926/docs/guides/securing-apps/dpop.adoc) — normative field table
17. [bitwarden/agent-access](https://github.com/bitwarden/agent-access) — preview status, pairing flow, env injection
18. [Agent Access SDK announcement](https://bitwarden.com/blog/introducing-agent-access-sdk/) — JIT/HITL/E2E model
19. [AP2 repo](https://github.com/google-agentic-commerce/AP2) + [code README](https://github.com/google-agentic-commerce/AP2/blob/main/code/README.md) — SDK, samples, no PyPI
20. [AuthZEN at Identiverse 2026](https://openid.net/authzen-at-identiverse-2026-authorization-in-the-agent-era/) — interop track record, COAZ/ARAP edges
21. [WG meeting notes Jan 2026](https://hackmd.io/@oidf-wg-authzen/wg-meeting-20260129) — EIC/Forrester/certification pipeline
22. [1Password service accounts](https://www.1password.dev/service-accounts/get-started) + [CLI usage](https://www.1password.dev/service-accounts/use-with-1password-cli) — GA automation surface

## Methodology

Single session, primary sources only: npm/JSR registry pages for version-license-size-runtime, repo READMEs for protocol/SDK behavior, RFC/Draft text for normative claims, WG notes + OIDF news for event status. Every factual claim carries its owning URL inline.

## Spot-verification

- `jose` 6.2.12 (2026-09-05) confirmed on the versioned registry page against the 6.2.8 npm landing page; both agree on MIT + 0 deps + universal ESM + Node support.
- Bitwarden LICENSE.txt fetched raw: Apache-2.0, copyright 2023 Bitwarden Inc. — contradicts any assumption of a proprietary SDK license.
- AuthZEN cert status triangulated three ways (issue #433 text, PR #511 merge, Mar 2026 WG notes "awaiting cert team") — all agree: scenario defined, harness not GA.
- AP2 "no PyPI yet, git-install" confirmed on both the repo README and the code README.

## Gaps

- `@sd-jwt/core` unpacked size and exact version not pulled from the registry; `@kuboon/dpop` license/size unverified (hand-roll path avoids both).
- `@jmondi/oauth2-server` license unverified — immaterial (we borrow RFC vectors, not the package).
- No announced post-June-2026 AuthZEN plugfest date found; `certification/` dir and authzen-interop.net matrix not re-checked.
- AP2 SDK tests not executed here — offline-runnability is inferred from "local pytest, no services except scenario roles", not demonstrated.
- 1Password pricing/account tier needed for service accounts not verified (docs assume an existing account).
