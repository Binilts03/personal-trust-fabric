# Deep read: delegation and policy models (Macaroons, UCAN Invocation, Cedar, AuthZEN, RFC 8693, Biscuit)

_Generated: 2026-09-09 | Sources: 6 primary | Confidence: High, except Macaroons formulas (UNVERIFIED — PDF unparseable, see gaps)_

Supersedes the delegation section of `2026-09-08-agentic-commerce-protocols.md`. Read from spec text.

## 1. Macaroons (partially verified — PDF could not be parsed)

- Reported chain: `sig0 = HMAC(rootKey, id)`, `sig_i = HMAC(sig_{i-1}, caveat_i)`; only terminal `sig_n` stored, caveats in clear in sequence — UNVERIFIED (search-index excerpts only). (https://theory.stanford.edu/~ataly/Papers/macaroons.pdf)
- Reported verification: recompute all intermediates from root key + id + ordered caveats, compare to presented terminal sig; removal/reorder mismatches — UNVERIFIED. (https://theory.stanford.edu/~ataly/Papers/macaroons.pdf)
- Reported caveats: first-party `cav@> <predicate, 0>` checked locally as `predicate ∈ A`; third-party `cav@L <cId, vId>` with `cId = Enc(K_thirdparty, caveatRootKey+predicates)`, `vId = Enc(currentSig, caveatRootKey)`, location `L` an unsigned hint — UNVERIFIED. (https://theory.stanford.edu/~ataly/Papers/macaroons.pdf)
- Reported discharge flow: holder sends `cId` to third party → third party mints discharge macaroon rooted at `caveatRootKey` with id `cId` → holder binds via `PrepareForRequest: H(dischargeSig :: authSig)` → target recursively verifies — UNVERIFIED. (https://theory.stanford.edu/~ataly/Papers/macaroons.pdf)
- Revocation discussion in the paper: NOT recovered (binary PDF). Standing position unchanged: symmetric-only verification disqualifies Macaroons as the PTF capability format (only the secret holder can verify); retained as prior art for caveat-chaining intuition. (https://theory.stanford.edu/~ataly/Papers/macaroons.pdf)

## 2. UCAN Invocation v1.0.0 (README read in full — corrects earlier notes)

- Envelope tag MUST be `ucan/inv@1.0.0`. Payload fields: `iss, sub, aud, cmd, args, prf, meta, nonce, exp, iat, cause`. There is NO `do`/`nnc` field in this version — earlier summary was wrong. (https://raw.githubusercontent.com/ucan-wg/invocation/main/README.md)
- REQUIRED: `iss` (DID), `sub` (DID), `cmd` (String), `args` (Map), `prf` ([CID]), `nonce` (Bytes), `exp` (Int|null). OPTIONAL: `aud` (DID, ≠ sub, omit if = sub), `meta` (non-empty Map), `iat` (Int, untrusted), `cause` (CID Receipt). (https://raw.githubusercontent.com/ucan-wg/invocation/main/README.md)
- `prf` MUST be CIDs of Delegations, root-first, strict chain `aud[n] == iss[n+1]`, ending `iss == invoker iss`, all `sub` == invocation `sub`. `args` MUST pass all delegation Policies or the invocation is rejected. (https://raw.githubusercontent.com/ucan-wg/invocation/main/README.md)
- `nonce` MUST be random per non-idempotent Task; SHOULD be `0x` empty for idempotent/pure commands. TaskID = CID(`sub,cmd,args,nonce`). Short `exp` timeout RECOMMENDED as anti-replay. (https://raw.githubusercontent.com/ucan-wg/invocation/main/README.md)
- Executor checklist (inference from payload + proof-chain rules): verify envelope signature by `iss`, validate full `prf` chain to `sub`, check `sub/cmd/args` authorized by proofs, enforce `exp`, enforce uniqueness via `nonce`/TaskID. (https://raw.githubusercontent.com/ucan-wg/invocation/main/README.md)

## 3. Cedar (policy + authorization + validation docs read)

- Anatomy: `effect scope when/unless;` with effect = `permit|forbid`, scope = `principal,action,resource` constraints, `when` = must-be-true, `unless` = must-be-false. Example: `permit(principal==User::"alice",action==Action::"view",resource==Photo::"a.jpg");`. (https://docs.cedarpolicy.com/policies/syntax-policy.html)
- Default-deny: Allow iff ≥1 `permit == true` AND zero `forbid == true`; else Deny. Empty store = Deny (implicit). Any `forbid == true` = Deny — explicit deny overrides all permits. (https://docs.cedarpolicy.com/auth/authorization.html)
- Evaluation order: scope match, then `when`/`unless`; combine: (1) any forbid-true → Deny, (2) else any permit-true → Allow, (3) else Deny. `error` skips the policy and surfaces in diagnostics (caller may escalate). (https://docs.cedarpolicy.com/auth/authorization.html)
- Schema validator (offline, at policy-create time, not per-request) catches: unknown entity/action types, wrong principal/resource for an action, `==` vs `in` misuse, unknown/unsafe-optional attributes (needs `has` + `&&`), operator type mismatches, bad enum EIDs; warns on always-false policies and mixed-script/bidi strings. (https://docs.cedarpolicy.com/policies/validation.html)

## 4. AuthZEN Authorization API draft-01 (spec read)

- Request: `{subject:{type*,id*,properties?}, action:{name*,properties?}, resource:{type*,id*,properties?}, context?{}}`. `subject`/`resource` share the `type/id/properties` shape; `action` uses `name/properties`. (https://openid.net/specs/authorization-api-1_0-01.html)
- Response: `{decision*:boolean}` (`true` = permit, `false` = MUST NOT permit) + optional `context:{}` for advice/obligations/reasons (`id`, `reason_admin`, `reason_user`). HTTP `200` carries a deny-decision; `401/403/500` are transport errors only. (https://openid.net/specs/authorization-api-1_0-01.html)
- Assumes PEP↔PDP over TLS; PDP SHOULD authenticate the PEP via mTLS/OAuth2-bearer/API-key (out of scope); PDP trusts PEP inputs, PEP enforces. `Authorization: Bearer/Basic` + `X-Request-ID` echo defined. (https://openid.net/specs/authorization-api-1_0-01.html)

## 5. RFC 8693 token exchange (key sections re-read from RFC text)

- `act` value is an object of actor claims (identity only — `exp`/`nbf`/`aud` meaningless inside). Nesting: outermost = current actor, each inner `act` = prior actor, deepest = least-recent. Consumers MUST use only top-level claims + current `act`; nested history is informational only. (https://www.rfc-editor.org/rfc/rfc8693.txt)
- `may_act` = `{sub[,iss,email…]}` inside the subject token, asserting the named party is eligible to become actor; the AS uses it to authorize delegation/impersonation exchanges. Same shape in JWT and introspection responses. (https://www.rfc-editor.org/rfc/rfc8693.txt)
- §5: delegation/impersonation enable abuse — mitigate with `scope` restriction + limited lifetime + token-type-aware validation + encrypted channels/minimization. Exchange does not revoke or link input/output tokens by default. (https://www.rfc-editor.org/rfc/rfc8693.txt)

## 6. Biscuit authorization (authorization-policies + spec tail read)

- Order: load facts/rules with block scope → run Datalog to fixpoint → ALL `check if/all/reject if` must succeed → then `allow`/`deny` policies in sequence, first match wins and short-circuits. No matching policy = fail. Checks are AND, policies are OR. (https://doc.biscuitsec.org/getting-started/authorization-policies)
- Only the authorizer defines `allow`/`deny`. Token blocks add `facts/rules/checks` and by default only attenuate; non-authority facts are visible only to their own block unless `trusting authority|previous|ed25519|secp256r1/<key>`. Scope default = authority + current + authorizer. (https://doc.biscuitsec.org/reference/specifications.html)
- Revocation fact shape: `revocation_id(<blockIndex>, <blockSignatureBytes>)`, auto-generated per block with the signature as id; enforcement pattern is authorizer-provided revocation-list facts plus a `reject if`-style check — check pattern is inference. (https://doc.biscuitsec.org/reference/specifications.html)
- Third-party flow: holder builds `ThirdPartyBlockRequest{previousSignature*}` → third party returns `ThirdPartyBlockContents{payload*=Block, externalSignature*=ExternalSignature{signature*,publicKey*}}` → holder appends. External blocks use isolated symbol/key tables and need sig-v1 + datalog ≥3.2. (https://doc.biscuitsec.org/reference/specifications.html)

## Key takeaways (→ ticket 01 policy + approval)

- Offline default-deny with citation-carrying allows fits a Biscuit/Cedar hybrid, NOT AuthZEN (online PDP round-trip per decision) and NOT raw RFC 8693 (needs an STS). Adapt by embedding signed `permit` citations as authority facts plus `revocation_id` + expiry checks: forbid-guardrails first, `allow if citation(…)` last. (Inference from the above.)
- PTF `Policy.evaluate` shape: input `{subject sì principal, action, resource, context}` (AuthZEN-shaped, offline) → output `{allow, citations[]}` or `{deny, reason}` with Cedar precedence (any forbid wins, else any cited permit, else deny). Schema validation at grant-create time (Cedar-style), never per-request.
- PTF demand ≈ UCAN Invocation without the envelope: `{sub,cmd,args,proofs,nonce,exp}` + recipient proof; executor checklist mirrors the Invocation checklist plus termsDigest equality and maxUses. Adopt the nonce rule verbatim (random per non-idempotent action, empty only for pure/idempotent reads).
- One correction applied to prior work: no `do`/`nnc` fields exist in Invocation v1.0.0 — do not reference them in code or docs.

## Sources

1. [Macaroons paper (Stanford PDF, unparsed)](https://theory.stanford.edu/~ataly/Papers/macaroons.pdf) — prior art only, formulas UNVERIFIED
2. [UCAN Invocation spec](https://raw.githubusercontent.com/ucan-wg/invocation/main/README.md) — envelope, fields, proof chains, nonce rules
3. [Cedar policy syntax / authorization / validation](https://docs.cedarpolicy.com/policies/syntax-policy.html) — anatomy, default-deny, evaluation order, offline validation
4. [AuthZEN draft-01](https://openid.net/specs/authorization-api-1_0-01.html) — request/response shapes, transport assumptions
5. [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.txt) — act nesting, may_act, §5 mitigations
6. [Biscuit authorization + spec](https://doc.biscuitsec.org/getting-started/authorization-policies) — check/policy order, scopes, third-party blocks

## Methodology

Parallel subagent read primary texts via webfetch, quoting field names and flagging single-source claims; main session synthesized. GAPS: Macaroons PDF binary via webfetch (needs `pdftotext` re-read; non-gating — format already rejected); revocation-invocation nonce rule lives in delegation/revocation spec, not Invocation README; Biscuit `ThirdPartyBlockRequest` legacy-field details need `schema.proto` raw read (queued in spot-verification); Cedar JSON-policy format and RFC 8693 appendix example not re-checked field-by-field.

## Spot-verification (main session, 2026-09-09)

- Raw UCAN Invocation README read in full: tag `ucan/inv@1.0.0`; REQUIRED `iss/sub/cmd/args/prf/nonce/exp`; OPTIONAL `aud/meta/iat/cause`; `aud` MUST differ from `sub` (omit when equal); `meta` non-empty-or-omitted; TaskID = CID(`sub,cmd,args,nonce`); random nonce, empty `0x` only for idempotent commands; short `exp` anti-replay — all confirmed. Three additions for implementation: (1) `iat` is untrusted by spec — never use it for validity, only `exp` + ledger clocks; (2) an unsigned payload MUST NOT count as an invocation — envelope/signature required, matching our dry-run-vs-redeem split; (3) public-resource invocations MAY skip closed-loop proofs but SHOULD NOT by default — adapters must opt in explicitly, never silently.
- Raw Biscuit `schema.proto` read in full: `ThirdPartyBlockRequest{legacyPreviousKey?, legacyPublicKeys[], previousSignature*}`, `ThirdPartyBlockContents{payload*, externalSignature*}`, `Proof{nextSecret | finalSignature}`, `Check{queries[], kind? (One|All|Reject)}`, `Policy{queries[], kind (Allow|Deny)}`, `PublicKey{algorithm (Ed25519|SECP256R1), key}` — all confirmed.
