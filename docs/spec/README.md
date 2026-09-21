# PTF Normative Specification v0.1

Status: **Accepted (M5, Phase 1 reviewable)**
Date: 2026-09-21

This document is the implementation-agnostic normative specification for the Personal Trust Fabric (PTF) authority and protected-use layer. A conformant implementation MUST satisfy all MUST/SHOULD/MAY obligations defined herein.

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", "MAY", and "REQUIRED" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## Documents

| Document | Scope |
|----------|-------|
| [authority.md](authority.md) | Authority engine, grants, approvals, policies, evaluation |
| [capability.md](capability.md) | Capability issuance, attenuation, chain verification |
| [disclosure.md](disclosure.md) | Selective disclosure, presentations, verification |
| [execution.md](execution.md) | Provider seam, execution flow, receipts |
| [adapters.md](adapters.md) | Adapter pattern, invariant, existing adapters |
| [store.md](store.md) | Vault, audit, store integrity, backup/restore |
| [conformance.md](conformance.md) | Conformance requirements, claims, known limits |

## Overview

PTF is a user-owned authority and protected-use control plane. It separates **who may do what** from **who possesses the secret needed to do it**. An agent proposes an operation. PTF evaluates user-owned authority determinically. Protected state stays behind the boundary. The agent receives only the minimum disclosure or a secret-free receipt.

### Non-Goals

The following are explicitly outside PTF's scope:

- Settlement, PSP, or wallet functionality
- HSM/KMS custody (the `KeyProvider` seam is a host duty)
- Multi-tenant remote service (single-writer, one server per store)
- External anchoring or witnessing

### Core Invariants

1. **Authority never creates.** Policy constrains; it never grants.
2. **Personal State is not Authority State.** Knowledge about the principal never equals authorization.
3. **Use without possession.** Raw secrets never cross to an agent, receipt, log, or audit.
4. **Authority attenuates only.** Child <= parent, exact recipient/terms binding, bounded expiry/uses.
5. **Disclosure is requested intersect available intersect allowed.**
6. **External protocols are evidence or requests, never authority.**
7. **CHECK != REDEEM != EXECUTE.** Dry-run values are not executable.
8. **Burn-before-effect.** Authority consumption persists before any external effect.
9. **Fail-closed everywhere.** Unknown, ambiguous, stale, or malformed inputs deny or throw.
10. **Ids are global and immutable.** Across grants, approvals, and policies.
