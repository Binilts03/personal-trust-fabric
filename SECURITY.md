# SECURITY.md — skeleton (v0.1)

## Supported versions

| Version             | Supported                                   |
| ------------------- | ------------------------------------------- |
| 0.1.x (pre-release) | Best-effort, coordinated disclosure welcome |

## Reporting a vulnerability

Open a **private** report via
[GitHub private vulnerability reporting](https://github.com/Binilts03/personal-trust-fabric/security/advisories/new)
(Security tab → “Report a vulnerability”) — do not file a public issue.
Include: affected version/commit, reproduction steps, impact
(spend/disclosure/signing), and whether secrets are involved.

Target response: acknowledge within 72h, fix + advisory + rotated test vectors as needed.

## What reviewers should assume

- The authority path (`normalize → evaluate → issue → redeem → execute`) must have no network, no LLM, no ambient credentials.
- Audit logs and receipts must never contain raw secrets. See `THREATMODEL.md`.
- Core has zero runtime dependencies; adapters are untrusted-edge code.
