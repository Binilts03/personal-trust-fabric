---
layout: default
title: Security Model
nav_order: 3
permalink: /security-model/
---

# Security Model in One Paragraph

Default-deny with citations: every allow names the grant or approval consumed. Policies narrow; learning never mints power. Capabilities attenuate monotonically, bind recipient + terms digest + expiry + uses, and redeem only against a live recipient key proof. Disclosure is `requested ∩ available ∩ allowed`, holder-bound. The vault is AES-256-GCM under a keystore DEK with freshness binding; the audit is hash-chained (optionally HMAC-keyed) and never carries secrets. External protocol messages are untrusted evidence re-validated locally.

---

## Core Principles

| Principle                   | Enforcement                                       |
| --------------------------- | ------------------------------------------------- |
| **Default Deny**            | No implicit allow; every decision cites authority |
| **Citations Required**      | `decision.citations[0].authorityId` must exist    |
| **Policy Only Narrows**     | `policy.narrow(grant)` — never expands            |
| **Attenuation Monotonic**   | Child capability ≤ parent; terms digest bound     |
| **Recipient Auth**          | Redemption requires live recipient key proof      |
| **Disclosure Intersection** | `requested ∩ available ∩ allowed` only            |
| **Vault Encryption**        | AES-256-GCM, keystore DEK, freshness binding      |
| **Audit Integrity**         | Hash-chained, optional HMAC, no secrets in log    |
| **Evidence Re-validation**  | External messages re-checked locally              |

---

## Threat Model Summary

See [THREATMODEL.md](https://github.com/Binilts03/personal-trust-fabric/blob/main/THREATMODEL.md) and [docs/audit/threats.md](audit/threats) for full model.

| Asset             | Threat          | Mitigation                                           |
| ----------------- | --------------- | ---------------------------------------------------- |
| Authority grants  | Forgery, replay | JWS signatures, digest binding, expiry               |
| Personal state    | Exfiltration    | AES-256-GCM, purpose-scoped access, no generic read  |
| Capabilities      | Escalation      | Monotonic attenuation, recipient binding, use limits |
| Receipts          | Repudiation     | Signed, hash-chained audit, citations                |
| External messages | Spoofing        | Local re-validation, evidence not authority          |
| Approvals         | Mutation        | Digest-bound, exact terms, one-time use              |

---

## Honest Limits

Documented in [docs/audit/limits.md](audit/limits). Key ceilings:

- Single-operator topology (no multi-tenant)
- File keystore (no HSM/KMS)
- Reference providers move nothing (no live rails)
- No remote ingress / rate limiting
- No external audit anchoring
- npm package not published

---

## Verification

```sh
npm run typecheck && npm test && npm run eval
```

- 297+ unit tests (public seam only)
- 9 eval/property tests (attack vectors, fuzzing)
- Brand check, zero-dep core check, public-seam test check
- Secret scanning (GitHub + TruffleHog)
