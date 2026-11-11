---
layout: default
title: Host Kit
nav_order: 9
permalink: /host-kit/
---

# Host kit

The host kit is a reusable effect boundary. A host composes it once, at the
place where it performs external effects, and every operation routed through
it is then decided by Authority, narrowed by the privacy plane, and evidenced.

It is a library boundary, not an interceptor. A host that does not route its
effects through it is uncovered, not compliant — see
[ADR-0025](adr/0025-privacy-enforcement-is-per-host.md).

## The surface

The kit ships as the `./hostkit` subpath:

```ts
import {
  createEffectBoundary,
  privacyForHostOperation,
  type HostPrivacyConfig,
} from "personal-trust-fabric/hostkit";
```

The subpath is the surface. The kit binds host stores, so it is not
re-exported from the curated root barrel.

## Compose it once

```ts
import {
  createEffectBoundary,
  type HostPrivacyConfig,
} from "personal-trust-fabric/hostkit";

const { runtime, gate } = privacyForHostOperation({
  dir: storeDir,
  keys,
  auth,
  ingress,
  demand,
  config,
  now: () => Math.floor(Date.now() / 1000),
});

const boundary = createEffectBoundary({
  dir: storeDir,
  auth,
  ingress,
  runtime,
  gate,
  now: () => Math.floor(Date.now() / 1000),
  authorizedContext: { amount: 100, currency: "INR", recipient: "shop" },
  provider,
  redemption,
  execute: async (ctx) => {
    ctx.markEffectStarted();
    return await runTheEffect(ctx.operation);
  },
});

const decision = await boundary.check();
if (!decision.allow) return decision.reason;

const receipt = await boundary.run();
```

`privacyForHostOperation` binds the privacy runtime to the encrypted host
stores; `createEffectBoundary` owns the nine-step order. The kit removes the
store-wiring tax, but it does not hide the two objects: the host still builds
the runtime and the gate, and still owns the effect. `privacyForHostOperation`
covers the two reference actions, `/pay` and `/disclose`. A host that owns
another action composes its own gate from a `TrustedProcessingContext`; the
runtime, the stores and the ordering do not change.

`check()` is the dry run. It performs no effect, writes no Processing Event
and consumes no authority use. Its result can never execute.

`run()` performs the effect and returns a `HostEffectReceipt`. The receipt
carries fixed fields only — ids, digests and the provider's external
reference. It never carries a secret, the data principal reference, the
controller or the data categories.

A retry reuses the same attempt. `attemptRef` is optional and defaults to the
terms digest, so a second `run()` for the same terms is refused with
`PrivacyEventConflictError` before the effect runs. Supply a distinct,
opaque reference only for a genuinely distinct operation; the value is
limited to 200 characters from letters, digits, `:`, `.`, `_` and `-`, and
it also becomes the effect's `idempotencyKey`.

`persistAuthority` may return a promise. The boundary awaits it before the
effect, so a host with a database-backed authority keeps the
burn-before-effect ordering; a rejection is a pre-effect failure
(`FAILED_FINAL`, no effect).

## The ordering

The boundary runs nine steps, in this order:

| #   | Step                    | What it proves                                                           |
| --- | ----------------------- | ------------------------------------------------------------------------ |
| 1   | terms binding           | the effect context deep-equals the authorized context (ADR-0018)         |
| 2   | authority               | a non-consuming decision, before any privacy state is read (ADR-0024)    |
| 3   | privacy preflight       | the configured processing controls allow this operation                  |
| 4   | privacy recheck         | the live privacy state still allows it                                   |
| 5   | evidence precommit      | a durable, secret-free Processing Event exists before any consumption    |
| 6   | authority consume + CAS | the use is burned and persisted before the effect (invariant 9)          |
| 7   | privacy fence           | the privacy state is re-read at the effect boundary (ADR-0024, ADR-0025) |
| 8   | effect                  | the journaled provider call, or the host's callback                      |
| 9   | evidence finalize       | `SUCCEEDED`, `FAILED_FINAL` or `OUTCOME_UNKNOWN`                         |

A failure before step 8 is a provable pre-effect failure. The Processing
Event becomes `FAILED_FINAL` and the error is a `PrivacyPreEffectError`: the
coarse reason distinguishes an authority denial from a privacy denial, and
the internal reason stays in operator evidence.

A failure after the effect started is `OUTCOME_UNKNOWN`. The boundary never
reports a success it cannot prove, and never reports an ambiguous outcome as
a denial. On the provider path, the execution journal stays the
reconciliation oracle.

The fence in step 7 narrows the withdrawal race to the gap between the fence
and the external effect. That gap is not one atomic transaction.

## Failure classes

| Class                        | When                                                   |
| ---------------------------- | ------------------------------------------------------ |
| `PrivacyPreEffectError`      | proven before the effect boundary                      |
| `PrivacyOutcomeUnknownError` | the effect may have happened                           |
| `PrivacyEventConflictError`  | an attempt already has evidence; reconcile, do not run |

A host callback that starts an external effect must call
`ctx.markEffectStarted()` first. After that call the boundary treats any
failure as an unknown outcome.

## Recovering an interrupted attempt

An attempt that ends `OUTCOME_UNKNOWN` has crossed the submit boundary: the
provider may or may not have taken the effect. The journal knows more than the
caller does, but the caller has to ask. Two operations do that, and they are
deliberately different:

| Operation     | Reads the journal | Asks the provider       | Writes | Finalizes an event |
| ------------- | ----------------- | ----------------------- | ------ | ------------------ |
| `inspect()`   | yes               | only for a live attempt | no     | no                 |
| `reconcile()` | yes               | yes                     | yes    | yes                |

`inspect()` is observation. It never submits, never writes a journal row and
never finalizes an event, so it is safe to call from an operator console at any
time. It answers with one of:

| Result         | Meaning                                                              |
| -------------- | -------------------------------------------------------------------- |
| `succeeded`    | the journal proves the effect succeeded; the receipt is replayed     |
| `absent`       | no journal record, or the provider confirms it never took the effect |
| `failed_final` | the journal proves a terminal failure; new terms are required        |
| `unsubmitted`  | the row never reached the submit boundary: provably no effect        |
| `effected`     | the provider confirms the effect happened (observation only)         |
| `unknown`      | ambiguous; the `reason` is a fixed vocabulary, never provider text   |

`reconcile()` is the authorized resolver. It refuses unless the journal proves
that an attempt exists for exactly these terms, and it hands the resolution to
the journaled executor, which owns the provider attestation: an effected query
adopts the existing reference without resubmitting, and an unknown query
quarantines the attempt. It never starts a new effect.

Both need a provider outcome query for the live case:

```ts
const boundary = createEffectBoundary({
  // ...the usual composition
  provider,
  redemption,
  query: {
    async query({ idempotencyKey, capabilityId, termsDigest }) {
      return await provider.lookup({
        idempotencyKey,
        capabilityId,
        termsDigest,
      });
    },
  },
});

const inspection = await boundary.inspect();
if (inspection.kind === "effected") {
  const receipt = await boundary.reconcile();
}
```

The query is called with the attempt's journal idempotency key — the key the
provider was called with — so a provider can find the record it was given.
Callers that do not opt into recovery keep the existing behaviour: a retry of
the same attempt still fails with `PrivacyEventConflictError`.

## Conformance

The kit ships ten executable checks. Each one builds a real boundary against a
real encrypted store and observes the durable state; none of them asserts a
slogan.

The command needs an initialised store and a passphrase:

```sh
export PTF_PASSPHRASE="ptf-demo-only-change-me"
node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
node dist/src/cli.js --dir ./ptf-store privacy init
node dist/src/cli.js --dir ./ptf-store host-conformance --privacy-config ./examples/privacy-config.example.json
```

`--privacy-config` is required. The example file is a template; replace the
opaque subject reference, controller id and recipient aliases before a real
run (fields are documented in
[privacy/dpdp.md](privacy/dpdp.md#operator-setup)). For a real store, use a
0600 file with `PTF_PASSPHRASE_FILE`; the env var above is for this local demo.

The command tests the **reference composition** and prints the store and
configuration preamble, then one line per check:

```text
store: ./ptf-store (privacy state loaded, revision 0)
operator configuration: valid (recipient roles: 2, /pay categories: 1)
boundary: reference composition (a host with its own composition calls runHostConformance with its factory)
authority-first  PASS  ADR-0024 (privacy is a narrowing layer): an unauthorised caller is denied by the authority ...
dry-run-has-no-effect  PASS  ADR-0018: CHECK != REDEEM != EXECUTE - a dry-run result can never execute
...
10/10 checks passed
```

The exit code is `0` only when every check passes. The checks run in a
scratch directory seeded from the operator's configuration: the operator's
store is read for the keystore, never written, and nothing reaches the
network.

A host with its own boundary composition passes its own factory:

```ts
const results = await runHostConformance({
  config,
  tmpDir,
  boundary: (scenario) => createMyBoundary(scenario),
});
```

`runHostConformance` returns one result per check. A failing check is a
result with `ok: false` and a detail, never an exception. The CLI does not
load a host module dynamically; a custom host runs this in its own test
harness.

## What it does not do

- It does not intercept effects. A host that does not compose it is
  uncovered.
- It is the privacy-aware boundary. A host that processes no personal data
  can use the core execution path instead; the kit adds the privacy
  preflight, the evidence and the fence.
- It does not decide that a processing basis is legally sufficient, and it
  never reports `compliant`.
- It does not read or erase copies outside the host's own store.
- It does not reconcile an ambiguous outcome. That stays with the operator
  and the execution journal.
- It does not prove that a separately running host composes it. The
  conformance suite proves the composition it is given.

The honest limits live in [audit/limits.md](audit/limits.md).

## References

- [ADR-0011](adr/0011-public-surface.md) — the curated public surface.
- [ADR-0018](adr/0018-exact-operation-authorization.md) — exact-operation
  authorization and consumption.
- [ADR-0024](adr/0024-privacy-enforcement-narrows-authority.md) — privacy
  enforcement narrows Authority.
- [ADR-0025](adr/0025-privacy-enforcement-is-per-host.md) — per-host,
  explicit enforcement at the effect boundary.
