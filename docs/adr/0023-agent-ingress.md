# ADR-0023: Authenticated multi-agent ingress (registry + session proof)

**Date**: 2026-09-22
**Status**: accepted
**Deciders**: PTF maintainer

## Context

The MCP server speaks for one fixed identity pinned at startup
(`PTF_MCP_PRINCIPAL` / `PTF_MCP_ACTOR`). That is a fail-closed reference,
but it cannot express PTF's defining claim: multiple interchangeable
agents using the user's authority, with agents replaceable independently
of authority state. Roadmap G5 requires an explicit authenticated-agent
ingress model where verified transport identity maps to the PTF actor —
never `request.actor`.

Researched current authority (checked 2026-09-22): the MCP authorization
specification (2026-07-28 and draft) defines the OAuth 2.1 resource-server
flow for HTTP transports, and states explicitly that STDIO transports
SHOULD NOT follow it and SHOULD instead retrieve credentials from the
environment. PTF's node deployment is stdio-first; its HTTP story is the
PDP bin, which already authenticates per-caller Bearer keys with scopes.

## Decision

Two ingress modes, one invariant (`verified identity → actor`):

- **Fixed mode (unchanged)**: no `agents.json` in the store → the server
  behaves exactly as today (env-pinned identity, tool schemas carry no
  identity fields). Single-agent deployments keep working untouched.
- **Registry mode**: `agents.json` present → every evaluation binds an
  agent from the operator-managed registry, verified two ways:
  1. **Launcher-asserted + registry-checked**: `PTF_MCP_ACTOR` names an
     agent that must be registered AND active (reloaded from disk per
     tool call, so removal/revocation takes effect immediately). This is
     the stdio-blessed pattern: env credential + PTF-side membership
     proof, matching the MCP spec's stdio guidance.
  2. **Challenge-response session proof**: new `ptf_authenticate` tool.
     No args → server challenge (id + nonce + 120s expiry, in-memory,
     single-use). With `{agentId, challengeId, sigHex}` → signature over
     the domain-separated challenge bytes verified against the registry
     key → session bound. All other tools fail closed
     (`authentication required`) until bound. Keyless registry entries
     (plain LLM clients that cannot sign) authenticate via path 1 only.

- **Registry** (`agents.json`, revision CAS like authority/registry):
  operator CLI owns it (`ptf agent --register/--remove/--rotate/--list`).
  Ids are global + immutable; removal retires permanently (same rule as
  recipient aliases); rotation swaps the key (hard cutover, in-flight
  sessions re-authenticate). Registry mutations are audit-appended.
- **Core stays pure**: `src/core/agent.ts` holds challenge
  issue/verify over Ed25519 (node:crypto only); persistence lives in
  `src/store/agents.ts`. Tool schemas still carry no identity fields
  except `ptf_authenticate`, whose `agentId` is a verified claim (bound
  by signature against the registry key), never trusted input.
- **Replaceability proof**: grants bind actor sets, not processes —
  after Agent A is removed, Agent B authenticates and the SAME grant
  covers B iff B is in its actor selector. Authority is never copied
  into any agent platform. Tested end to end over stdio.

## Alternatives Considered

### OAuth 2.1 / DPoP for the node now

- **Pros**: standards-maximal, matches MCP HTTP guidance.
- **Cons**: authorization-server machinery (issuer, discovery, PKCE,
  token lifecycle) for a single-user local node; the MCP spec itself
  exempts stdio from it.
- **Why not**: deferred to the hosted profile with the PDP key story;
  overkill that would delay the actual claim (replaceable agents).

### mTLS client certificates

- **Pros**: strong transport binding.
- **Cons**: PKI issuance/rotation burden on a personal node; no benefit
  over registry keys for local processes.
- **Why not**: heavier operations, same assurance class locally.

### Unix-domain socket peer credentials

- **Pros**: kernel-attested peer identity.
- **Cons**: non-portable (no Windows story); still needs a registry
  mapping uid → agent.
- **Why not**: platform coverage; registry check subsumes the mapping.

### Pure env trust (no registry)

- **Pros**: zero code.
- **Cons**: any local process spawning the server with chosen env
  self-certifies as any agent — PTF verifies nothing.
- **Why not**: fails the mission invariant (verified, not asserted).

## Consequences

- `ptf_authenticate` joins the MCP tool table (session-scoped, no
  authority consumed); `docs/mcp-contract.md` documents both modes.
- Backup/restore unit extends to `agents.json` (+ `nonces.json`,
  `executions/`, `ptf.sqlite`+WAL leftovers from Phases 3–4 — previously
  unprotected state, now covered with never-merge rules).
- `docs/audit/limits.md` records: keyless entries rely on launcher
  trust (spec-blessed for stdio); challenges in-memory (restart
  re-authenticates, consistent with ADR-0017); registry reload per call
  (operator scale, same as authority reloads).
