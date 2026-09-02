# Product Boundary Matrix

This matrix prevents a demonstration or protocol from becoming the product.

| Area | Product status | Required for complete PTF | WebMCP challenge milestone | Notes |
|---|---|---:|---:|---|
| Principal/device/agent identity | Core | Yes | Minimum viable real seam required | Generic, not tied to one website |
| Protected Store/key operations | Core | Yes | Synthetic protected values are acceptable for judging | Challenge deployment does not prove final local custody |
| Personal State/Persona | Core | Yes | Must demonstrate task-specific safe projection | Raw history is not required in model context |
| Hard Policy/Approval | Core | Yes | Must be real reusable policy, not scenario conditionals | Human approval for consequential actions |
| Capability Runtime | Core | Yes | Must be real reusable capability/action seam | Scenario handle must not define semantics |
| Disclosure Planner | Core | Yes | Demonstrate the modes actually exercised by the selected challenge scenarios | Proof/selective/direct modes depend on validated standards and recipient capabilities |
| Credential/Identity Broker | Core | Yes | Synthetic/test credential acceptable | Standards adapters must remain replaceable |
| Payment Authority | Core | Yes | Synthetic/test payment rail acceptable | Must prove authority/credential separation |
| Signing/Auth/Action Authority | Core | Yes | Challenge may demonstrate one bounded action class | Private key not model-visible |
| Agent Safe View | Core | Yes | Required | Demonstrate model gets task-relevant projection, not canonical state |
| Agent/Web Adapters | Core adapter layer | Yes | WebMCP required; at least one non-WebMCP seam should exist in the product architecture | WebMCP is an adapter |
| Recipient/Verifier SDK | Core developer surface | Yes | Required for at least two demo recipients or equivalent generic fixtures | Avoid recipient-specific redemption logic |
| Audit/Provenance | Core | Yes | Required | No protected values in ordinary audit |
| Portability/Sync/Recovery | Core | Yes | Challenge may expose portability/revoke semantics without full production multi-device rollout | Product completion still requires full semantics |
| Persona learning/self-improvement | Core | Yes | Demonstrate correction/provenance or safe preference use | Never self-expand authority |
| User product UI | Core | Yes | Required coherent experience | PTF dashboard must be visibly a product, not only an attack demo |
| Developer platform/conformance | Core | Yes | Required enough for public repo/testing | Full product expands this continuously |
| Production security/ops | Core | Yes | Submission-specific security + deployment required | Full production release requires broader ops |
| WebMCP | Adapter + release milestone | No single protocol is defining | Yes | Current experimental standard |
| MCP | Candidate adapter | No specific external agent protocol is mandatory until evidence/product requirements select it | Not necessary to score WebMCP | Keep the local/programmatic seam protocol-neutral |
| A2A | Conditional adapter | Only if actual use case requires agent-to-agent interop | No | Validate maturity/use before implementation |
| OpenID4VP/VCI, Digital Credentials | Candidate standards adapters | Credential interoperability is required; the exact standards/profile set is selected through evidence and conformance work | Synthetic credential fixtures may be used for challenge scenarios, with limitations stated | Do not claim protocol support before conformance |
| UCP/AP2/ACP/x402/PSP adapters | Conditional payment/commerce adapters | Generic payment authority required; individual rails selected by evidence | No particular rail required | Avoid adapter collection for its own sake |
| TEE/confidential compute | Optional assurance profile | No, unless chosen threat model requires it | No | Do not overengineer |
| Enterprise policy/admin | Not assumed | No | No | Add only if product decision creates an enterprise edition |
| Travel booking | Demonstration scenario | No | Optional hero scenario | Must not appear in trust-core domain terms |
| Shopping/payment demo | Demonstration scenario | No | Optional | Same rule |
| Age/status proof demo | Demonstration scenario | No | Optional | Same rule |
| Signing/account-action demo | Demonstration scenario | No | Optional | Same rule |

## Challenge generality rule

The challenge release must demonstrate that PTF is not a single vertical. The default safeguard is to show **multiple materially different PTF capability classes** using the same trust core, chosen from:

- persona/safe-context projection;
- credential/identity disclosure or proof;
- payment authority;
- signing/authentication authority;
- bounded account/action authority.

The exact scenario count and composition are a design decision. Codex must run a fresh product-scope review and choose enough distinct classes to make generality observable; a single scenario is insufficient. Travel may be one scenario, but it cannot define trust-core types.

## No hidden future-work rule

A mandatory product capability cannot be satisfied by placing it only in a roadmap paragraph. It must have:

1. an implementation workstream;
2. acceptance criteria;
3. tests or conformance evidence;
4. a traceability entry.

If a mandatory capability cannot be implemented, Codex must surface that as a product gap rather than silently moving it to “future work.”
