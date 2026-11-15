---
layout: default
title: Adoption validation
nav_order: 10
permalink: /adoption-validation/
---

# Adoption validation: prove value before expanding scope

PTF has a working **reference** authorization engine. It does not yet have
independently validated product demand or a certified production deployment.
The next milestone is not a star count or another protocol adapter. It is an
independent integrator showing that PTF is useful in a real, deliberately
limited host integration **and** offers a meaningful advantage over a simpler
alternative.

## Start with the shipped boundary

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
npm ci
npm run demo
```

The demonstration uses synthetic identities and checks one allowed request,
a different actor, and a changed recipient. It performs **no** external
effect, does not redeem authority, and neither authenticates a remote agent
nor protects a real credential. It is a fast mechanism check, **not** a
security evaluation of an adopting system.

## The integration experiment

Build **one** separate, disposable host for a constrained operation, for
example creating an issue in a test GitHub repository. A GitHub token and
repo contents are hosted and used **only** by that trusted host. The agent
receives a request interface and a bounded result, never the token. No
production repository, personal account or financial credential is required.
Do not run a real effect during evaluation without a dedicated sandbox and
explicit operator approval.

The host must explicitly compose PTF at the actual effect boundary. PTF is
not a network interceptor: an operation using another host path is outside
its coverage. Authenticate the agent independently, register the intended
recipient, bind the operation's immutable terms, and reconcile unknown
provider outcomes before allowing a retry. Reuse the existing conformance
checks rather than making a new security engine in the demo.

Record observations for **both** a PTF-powered host and the control design
below. Tests and readme assertions do not count as independent adoption.

| Test | Required observation |
| --- | --- |
| Allowed exact request | One authorized effect, provider evidence and a secret-free result |
| Modified recipient or resource | Denied before the external request |
| Wrong or removed agent | No inherited authority without verified re-registration/authorization |
| Repeated one-use request | No second effect; verify durable authority consumption |
| Revoked grant | A new request is denied, including after process restart |
| Timeout after submission | An uncertain result is quarantined/reconciled, never blindly resubmitted |
| Unintegrated host route | Explicitly identified as **not protected**; never counted as a pass |
| Secret handling | No credential in agent-visible request/response, logs, traces or receipts in tested paths |

**Security claim limit:** successful tests establish only the tested routes
and fault cases. They do not prove general non-disclosure, protection against
a malicious trusted host, absence of untested egress, distributed exactly-once
execution, or statutory compliance. Seek an independent security review
before any live high-value use.

## Compare against a conventional baseline

Implement the same sandbox request, identity and exact terms using an
ordinary fine-grained token, a host-side secret store, and a small
allowlist/policy check—without PTF. Do **not** compare PTF with an
intentionally insecure agent holding a broad token: that would exaggerate
the claimed benefit. Use the same authentication assumptions and provider
behavior for both versions.

Capture in a dated, reproducible record:

- Checkout/commit IDs, dependency versions, host code, and test results
- Time from clean checkout to first successful *real* sandbox effect
- Additional code and configuration required for each implementation
- Which misuse/failure cases each design prevents, and which it does not
- How a second independently authenticated agent takes over under the same
  principal's authorization, without exporting the underlying secret
- Whether an adopter would choose PTF after seeing both implementations,
  with their concrete reasons

If the conventional design provides equivalent security properties with
substantially less integration work, call the differentiation hypothesis
**not demonstrated**. No benchmark should be called independent when run
only by the project maintainer.

## Independent first-run study

Recruit five developers unfamiliar with the repository. Provide each with
the same README and isolated sandbox. Do not coach them through setup.
Capture the initial attempt, installation errors, where they needed to
read implementation code, unsupported platforms and whether they completed
one protected effect.

**Provisional go/no-go targets** (decision rules, not observed metrics):

1. At least three of five developers reach the promised sandbox effect
   without maintainer intervention.
2. At least two state a concrete reason to retain PTF rather than the
   conventional baseline, after using both.
3. Every claimed protection has a reproducible negative test and an
   explicit coverage boundary.

If these targets fail, fix the actual blocker or narrow the intended
adopter. If successive independent trials produce no demonstrated advantage,
stop expanding the general-purpose framework and consider maintaining PTF
as a reference implementation instead.

## Adoption signals to track

Record (with optional, privacy-respecting self-reporting) unique qualified
integrators, attempted installs, successful sandbox integrations,
second-session reuse, independent security findings and external merged
contributions. Report denominator and observation window for each metric.
GitHub stars, clones and page views are **discovery indicators**, not
proof that the software is deployed or useful.

This plan is an evaluation protocol, not a claim that these trials have
already happened.
