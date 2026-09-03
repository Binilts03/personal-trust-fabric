# ADR 0004 — Plural Custody and Protected Executors

Status: **Accepted**

## Context
PTF's non-possession claim cannot be truthful if every resource is copied into one central vault or if all custody profiles are described with one vague assurance level.

## Decision
PTF supports plural custody and bounded Protected Executors. Every execution route carries an Assurance Manifest describing the actual trusted-computing boundary, plaintext visibility, usable-key authority, artifact custody, recovery parties, and residual risk.

## Consequences
External/provider, device, customer-controlled, managed, and attested-confidential profiles can coexist without being misrepresented as equivalent. Encryption at rest alone never establishes operator non-possession. See `docs/spec/PTF-V1-APPROVAL.md` for the exact approved specification blob.
