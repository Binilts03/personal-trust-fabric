---
layout: default
title: Personal Trust Fabric
nav_order: 0
permalink: /
---

# Personal Trust Fabric

> **Authority should travel. Secrets should not.**

PTF lets interchangeable agents request narrowly authorized operations **without putting the owner's raw credentials, signing keys or unrestricted tokens into the agent's context**. A trusted host checks the exact operation, uses protected state when allowed, and returns a bounded result. It does not automatically intercept tools outside that host.

## Why use it?

- **Switch agents without duplicating secrets:** keep authorization and personal state separate from an agent platform. The replacement agent must still be authenticated and allowed to request the operation.
- **Delegate specific actions:** bind an operation to the actor, resource, recipient and effect-bearing fields rather than exposing a broadly privileged API key.
- **Release only what is allowed:** a trusted host can perform protected credential use or disclose a permitted subset of information, not hand the vault to a model.

The [README](https://github.com/Binilts03/personal-trust-fabric#readme) provides concrete scenarios, runnable examples and explicit boundaries.

## Current reference implementation

| Layer | Present in the repository | Outside current proof |
| --- | --- | --- |
| Authority | Default-deny grants, one-time approvals, exact terms, recipient-bound proof and durable consumption | Host identity enrollment and deployment |
| Personal State | AES-256-GCM local vault, scoped reads and protected-use interfaces | HSM/KMS custody and multi-tenant service |
| Execution | Shared `createProtectedEffect` Host Kit for reference payment and host-registered non-payment actions; journal-first replay | Distributed exactly-once effect guarantees |
| MCP | Fixed or local registry identity; payment, data presentation and exact host-registered generic action execution | Global agent-tool interception or general remote deployment |
| Adapters | Opt-in GitHub Issues REST provider, reference email/payment paths | Live third-party acceptance and independent host adoption |
| Privacy | Optional host-composed processing controls, evidence and synthetic DPDP-informed profile | Statutory compliance or unintegrated host paths |

**Generic action execution is merged into `main`** via [PR #121](https://github.com/Binilts03/personal-trust-fabric/pull/121). The stock stdio launcher still registers **no generic executable actions**: a trusted embedding host must supply the registration, validation, provider and applicable processing controls.

## Try it from a source checkout

Requires Node.js 22+, npm and Git.

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
npm ci
npm run demo
```

The example checks one permitted request and two denials without calling a provider. Use [Getting started]({{ '/getting-started/' | relative_url }}) for operator setup and the synthetic protected-effect examples.

## Further reading

| Start | What to verify |
| --- | --- |
| [Host Kit]({{ '/host-kit/' | relative_url }}) | Trusted execution and privacy-composition contract |
| [MCP contract]({{ '/mcp-contract/' | relative_url }}) | Registered non-payment actions and authenticated local agent ingress |
| [GitHub Issues]({{ '/adapters/github-issues/' | relative_url }}) | Real REST adapter with injected-HTTP tests (no live GitHub UAT) |
| [Use cases]({{ '/use-cases/' | relative_url }}) | Scope of reference payment, disclosure, credential and privacy flows |
| [Architecture]({{ '/architecture/' | relative_url }}) | Authority, Personal State, execution and protocol separation |
| [Adoption validation]({{ '/adoption-validation/' | relative_url }}) | How to test a second host independently |
| [Security model]({{ '/security-model/' | relative_url }}) · [known limits]({{ '/audit/limits/' | relative_url }}) | What is enforced and what remains a host obligation |
| [Production roadmap]({{ '/roadmap/production-v1/' | relative_url }}) | Remaining custody, reliability, deployment and audit work |

The current package is being prepared for an **experimental npm prerelease**. Local package checks and historical GitHub release tags are not evidence that these interfaces are published or production-approved.

[Contributing](https://github.com/Binilts03/personal-trust-fabric/blob/main/CONTRIBUTING.md) · [Private security reporting](https://github.com/Binilts03/personal-trust-fabric/blob/main/SECURITY.md) · [Apache-2.0](https://github.com/Binilts03/personal-trust-fabric/blob/main/LICENSE)
