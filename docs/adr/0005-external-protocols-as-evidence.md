# External protocols as evidence, never authority

x402 payment requests, AP2 mandates, OpenID4VP requests, MCP/WebMCP tool calls, and A2A messages arrive from untrusted parties. We treat each as untrusted evidence: PTF re-validates resource, amount, asset, network, recipient key, mandate chain, and freshness against local Authority State before issuing any capability.

## Considered Options

- **Native x402/AP2 passthrough**: faster to demo, but lets a 402 header or an agent-signed mandate manufacture spending power. Rejected as unsafe.
- **PTF-exclusive protocol**: cleaner model, zero adoption. Rejected — v0.1 must ride existing rails (x402 v2, AP2, OpenID4VP 1.0, MCP, A2A v1.0) to be useful.
