# Capability System

## 1. Capability Payload

A capability MUST contain:

| Field | Type | Constraint |
|-------|------|------------|
| `tag` | `"ptf/cap@0.1"` | Fixed tag identifying the capability version. |
| `iss` | string | Issuer identity. |
| `aud` | string | Audience identity. |
| `sub` | string | Subject (principal). |
| `cmd` | Command | A `/`-prefixed command path. |
| `pol` | Predicate[] | Policy predicates for demand satisfaction. |
| `purpose` | string | Purpose binding. |
| `recipient` | string | Recipient identity. |
| `nonce` | string | Random nonce, minimum 16 characters. |
| `exp` | number | Expiry timestamp. Positive integer. `null` (immortal) is rejected in v0.1. |
| `maxUses` | number | Maximum consumption count. Positive integer >= 1. |
| `termsDigest` | string | Terms digest, minimum 16 characters. |
| `revocationId` | string | Minimum 8 characters. |

A capability MAY contain:

| Field | Type | Constraint |
|-------|------|------------|
| `amountMax` | number | Required for `/pay*` commands. Positive finite. |
| `currency` | string | Required for `/pay*` commands. Non-empty. |
| `claims` | string[] | For `/disclose*` commands. |
| `resource` | string | Resource binding. |
| `nbf` | number | Not-before timestamp. |
| `parentRevocationId` | string | Links to parent's `revocationId`. |

## 2. Narrowing Rules (child <= parent)

When issuing an attenuated child capability, the following rules MUST hold:

| Dimension | Rule |
|-----------|------|
| `iss` | MUST equal parent `aud` |
| `sub` | MUST equal parent `sub` (fixed across chain) |
| `parentRevocationId` | MUST equal parent `revocationId` |
| `cmd` | MAY only stay or go deeper (sub-path) |
| `pol` | MAY only narrow (preserve or tighten) |
| `exp` | MAY only shorten |
| `nbf` | MAY only move later |
| `maxUses` | MAY only decrease |
| `purpose` | MUST equal parent (fixed) |
| `resource` | MUST equal parent (fixed) |
| `recipient` | MUST equal parent (fixed) — re-issue for new recipient |
| `termsDigest` | MUST equal parent (fixed) — new approval required |
| `amountMax` | MAY only decrease |
| `currency` | MUST equal parent (fixed) |
| `claims` | MAY only subset parent's claims |
| `meta` | Ignored during narrowing (non-authoritative) |

## 3. Signature

- Capabilities are signed with Ed25519 (64-byte raw signatures)
- The signature covers the canonicalized payload bytes
- The signer is the issuer (`iss` field)

## 4. Chain Verification

A capability chain MUST be verified as follows:

1. **Shape check:** Every link must have valid tag `"ptf/cap@0.1"`, non-empty `iss/aud/sub`, positive integer `exp`, integer `maxUses >= 1`, nonce >= 16 chars, termsDigest >= 16 chars, revocationId >= 8 chars. `/pay` requires positive `amountMax` + non-empty `currency`.
2. **Signature check:** Every link's Ed25519 signature MUST verify against `resolveKey(iss)`. Unknown issuer -> deny with reason `"sig"`.
3. **Root integrity:** Root `iss` MUST equal `sub` (self-rooted).
4. **Chain linking:** Each child link: `iss` MUST equal parent `aud`; `sub` MUST equal parent `sub`. Each child must pass narrowing check against its parent.
5. **Time check:** Every link MUST be within its `nbf..exp` window (with clock skew tolerance).
6. **Revocation check:** Any link with a revoked `revocationId` denies the chain.
7. **Command coverage:** Leaf `cmd` MUST cover `demand.cmd` (prefix match).
8. **Policy predicates:** Every predicate must hold against `demand.args`.
9. **Domain checks:**
   - `/pay*`: demand `amount` must be positive numeric, `<= amountMax`; currency must match.
   - `/disclose*`: demand `claims` must be subset of leaf's `claims`.
10. **Recipient match:** `demand.recipient` MUST equal leaf `recipient`.
11. **Resource/purpose/termsDigest:** If present in demand, MUST match leaf exactly.
12. **Use budget:** Every link's remaining uses checked. Minimum across chain is the effective budget.

## 5. CHECK != REDEEM != EXECUTE

- **CHECK** (`capabilities.check`): Dry-run verification. Returns `CheckResult`. MUST NOT consume uses. MUST NOT check recipient proof. The `CheckResult` MUST NOT be accepted by any execute path.
- **REDEEM** (`capabilities.redeem`): Full redemption. Requires recipient proof (Ed25519 signature over leaf CID). Consumes one use. Returns `RedemptionResult` with `consumed: true` and `proofVerified: true`. This is the ONLY value execute paths accept.
- **EXECUTE** (`executeAndReceipt`, `executeViaProvider`): Requires a `Redemption` with `consumed: true` and `proofVerified: true`. Deep-compares instruction against authorized terms. Burns use before calling executor.
