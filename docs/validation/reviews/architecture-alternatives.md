# Fresh architecture alternatives review

Reviewer date: 2026-09-02. Standards mentioned here remain candidates until the standards review verifies them.

## Compared designs

### Device-sovereign personal node

One local authoritative runtime, OS keystore/protected database, typed in-process policy, server-held opaque operation references, authenticated recipient redemption, relational persona plus evidence history, and narrow local RPC. Best containment and complete-product reference; weakest no-install M0 judgeability and recovery convenience.

### Hosted custodial broker

Multi-tenant hosted runtime, central database/KMS, centrally atomic use/revocation, versioned HTTPS SDKs, and OAuth-aligned recipient profiles. Best M0 judgeability; largest TCB and unacceptable default operator/plaintext dependency for the complete product unless Human explicitly accepts it.

### Device-authoritative core with hosted rendezvous/ciphertext services

Local core remains sole authority/plaintext executor; hosted services relay safe requests/status and encrypted versioned state. Promising after partition, rollback, device pinning, recovery, and profile-drift tests; highest operational complexity.

## Verdict

The generic word “hybrid” is rejected because it does not name the authority and can turn one-time use/revocation into a distributed-consensus problem. The provisional reference is a **device-sovereign authoritative core with optional untrusted services**. A hosted synthetic M0 profile may reuse its schemas/contracts but is explicitly weaker and is not production-custody evidence.

## Required before contracts freeze

- Canonical versus agent/UI/recipient/audit/sync serialization families.
- Approval-relevant transaction canonicalization and binding.
- Recipient identity/assurance abstraction.
- Capability semantics: opaque correlation reference is not transferable authority; constraints, derivation, descendants, and revocation are explicit.
- Versioned data-classification lattice.

Runtime/TCB, key custody, backup/recovery actors, approval surface, downgrade rules, recipient assurance minimums, and revocation propagation bounds require security review and Human decisions before production acceptance.
