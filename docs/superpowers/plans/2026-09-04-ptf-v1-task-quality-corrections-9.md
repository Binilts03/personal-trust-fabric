# PTF v1 Task-Quality Corrections 9 — Verified x402 2.22.0 API

Status: **BINDING PLAN 02 UPSTREAM-API CORRECTION**

The September 4 strict Superpowers pass verified the actual x402 2.22.0 Python package published from source commit `23c7a9751ae4033de60cf6e9111a931869eecbe7`. This document removes guessed/fallback SDK calls from Plan 02.

## Provenance

```text
x402 version: 2.22.0
PyPI source commit: 23c7a9751ae4033de60cf6e9111a931869eecbe7
wheel SHA-256: e2908fe1493144bfb2b7e624d0373eed70ce2af1b445f55e2c91e6502140bce2
sdist SHA-256: 28d2673c766dbc3c0aca236cacd410e3a52522f7e5a9a49cd836aa33d0484042
```

## Exact V2 schema constructors

Use:

```python
from x402.schemas.payments import PaymentRequired, PaymentRequirements, ResourceInfo

requirements = PaymentRequirements(
    scheme="exact",
    network="eip155:84532",
    asset="0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    amount="2500000",
    pay_to="0x1111111111111111111111111111111111111111",
    max_timeout_seconds=60,
    extra={"name": "USDC", "version": "2"},
)

payment_required = PaymentRequired(
    x402_version=2,
    resource=ResourceInfo(url="https://merchant.example/protected"),
    accepts=[requirements],
    extensions={},
)
```

Canonical Python field names are snake_case (`x402_version`, `pay_to`, `max_timeout_seconds`) while wire aliases are handled by the upstream Pydantic base model.

## Exact client construction

The earlier Plan 02 example:

```python
x402Client(spend_controls=False)
```

is invalid for x402 2.22.0. The constructor accepts only an optional payment-requirements selector.

Reference executor construction is exactly:

```python
from x402 import x402Client
from x402.mechanisms.evm.exact import ExactEvmScheme

self._client = x402Client()
self._client.set_spend_controls(False)
self._client.register(
    "eip155:84532",
    ExactEvmScheme(signer=signer),
)
```

The reference test profile uses exact Base Sepolia network registration rather than a wildcard. `set_spend_controls(False)` is defense-in-depth configuration only; disabling or enabling x402 spend controls cannot create PTF authority.

Payment creation is async:

```python
payload = await self._client.create_payment_payload(payment_required)
```

No plan step may say “adapt if the installed signature differs.” If the locked 2.22.0 artifact does not match these verified APIs, the provenance/hash gate fails and implementation stops for dependency review.

## C10 effect

Plan 02 T4 implementation/test snippets use the exact construction above. Any old `x402Client(spend_controls=False)` or “adapt to installed API” wording is superseded and forbidden.