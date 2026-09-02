# Open Questions and ADR Candidates

Do not hide unresolved decisions inside implementation prose.

## OQ-01 Trusted runtime deployment
Local, hosted, or hybrid? Challenge sandbox profile may differ from production.

## OQ-02 Primary platform
Desktop/native shell, browser extension, mobile-native, or combination? The answer affects secure storage and process isolation.

## OQ-03 Hard policy engine
Typed in-process model vs Cedar vs OPA/Rego vs other.

## OQ-04 Capability representation
Stateful opaque reference, signed attenuable token, OAuth-aligned constrained token, or other established mechanism.

## OQ-05 Recipient authentication
How is a Recipient independently identified and bound to a request/redemption?

## OQ-06 Credential formats
Which standards/formats are required for the first real interoperable credential path?

## OQ-07 Payment provider/rail
Which real provider/standard can demonstrate non-possession without turning the product into a payment processor?

## OQ-08 Signing/authentication providers
Which hardware/OS/WebAuthn/key interfaces fit the target platforms?

## OQ-09 Sync/recovery
Key hierarchy, recovery actors, device loss, rollback/conflict semantics.

## OQ-10 Persona storage/learning
Storage model and promotion thresholds; sensitive inference policy.

## OQ-11 Legacy web
What assurance downgrade is acceptable where only form injection/plaintext page delivery works?

## OQ-12 Downstream obligations
What can PTF technically enforce after legitimate disclosure, versus merely record/contract?

## OQ-13 WebMCP challenge scenarios
Which set best proves generality, WebMCP leverage and judgeability without adding demo-only architecture?

## OQ-14 Product distribution
How users install/own/use PTF across agents and devices.

## ADR rule

Create an ADR only when:
1. hard to reverse;
2. surprising without context;
3. genuine alternatives were compared.

Each ADR must include:
- requirement IDs;
- evidence/source date;
- alternatives;
- security/trust effect;
- operational effect;
- rejected options;
- test obligations;
- revisit trigger.
