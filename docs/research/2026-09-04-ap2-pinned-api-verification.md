# AP2 Pinned Python API Verification — 2026-09-04

## Scope

PTF Plan 03 pins `google-agentic-commerce/AP2` at commit:

```text
e1ea56db72a6385bce3e5c1112b3a56ce60acb43
```

This note verifies only that exact first-party source revision.

## Primary sources

- Commit: <https://github.com/google-agentic-commerce/AP2/commit/e1ea56db72a6385bce3e5c1112b3a56ce60acb43>
- Package metadata: <https://github.com/google-agentic-commerce/AP2/blob/e1ea56db72a6385bce3e5c1112b3a56ce60acb43/pyproject.toml>
- Mandate facade: <https://github.com/google-agentic-commerce/AP2/blob/e1ea56db72a6385bce3e5c1112b3a56ce60acb43/code/sdk/python/ap2/sdk/mandate.py>
- SDK README/API example: <https://github.com/google-agentic-commerce/AP2/blob/e1ea56db72a6385bce3e5c1112b3a56ce60acb43/code/sdk/python/ap2/sdk/README.md>
- OpenPaymentMandate schema: <https://github.com/google-agentic-commerce/AP2/blob/e1ea56db72a6385bce3e5c1112b3a56ce60acb43/code/sdk/python/ap2/sdk/generated/open_payment_mandate.py>
- PaymentMandate schema: <https://github.com/google-agentic-commerce/AP2/blob/e1ea56db72a6385bce3e5c1112b3a56ce60acb43/code/sdk/python/ap2/sdk/generated/payment_mandate.py>
- Amount: <https://github.com/google-agentic-commerce/AP2/blob/e1ea56db72a6385bce3e5c1112b3a56ce60acb43/code/sdk/python/ap2/sdk/generated/types/amount.py>
- Merchant: <https://github.com/google-agentic-commerce/AP2/blob/e1ea56db72a6385bce3e5c1112b3a56ce60acb43/code/sdk/python/ap2/sdk/generated/types/merchant.py>
- PaymentInstrument: <https://github.com/google-agentic-commerce/AP2/blob/e1ea56db72a6385bce3e5c1112b3a56ce60acb43/code/sdk/python/ap2/sdk/generated/types/payment_instrument.py>
- ReceiptClient: <https://github.com/google-agentic-commerce/AP2/blob/e1ea56db72a6385bce3e5c1112b3a56ce60acb43/code/sdk/python/ap2/sdk/receipt_wrapper.py>

## Verified dependency contract

Pinned `pyproject.toml` declares:

```text
cryptography==46.0.5
jwcrypto==1.5.6
pydantic==2.12.5
sd-jwt==0.10.4
pytest==9.0.2
py
```

PTF needs only the runtime dependencies from this list; upstream's test dependency does not become a PTF runtime authority/security dependency.

## Verified `MandateClient` signatures

```python
MandateClient.create(
    payloads: list[Any],
    issuer_key: JWK,
    sd: DisclosureMetadata | None = None,
) -> str
```

```python
MandateClient.present(
    holder_key: JWK,
    mandate_token: str,
    payloads: list[Any],
    sd: DisclosureMetadata | None = None,
    claims_to_disclose: dict[str, Any] | None = None,
    nonce: str | None = None,
    aud: str | None = None,
    hash_mode: Literal["sd_hash", "issuer_jwt_hash"] = "sd_hash",
) -> str
```

Despite optional type annotations, `present()` requires both `aud` and `nonce` for the KB-SD-JWT hop and raises when either is absent.

```python
MandateClient.verify(
    token: str,
    key_or_provider: JWK | PublicKeyProvider,
    payload_type: type[T] | None = None,
    expected_aud: str | None = None,
    expected_nonce: str | None = None,
    clock_skew_seconds: int = 300,
    current_time: int | None = None,
) -> Mandate[T] | list[dict[str, Any]]
```

For a delegation chain, the root key argument must be a `PublicKeyProvider` callable rather than a single JWK. Final KB-SD-JWT verification requires expected audience and nonce when the presentation contains key binding.

```python
MandateClient.get_closed_mandate_jwt(presentation_token: str) -> str
```

The SDK's canonical receipt reference is:

```python
reference = compute_sha256_b64url(
    MandateClient().get_closed_mandate_jwt(chain)
)
```

## Verified reference mandate constructors

```python
from ap2.sdk.generated.open_payment_mandate import (
    AllowedPayees,
    AmountRange,
    OpenPaymentMandate,
)
from ap2.sdk.generated.payment_mandate import PaymentMandate
from ap2.sdk.generated.types.amount import Amount
from ap2.sdk.generated.types.merchant import Merchant
from ap2.sdk.generated.types.payment_instrument import PaymentInstrument

open_payload = OpenPaymentMandate(
    constraints=[
        AmountRange(currency="USD", min=0, max=5000),
        AllowedPayees(allowed=[Merchant(id="M-1", name="Cat Store")]),
    ],
    cnf={"jwk": holder_public_jwk},
    iat=now_epoch,
    exp=expires_epoch,
)

closed_payload = PaymentMandate(
    transaction_id="tx_abc",
    payee=Merchant(id="M-1", name="Cat Store"),
    payment_amount=Amount(amount=2500, currency="USD"),
    payment_instrument=PaymentInstrument(
        type="card",
        id="protected-ref-or-protocol-token",
        description="PTF protected payment instrument reference",
    ),
    iat=now_epoch,
    exp=expires_epoch,
)
```

PTF must map AP2 merchant IDs to an already validated PTF Subject/binding; `Merchant.name` is display metadata and cannot establish identity.

## Selective disclosure semantics

`MandateClient.present(..., hash_mode="sd_hash")` locks the exact preceding disclosures forwarded at that hop.

`hash_mode="issuer_jwt_hash"` commits only to the preceding issuer-signed JWT, allowing the next delegate to drop disclosures. PTF may use this only when the selected DisclosurePlan explicitly permits downstream minimization.

`claims_to_disclose=None` reveals all available disclosures; `{}` reveals none; a dictionary selects named fields. PTF must never derive the dictionary from Agent preference alone—it comes from the already-authorized DisclosurePlan.

## Security finding AP2-LOG-01 — raw presentation JWT is logged by upstream `present()`

At this pinned revision, `MandateClient.present()` calls the module-local `_log_event()` after presentation creation with:

```python
{
    "success": True,
    "pres_jwt": pres_jwt,
    "aud": aud,
    "holder_pub": ...,
}
```

`_log_event()` appends JSON to `LOG_FILE_PATH`, which defaults to `.logs/mandate_operations.log` under the SDK source/package root.

This conflicts with PTF's requirement that raw protocol Evidence Artifacts remain on the protected protocol delivery/evidence path and not generic logs.

### Required PTF containment

The AP2 protected signing executor must suppress this vendor file logger before constructing/using `MandateClient`:

```python
import os
import ap2.sdk.mandate as ap2_mandate

ap2_mandate.LOG_FILE_PATH = os.devnull
client = ap2_mandate.MandateClient()
```

The executor test must monkeypatch the upstream log path to a controlled canary file before executor construction, assert the executor resets it to `os.devnull`, execute a presentation, and assert no raw mandate token is written to the controlled file or PTF logs.

This is a containment workaround for the pinned upstream behavior, not an AP2 protocol requirement. It should be documented and reconsidered if a later AP2 revision exposes a supported logger/configuration seam.

## Security finding AP2-MONEY-01 — generated `Budget.max` is a float

The generated `Budget` constraint uses:

```python
max: float
currency: str
```

PTF canonical monetary security terms forbid binary floats. Therefore the foundational AP2 reference profile must **not** use AP2 `Budget` as authoritative enforcement of a PTF aggregate monetary limit.

Reference mapping:

- exact/transaction amount -> AP2 `Amount` / `AmountRange`, which use integer minor units;
- aggregate Standing Grant budget -> PTF CP2/authority ledger enforcement;
- AP2 `Budget` is not claimed as an enforcement location for canonical PTF aggregate money in the foundational profile.

If a future AP2 profile needs protocol-side aggregate-budget enforcement, it requires an explicit semantic mapping review rather than converting PTF integer money to float.

## Receipt API and pinned-source discrepancy

`ReceiptClient.create_payment_receipt(payment_mandate_content, reference)` builds a `PaymentReceipt` model; it does not sign it. AP2's own README says to sign separately with `create_jwt`.

`ReceiptClient.verify_receipt(...)` verifies signature and reference existence. Its annotation says `has_reference_in_store_cb` is optional, and the README says the reference check is conditional. However the pinned implementation calls `has_reference_in_store_cb(receipt_reference)` unconditionally.

PTF therefore always supplies a callback:

```python
result = ReceiptClient().verify_receipt(
    receipt_jwt=receipt_jwt,
    receipt_issuer_public_key=issuer_public_key,
    has_reference_in_store_cb=lambda candidate: candidate == expected_reference,
    is_payment_receipt=True,
)
```

No PTF code relies on `None` callback behavior at this commit.

## Planning decisions

1. Use only the exact verified APIs above; no “adapt if signature differs” instruction.
2. Suppress the pinned SDK's raw presentation-JWT file logging inside the AP2 signing executor.
3. Use integer `AmountRange`/`Amount` for monetary mapping; keep aggregate budgets in PTF CP2 rather than AP2 float `Budget`.
4. Always provide an explicit receipt-reference callback to `verify_receipt`.
5. Merchant/name/protocol IDs remain evidence/binding data and do not create PTF trust or authority.
