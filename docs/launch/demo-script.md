---
layout: default
title: The five-minute demo
nav_order: 3
permalink: /launch/demo/
---

# The five-minute demo

The demo is one terminal and one idea: the authority belongs to the person,
not to the platform, and every effect routed through the boundary leaves
evidence.

Everything below runs from a clean clone with no credentials and no network
beyond `npm install`.

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
npm install
npm run build
```

## Beat 1: the decision is bounded (30 seconds)

```sh
node examples/payment-disclosure.mjs
```

The point of this beat: the decision is a deterministic policy evaluation of
the operation, the recipient, the amount and the host-asserted actor. The
grant is a set of bounds, not one exact operation. In this example the payment
cap is ₹1,790: ₹1,790 fits, ₹1,791 does not. The host checks every effect
against the grant. There is no model in the loop and no "the agent decided".

## Beat 2: the DPDP vertical (2 minutes)

```sh
node examples/dpdp-consent-gateway.mjs
```

A clinic shares a patient's diagnostic summary with a lab. Watch for four
things in the transcript:

1. The disclosure reveals claim **names**, not values, and only the ones the
   processing activity and basis allow.
2. A Processing Event is written before the effect and carries the purpose,
   the basis, the category and the recipient. It records the requested
   category set, including any category the basis withheld; it is not the
   disclosure manifest.
3. Consent is withdrawn. The **second** attempt is stopped at the effect
   boundary: the withdrawal lands after the live privacy recheck but before
   the effect, and nothing is released. A **third**, once the withdrawal is
   durable, is denied before any evidence is prepared. The first disclosure
   stands; neither stopped attempt reached the lab.
4. Erasure is scoped to the PTF-managed records bound to that subject. The
   lab's own copies and backups are outside this path.

The walkthrough with the full transcript is in
[../verticals/dpdp-consent-gateway.md](../verticals/dpdp-consent-gateway.md).

## Beat 3: prove the composition (1 minute)

```sh
export PTF_PASSPHRASE="ptf-demo-only-change-me"
node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
node dist/src/cli.js --dir ./ptf-store privacy init
node dist/src/cli.js --dir ./ptf-store host-conformance --privacy-config ./examples/privacy-config.example.json
```

Ten checks, each one a rule, each one printed with the rule it proves. The
exit code is 0 only when all of them pass. The suite checks the composition it
is given; it does not prove that a separately running host routes every
effect through the boundary. A host that does not is uncovered, not proven.

The example config is a template. Replace the opaque subject reference, the
controller id and the recipient aliases before a real run; the fields are
documented in [../privacy/dpdp.md](../privacy/dpdp.md#operator-setup). The
throwaway passphrase above is only for this local demo; use
`PTF_PASSPHRASE_FILE` with a 0600 file for a real store.

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
real data controller, and a second pair of eyes on the ordering invariants
in `src/hostkit/`.
