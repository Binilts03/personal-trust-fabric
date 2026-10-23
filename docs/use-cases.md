---
layout: default
title: Use cases
nav_order: 4
permalink: /use-cases/
---

# Use cases

Personal Trust Fabric (PTF) is a **domain-neutral, user-owned authority and
protected-use foundation for interchangeable AI agents**. A use case composes
its authority, vault, protected execution, provider and, when appropriate,
optional privacy controls. No industry or jurisdiction defines the product.

## Implemented local reference flows

| Application | Repository example | What the code exercises | What it does **not** establish |
| --- | --- | --- | --- |
| Bounded payment and minimal disclosure | [payment-disclosure.mjs](https://github.com/Binilts03/personal-trust-fabric/blob/main/examples/payment-disclosure.mjs) | Exact-terms grant, recipient proof, fake payment executor, claim subset disclosure | Real payment or production payment-provider adoption |
| Vault-scoped disclosure and protected credential use | [vault-protected-action.mjs](https://github.com/Binilts03/personal-trust-fabric/blob/main/examples/vault-protected-action.mjs) | Purpose/agent-scoped reads, in-host secret use, dry-run proposals, fake provider receipt | Real external credential processing, production custody |
| Synthetic delegated email | `examples/generic-protected-action.mjs` | Scoped `/email/send` grant, recipient-signed proof, fake external reference, optional privacy module | Live email, authenticated real-world email server, general MCP execution |\n| **DPDP-informed personal-data processing (optional)** | [Synthetic clinic-to-lab walkthrough]({{ '/verticals/dpdp-consent-gateway/' | relative_url }}) | Configured privacy basis and activity, Authority plus privacy checks, Processing Events, withdrawal checked before subsequent disclosure, subject-scoped PTF vault erasure | Actual clinic/lab systems, legally valid consent, statutory compliance, full privacy-program automation, or coverage of unintegrated host paths |

Build and run the local flows from a checkout:

```sh
npm ci
npm run build
node examples/payment-disclosure.mjs
node examples/vault-protected-action.mjs
node examples/generic-protected-action.mjs
node examples/dpdp-consent-gateway.mjs
```

**Evidence level:** These are repository-owned, synthetic reference examples,
not customer deployments or independently audited deployments. The DPDP
script uses a fixed clock, a temporary local store and no real clinic/lab
network integration.

## Why DPDP is a use case, not the product

PTF first asks whether an agent has explicit authority to perform the exact
operation. In an applicable personal-data workflow, a host can **also** use
the optional privacy extension to check the configured processing activity,
purpose, categories, recipient and asserted processing-basis evidence.

The first jurisdiction-specific profile is `IN-DPDP-2025`. A passing
privacy decision only indicates configured technical checks passed: it
does not grant authority or independently establish a lawful basis.

PTF does **not** provide a complete consent experience, enterprise-wide
data discovery and rights-request orchestration, registered Consent Manager
service, or statutory compliance determination. External processors,
backups, and independently operating host paths are not automatically
controlled. Read the [DPDP profile]({{ '/privacy/dpdp/' | relative_url }}), [host kit]({{ '/host-kit/' | relative_url }}),
and [audit limits]({{ '/audit/limits/' | relative_url }}).

The `ptf host-conformance` CLI checks the library's **reference effect
boundary**. Integrators need their own host-specific conformance and
end-to-end evidence before asserting actual runtime coverage.

## Possible later applications (not complete implementations)

Travel booking, delegated email actions and signing are potential
applications of the same authority semantics. These are not presented as
completed adapters, deployed integrations or validated product needs.
Evidence from additional real host integrations, not the number of demo
scripts, should determine which use cases merit expansion.
