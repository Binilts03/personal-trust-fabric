# Application and jury pitch — truthful draft

**Competition:** Google Startup Buildathon India 2026. **Deadline:** 13 Nov 2026. **Preferred city:** Kochi (subject to organiser allocation and personal availability). **Selected stage:** Not yet confirmed. No application or registration has been submitted by this repository work.

## Proposed title
**Personal Trust Fabric — constrained authority for interchangeable AI agents**

## Founder fit
The founder combines experience as a Chartered Accountant and a forward-deployed engineer. This is relevant to delegated authorization, traceable approvals, and the difference between evidence, a proposal, and an accountable protected action. Do not claim institutional sponsorship or that EY endorses the project.

## Problem
Agent tool integrations frequently require credentials and broad access that outlive or exceed a single task. Agent-to-agent communication and payment-mandate protocols help communicate intent and transaction evidence; they do not by themselves give every application a local, model-independent custody and authority runtime. Potential buyers need to demonstrate which agent was allowed to do what, for whom, to which recipient, and whether the operation actually happened.

## Solution
PTF is a composable principal-controlled authority and protected-use layer. An agent proposes an operation. The trusted host checks verified identity, authorized exact terms, recipient binding, expiry and uses. Where required, the host mediates access to protected state and secrets; the requesting model receives only permitted results or references. The agent can change without moving custody to the new model.

## Google AI and cloud
The demonstration uses the **Gemini API function-calling** contract to propose a typed synthetic action, then routes the request to PTF's real deterministic checks and a fake provider. A separate synthetic-only presentation endpoint and Dockerfile are prepared for an **IAM-protected Google Cloud Run** deployment. Deployment and live model execution must be recorded separately; code alone is not proof of either.

## How this differs from A2A and AP2
A2A is agent communication; AP2 specializes in commerce/payment mandates. PTF is proposed as the *local authority/custody implementation boundary* that could consume verified protocol evidence before executing permitted operations. PTF does **not** claim to replace A2A/AP2 or have independently qualified live interoperability.

## First buyer hypothesis
Developers of enterprise agent platforms, vertical SaaS products and agent-enabled service providers that need their own user-controlled authorization/custody layer. Their alternatives include bespoke internal authorization, direct OAuth grants, AP2-native authorization for payments, and broader enterprise identity/control products. Competitive differentiation and willingness to pay are **hypotheses**, not established facts.

## Business model hypothesis
A supported open-core / commercial-host integration offering could charge enterprises for deployment support, operational assurance and maintained provider connectors. No users, ARR, market size or letters of intent are asserted. A first pilot should measure integration hours, denied unauthorized attempts, secret exposure surfaces, customer willingness to pay and support burden.

## Current proof and its scope
The existing repository has a runnable core, local tests and a published public security-limit register. The Buildathon branch exercises a real PTF authority/execution path with a synthetic provider and a Gemini function-call client. It does not execute live transactions, deliver email, provide real third-party interoperability, or constitute an external security audit.

## Immediate asks from the event
Seek one agent-runtime integrator to review protocol boundaries, one domain SaaS operator to discuss a concrete deployment, and one security reviewer willing to inspect the Host Kit's trust assumptions.

## 6-slide jury narrative
1. **The problem:** a task needs narrow authority, not a reusable bearer credential.
2. **Where protocols fit:** A2A communicates; AP2 provides payment mandates; PTF owns principal-controlled protected use.
3. **The demonstration:** Gemini proposes; PTF verifies, consumes and emits a bounded synthetic receipt.
4. **Adversarial outcomes:** wrong recipient, wrong agent and replay are handled deterministically.
5. **Why a buyer might care:** fewer ad-hoc privileged agent integrations and inspectable enforcement. This is a buyer hypothesis.
6. **What comes next:** live verified protocol adapters, external pilot and independent security review—without promising those are already finished.

**Application constraints:** Verify the organiser's rules for pre-existing code and intellectual property before submission. Do not upload private keys, confidential user documents, unreviewed test traces or secret values in a deck or demo.
