# Personal Trust Fabric

Build the complete Personal Trust Fabric defined in `PRODUCT_CONTRACT.md`. The WebMCP Challenge is milestone M0, not the product boundary.

## Golden rules

- The model/agent is not a trust authority and does not receive protected values by default.
- Hard policy and protected execution are deterministic and outside model inference.
- Authority, secret visibility, authentication, and disclosure planning remain separate concepts.
- Scenario and protocol vocabulary stays outside the generic trust core.
- Learning cannot silently expand authority; routine observability cannot copy protected values.
- Security claims name their evidence, observable scope, trusted boundary, and residual limitation.

## Map

| Need | Source of truth |
|---|---|
| Product scope and acceptance | `PRODUCT_CONTRACT.md`, `PRODUCT_BOUNDARY_MATRIX.md` |
| Domain and interfaces | `DOMAIN_MODEL.md`, `DATA_MODEL_AND_STATE_MACHINES.md`, `INTERFACE_CONTRACTS.md` |
| Security and privacy | `SECURITY_PRIVACY_MODEL.md` |
| Program and requirements status | `docs/program/requirements-ledger.md` |
| Commands and harness state | `docs/commands.md`, `docs/program/harness-status.md` |
| Architecture decisions | `docs/adr/README.md` |
| Research and validation | `docs/research/current-sources.md`, `VALIDATION_REPORT.md` |
| Execution/review recovery | `docs/program/execution-ledger.md` |
| Documentation index | `docs/index.md` |

## Work gate

Before substantive work, follow `SKILL_ROUTING_PROTOCOL.md`, record routing in the execution ledger, and re-route when the task category changes. Material work requires scoped verification and fresh independent review. Large trusted-core implementation remains blocked until W0 validation is accepted in `VALIDATION_REPORT.md`.

Run `pwsh scripts/verify-harness.ps1` for the current repository gate. Product commands are discovered through `docs/commands.md`; never invent a passing command or completion claim.
