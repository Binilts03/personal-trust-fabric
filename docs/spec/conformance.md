# Conformance

## 1. Conformant Implementation

A conformant implementation MUST:

1. Implement the authority engine evaluation algorithm (authority.md Section 6)
2. Implement capability chain verification (capability.md Section 4)
3. Implement CHECK != REDEEM != EXECUTE separation (capability.md Section 5)
4. Implement selective disclosure with holder binding (disclosure.md)
5. Implement burn-before-effect ordering (execution.md Section 4)
6. Implement revision CAS for all durable stores (store.md Section 3.1)
7. Implement hash-chained audit (store.md Section 2.1)
8. Reject bearer presentations (disclosure.md Section 5)
9. Reject prototype-pollution paths (authority.md Section 5)
10. Reject duplicate authority ids across grants, approvals, and policies (authority.md Section 7)

## 2. Conformance Claims

An implementation MAY claim conformance at one or more levels:

- **Core**: Authority engine + capability system + audit
- **Vault**: Encrypted Personal State + use-without-possession
- **Agent Loop**: MCP tools + proposals + receipts
- **Adapter**: External protocol integration (specify which protocols)
- **Full**: All of the above

## 3. Known Limitations

Conformant implementations MUST document the following known limitations:

- Single-writer topology (one server per store)
- Audit is tamper-evident, not independently anchored
- File keystore (not HSM/KMS)
- No multi-tenant remote service
- Host compromise is out of model
- No external witness or anchoring (ADR-0006)
- `metadata` field effectfulness is unenforced convention
- `detail`/context strings can leak secrets (host duty to prevent)
- Heap copies are best-effort unzeroed
