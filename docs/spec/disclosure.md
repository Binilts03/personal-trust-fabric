# Selective Disclosure

## 1. Credential

A credential contains:

| Field | Type | Constraint |
|-------|------|------------|
| `issuer` | string | Credential issuer identity. |
| `subject` | string | Credential subject (principal). |
| `claims` | Record<string, unknown> | Key-value claim set. |
| `exp` | number | Optional credential expiry. |
| `cnf` | `{ kid: string }` | Optional confirmation (holder binding). |

## 2. Disclosure Flow

1. Agent requests disclosure of specific claims.
2. PTF evaluates `/disclose` authority without consuming uses.
3. PTF computes `requested AND available AND allowed` claim names.
4. Each disclosure is salted: `digest = SHA-256(canonicalize([salt, name, value]))`.
5. Holder signs the canonical unsigned presentation.
6. Presentation is returned to the verifier.

## 3. Presentation

A presentation contains:

| Field | Type | Constraint |
|-------|------|------------|
| `issuer` | string | Credential issuer. |
| `subject` | string | Credential subject. |
| `holder` | string | Holder identity (must match `cnf.kid` if present). |
| `verifier` | string | Audience identity. |
| `nonce` | string | Verifier-provided nonce. Minimum 16 characters. |
| `iat` | number | Issuance timestamp. |
| `credExp` | number | Optional credential expiry. |
| `disclosures` | Disclosure[] | Salted claim disclosures. |
| `sig` | Uint8Array | Holder signature (64 bytes). |

## 4. Disclosure

Each disclosure contains:

| Field | Type | Constraint |
|-------|------|------------|
| `name` | string | Claim name. |
| `value` | unknown | Claim value. |
| `salt` | string | Random salt. |
| `digest` | string | `SHA-256(canonicalize([salt, name, value]))`. |

## 5. Verification

A presentation MUST be verified against:

- Signature is 64 bytes (bearer presentations are forbidden)
- Audience matches expected audience
- Optional nonce binding (`expectedNonce` equality)
- Freshness: `iat + maxAgeSec` (default 300 seconds)
- Optional replay cache (`usedNonces` set)
- Credential expiry (`credExp` if present)
- Disclosure digest integrity (recompute each digest)
- Holder binding (`cnf.kid` match if credential has `cnf`)

## 6. Constraints

- Bearer presentations (signature length != 64) MUST be rejected
- Replay within the freshness window is possible if the host does not persist used nonces (host duty)
- Issuer authenticity is host business — credentials arrive from the host's own store
- Ambiguous same-type claims (same name, different types) fail closed
