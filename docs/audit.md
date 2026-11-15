---
layout: default
title: Audit Documentation
nav_order: 6
permalink: /audit/
---

# Audit Documentation

Auditor entry point: honest limits, operations, verification, threats.

## Sections

| Doc                       | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| [Limits](limits/)         | What PTF **cannot** do — ceilings documented more carefully than features |
| [Operations](operations/) | Container image, health signals, rotation, restore drills                 |
| [Verification](verify/)   | Reproduce CI gate from scratch: `typecheck`, unit, eval, brand, harness   |
| [Threats](threats/)       | Trust boundaries, assets, attacker capabilities, abuse paths, mitigations |
| [Decisions](decisions/)   | Key security/architecture decisions with rationale                        |

## Quick Verification

```sh
git clone https://github.com/Binilts03/personal-trust-fabric.git
cd personal-trust-fabric
npm install
npm run typecheck && npm test && npm run eval
bash scripts/harness.sh
```

All must pass. Current exact-head CI is the source for test counts. It checks strict TypeScript, the unit/integration suite, example/evaluation tests, brand/zero-dependency/public-seam rules, packed consumer imports, dependency audit, documentation build and secret scanning. It does not prove live-provider security.

## Honest Limits Highlights

- **Single-operator** — no multi-tenant, no remote ingress
- **File keystore** — no HSM/KMS (pluggable `KeyProvider` seam exists)
- **Reference providers** — move nothing; x402/AP2 are evidence translators
- **No rate limiting** — no DoS protection on ingress
- **No external anchoring** — audit is local hash chain only
- **No npm publish** — `package.json` has `publishConfig` but not on registry

See [limits.md](limits/) for complete list.
