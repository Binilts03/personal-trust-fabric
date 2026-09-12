# Policy constrains, never creates authority

A rule like "purchases below ₹2,000 are permitted" is ambiguous: it can be misread as granting ₹2,000 of spending power. We decide that Authority State comes only from Standing Grants and digest-bound Approvals; Policy evaluation can only narrow or deny.

## Consequences

Prevents the dangerous bug class where configuration, inference, or protocol input accidentally manufactures permission. Every `allow` in audit must cite the Grant or Approval it consumed, not just the Policy that passed.
