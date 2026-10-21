---
layout: default
title: The five-minute demo
nav_order: 3
permalink: /launch/demo/
---

# The five-minute demo

The demo is one terminal and one idea: the authority belongs to the person,
not to the platform, and every effect leaves evidence.

Everything below runs from a clean clone with no credentials and no network
beyond `npm install`.

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
npm install
npm run build
```

## Beat 1: the decision is exact (30 seconds)

```sh
node examples/payment-disclosure.mjs
```

The point of this beat: the decision is a pure function of an exact
operation, an exact recipient, an exact amount and a verified actor. Change
the amount by one rupee and the grant no longer covers it. There is no model
in the loop and no "the agent decided".

## Beat 2: the DPDP vertical (2 minutes)

```sh
node examples/dpdp-consent-gateway.mjs
```

A clinic shares a patient's diagnostic summary with a lab. Watch for four
things in the transcript:

1. The disclosure reveals claim **names**, not values, and only the ones the
   processing activity and basis allow.
2. A Processing Event is written before the effect and carries the purpose,
   the basis, the category and the recipient.
3. Consent is withdrawn. The **second** attempt is stopped at the effect
   boundary. The first disclosure still stands; the second never happened,
   and the evidence says so instead of guessing.
4. The erasure is exact and subject-bound, and it refuses anything it cannot
   prove belongs to that subject.

The walkthrough with the full transcript is in
[../verticals/dpdp-consent-gateway.md](../verticals/dpdp-consent-gateway.md).

## Beat 3: prove the host enforces (1 minute)

```sh
ptf host-conformance --dir ./ptf-store
```

Nine checks, each one a rule, each one printed with the rule it proves. The
exit code is 0 only when all of them pass, so a host can put it in CI and
say, with evidence, that its own agent paths enforce the controls.

## Beat 4: the crash window (1 minute)

This is the part most "agent spending" systems get wrong. When a payment
succeeds at the provider but the host dies before it records that, a retry
must not spend a second grant and must not hand the agent a second
capability.

```sh
node --test dist/tests/mcp-crash.test.js
```

The journal is the proof. A retry of the same exact terms replays the
journal and returns the original receipt. An unsettled journal is answered
with `outcome_unknown`, never with a denial and never with a second effect.

## Beat 5: the honest limits (30 seconds)

Say this part out loud, it is what makes the rest credible:

- PTF is a library. It is not a wallet, a payment rail or a compliance
  product, and it will not become one.
- Privacy enforcement is per host. A host that composes the runtime is
  enforced for its own effects. A host that does not is uncovered, not
  compliant.
- The DPDP layer implements technical controls and produces evidence. It
  does not decide whether a lawful basis exists, and it never says
  "compliant".
- Single operator, file-backed stores, reference providers that move no
  money. Every one of those limits is written down in
  `docs/audit/limits.md`.

## The ask

The gap this project fills is not a feature gap, it is a standards gap:
agent protocols (MCP, A2A) tell agents how to talk, not what they may do.
The interesting work now is a real deployment with a real provider and a
real data controller, and a second pair of eyes on the ordering guarantees
in `src/hostkit/`.
