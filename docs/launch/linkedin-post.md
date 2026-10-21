# Launch post (LinkedIn)

Drafted for the first public release. Two lengths: the short one for the
feed, the long one for the repo or a newsletter. Facts are sourced in
[launch-facts.md](launch-facts.md).

## Short version (the feed)

When an AI agent spends your money or reads your health data, the question
that matters is who decided it was allowed to.

Today the answer is usually the platform. The agent runs on someone else's
infrastructure, so the platform holds the credential, sets the limit, and
decides what the agent can touch. The user finds out afterwards.

I have been building the other arrangement for a while. Personal Trust
Fabric is an open-source library where the authority belongs to the person.
You issue a grant. The agent acts on that grant, exactly. The credential
never reaches the agent. Every effect leaves evidence, including the effects
that did not happen.

https://github.com/Binilts03/personal-trust-fabric

## Long version (the repo or a newsletter)

When an AI agent spends your money or reads your health data, the question
that matters is who decided it was allowed to.

Today the answer is usually the platform. The agent runs on someone else's
infrastructure, so the platform holds the credential, sets the limit, and
decides what the agent can touch. The user finds out afterwards.

I have been building the other arrangement for a while. Personal Trust
Fabric is an open-source library where the authority belongs to the person.

The shape of it:

- You issue a grant: pay at most 2000 rupees at this shop, until Friday, for
  this purpose.
- The agent acts on that grant and on nothing else. Change the amount by one
  rupee and the grant stops covering it.
- The credential never reaches the agent. The host uses it. The agent gets a
  receipt.
- Every effect leaves evidence, and so does every attempt that was stopped
  before it happened.

The part I did not expect to spend my evenings on is India's data
protection law. The DPDP Act was enacted in 2023. The Rules were notified on
13 November 2025, and the substantive obligations for Data Fiduciaries come
into force on 13 May 2027. The Consent Manager framework goes live on
13 November 2026. The Data Protection Board has existed since November 2025,
and as of the government's answer in Parliament in August 2026, no chairperson
had been reported as appointed.

So there is a runway, and there is a specific obligation that software can
actually serve. Section 6(10) puts the burden on the Data Fiduciary to prove
that a notice was given and that consent was given. That is an evidence
problem, and evidence is something a machine is better at than a spreadsheet.

What landed this week:

1. A host kit. One call puts the authority and privacy gates in the right
   order around an effect, and a conformance suite lets a host run the checks
   in its own CI and prove that its agent paths enforce the controls. Each
   check names the rule it proves.
2. Two HTTP provider adapters that speak real protocols. One signs a JSON
   body and posts it to any REST endpoint, which covers most payment and KYC
   APIs. The other implements the x402 HTTP 402 flow at protocol version 2,
   which is what the new x402 Foundation under the Linux Foundation is
   standardising, with Visa, Mastercard, Stripe and Google among its Premier
   members. Both are tested against a real local HTTP server, including the
   case where the server asks for more than the user authorised.
3. A vertical that runs with one command and needs no credentials. A clinic
   shares a patient's diagnostic summary with a lab under the DPDP rules. You
   see the disclosure, the evidence, the consent withdrawal that stops the
   next attempt at the effect boundary, and the exact erasure.

https://github.com/Binilts03/personal-trust-fabric

What this is not: it is not a wallet, a payment rail, or a compliance
product, and it will not become a PSP. It is a library, and enforcement is
per host. A host that composes the runtime is enforced for its own effects.
A host that does not is uncovered, which is a different thing from
compliant. The limits are written down in `docs/audit/limits.md`, and they
are longer than the feature list.

The open problems are the interesting ones. A real provider integration, a
second pair of eyes on the ordering guarantees, and a deployment where
somebody other than me is the Data Fiduciary.

If you build agent products and have to answer "how do we know the agent
only did what the user allowed", the repo is here:
https://github.com/Binilts03/personal-trust-fabric

## Notes for the poster

- Do not use the words "compliant", "DPDP compliant", "guarantees
  compliance" anywhere in the post or the comments. The library implements
  technical controls and produces evidence. It does not decide whether a
  lawful basis exists.
- Do not quote the x402 usage counters (75.41M transactions, $24.24M volume).
  They are self-reported by the project with no published date or
  methodology.
- If someone asks "is this legal advice", the answer is no, and the post
  should not invite the question.
- The demo behind the post is in
  [demo-script.md](demo-script.md); the vertical transcript is in
  `docs/verticals/dpdp-consent-gateway.md`.
