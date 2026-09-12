# Recipient authentication before protected execution, audit without secrets

Paying or disclosing to a string ID (`merchant_b`) allows substitution. We require the redeeming party to prove possession of the bound private key (Ed25519 signature over the capability reference, checked against the registered Identity Binding; SPIFFE ID where workloads are involved) before any credential, payment instrument, or signing key is touched. Audit records who requested, which policy/grant/approval applied, which capability was consumed, and the outcome — hash-chained with optional HMAC — and never contain raw secrets.

## Consequences

Substitution and replay become redemption-time failures, not post-mortems. Genuine tamper-evidence still needs separately protected HMAC keys and independent anchoring; the hash chain alone is tamper-detection, not proof.
