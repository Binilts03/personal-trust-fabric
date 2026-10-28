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


## Build on authority, not trust in the agent

A useful agent needs to do things, not just suggest them. But giving an agent a credential, card, or unrestricted API token means the *tool* can carry more power than the individual task requires. Changing the agent should not mean copying your secrets into a new runtime.

**PTF's answer:** the principal controls authority; the host keeps protected state; an agent can request a specific operation and receive a bounded result. The decision is deterministic, not an LLM judgment.

**Start here:** [Run the 2-minute demo](#run-a-deny-by-default-decision) · [See what is implemented](#whats-real-today) · [Find a way to contribute](#where-contributors-can-make-a-difference) · [Review the next architecture](https://github.com/Binilts03/personal-trust-fabric/pull/121)

## Run a deny-by-default decision

You can try the **domain-neutral Authority engine** without keys, accounts, payments, a model, or a live provider.

Requirements: Node.js 22+, npm 10+, Git. The package is **not yet published to npm**.

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
npm ci
npm run build
node examples/authority-decision.mjs
```

Expected console output:

```text
ALLOW: exact operation for agent-a (grant: one-task)
DENY: other actor
DENY: changed recipient
CHECK only: no authority consumed, no external effect
```

The demonstration uses the **curated public API**. One person grants one named agent permission to submit a particular synthetic task to one recipient. The same request from another agent or to a different recipient is refused. Nothing is executed: this is a **CHECK**, not a redeemed, externally performed effect.

[Read the runnable example](examples/authority-decision.mjs) · [Try the operator CLI next](docs/getting-started.md) · [Inspect the tests](tests/readme-example.test.ts)

## Why the boundary matters

Suppose a person asks an agent to pay an invoice, use a credential for an API call, or share one verified claim. Different agents might understand the request differently or be compromised. The permission to act cannot safely be whatever the agent says it is.

PTF separates the responsibilities:

| Who or what | Responsibility |
| --- | --- |
| **Principal** | Grants or approves bounded authority for an operation |
| **Agent** | Proposes an action and its exact terms; does not mint permission |
| **PTF Authority** | Verifies the existing grant, scope, actor, purpose and constraints |
| **Trusted host** | Verifies identity, protects secrets, checks redemption and runs a permitted effect |
| **External provider** | Performs the domain-specific operation; the host must verify its evidence |

The security-critical sequence is **CHECK ≠ REDEEM ≠ EXECUTE**. A successful check does not confer executable authority. Exact effect-bearing terms must match the authorization, a real recipient proof is required for redemption, and a consumed use must be durably recorded before a protected effect. Uncertain external outcomes require reconciliation rather than a blind retry.

PTF's core is intentionally **model-independent**: generative AI can interpret intent or discover options, but deterministic enforcement decides what the agent is allowed to do.

## What's real today

This repository contains running reference code, abuse tests, documented security limits, and an operator interface—not a deployed service or an audited production custodian.

| Area | Present on `main` | What remains the responsibility of an adopting host |
| --- | --- | --- |
| Authority | Default deny; standing grants and one-time approvals; exact-term digests; narrowing policies | Trusted identity verification and correct issuer/recipient registration |
| Personal State | Encrypted local vault, purpose/agent-scoped access and protected secret use | Secure custody, deployment isolation and backup management |
| Disclosure | Requested ∩ available ∩ allowed; holder-bound presentation | Verifier trust, consent/policy applicability and permitted release of claim values |
| Protected execution | Provider interfaces, receipt binding, journaled reference execution | External service integration, delivery/settlement checks, reconciliation |
| Agent access | CLI plus MCP proposal, disclosure and payment redemption flows | Authenticated host setup, human approval and safe tool exposure |
| Privacy extension | Optional host-composed controls; DPDP-informed synthetic profile | Legal validity, comprehensive processing coverage and real-world compliance |

**Try the other reference paths:** [payment and disclosure](examples/payment-disclosure.mjs), [vault/credential use](examples/vault-protected-action.mjs), and [synthetic DPDP-informed processing](examples/dpdp-consent-gateway.mjs). These scripts are reference source, not evidence of real transfers, email delivery, live institutional integration, or legal compliance. Some extended examples have pending execution fixes in [the consolidation PR](https://github.com/Binilts03/personal-trust-fabric/pull/121); start with the tested Authority demonstration above.

PTF does **not** settle payments, issue identities, provide a wallet, or run an agent's reasoning loop. It provides a reusable authority and protected-use layer that hosts can integrate.

## The next proof: reuse beyond payment

The [domain-neutral consolidation, draft PR #121](https://github.com/Binilts03/personal-trust-fabric/pull/121), is deliberately separate from released `main`.

It introduces a common protected-effect boundary, an explicit host-selected privacy-processing mode, recipient-proof support for generic operations, and **trusted-host registration** of non-payment MCP actions. The draft includes a **synthetic `/email/send` example** using a fake provider; it does not deliver email.

We have a local demonstration of reuse. **We do not yet have independent external adoption.** We want evidence that an integrator can use the public surface without private source imports, special-case workarounds or weakened security guarantees.

This is the engineering question behind the project:

> Can two independent hosts safely delegate very different operations through the same authority contract without giving their agents the underlying secrets?

The draft is open to critical review. **Do not use its APIs as if they already shipped on `main`.**

## Where contributors can make a difference

Security researchers, protocol implementers, host builders, and technical writers all have useful ways in. You do **not** need to work on the payment profile.

| If you work on… | A valuable contribution |
| --- | --- |
| **Agent runtime / MCP integrations** | Try the public surfaces in an independent host; document every missing seam, hidden assumption and unnecessary tool |
| **Security / threat modeling** | Find an actor-confusion, recipient-substitution, replay, mutation, crash or secret-exposure counterexample; include a minimal reproducer |
| **Specification / interoperability** | Help define implementation-independent exact-term, capability and receipt vectors; challenge ambiguities in the [domain vocabulary](CONTEXT.md) |
| **Developer experience** | Test first-run instructions on Windows, Linux or macOS; make a genuine onboarding failure reproducible |
| **Reliability / providers** | Stress idempotency, unknown effects, durable consumption and recovery against a deliberately unreliable fake provider |

**A good first contribution is one verifiable observation**, not a sweeping redesign. Reproduce a failure, write a focused test or propose a concrete contract improvement, and explain the boundary it affects. For architecture changes, connect the proposal to an [ADR](docs/adr/) and add an abuse case.

To participate: [Read contributing guidelines](CONTRIBUTING.md) · [Browse issues](https://github.com/Binilts03/personal-trust-fabric/issues) · [Review PR #121](https://github.com/Binilts03/personal-trust-fabric/pull/121). Security vulnerabilities should be [reported privately](SECURITY.md), never as public exploit details.

If you want to follow progress, **star the repository**. If you want to shape it, an independently reproduced finding or a focused PR is more valuable than a star.

## Verify the claims yourself

```sh
npm run check:brand
npm run typecheck
npm test
npm run eval
bash scripts/harness.sh
npm run verify:package -- --install
```

CI checks the same security-relevant project surfaces and also builds the documentation site and runs secret scanning. Green checks mean the specified code and tests passed; they are **not** a third-party audit, real provider certification, a statutory legal opinion, or proof of multi-tenant production readiness.

[Verification guide](docs/audit/verify.md) · [Threat model](THREATMODEL.md) · [Known limitations](docs/audit/limits.md) · [Architecture decisions](docs/adr/) · [CLI reference](docs/cli-reference.md) · [MCP contract](docs/mcp-contract.md) · [Host Kit](docs/host-kit.md)

## Project layout

- `src/core/` — deterministic Authority, approvals, capability and execution rules.
- `src/store/` — encrypted vault, local durability, audit and execution journal.
- `src/adapters/` — evidence/protocol translators and provider interfaces.
- `src/profiles/` — domain conventions including payment and data requests.
- `src/hostkit/` — opt-in host effect boundary and conformance tests.
- `src/privacy/` — optional privacy processing enforcement and evidence.
- `examples/`, `tests/` — runnable reference behavior and adversarial checks.

**Roadmap:** independent cross-domain host proof; normative specification and frozen conformance vectors; independent security review; then the custody, ingress and durability work needed for real deployments. Avoid claiming these goals are finished because a synthetic example passes.

## License

Apache-2.0 — [LICENSE](LICENSE).
