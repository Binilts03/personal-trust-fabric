# Changelog

All notable changes to this project are documented here, Keep-a-Changelog
flow: land work under `## [Unreleased]`, move it to a versioned section on
release day. This project adheres to Semantic Versioning.

## [Unreleased]

## [0.1.0-rc.1] - 2026-09-14

First release candidate: user-owned trust and delegated-authority layer
for the agentic web (PTF v0.1).

### Added

- Domain-neutral `Authority` engine (`evaluate(operation, ingress)` with
  `VerifiedIdentity`; digest by construction; `exact`/`set`/`any` actor
  selectors) — ADR-0010, ADR-0013.
- Standards edge: AuthZEN 1.0 evaluation profile, RFC 8693/9396/8707/9449
  OAuth-agent attenuation, SD-JWT/KB-JWT evidence translator, audit
  interop projection — ADR-0009.
- Operator surface: `ptf` CLI (init/keygen/rekey/recipient/grant/pay/
  disclose/audit/revoke), MCP stdio server (fixed identity, propose/check/
  redeem), production PDP bin (TLS-required, key allowlist, per-key rate
  limits, read-only evaluation).
- Durability: JSON stores with optimistic revision CAS, audit freshness
  binding against rollback, scrypt+AES-GCM keystore with passphrase
  sourcing (env/file/TTY) and rotation — ADR-0014, ADR-0015.
- Release automation: SLSA Build L3 provenance + CycloneDX SBOM on `v*`
  tags, Scorecard, TruffleHog verified-secrets scan.

### Security

- See `THREATMODEL.md` v2 (open gaps stated with mitigations) and
  `docs/audit/` (auditor entry). Report vulnerabilities privately via the
  GitHub Security tab, never in a public issue.

[Unreleased]: https://github.com/Binilts03/personal-trust-fabric/compare/v0.1.0-rc.1...HEAD
[0.1.0-rc.1]: https://github.com/Binilts03/personal-trust-fabric/releases/tag/v0.1.0-rc.1
