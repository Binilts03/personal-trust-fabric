# Fresh product-scope review

Reviewer date: 2026-09-02. Scope: supplied specification package; no implementation existed.

## Verdict

**PASS for product-boundary interpretation; FAIL as an implementation-ready acceptance contract.** PTF is consistently a generic trust/capability platform and M0 is consistently a milestone. The original traceability mapped P1–P18 to workstream names but did not provide closeable, executable acceptance per capability.

## Findings integrated

- Added `docs/program/capability-ledger.md` with an independent acceptance row for P1–P18, including separate P8 and P9 exits.
- A supported release profile must resolve vague qualifiers by naming platforms, custody, operation classes, adapters, provider profiles, recovery bounds, and release controls.
- S1–S5 become mandatory representative complete-product coverage where their corresponding P-capabilities are supported; “eventually” is not completion.
- M0 may swap synthetic protected-store/provider fixtures, but must reuse the same core packages, policy schema/evaluator, capability state machine, receipt schema, and contract tests.
- Generality evidence must show distinct credential/disclosure and consequential-action journeys traversing the same generic request → policy → disclosure/approval → capability → execution → receipt pipeline.
- P6 needs a minimality oracle; P13 needs integrity verification; P14 needs cross-environment migration; P16 needs accessibility acceptance; P18 needs a finite per-release checklist.

## M0 portfolio recommendation

Use two recipients and two independent journeys through one core:

1. Synthetic credential/status proof to verifier A, with minimal disclosure, nonce, recipient/purpose binding, and safe receipt.
2. Transaction-bound synthetic payment to merchant B, with safe preference projection, concrete approval, no reusable payment secret, and deterministic rejection of mutation/replay.

This exposes three classes—safe view, credential/disclosure, and payment authority—without making one scenario the product. Add signing/account-action only if fresh judge-like review finds the two journeys still look commerce-specific.

Current core documents passed a case-insensitive scenario-vocabulary scan. Future source needs the mechanical lint.
