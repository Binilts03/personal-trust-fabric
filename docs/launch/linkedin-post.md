---
layout: default
title: Technical preview post
nav_order: 1
permalink: /launch/post/
---

# Technical preview post (LinkedIn)

Prepared 2026-10-22. This is a request for technical review, not a launch.
Do not publish until the preview gate in
[publish.md](publish.md#technical-preview-gate-before-npm) passes and the link
points at the commit being described.

## Short version (the feed)

When an AI agent spends your money or reads your health data, the question is
not only whether the model behaved. It is who authorized that specific effect,
and what evidence exists afterwards.

I have been building Personal Trust Fabric, an open-source, host-side
authority and privacy boundary for AI agents. It is a technical preview, not a
finished product and not a compliance product.

The shape:

- You issue a grant: pay at most ₹2,000 at this shop, for this purpose, until
  Friday.
- The host checks each effect against that grant; ₹2,001 stops fitting.
- The credential stays with the host, not the agent.
- Effects that pass through the boundary leave evidence. A denial before
  evidence precommit is a decision, not a processing event.
- Withdrawal is fenced at the boundary; erasure is scoped to PTF-managed
  records.

The preview includes a host kit, a ten-check conformance suite, signed-JSON
and x402 v2 providers, and a DPDP-oriented clinic-to-lab vertical. The vertical
runs with one command and no credentials.

It is not a wallet, a payment rail, a DPIA, a DSAR system, a
breach-notification system, or a Consent Manager. Enforcement is per host: a
host that does not compose the boundary is uncovered. Erasure does not reach
external copies or backups. The limits are in `docs/audit/limits.md`.

I am looking for three to five technical reviewers, especially people building
agent hosts or DPDP operations. If that is you, I would value a critical read
of the ordering invariants and the limits.

Preview: <https://github.com/Binilts03/personal-trust-fabric/tree/verify/2026-10-22-hardening>

## Long version (the repo or a newsletter)

When an AI agent spends your money or reads your health data, the question is
not only whether the model behaved. It is who authorized that specific effect,
and what evidence exists afterwards.

Today the answer is usually the platform. The agent runs on someone else's
infrastructure, so the platform holds the credential, sets the limit, and
decides what the agent can touch. The user finds out afterwards.

I have been building the other arrangement. Personal Trust Fabric is an
open-source, host-side authority and privacy boundary for AI agents. This is a
technical preview, not a finished product.

The shape:

- You issue a grant: pay at most ₹2,000 at this shop, for this purpose, until
  Friday.
- The host checks each effect against that grant. Change ₹2,000 to ₹2,001 and
  it stops covering the payment; ₹1,999 still fits.
- The credential stays with the host, not the agent. The agent gets a receipt.
- Effects that pass through the boundary leave evidence. A denial after
  evidence precommit leaves a failed event; a denial before it is a decision,
  not a Processing Event.
- The boundary re-reads live privacy state immediately before the effect, so a
  withdrawal that lands in that window stops the attempt.
- Erasure is scoped to the PTF-managed records bound to the subject reference.
  External copies and backups are outside that path.

The DPDP part is deliberately narrower than a compliance product. The DPDP
Rules were notified on 13 November 2025. The main Data Fiduciary duties in
those Rules phase in on 13 May 2027, and the Consent Manager framework on
13 November 2026. Section 6(10) of the Act puts an evidence burden on the Data
Fiduciary when a notice or consent question arises in a proceeding. A runtime
layer can preserve linked notice, consent, basis and attempt records; it cannot
make the records legally sufficient or replace the operator's evidence
programme.

What is in the preview:

1. A host kit. It composes the authority and privacy gates around an effect in
   the right order, and a ten-check conformance suite checks the composition it
   is given. The suite does not prove that a separately running host routes
   every effect through the boundary; a host that does not is uncovered. Each
   check names the rule it exercises.
2. Two HTTP provider adapters. The signed-JSON adapter posts the authorized
   terms to a REST endpoint. The x402 adapter implements the HTTP 402 flow at
   protocol version 2. Both are tested against a local HTTP server, including
   amount, asset, payee and resource mismatches for x402 and signed submission,
   failures, redirects and timeouts for the signed-JSON path.
3. A DPDP-oriented vertical that runs with one command and needs no
   credentials. A clinic shares a patient's diagnostic summary with a lab. You
   see the disclosure, the evidence, the consent withdrawal that stops the next
   attempt at the effect boundary, and the erasure of the PTF-managed records,
   scoped to the subject.

What this is not: it is not a wallet, a payment rail, a DPIA, a DSAR system, a
breach-notification system, a Consent Manager, or a compliance product. It is
a library, and enforcement is per host. A host that composes the runtime is
enforced for its own effects; a host that does not is uncovered. The limits are
in `docs/audit/limits.md`, and they are longer than the feature list.

The open problems are the interesting ones: a real provider integration, a
second pair of eyes on the ordering invariants, and a deployment where somebody
other than me is the Data Fiduciary.

If you build agent products or DPDP operations and want to look at the
boundary, the preview is here:

<https://github.com/Binilts03/personal-trust-fabric/tree/verify/2026-10-22-hardening>

## Notes for the poster

- **Do not publish from a local-only branch.** The link must resolve, and the
  commit it resolves to must be the one that passed the clean-clone check. See
  [publish.md](publish.md#technical-preview-gate-before-npm).
- Do not call this a launch, release, or announcement. Call it a technical
  preview or a request for comment.
- Do not claim legal compliance, certification, or that PTF "makes you
  compliant." It enforces configured technical controls and produces scoped
  evidence. It does not decide whether a lawful basis exists.
- Do not quote the x402 usage counters (75.41M transactions, $24.24M volume).
  They are self-reported by the project with no published date or methodology.
- If someone asks whether this is legal advice, the answer is no. The post
  should not invite the question.
- If someone asks about erasure, say it removes PTF-managed records only.
  Processor copies, backups, logs and other systems are outside that path.
- If someone asks how much of their estate is covered, say only effects routed
  through the host boundary. The conformance suite checks the composition it is
  given; it does not attest to a separately running host.
- The demo behind the post is in [demo-script.md](demo-script.md); the vertical
  transcript is in `docs/verticals/dpdp-consent-gateway.md`.
