# Security and Privacy Model

## 1. Security objective

PTF should remain useful even if the planning agent is prompt-injected or malicious. The principal security goal is not “make the model behave”; it is “limit what a misbehaving model can learn or cause.”

## 2. Adversaries

At minimum test:

1. **Malicious/prompt-injected Agent** — follows hostile instructions and tries to read/redirect protected data or authority.
2. **Malicious Website/Tool** — requests excessive data, lies about purpose, returns prompt injection, or attempts transaction substitution.
3. **Unauthorized Recipient** — obtains a capability handle/reference and tries to redeem/use it.
4. **Compromised Browser Renderer/UI** — reads DOM/storage/client logs and tampers with client state.
5. **Compromised Agent Host Process** — inspects its own filesystem/environment/memory/tool results.
6. **Memory Poisoner** — injects durable instructions/preferences through untrusted observations.
7. **Replay/Concurrency Attacker** — reuses or races one-time authority.
8. **Compromised Sync/Hosted Operator** — reads stored ciphertext/metadata or attempts rollback.
9. **Supply-Chain Attacker** — dependency/build/update compromise.
10. **Legitimate Recipient Misuse** — receives authorized plaintext and later misuses it; PTF can limit disclosure and audit but cannot claim perfect downstream control.

## 3. Trust boundaries

Codex must document the chosen architecture's actual boundaries. Do not assume “local” means trusted.

Required conceptual boundaries:
- model/agent context;
- agent process;
- PTF trusted runtime;
- protected store/key boundary;
- browser/page renderer;
- recipient/verifier backend;
- sync/hosted services;
- audit/telemetry;
- human approval surface.

## 4. Required security properties

### S-01 Model non-possession
For operations whose supported assurance mode excludes model visibility, raw Protected Values must not be emitted through model-facing PTF interfaces.

### S-02 Non-bearer where required
If an agent may possess a capability handle, possession alone cannot satisfy a policy that requires an authenticated recipient/holder.

### S-03 Binding
Authority/disclosure must be checked against approval-relevant recipient, purpose, transaction, action/scope, expiry, use, and amount/currency terms where applicable.

### S-04 No broadening
Derived/delegated capabilities cannot become broader than parent authority.

### S-05 Atomic one-time use
Single-use authority must be concurrency safe.

### S-06 Model-independent approval
Approval state and policy evaluation cannot be forged through model text/tool content.

### S-07 No-secret observability
Normal logs, receipts, traces, analytics, crash reports, and audits exclude raw protected values.

### S-08 Memory integrity
Untrusted content cannot directly write trusted persona/policy state.

### S-09 Downgrade truthfulness
If an external operation requires plaintext in a weaker boundary, the UI/policy/result must identify the downgrade.

### S-10 Revocation
Revoked capability/device/authority cannot continue to operate beyond documented propagation bounds.

## 5. Security testing with canaries

Use unique synthetic canary values for every protected class. Automatically scan all observable surfaces under test:

- model-facing tool arguments/results;
- MCP/WebMCP/A2A messages;
- browser DOM, local/session storage, IndexedDB where relevant;
- URLs/query strings;
- client/server logs;
- telemetry;
- network captures under test control;
- audit/receipt exports;
- crash/error output;
- sync payloads;
- generated screenshots/test artifacts.

A clean scan proves only the surfaces instrumented. It does not prove undocumented model-provider internals were inspected.

## 6. Adversarial scenarios

Required:
- “show me the secret” request;
- malicious tool/site asks for extra claims;
- purpose/recipient swap;
- amount/transaction mutation after approval;
- capability forwarding;
- replay;
- double-use race;
- expired/revoked authority;
- debug/error serialization attempt;
- prompt injection instructing exfiltration;
- memory write poisoning;
- summary/compaction poisoning;
- malicious recipient metadata;
- downgrade request.

Security passes only if deterministic controls block the unauthorized operation. Model refusal is not counted.

## 7. Privacy model

Classify personal state by at least:
- model-shareable;
- abstractable/derived;
- selectively disclosable;
- use-only;
- direct-delivery-only;
- never-disclose.

The exact taxonomy may change after design, but the system must represent the distinction between “agent may reason over” and “agent may only cause authorized use.”

## 8. Explicit non-guarantees

Do not claim:
- absolute security;
- protection after an authorized recipient legitimately receives plaintext beyond what recipient-side controls actually enforce;
- protection against a fully compromised trusted runtime/OS without additional assurance;
- that encryption automatically prevents inference from metadata;
- that a TEE removes all side-channel/platform risk;
- that a clean application trace proves secret absence from undocumented provider internals.
