# ADR-0027: The host conformance suite is an adoption gate, not a self-test

**Date:** 2026-11-15
**Status:** accepted
**Scope:** Host Kit conformance, operator CLI

## Context

`runHostConformance` accepts `options.boundary` — a
`HostConformanceBoundaryFactory` — and defaults to `referenceHostBoundary`,
the kit's own composition. The library seam was there from the start, and the
suite has teeth: `tests/host-kit-conformance.test.ts` injects a boundary that
omits only the fence and asserts that exactly one check fails.

But the shipped operator command never reached that seam. `ptf
host-conformance` called `runHostConformance({ config, tmpDir })` with no
boundary, so it always exercised the kit's reference composition. A host
running the command in its own CI got a green run that said nothing about the
host's code path: the suite could pass while the adopter's production path
violated every rule the suite names. The command's stated purpose — an
adoption gate a host puts in CI — was not what it did.

## Decision

`ptf host-conformance --boundary MODULE` runs the checks against the
**adopter's** composition.

- The module must export a boundary factory: a named export `boundary`, or a
  default export that is a function. A module that exports neither is
  refused before any check runs.
- The boundary under test is always named in the output
  (`boundary: host-supplied (<specifier>)` or `boundary: reference (the kit's
own composition)`), so a green run is attributable to the thing that was
  tested.
- Without the flag the command is unchanged and still runs the reference
  composition.
- Resolution: `./x.mjs`, `../x.mjs` and absolute paths resolve against the
  working directory; a bare specifier resolves from the working directory's
  `node_modules`, so the host's module — not PTF's — owns the dependency and
  its own `import "personal-trust-fabric/hostkit"` resolves from the host's
  project. The resolution uses the **ESM** algorithm (the `exports` map with
  the `node`, `import` and `default` conditions, subpath maps, `*` patterns,
  then `main`/`index.js`), anchored at the working directory: the CommonJS
  resolver refuses a package that exports only an `import` condition — the
  normal shape of a modern ESM-only host kit — and
  `import.meta.resolve(specifier, parent)` ignores the parent argument on
  Node 22.18, which would resolve the operator's module against PTF's own
  `node_modules`.
- A module that cannot be loaded is reported with the loader's message; a
  module that loads but exports no factory is refused with an actionable
  message naming both accepted export names.

## Trust exposure

The module the operator names is **executed in this process**, so this
process must not hold anything the checks do not need.

The checks seed their own encrypted stores in a scratch directory with their
own key. They never needed the operator's store, but the command opened it:
it decrypted the operator's keystore and privacy state before running the
checks, in the same process that then loaded the adopter's module.

The command now runs **before the store is opened**: it does not open the
operator's store, does not decrypt the keystore and does not decrypt the
privacy state, so it holds no operator secret and needs no passphrase. The
adoption gate can therefore run in CI without the operator's passphrase. The
operator's privacy-config file is still read — it names the controller, the
opaque subject reference and the recipient roles the checks run against; it is
policy metadata, not a secret.

## Trust

The specifier comes from the operator's own command line, never from an agent
or an MCP caller. The operator already holds the store, so loading their own
module grants no privilege the CLI does not already have; the module runs
with the operator's privileges, like the CLI itself. The flag is not
reachable from any agent-facing surface.

## Alternatives Considered

### Leave the command as a library regression suite

- **Pros**: no code execution from a flag; the command stays trivial.
- **Cons**: the suite is described as an adoption gate and the roadmap puts
  host integration in front of independent review. A self-test that always
  passes the kit's own composition cannot answer "does my host comply?".
- **Why not**: the seam already existed and was already proven by the
  meta-test. Only the command failed to use it.

### Move the suite into the host's repository

- **Pros**: total control of the checks.
- **Cons**: the rules drift immediately; a host that edits the rules proves
  nothing. The rules are PTF's, and the checks reference PTF's evidence
  store and its durable state.
- **Why not**: the boundary under test must be the host's; the rules must
  stay PTF's.

### Accept a serialised description of the composition

- **Pros**: no code execution; the flag stays declarative.
- **Cons**: a composition is code — a provider, a store, an ordering. A data
  description cannot express it, and a configuration-driven boundary would be
  a new public surface to specify, version and secure.
- **Why not**: it would not be the host's own code under test, which is the
  entire point.

## Consequences

- A green `ptf host-conformance --boundary` run is now evidence about the
  adopter's composition, and a defective one names the defect. The CLI test
  drives a fence-less boundary through the command and asserts that exactly
  the `fence-stops-late-withdrawal` check fails.
- The reference boundary stays the default, so the command remains useful
  without the flag and still proves the kit itself works.
- The command can now execute a module the operator names. This is a new,
  small capability, deliberately operator-initiated and never agent-reachable.
- The suite remains a **narrow** gate: it tests the boundary's ordering
  against nine rules. It does not attest the host's whole surface — the
  proposal store, the MCP tools, the ingress model and the host's own
  provider are outside it. A green run is evidence, not certification.
- The gate holds no operator secret: it reads no store, opens no keystore and
  needs no passphrase, so a host can run it in CI without handing CI the
  operator's key material.
- The resolution rules are PTF's, and PTF models the common `exports` maps
  rather than every one: a package published with conditions PTF does not
  enable (a `browser`-only entry, a `development` condition) is not resolved
  to that entry, and the operator passes a path to the module instead. The
  rules are pinned by tests, not left to the runtime.
