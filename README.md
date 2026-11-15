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

## What PTF does

**Personal Trust Fabric (PTF) gives agents narrowly scoped permission to use a person's protected capabilities without giving those capabilities to the agent.**

An agent can propose an operation. PTF evaluates who is asking, what they may do, which resource and recipient are permitted, and whether the exact terms still match an existing grant or one-time approval. A trusted host can then perform the permitted effect using credentials it controls. The agent receives a bounded result or receipt.

This matters when switching between agents, delegating to multiple agents, or letting an agent complete a task without copying a broadly privileged API token, signing key, or payment credential into its context.

PTF is **not** another AI model, agent orchestrator, wallet, password manager, or blanket network interceptor. The integrating host must actually route an operation through PTF; any bypass path remains outside its protection.

### Three concrete examples

| An agent wants to… | What PTF contributes | Current evidence |
| --- | --- | --- |
| Create one GitHub issue | Bind the requested repository, recipient, title and body to explicit authority; the host keeps the GitHub token and returns an issue receipt | Real GitHub REST adapter and registered MCP journey tested against controlled HTTP responses; **no live GitHub issue created in CI** |
| Use a saved credential or disclose one permitted claim | Check actor, purpose and authorized scope; let a trusted host use protected state or return only the allowed disclosure | Encrypted vault, protected-use APIs and disclosure tests; external host coverage depends on integration |
| Pay a bounded amount | Check the recipient and payment ceiling, redeem recipient proof, consume authority, journal the effect and recover without blind resubmission | Reference payment path and synthetic executor; **no real transfer** |

These are examples of *authority-controlled protected use*, not claims that PTF independently controls every website, agent runtime or provider.

## Try the working implementation

The source checkout is the supported evaluation path until an npm prerelease is independently published and verified. Requires **Node.js 22+**, npm and Git.

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
npm ci
npm run demo
```

The demo exercises deterministic Authority decisions: one permitted request, another actor denied, and a changed recipient denied. It **does not** execute a provider action or consume an approval.

To exercise protected effects with synthetic providers, run:

```sh
npm run build
node examples/generic-protected-action.mjs
node examples/vault-protected-action.mjs
node examples/payment-disclosure.mjs
```

These use local reference state and fake external effects. For actual operator store setup and Windows PowerShell commands, follow [Getting started](docs/getting-started.md). For an embedding host, begin with the [Host Kit](docs/host-kit.md), [MCP contract](docs/mcp-contract.md), and [adoption validation protocol](docs/adoption-validation.md).

## How protected effects work

A successful **CHECK is not permission to execute**. On supported reference execution paths, the trusted host must bind the exact operation and verified actor to available Authority, enforce any configured privacy processing gate, consume the authorized use durably, and obtain a provider receipt. Recipient proof and recorded terms prevent an unrelated request from borrowing another capability.

The merged [PR #121](https://github.com/Binilts03/personal-trust-fabric/pull/121) implementation provides:

- **One protected-effect Host Kit**: `createProtectedEffect` is shared by reference MCP payments and exact trusted-host-registered non-payment actions. The older privacy-required `createEffectBoundary` remains available for compatibility.
- **Host-controlled MCP registration**: the `personal-trust-fabric/mcp` package export exposes `createPtfServer` and registration types. A host supplies strict validators, provider handlers and applicable processing controls. Agents cannot register arbitrary executable tools through JSON-RPC. The stock stdio server does not automatically register generic actions.
- **Recipient-bound execution**: local recipient-key challenges and proofs, exact action/context/recipient checks, constrained capability redemption and durable Authority consumption.
- **Journal-first recovery**: a confirmed prior provider success is not submitted again; ambiguous outcomes are quarantined for reconciliation. Missing original Processing Events are reported as an **evidence gap**, never reconstructed retrospectively from today's policy.
- **Opt-in GitHub Issues provider**: implements the actual REST request format with a host-held token. The registered MCP path and negative cases have controlled-HTTP integration coverage, not independent live third-party acceptance.

The locally enrolled `github:OWNER/REPO` recipient key is a **PTF trust arrangement**, not a GitHub-signed consent statement. GitHub issue creation has no guaranteed idempotency key; unknown submissions require human/operator reconciliation.

[Technical architecture](docs/architecture.md) · [Public APIs and Host Kit](docs/host-kit.md) · [GitHub Issues integration](docs/adapters/github-issues.md) · [Known limits](docs/audit/limits.md)

## What is implemented—and what is not

| Boundary | Implemented in this repository | Not established by the repository |
| --- | --- | --- |
| Authority | Default deny; standing grants and one-time approvals; exact terms and bounded uses; deterministic decision and citations | Correct authentication and enrollment by any arbitrary external host |
| Personal State | AES-256-GCM local vault, scoped reads and protected credential-use reference flows | HSM/KMS-backed custody, comprehensive backup protection, universal secret isolation |
| Agent access | Operator CLI, MCP payment and disclosure flows, local authenticated agent registry, opt-in registered generic MCP execution | Production remote ingress, universal interception, independently deployed multi-tenant service |
| Protected execution | Provider interfaces, shared Host Kit for reference payment/registered actions, durable journal and receipt reconciliation | Distributed exactly-once execution or atomic transaction across Authority/privacy/provider |
| External adapters | Protocol/evidence adapters and opt-in GitHub Issues REST integration | Live acceptance for every third-party provider or complete protocol certification |
| Privacy | Optional host-composed processing controls, evidence and synthetic DPDP-informed workflow | Legal compliance, blanket consent management or coverage of unintegrated host paths |
| Assurance | Source tests, adversarial cases, example tests, package-tarball consumer tests and CI checks | Independent third-party security certification or independent user adoption |

**The boundary is conditional on integration.** PTF can constrain effects executed through its verified host path; it cannot stop an agent that also possesses a credential or can invoke a separate unguarded tool. Returned, intentionally permitted personal-data disclosures are disclosures—not a zero-information guarantee.

For the exact current limitations, see [the limits register](docs/audit/limits.md) and [threat model](THREATMODEL.md). The [production roadmap](docs/roadmap/production-v1.md) tracks stronger custody, authenticated ingress, external review, operational recovery and deployment work.

## Integrate or evaluate

**If you build agent tools or MCP hosts:** start with `personal-trust-fabric/hostkit` and `personal-trust-fabric/mcp`. Host-owned registration and validation—not a new agent prompt—are where security properties must be enforced. The package *exports* these surfaces in source; registry publication is a separate release gate.

**If you evaluate privacy/security:** try to break actor, recipient, terms-digest, one-use, replay and evidence-gap handling. The value of a finding is a reproducible counterexample, not a broad claim that an architecture is "secure."

**If you evaluate interoperability:** try a second host and a second agent with no credentials copied into either agent runtime. Compare what the agent can actually do before and after integration. The current examples do not prove independent adoption.

[Public-surface exports](package.json) · [Examples](examples/) · [Contributing](CONTRIBUTING.md) · [Architecture decisions](docs/adr/)

## Verification

```sh
npm run check:brand
npm run typecheck
npm test
npm run test:examples
npm run eval
node scripts/check-seams.mjs
npm run verify:package -- --install
```

The CI gate runs these checks against the relevant commit, including a fresh-tarball install into a consumer project. Passing CI is evidence for those test surfaces only; it does not certify a production deployment or live-provider behavior.

## Release status

This repository has historical GitHub release tags, but its newer Host Kit and MCP integration are **not yet verified as published to npm**. Preparations for an experimental npm prerelease are tracked in [the publishing runbook](docs/launch/publish.md). Do not infer a registry release from the `package.json` version, a GitHub release, or a successful local `npm pack`.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for focused contributions and [SECURITY.md](SECURITY.md) for private vulnerability reporting. Useful first contributions include independent host onboarding, public-API contract tests, replay/failure-injection cases, and documentation corrections backed by actual source behavior.

PTF is Apache-2.0 licensed. See [LICENSE](LICENSE).
