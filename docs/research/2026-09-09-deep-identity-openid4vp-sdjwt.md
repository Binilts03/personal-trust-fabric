# Deep read: identity and selective disclosure (OpenID4VP, SD-JWT, VC 2.0, did:key)

_Generated: 2026-09-09 | Sources: 5 primary | Confidence: High, except flagged GAPS_

Supersedes the identity section of `2026-09-08-agentic-commerce-protocols.md`. Read from spec text.

## 1. OpenID4VP 1.0 Final (spec read, partially via saved full text)

- Request params: `response_type` (`vp_token`, `vp_token id_token`, `code`), `client_id` (as `prefix:orig_id`), `redirect_uri` or `response_uri` (direct_post), `response_mode` REQUIRED, `nonce` REQUIRED, `state` REQUIRED-if-no-holder-binding else OPTIONAL, `dcql_query` or `scope` (exactly one), plus `client_metadata`, `request_uri_method` (`get`/`post`), `transaction_data`, `verifier_info`, `wallet_nonce`, `expected_origins` (DC API). Request Object `typ` MUST be `oauth-authz-req+jwt`; `iss` MUST be ignored; `aud` = `iss` (dynamic) or `https://self-issued.me/v2` (static). (https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- DCQL: top-level `credentials[]` + optional `credential_sets[]`. Credential Query: `id` REQUIRED `[A-Za-z0-9_-]+` unique, `format` REQUIRED (`dc+sd-jwt`, `jwt_vc_json`, `mso_mdoc`, …), `meta` OPTIONAL format-specific (`vct_values`, `type_values`, `doctype_value`), `multiple` OPTIONAL default false, `trusted_authorities` OPTIONAL, `require_cryptographic_holder_binding` OPTIONAL, `claims[]` OPTIONAL, `claim_sets[]` OPTIONAL. CredentialSet: `options: string[][]` + `required` flag. (https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- Claims entries `{id, path, values}`: `id` REQUIRED if `claim_sets` present; `path` REQUIRED non-empty array of `string|null|non-neg-int` (string = object key, null = all array elements, int = array index); `values` OPTIONAL value-match — Wallet SHOULD skip non-matches but Verifier MUST NOT rely on it for security. Examples: SD-JWT VC `{"path":["address","street_address"]}`, W3C `{"path":["credentialSubject","family_name"]}`, mdoc `{"path":["org.iso.18013.5.1","given_name"]}`. (https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- Response modes: `fragment` (default for `vp_token`, same-device), `direct_post` (cross-device/large POST to `response_uri`), `direct_post.jwt` (encrypted JWE POST), `dc_api` / `dc_api.jwt` (W3C Digital Credentials API only). `vp_token` response is a JSON object keyed by DCQL `id` → array of presentations (single element unless `multiple`). (https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- `client_id` validation per prefix (full `prefix:orig` string is the aud): `redirect_uri:` orig is redirect/response URI, unsigned only; `x509_san_dns:` orig DNS MUST match leaf SAN dNSName, signed via `x5c` key, chain validated; `x509_hash:` orig is base64url(SHA256(DER leaf)), signed via `x5c`; `decentralized_identifier:` orig is a DID, signed, `kid` selects `verificationMethod`, resolved via DID method; `verifier_attestation:` orig MUST equal attestation `sub`, signed with `cnf` key, attestation JWT in `jwt` header. (https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- Verifier replay checks: holder binding MUST be bound to `client_id` + `nonce`; reject any VP with wrong `nonce`; Wallet MUST link every VP to request `client_id` + `nonce`; over DC API `aud` MUST be `origin:<Origin>` with `expected_origins` checked; presentations without holder binding require a fresh 128-bit `state` echoed back; Wallet MUST echo `wallet_nonce`; `transaction_data` MUST be hashed into `transaction_data_hashes` (sha-256 default) inside KB-JWT / mdoc DeviceSigned. (https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)

## 2. SD-JWT, RFC 9901 (RFC text read)

- Disclosure encoding: `base64url(UTF8(JSON([salt, name?, value])))` for objects (`salt` unique, `name` ≠ `_sd`/`...`), `[salt, element]` for array elements. Digest = `base64url(hash(US-ASCII(Disclosure)))` via `_sd_alg` (default sha-256). Digests embed as `_sd:[digests...]` (shuffled) or `{"...":digest}`; decoy digests with no Disclosure are allowed. (https://www.rfc-editor.org/rfc/rfc9901.txt)
- Verifier recomputes: check Issuer JWT signature (`none` forbidden); for each received Disclosure recompute the digest and require membership in `_sd`/`...`; reject duplicates/unknown; rebuild the payload. KB-JWT exact fields — header `typ: kb+jwt` REQUIRED, `alg` REQUIRED (≠ `none`); payload `iat` REQUIRED, `aud` REQUIRED single string, `nonce` REQUIRED string, `sd_hash` REQUIRED base64url hash. `sd_hash` covers `US-ASCII("<IssuerJWT>~<D1>~...~<DN>~")` with the same hash as the Disclosures. (https://www.rfc-editor.org/rfc/rfc9901.txt)
- Without KB-JWT is acceptable only if verifier policy does not require Key Binding (trailing `~` = SD-JWT, KB-JWT appended = SD-JWT+KB). Stated risk (§9.9): without binding the verifier gets proof of the issuer signature only — the presentation "can be replayed by anyone who gets access to it". Verifier MUST decide whether KB is required and MUST reject KB-expected-but-missing. (https://www.rfc-editor.org/rfc/rfc9901.txt)

## 3. SD-JWT VC draft (type/status/cnf section read)

- Header `typ` MUST be `dc+sd-jwt` (media `application/dc+sd-jwt`); `vct` REQUIRED collision-resistant type name (new versions = new `vct`); `aka_vcts` OPTIONAL non-empty array ≠ `vct`. MUST-NOT-disclose: `iss,nbf,exp,cnf,vct,vct#integrity,aka_vcts,status` (+ sub-claims). MAY-disclose: `sub,iat`. `cnf` REQUIRED iff Key Binding, RECOMMENDED `cnf.jwk`, and the KB MUST use that key. `status`/`status_list` SHOULD be checked per verifier policy. Issuer keys via `iss` HTTPS `/.well-known/jwt-vc-issuer` (`issuer` == `iss`, `jwks` xor `jwks_uri`) or `x5c` chain. (https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/)

## 4. did:key (spec read)

- Form `did:key:<mb-value>` with `z<base58-btc(multicodec||raw)>` (or `u<base64url>`). Prefix table: `0xed` = Ed25519-pub 32B, `0xec` = X25519-pub 32B, `0xe7` = secp256k1-pub 33B compressed, `0x1200` = P-256 33B, `0x1201` = P-384 49B. Example Ed25519: `did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`. Resolution is a pure function returning a DID Document with `verificationMethod` (`Multikey`/`publicKeyMultibase`), `authentication`, `assertionMethod`, `capabilityInvocation`, `capabilityDelegation`, plus derived X25519 `keyAgreement`. (https://w3c-ccg.github.io/did-key-spec/)

## 5. W3C VC Data Model 2.0 (normative definitions read)

- `verification` = "evaluation whether [it] is an authentic and current statement of the issuer/presenter… conforms to spec, securing mechanism satisfied, status check succeeds… does not imply truth". `validation` = "assurance [the] claim satisfies business requirements… means vary widely and are outside the scope… Verifiers trust certain issuers… apply own rules". Credential = issuer's claim set; presentation = data derived from 1+ credentials for a specific verifier. Only `application/vc`/`application/vp` + a securing mechanism (DataIntegrity/JOSE/COSE) conform. (https://www.w3.org/TR/vc-data-model-2.0/)

## 6. Holder vs verifier allocation (the load-bearing split for ticket 03)

- OpenID4VP: "Wallet MUST link every Verifiable Presentation… to the `client_id` and `nonce`" vs "Verifier MUST verify this binding… If any VP… does not contain correct nonce, response MUST be rejected". (https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- SD-JWT: Issuer "decides which claims are selectively disclosable"; Holder "MUST NOT send Disclosures… for data not to reveal… MUST NOT send [a] Disclosure not included or more than once" — i.e. the holder enforces `requested ∩ available ∩ allowed`; Verifier decides whether Key Binding is required and MUST validate issuer sig, digests, and KB sig via `cnf` + `sd_hash`/`aud`/`nonce`. (https://www.rfc-editor.org/rfc/rfc9901.txt)
- VC 2.0: "Verifiability… does not imply truth… verifier validates included claims using their own business rules… after evaluating issuer, proof, subject, claims against one or more verifier policies"; the holder composes presentations, possibly multi-credential. (https://www.w3.org/TR/vc-data-model-2.0/)

## Key takeaways (→ ticket 03 disclosure)

- Presentation = `{disclosures ⊆ requested ∩ available ∩ allowed}` + KB-JWT(`aud`=recipient binding id, `nonce`, `iat`, `sd_hash` over exact `IssuerJWT~D1~…~DN~` serialization). Reject bearer-only presentations for anything consequential — the RFC's replay warning is the justification.
- DCQL `values` matching is explicitly NOT security-relevant ("MUST NOT rely") — enforcement belongs in the allow-list intersection, never in query matching.
- v0.1 key support (`did:key` Ed25519 + raw keys) covers the `cnf.jwk` holder-binding path without a universal resolver; `/.well-known/jwt-vc-issuer` is the issuer-discovery fallback.

## Sources

1. [OpenID4VP 1.0 Final](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html) — request, DCQL, response modes, client_id prefixes, replay checks
2. [RFC 9901 (SD-JWT)](https://www.rfc-editor.org/rfc/rfc9901.txt) — disclosures, digests, KB-JWT, binding policy
3. [SD-JWT VC draft](https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/) — vct, must-not-disclose set, cnf, issuer discovery
4. [did:key spec](https://w3c-ccg.github.io/did-key-spec/) — prefixes, resolution output
5. [VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/) — verification vs validation, presentation model

## Methodology

Parallel subagent read primary texts via webfetch, quoting field names; main session synthesized. GAPS (honest): OpenID4VP `openid_federation:` prefix, full `meta`/`trusted_authorities` semantics, `vp_formats_supported` negotiation, and mdoc `SessionTranscript` bytes not line-verified (fetch truncated); SD-JWT VC Type Metadata processing (`extends`, `vct#integrity` algorithm) read only at §2; VC 2.0 §7.1 algorithm return fields seen via snippets only; did:key varint byte encoding not line-verified. None gate ticket 03's v0.1 scope (SD-JWT + `did:key` Ed25519 holder binding).

## Spot-verification (main session, 2026-09-09)

RFC 9901 full text fetched; §§4.3.2/7.3/9.5/9.9/7.2/4.1.2/9.7 extracted verbatim via targeted re-read. All six load-bearing claims CONFIRMED: (a) KB-JWT requires `typ=kb+jwt`, `alg≠none`, `iat`, single-string `aud`, string `nonce`, `sd_hash`; (b) `sd_hash` over US-ASCII `<IssuerJWT>~<D1>~…~<DN>~` with the disclosure hash algorithm; (c) trailing-tilde distinguisher with MUST-checks on the final component; (d) duplicate-digest and unreferenced-Disclosure rejection; (e) policy-decided KB plus anyone-can-replay-without-it; (f) holder MUST-NOTs. Three additions for ticket 03: (1) downgrade rule — the verifier MUST decide the KB requirement upfront and MUST NOT infer it from presentation form, since an attacker can strip the KB-JWT (§9.5); per-recipient KB policy is therefore mandatory, never optional inference. (2) KB `iat` must fall inside an acceptable window (§7.3) — freshness is normative. (3) Validity-critical claims (`exp`, `cnf`, `iss`, `nbf`) MUST NOT be selectively disclosable (§9.7) — keep them always-visible in the claim catalog.
