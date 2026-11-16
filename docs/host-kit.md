---
layout: default
title: Host Kit
nav_order: 9
permalink: /host-kit/
---

# Host kit

The host kit is a reusable effect boundary. A host composes it once, at the
place where it performs external effects. Each **operation routed through this boundary** is checked by Authority, narrowed by configured privacy controls, and evidenced. Other host paths are not automatically covered.

It is a library boundary, not an interceptor. A host that does not route its
effects through it is uncovered, not compliant — see
[ADR-0025](adr/0025-privacy-enforcement-is-per-host.md).

## The surface

New non-payment hosts should evaluate `createProtectedEffect`; `createEffectBoundary` is the privacy-required compatibility interface. The kit ships as the `./hostkit` subpath:

```ts
import {
  createEffectBoundary,
  privacyForHostOperation,
  type HostPrivacyConfig,
} from "personal-trust-fabric/hostkit";
```

The subpath is the surface. The kit binds host stores, so it is not
re-exported from the curated root barrel.

## One call

**Integration sketch, not a copy-paste quickstart.** This assumes the
host has already constructed `storeDir`, `keys`, `auth`, verified
`ingress`, `demand`, `config`, a provider and a proof-verified redemption.
It assumes the host routes **every relevant effect path** through the
boundary. The provider is executed through the journal; do not supply an
additional callback that will be bypassed by the provider mode. To try PTF without those
prerequisites, start with [Getting Started]({{ '/getting-started/' | relative_url }}).

```ts
import {
  createEffectBoundary,
  privacyForHostOperation,
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
  authorizedContext: redemption.operation.args,
  provider,
  redemption,
});

const decision = await boundary.check();
if (!decision.allow) return decision.reason;

const receipt = await boundary.run();
```

`privacyForHostOperation` binds the privacy runtime to the encrypted host
stores. It covers the two reference actions, `/pay` and `/disclose`. A host
that owns another action composes its own gate from a
`TrustedProcessingContext`; the runtime, the stores and the ordering do not
change.

`check()` is the dry run. It performs no effect, writes no Processing Event
and consumes no authority use. Its result can never execute.

`run()` performs the effect and returns a `HostEffectReceipt`. The receipt
carries fixed fields only — ids, digests and the provider's external
reference. It never carries a secret, the data principal reference, the
controller or the data categories.

## The ordering

For a new privacy-enforced effect, the boundary follows the nine steps below. For an exact provider replay, the shared journal is checked first: confirmed prior success does not reconsume Authority or resend the effect; ambiguous outcomes remain quarantined. A trusted non-enforced mode omits privacy-specific steps and does not establish legal compliance.

The boundary runs nine steps for a new privacy-enforced attempt:

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
Event becomes `FAILED_FINAL` and the error is a `PrivacyPreEffectError`
(the privacy plane) or the authority's own error.

A failure after the effect started is `OUTCOME_UNKNOWN`. The boundary never
reports a success it cannot prove, and never reports an ambiguous outcome as
a denial. The execution journal stays the reconciliation oracle.

The fence in step 7 narrows the withdrawal race to the gap between the fence
and the external effect. That gap is not one atomic transaction.

## Failure classes

| Class                                | When                                                     |
| ------------------------------------ | -------------------------------------------------------- |
| `PrivacyPreEffectError`              | proven before the effect boundary                        |
| `PrivacyOutcomeUnknownError`         | privacy-enforced effect may have happened                |
| `ProtectedEffectOutcomeUnknownError` | non-enforced effect may have happened; reconcile journal |
| `PrivacyEventConflictError`          | an attempt already has evidence; reconcile, do not run   |

A host callback that starts an external effect must call
`ctx.markEffectStarted()` first. After that call the boundary treats any
failure as an unknown outcome.

## Conformance

The kit ships nine executable checks. Each one runs a real boundary against a
real store and observes the durable state; none of them asserts a slogan.

```sh
node dist/src/cli.js --dir ./ptf-store host-conformance --privacy-config ./privacy-config.json
```

The command prints one line per check:

```text
authority-first  PASS  ADR-0024 §4: an unauthorised caller is denied by the authority ...
dry-run-has-no-effect  PASS  ADR-0018: CHECK != REDEEM != EXECUTE - a dry-run result ...
```

The exit code is `0` only when every check passes. The checks use a scratch
directory: the operator's store is read, never written, and nothing reaches
the network.

Without `--boundary` the command tests the **shipped reference boundary** —
the kit's own composition. That proves the kit still works; it says nothing
about the adopter's code path.

### Testing your own composition

Point the command at the module that composes your boundary:

```sh
node dist/src/cli.js --dir ./ptf-store host-conformance \
  --privacy-config ./privacy-config.json \
  --boundary ./host-boundary.mjs
```

The module exports a factory — a named export `boundary`, or a default
export that is a function:

```js
// host-boundary.mjs
import { createEffectBoundary } from "personal-trust-fabric/hostkit";

export function boundary(scenario) {
  return createEffectBoundary({
    dir: scenario.dir,
    auth: scenario.auth,
    ingress: scenario.ingress,
    runtime: scenario.runtime,
    gate: scenario.gate,
    now: scenario.now,
    authorizedContext: scenario.authorizedContext,
    execute: scenario.effect,
    persistAuthority: scenario.persistAuthority,
  });
}
```

Relative and absolute paths resolve against the working directory; a bare
specifier resolves from the working directory's `node_modules`, so your
module — not PTF's — owns the dependency. The boundary under test is always
named in the output, so a green run is attributable:

```text
boundary: host-supplied (./host-boundary.mjs)
authority-first  PASS  ADR-0024 §4: an unauthorised caller is denied by the authority ...
```

This is the adoption gate: put it in the host's CI. The specifier comes from
your own command line and is never reachable from an agent-facing surface.

The suite stays a **narrow** gate. It tests the boundary's ordering against
nine rules; it does not attest the rest of the host — the proposal store, the
MCP tools, the ingress model and your own provider are outside it. A green
run is evidence, not certification.

A host with its own boundary composition also passes its own factory
in-process:

```ts
const results = await runHostConformance({
  config,
  tmpDir,
  boundary: (scenario) => createMyBoundary(scenario),
});
```

`runHostConformance` returns one result per check. A failing check is a
result with `ok: false` and a detail, never an exception.

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

## Domain-neutral host-controlled effects (implemented on `main`)

The `./hostkit` library also exports `createProtectedEffect` and
`createHostRedemptionChallenge`. An independent **synthetic**
`/email/send` reference lives in
[`examples/generic-protected-action.mjs`](https://github.com/Binilts03/personal-trust-fabric/blob/main/examples/generic-protected-action.mjs).
Run `npm run build && node examples/generic-protected-action.mjs` from
a current source checkout. It contacts **no** external email provider.

A trusted host constructs the verified `ingress`, the complete
`AuthorityOperation`, and the effect implementation. The agent cannot
choose a callback, processing profile, recipient key, or principal signing
key. Non-payment, non-disclosure effects use the existing locally signed
capability proof through `createHostRedemptionChallenge`; its challenge
returns a `cidHex` to the recipient signer and `redeem(proof)` returns
a genuine, single-use, exact-terms redemption. The issuer private key
remains inside the trusted host. This helper deliberately refuses
`/pay*` and `/disclose*`.

`createProtectedEffect` takes a **required** trusted-host `processing`
discriminator. `{ kind: "enforced", runtime, gate }` composes the
existing privacy preflight, recheck, durable evidence, fence and
finalization. `{ kind: "not-enforced", reason: "synthetic-no-personal-data" }`
is only a synthetic example; `"no-host-privacy-profile-configured"`
is a host deployment assertion, **not** an agent-selectable bypass.
Neither makes a regulated or personal-data-processing deployment exempt
from applicable privacy obligations. No implicit or missing processing
mode can silently disable privacy.

The new `privacyEventId` receipt property is emitted only when privacy
evidence actually exists. A journal-confirmed effect with a missing original
Processing Event is reported as `processingEvidence: "gap"`, not recreated
using today's privacy configuration or submitted to the provider again.
The trusted host must investigate the processing-evidence gap separately. The older `createEffectBoundary` API still
always requires privacy and retains its historical `eventId` receipt
property for its consumers. Do not treat the older path as automatically
enforcing every other host's effects.

**Host integration limit:** The package-exported `personal-trust-fabric/mcp` subpath (registry publication not yet verified) exposes `createPtfServer` and the registration API to trusted Node embedding hosts. The reference MCP server can execute only trusted-host-registered exact actions, alongside its established payment route. `ptf_request_action` still proposes arbitrary actions for visibility, but unregistered actions cannot execute. When a privacy profile is configured, an action with no enforced trusted processing gate is denied. The synthetic email provider does not deliver real email. See [MCP contract]({{ '/mcp-contract/' | relative_url }}) and [known limits]({{ '/audit/limits/' | relative_url }}).
