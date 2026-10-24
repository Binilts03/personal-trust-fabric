# PTF architectural consolidation — implementation and review gate

**Baseline:** `main@cb687c685ba19627d4aa59c7e4375b18ded92c1f`  
**Implementation branch:** `feat/ptf-domain-neutral-consolidation-20261024` (draft PR #121)  
**Status:** Implementation of the specified reference-level slices completed; **independent merge review remains required**. This supersedes the earlier historical partial-state notes in this file.

## Verified implementation

1. Reference payment and vault scenarios use valid recipient-signed, exact-terms redemptions; executable example smoke tests are part of CI.
2. `createProtectedEffect` is the canonical Host Kit effect boundary. The privacy-required `createEffectBoundary` remains as a compatibility adapter.
3. `createHostRedemptionChallenge` signs bounded, local generic-operation capabilities and requires recipient proof before redemption.
4. `/email/send` works as a **synthetic** provider use case through both the public SDK and an exact trusted-host registration to the existing MCP `ptf_request_action` / `ptf_redeem` tools; no extra MCP tool was added.
5. Generic and payment protected-effect paths share the Host Kit's journal-aware execution. The generic journal is checked **before** live Authority on replay. A conclusive success is not resubmitted; an unknown/corrupt journal fails closed. Missing privacy processing evidence is surfaced as an explicit gap without reclassifying a completed external effect as unknown.
6. Privacy-mode generic operations require a host-defined enforced processing gate. Existing payment, disclosure, privacy fence and referential compatibility suites continue to run.
7. A clean tarball consumer installs and invokes the fake-email provider without any internal `src/*` imports. Example/secret/public-export checks also run in CI.
8. Module boundaries and public limitations were updated. Payment-specific safety checks in Authority and Capabilities are **deliberately retained**: removing them would weaken direct callers. No speculative new core policy engine was introduced.

## Execution evidence

**Known successful complete CI at commit `02a5c219223e4ec1ec6ef19cf44a5134254e38d2`:** GitHub Actions workflow run [40066292241](https://github.com/Binilts03/personal-trust-fabric/actions/runs/40066292241), covering gate, docs, and secrets jobs (all successful). Further commits require their own evidence; this line is not an unconditional guarantee of future heads.

Test-backed cases include: unregistered or malformed action denial, cross-actor checks, forged/expired proof denial, strict opaque email context, protected-provider non-resubmission, journal unknown classification, payment compatibility, generic privacy precommit/fence, privacy evidence gaps, package installation and reference synthetic effects. No real commerce, payment, email, or clinical system was contacted.

## Standards review (manual, not independent)

- The patch extracts host registration and execution from the large MCP file into dedicated `src/mcp/` modules; it does not create an additional agent tool or independent effect submit path.
- `src/hostkit/boundary.ts` has substantial replacement rather than added parallel sequencing. Check the legacy adapter and exact error classifications closely during peer review.
- Historical core `/pay` branches remain as intentional safety constraints. Domain neutrality is proven for an unrelated email action, not for every domain or external protocol.
- The source tree still includes large `src/mcp-server.ts` and `src/core/authority.ts` files. Further cleanup must be evidence-driven and not compromise compatibility.

## Remaining limitations — not implementation blockers

- The system remains a local reference implementation: hosts are trusted, and `not-enforced` is a host assertion rather than an independently established legal basis.
- No distributed exactly-once settlement, live provider integration, multi-tenant remote ingress, trusted hardware custody, or third-party security audit is claimed.
- Eventual outcome reconciliation requires trustworthy provider query/evidence; unknown external outcomes must never be blindly retried.
- General CLI actions and external hosts not explicitly adopting the Host Kit are not automatically privacy enforced.
- A reviewer should scrutinize receipt binding, privacy event reconciliation, journal ambiguity, registered-action validation, and state persistence before accepting ADR-0026.

## Disposition

The **code implementation and executable reference acceptance gates** are complete at the SHA cited above. Retain draft status for independent security/structural review; do not merge or publish without review authorization. `main` remains unchanged. A green CI result is not a production-readiness certification.
