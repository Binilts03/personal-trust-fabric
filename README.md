# Personal Trust Fabric

User-owned trust and delegated-authority layer for the agentic web.
Agents propose; the deterministic core disposes. LLMs may reason about
authority — they are never its source.

The rule the whole repo enforces: **use without possession**. An agent can
spend, prove, and sign on your behalf without ever holding your credentials,
keys, payment instruments, or unrestricted authority.

## Install

Requires Node 22+.

```sh
npm install
npm run typecheck && npm test && npm run eval
```

One-command local loop: `scripts/dev-local.sh up` (see `.claude/skills/dev-local/SKILL.md`).

## Sixty-second quickstart

```ts
import {
  Authority,
  Capabilities,
  generateEd25519Keypair,
  leafCidHex,
  signBytes,
  termsDigestOf,
} from "personal-trust-fabric";

const principal = generateEd25519Keypair();
const agent = generateEd25519Keypair();
const merchant = generateEd25519Keypair();
const ids = {
  p: "did:example:you",
  a: "did:example:agent",
  m: "did:example:shop",
};
const keys = new Map([
  [ids.p, principal.publicKeyRaw],
  [ids.a, agent.publicKeyRaw],
  [ids.m, merchant.publicKeyRaw],
]);

// 1. Authority: a standing grant covers the demand (policy only narrows, never creates).
const authority = new Authority();
authority.addGrant({
  id: "groceries",
  principal: ids.p,
  agent: ids.a,
  cmd: "/pay",
  amountMax: 2000,
  currency: "INR",
});
const digest = termsDigestOf({ invoice: "inv-1", amount: 1790 });
const decision = authority.evaluate({
  principal: ids.p,
  agent: ids.a,
  cmd: "/pay",
  purpose: "groceries",
  resource: "invoice:inv-1",
  recipient: ids.m,
  amount: 1790,
  currency: "INR",
  termsDigest: digest,
});
if (!decision.allow) throw new Error("denied");

// 2. Capability: short-lived, bound to the exact terms and recipient.
const caps = new Capabilities({ resolveKey: (id) => keys.get(id) ?? null });
const cap = caps.issue(
  null,
  {
    iss: ids.p,
    aud: ids.a,
    sub: ids.p,
    cmd: "/pay",
    pol: [["<=", ".amount", 2000]],
    purpose: "groceries",
    resource: "invoice:inv-1",
    recipient: ids.m,
    amountMax: 2000,
    currency: "INR",
    exp: Math.floor(Date.now() / 1000) + 300,
    maxUses: 1,
    termsDigest: digest,
  },
  principal.privateKey
);

// 3. Redemption: the recipient proves its key; the agent never sees secrets.
const proof = {
  key: merchant.publicKeyRaw,
  sig: signBytes(merchant.privateKey, Buffer.from(leafCidHex(cap), "hex")),
};
const redeemed = caps.authorize(
  [cap],
  {
    cmd: "/pay",
    args: { amount: 1790, currency: "INR" },
    recipient: ids.m,
    termsDigest: digest,
  },
  { consume: true, proof }
);
if (!redeemed.ok) throw new Error(`denied: ${redeemed.reason}`);
```

## Layout

- `src/core/` — zero-dependency authority plane: capabilities, policy authority,
  disclosure, identity bindings, approval presenter, protected execution, audit.
  Never imports `adapters` (test-enforced).
- `src/adapters/` — thin protocol translators: x402 v2, AP2, OpenID4VP,
  MCP/WebMCP, A2A, plus shared URL and JWS helpers. Evidence in, never authority out.
- `tests/` — `node:test` suites at the public seam; `tests/eval/` holds
  fast-check properties and golden attack transcripts (`npm run eval`).
- `docs/` — system of record: ADRs, protocol deep reads, loops, hygiene checklist.

## Security model in one paragraph

Default-deny with citations: every allow names the grant or approval consumed.
Policies narrow; learning never mints power. Capabilities attenuate monotonically
(`Authority(child) ≤ Authority(parent)`), bind recipient + terms digest + expiry +
uses, and redeem only against a live recipient key proof. Disclosure is
`requested ∩ available ∩ allowed`, holder-bound. Audit is hash-chained (optionally
HMAC-keyed) and never carries secrets. External protocol messages are untrusted
evidence re-validated locally. See `THREATMODEL.md`, `SECURITY.md`, and
`docs/research/` for the full picture and the honest limits (no independent audit
anchoring yet; documented subset implementations for JCS, client_id validation,
and DCQL paths).

## Verify before ship

Every change proves itself: `/verify` (`.claude/skills/verify/SKILL.md`) drives the
public seam with a fresh verifier, runs the full gate, and saves evidence. No proof,
no merge. Pre-commit hooks run typecheck + tests; CI runs the full gate plus
secret scanning, Scorecard, and SLSA provenance on release tags.

## Contributing

Read `AGENTS.md` (golden rules), `CONTEXT.md` (ubiquitous language), and
`docs/agents/domain.md` before touching code. Test at the public seam only.
Report vulnerabilities privately per `SECURITY.md` — never in a public issue.

## License

Apache-2.0 — see `LICENSE`.
