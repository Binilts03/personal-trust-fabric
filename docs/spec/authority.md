# Authority Engine

## 1. Data Model

### 1.1 Standing Grant

A standing grant MUST contain:

| Field | Type | Constraint |
|-------|------|------------|
| `id` | string | Globally unique across grants, approvals, and policies. Immutable once registered. |
| `principal` | string | Identifies the principal this grant serves. |
| `actor` | ActorSelector | REQUIRED. Missing actor is never wildcard. |
| `action` | `{ name: Command }` | A `/`-prefixed command path. Bare `/` is forbidden. |
| `bounds` | AttributeBound[] | Zero or more narrowing constraints. |

A standing grant MAY contain:

| Field | Type | Constraint |
|-------|------|------------|
| `resource` | `{ type: string; id: string }` | When present, restricts to this exact resource. |
| `purpose` | string | When present, restricts to this purpose. |
| `nbf` | number | Not-before timestamp (seconds since epoch). |
| `exp` | number | Expiry timestamp (seconds since epoch). |
| `maxUses` | number | Maximum consumption count. Positive integer. |

### 1.2 One-Time Approval

An approval MUST contain:

| Field | Type | Constraint |
|-------|------|------------|
| `id` | string | Globally unique across grants, approvals, and policies. |
| `principal` | string | Identifies the principal. |
| `actor` | string | Exact actor identity (not a selector). |
| `action` | `{ name: Command }` | Exact action name. |
| `termsDigest` | string | Digest of the exact terms. Derived internally by the engine. |
| `exp` | number | Expiry timestamp. |
| `maxUses` | number | Default 1. Must be positive integer. |

An approval MAY contain:

| Field | Type | Constraint |
|-------|------|------------|
| `resource` | `{ type: string; id: string }` | Exact resource. |
| `purpose` | string | Exact purpose. |
| `context` | Record<string, unknown> | Exact context. |
| `binding` | VerifiedExternalBinding | External binding folded into digest. |

### 1.3 Policy Constraint

A policy MUST contain:

| Field | Type | Constraint |
|-------|------|------------|
| `id` | string | Globally unique across grants, approvals, and policies. |
| `bounds` | AttributeBound[] | One or more narrowing constraints. |

A policy MAY contain:

| Field | Type | Constraint |
|-------|------|------------|
| `actor` | ActorSelector | When present, restricts to matching actors. |
| `actionName` | Command | When present, restricts to matching action prefix. |
| `purpose` | string | When present, restricts to matching purpose. |
| `nbf` | number | Not-before timestamp. |
| `exp` | number | Expiry timestamp. |

**Policy MUST NOT create authority.** A matching policy with no covering grant or approval denies.

## 2. Identity Binding

The authority engine binds identity from `VerifiedIdentity`, which MUST be provided by the host. The engine MUST NOT accept identity from the caller's request body.

```
VerifiedIdentity {
  id: string          -- verified actor id
  principal: string   -- the principal this identity acts on behalf of
  source: enum        -- "oauth" | "mcp-token" | "dpop" | "mtls" | "local-registration" | "api-key"
  proofRef: string    -- reference to the proof used for verification
  chain?: string[]    -- optional delegation chain
}
```

## 3. Digest Derivation

The `termsDigest` MUST be derived internally by the engine from the normalized operation plus ingress identity plus optional external binding. Callers MUST NOT supply `termsDigest`.

The derivation uses canonical JSON serialization of the bound operation (including principal, actor, action, resource, context, purpose) plus optional binding, hashed with SHA-256.

## 4. ActorSelector

An ActorSelector MUST be one of:

- `{ kind: "exact"; id: string }` — matches exactly one actor
- `{ kind: "set"; ids: readonly string[] }` — matches any of the listed actors
- `{ kind: "any" }` — matches any actor

Missing actor is never wildcard. Every grant MUST have an actor selector.

## 5. AttributeBound

An AttributeBound constrains a dotted path in the operation context:

```
{ path: string; op: "==" | "<=" | ">=" | "in" | "subset"; value: unknown }
```

- `path` uses dot-separated selectors: `.context.amount`, `.context.currency`, `.context.recipient`
- Prototype-pollution keys (`__proto__`, `constructor`, `prototype`) MUST be rejected
- Missing selectors return false (deny), never throw

## 6. Evaluation Algorithm

`Authority.evaluate(operation, ingress, opts?)` MUST proceed as follows:

1. **Bind identity:** Extract `principal`, `actor`, `actorChain` from `ingress`. Derive `termsDigest` internally.
2. **Step 1 — Approvals (exact match):** Match by identity (principal, actor, action, resource, purpose) then by exact terms (context, digest). Tracked as `actorMismatch` if identity mismatches but action+resource+purpose match.
3. **Step 2 — Grants (bounds match):** Match by class-level bounds (principal, actor selector, action prefix, properties, resource, purpose, attribute bounds). Exclude revoked, expired, not-yet-valid, exhausted grants.
4. **Step 3 — Terms mismatch:** If no usable authority but an approval matched identity but not terms, return `{ allow: false, reason: "terms" }`.
5. **Step 4 — No authority:** If no covering authority and no blocked candidate, return `{ allow: false, reason: "no-authority" }`.
6. **Step 5 — Policy narrowing:** Every applicable policy MUST hold. Any failing constraint returns `{ allow: false, reason: "forbidden", policyId }`.
7. **Step 6 — Allow with citation:** Approvals outrank grants. If `opts.consume === true`, increment usage count.

## 7. Revocation

- Revocation is permanent and audit-visible
- Revoking an authority MAY fan out to revoke derived capabilities (via `noteIssued`)
- Authority ids are global: re-registering a revoked id throws (revoke first)

## 8. Concurrency

- The store layer MUST use optimistic revision CAS: every durable file carries a `revision` bumped atomically with the data
- A stale handle's save MUST fail closed ("changed under us — reload and retry")
- One writer per store is the supported topology
- Fresh instances MUST NOT overwrite an existing store they never loaded
