# Preliminary fresh security review

Reviewer date: 2026-09-02. This is specification-level and deliberately not a final implementation threat model.

## Gate verdict

**FAIL for beginning trusted-core production implementation.** Security intent is strong, but no control is implemented or evidenced. S-01–S-10 and INV-01–INV-12 lacked direct interface/test traceability; `docs/program/security-properties-ledger.md` now records the missing evidence obligations.

## Highest-risk abuse paths

1. Approval for terms A is reused after recipient, amount, scope, or transaction substitution.
2. A prompt-injected agent forwards an opaque handle that accidentally behaves as bearer authority.
3. Concurrent redemption executes a one-use capability more than once.
4. Canonical protected records leak through generic model/UI/error/debug/crash/log serialization.
5. Untrusted observations or summaries poison durable persona and manipulate future approval framing.
6. An adapter hides a plaintext/legacy downgrade or maps a malicious origin to the wrong recipient.
7. Stale sync/recovery state restores revoked device, policy, grant, or capability authority.
8. Recipient registry/key metadata is poisoned or not rotated after compromise.
9. A dependency/update compromise executes inside the trusted runtime TCB.

## Missing decisions/controls

- Concrete TCB and process isolation; key custody; caller/recipient authentication; canonical transaction encoding.
- Atomicity/idempotency/crash semantics; revocation bounds; rollback-resistant sync; recovery actors.
- Trusted approval ceremony; tenant/principal isolation; rate/resource limits; safe DTO allowlists.
- Enforceable disclosure minimality/cumulative risk; recipient-purpose non-guarantee; release/supply-chain controls.

## Assumptions requiring Human validation

1. Which production runtime/key boundary is authoritative, and which device/operator compromise cases must remain survivable?
2. Which independently authenticated recipient/redemption profile is mandatory for credential, payment, signing, and other consequential operations?
3. Who may authorize recovery or plaintext downgrade, through which trusted approval surface, and with what reauthentication/revocation bounds?

Permitted before those answers: harness work, architecture comparison, threat-driven synthetic spikes, and contract design. A final code threat model waits for a real implementation/deployment profile.
