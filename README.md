<!-- PTF-BRAND:START -->

# Personal Trust Fabric

> **Authority should travel. Secrets should not.**

PTF is a user-owned authority and protected-use layer for interchangeable AI agents. An agent can act with precisely bounded authority without receiving the underlying credential, payment instrument, signing key, or unrestricted token.

```text
                    authority
person  --------------------------------+
                                         \
agent A  -------------------------------> [ PTF ] ---> protected action
agent B  -------------------------------> [     ] ---> disclosure
local    -------------------------------> [     ] ---> signature
                                             |
personal state -------------------------->  |
                                      secrets stop here
                                             |
                                             v
                                          receipt
```

Default deny. Exact terms. Use without possession. External messages are evidence, never authority.

## Why this exists

Agent platforms are getting better at acting for people, but the authority to act is usually trapped inside a specific platform, session, credential store, or provider integration. PTF separates **who may do what** from **who possesses the secret needed to do it**. The agent proposes an operation. PTF evaluates user-owned authority deterministically. Protected state stays behind the boundary. The agent receives only the minimum disclosure or a secret-free receipt.

## An authority decision, not an AI opinion

```text
request
  actor       did:agent:travel
  action      /travel/book
  resource    flight:AI812
  purpose     personal-travel

authority
  source      grant:g-travel
  ceiling     INR 15,000
  secret      retained by PTF

decision      ALLOW
receipt       secret-free
```

The transcript above is illustrative, not a claim that every domain adapter is production-ready today. Current implementation status and known limits are documented below.

**Boundary:** PTF owns authority semantics, policy, protected state, approval, secret mediation, execution authorization, portable decision semantics, and audit evidence. External systems still own settlement, travel booking, delivery, identity issuance, and other domain-specific rails. Payment is one profile, not the product.

<!-- PTF-BRAND:END -->

## What PTF is

Personal Trust Fabric (PTF) is a **user-owned authority and protected-use layer for AI agents**. It separates an agent's ability to *request* an action from the principal's authority to *permit* that action and the trusted host's ability to *perform* it.

It is not an AI agent framework, a wallet, a payment service, or a DPDP compliance product. Its reusable mechanism can govern delegated purchases, API operations, communications, selective disclosure, signing, and other operations. Payment is one profile; privacy processing is an optional host-composed extension.

The distinction is structural:

- **Personal State** holds information or credentials about the principal. It never creates permission.
- **Authority State** holds standing grants and exact-term approvals. An allow decision must be grounded in these.
- **Policy** can narrow existing authority; it cannot invent it.
- **The trusted host** verifies the actor, binds the operation and recipient, keeps secrets, composes any applicable privacy controls, and owns the provider.
- **The agent** proposes work, receives only approved disclosures or bounded receipts, and cannot register its own provider or approve its own request.

Authorization is deterministic. No generative model decides whether a grant exists, whether terms match, or whether a recipient proved possession of its key.

## Implementation status

**Working reference implementation; not production-certified infrastructure.** The consolidation candidate on this branch demonstrates reuse beyond payment, but it has not yet been validated by an independent host adopter or deployed as a multi-tenant service.

| Area | What exists | What it does not prove |
| --- | --- | --- |
| Authority | Default-deny grants, one-time approvals, policy narrowing, operation digests, cited decisions | The agent's asserted identity is trusted without host verification |
| Protected state | Encrypted local vault, scoped disclosure and in-host secret use | HSM custody or safe public-cloud multi-tenancy |
| Protected effects | Host Kit, recipient-signed redemption, consumption before effects, provider journal and bounded receipts | Exactly-once delivery across arbitrary remote systems |
| Agent interfaces | Operator CLI; MCP propose, check, present, redeem and receipt paths | Arbitrary agent actions can execute without host registration |
| Optional privacy | Processing preflight, recheck, event precommit, effect fence and event finalization; first DPDP-informed profile | Legally valid consent, statutory compliance or universal interception |
| Provider/protocol edge | Generic provider contract and protocol adapters, including HTTP/x402 transports | Independent settlement, booking or delivery verification |

The **same protected-effect boundary** now supports a non-payment reference action. Payment-specific ceiling and currency defenses deliberately remain in their established enforcement paths while compatibility is assessed; consolidation does not remove those safeguards.

## Run the reference flows

Requires Node.js 22+, npm 10+ and Git. **PTF is not yet published to npm.** While the consolidation has not merged to `main`, check out this branch:

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
git switch feat/ptf-domain-neutral-consolidation-20261024
npm ci
npm run build
node examples/generic-protected-action.mjs
node examples/payment-disclosure.mjs
node examples/vault-protected-action.mjs
npm run test:examples
```

**Start with the generic example:** `/email/send` is authorized for a single opaque message handle, bound to an exact recipient, redeemed against a real local recipient signature, and handed to a **fake** email provider. The example uses published package entry points rather than importing a private core helper. **No email is sent.**

The payment example uses a fake executor: **no money moves**. The vault example exercises purpose/agent-scoped reads and in-host credential use. `node examples/dpdp-consent-gateway.mjs` demonstrates an **offline synthetic** personal-data-processing scenario, not a live clinic, legal compliance, or organizational rollout.

For the actual operator interface, run:

```sh
node dist/src/cli.js --help
```

[Getting Started](docs/getting-started.md) provides full Bash and PowerShell setup, including a private passphrase file, recipient registration, a standing grant, a simulated payment receipt and audit verification. [CLI Reference](docs/cli-reference.md) documents the available commands.

## The execution contract

```text
agent proposes exact operation
          |
trusted host verifies principal + actor
          |
standing grant or human approval -> deterministic Authority check
          |
recipient + resource + purpose + effect context are bound
          |
recipient-signed capability proof is redeemed
          |
applicable host-owned privacy controls (optional narrowing)
          |
authority use is consumed and durably persisted
          |
journaled protected provider performs the effect
          |
agent receives a bounded receipt, not host secrets
```

Three different events must not be confused:

1. **CHECK is not REDEEM.** A dry-run has no effect and consumes no authority.
2. **REDEEM is not permission to do something different.** Proof is recipient-bound and the effect-bearing context must equal the authorized terms. A trusted host selects the provider and effect implementation.
3. **A receipt is not independent evidence that an external rail settled.** Failed or ambiguous submissions require reconciliation, not blind retries.

**Disclosure is intentional:** a presentation can return the approved intersection of requested, available and allowed claim values. That is different from *secret use*, where the credential remains in the trusted host and the caller gets an effect result. PTF does not claim that every approved disclosure contains no personal data.

## A domain-neutral authorization example

The curated public API can evaluate a non-payment operation without involving the payment or DPDP profiles. This example **only proposes** an action; it neither consumes a grant nor sends a message.

```js
import { Authority, requestExecution } from "personal-trust-fabric";

const now = Math.floor(Date.now() / 1000);
const authority = new Authority({ nowSec: () => now });

authority.addGrant({
  id: "one-message",
  principal: "owner",
  actor: { kind: "exact", id: "email-agent" },
  action: { name: "/email/send" },
  bounds: [
    { path: ".context.messageId", op: "==", value: "msg:7" },
    { path: ".context.recipient", op: "==", value: "provider:email" },
  ],
  exp: now + 300,
  maxUses: 1,
});

// The host must verify identity out of band; an agent's JSON is not proof.
const ingress = {
  id: "email-agent",
  principal: "owner",
  source: "local-registration",
  proofRef: "synthetic-example",
};

const proposal = requestExecution(authority, ingress, {
  action: "/email/send",
  resourceType: "email-message",
  resourceId: "msg:7",
  purpose: "delegated-email",
  context: { messageId: "msg:7", recipient: "provider:email" },
}, { nowSec: now });

console.log({ allowed: proposal.decision.allow, digest: proposal.digest });
```

The fully executable proof-and-receipt sequence is in [`examples/generic-protected-action.mjs`](examples/generic-protected-action.mjs). The source checkout must be built before importing the package by its own name.

## Integrating PTF with a trusted host

The supported package surfaces reflect what the host actually needs:

| Import | Role |
| --- | --- |
| `personal-trust-fabric` | Curated Authority, protected-state and agent-contract APIs |
| `personal-trust-fabric/hostkit` | `createProtectedEffect`, `createHostRedemptionChallenge`, privacy-required legacy `createEffectBoundary` and conformance runner |
| `personal-trust-fabric/providers` | Protected provider contracts and fake test providers |
| `personal-trust-fabric/profiles/data` | Domain-neutral proposals |
| `personal-trust-fabric/mcp` | Trusted Node embedding with `createPtfServer` and exact-action registration |
| `personal-trust-fabric/privacy` | Optional privacy integration |

**The Host Kit is an integration boundary, not an interceptor.** An effect that bypasses the trusted host's configured boundary is not covered by its checks.

`createProtectedEffect` requires a **host-selected** processing mode. An `enforced` mode includes the configured privacy runtime and gate; `not-enforced` is an explicit trusted-host assertion, **not** an agent-controlled way around privacy obligations. The older `createEffectBoundary` remains privacy-required for compatibility, including its existing `eventId` receipt contract. The new boundary emits `privacyEventId` only when processing evidence exists.

For MCP, `ptf_request_action` can propose a generic action, but `ptf_redeem` can execute only payment or an **exact action registered by a trusted embedding host** with its own input validator, provider and processing decision. The shipped `ptf-mcp-server` does not enable arbitrary execution or the synthetic email provider by default. MCP has **no agent-accessible approve tool**; the principal grants or approves via trusted operator paths.

Read the [Host Kit guide](docs/host-kit.md), [MCP contract](docs/mcp-contract.md) and [use-case catalog](docs/use-cases.md) before integrating. A real provider must enforce its own network, delivery, signing and settlement guarantees.

## Limits that matter

- **Trusted-host assumption:** PTF cannot defend against a host that deliberately bypasses checks, exposes keys or lies about effect outcomes.
- **Local custody and topology:** the reference keystore, vault and journal use local stores with single-writer, backup and crash limitations. Protect passphrases and backups; this is not a multi-tenant production service.
- **Unknown outcomes:** an external effect may succeed even if the host loses its acknowledgment. Journal reconciliation and provider-side checks are operator responsibilities.
- **Bounded disclosure, not zero disclosure:** explicitly permitted claim values may leave PTF; protected secrets are intended to remain on the host-side secret-use path.
- **Optional privacy, not legal certification:** a DPDP-informed processing profile can check configured evidence on integrated paths but cannot decide whether a statutory processing basis is valid.
- **Synthetic validation, not independent adoption:** the second-domain demonstration exercises the reusable core locally. It does not establish compatibility with independent implementations, real delivery rails, or a third-party security audit.

The authoritative caveats are in [Known Limits](docs/audit/limits.md), [Threat Model](THREATMODEL.md), [Security Policy](SECURITY.md) and [Verification Guide](docs/audit/verify.md). External protocols are *evidence*, never additional authority.

## Code and evidence map

| Location | Responsibility |
| --- | --- |
| `src/core/` | Deterministic Authority, capability and exact-operation semantics |
| `src/store/` | Encrypted vault, keys, proposals, audit and durable execution state |
| `src/hostkit/` | The protected-effect boundary, recipient proof and conformance checks |
| `src/adapters/` | Protocol translation, evidence validation and provider connectors |
| `src/profiles/` | Domain profiles and request helpers |
| `src/privacy/` | Optional processing controls and jurisdiction-specific evidence |
| `src/mcp/` | Trusted-host registration for generic MCP effects |
| `examples/` and `tests/` | Local demonstrations and behavioral/abuse checks |

[`CONTEXT.md`](CONTEXT.md) defines the domain vocabulary. [Architecture decisions](docs/adr/) explain the security trade-offs; [ADR-0026](docs/adr/0026-domain-neutral-effect-consolidation.md) records the current consolidation and its stop conditions.

## Verify it yourself

```sh
npm run check:brand
npm run typecheck
npm test
npm run test:examples
npm run eval
bash scripts/harness.sh
npm run verify:package -- --install
```

CI also builds the documentation and scans for secrets. A green CI run is evidence for the tested code and package, **not** a production or legal-compliance certification.

Remaining work includes an independent host consumer, normative specification and conformance vectors, external security review, and production-grade custody/ingress/storage. The synthetic second domain is a demonstrated local reuse case, not a completed independent-adoption milestone.

## Contributing and license

[Contributing](CONTRIBUTING.md) describes the required checks, public seams and abuse-case evidence. Report security issues privately under [`SECURITY.md`](SECURITY.md); use [GitHub Issues](https://github.com/Binilts03/personal-trust-fabric/issues) for non-sensitive bugs and integration feedback.

Apache-2.0. See [LICENSE](LICENSE).
