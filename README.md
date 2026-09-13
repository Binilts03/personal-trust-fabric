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

As a library: `npm install personal-trust-fabric` (ESM, `exports` →
`dist/src/index.js` + types). As tools: `npx personal-trust-fabric` is not
shipped — use the bins after install: `node dist/src/cli.js --help`,
`PTF_STORE_DIR=./ptf-store ptf-mcp-server` (stdio).

One-command local loop: `scripts/dev-local.sh up` (see `.claude/skills/dev-local/SKILL.md`).

## Sixty-second quickstart

Local decision + local receipt in three steps. For cross-system interop, do not
emit the capability envelope — project through the standards edge instead
(`src/adapters/authzen.ts`, `src/adapters/oauth-agent.ts`,
`src/adapters/sd-jwt.ts`, `src/adapters/audit-interop.ts`; canonical demo: `tests/three-env.test.ts`).

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

// 2. Capability (LOCAL-ONLY, @internal per ADR-0009): short-lived, bound to
// the exact terms and recipient. Never emit across systems — interop uses
// the AuthZEN/OAuth/SD-JWT translators (see tests/three-env.test.ts).
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
- `src/adapters/` — thin translators: standards edge (AuthZEN PDP, OAuth-agent
  attenuation, SD-JWT/KB-JWT, audit interop) plus evidence parsers (x402 v2,
  AP2, OpenID4VP, MCP/WebMCP, A2A) and shared URL/JWS helpers. Evidence in,
  never authority out.
- `src/store/`, `src/cli.ts`, `src/mcp-server.ts` — durable JSON stores,
  `ptf` operator CLI, MCP stdio server (`ptf_propose/check/redeem`).
- `examples/` — `payment-disclosure.mjs` (library end-to-end),
  `mcp-client-config.json` (Claude Desktop wiring).
- `tests/` — `node:test` suites at the public seam; `tests/eval/` holds
  fast-check properties and golden attack transcripts (`npm run eval`).
- `docs/` — system of record: ADRs, protocol deep reads, loops, hygiene checklist.
- `docs/audit/` — auditor entry: architecture, threats, tests, limits, verify,
  public-flip + publish checklist (prod-05 done).

## Operator quickstart (real use)

```sh
export PTF_PASSPHRASE='strong-unique-pass'
node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
node dist/src/cli.js --dir ./ptf-store keygen --alias shop
node dist/src/cli.js --dir ./ptf-store recipient --alias shop --key <hex-from-keygen>
node dist/src/cli.js --dir ./ptf-store grant --id g1 --principal you --cmd /pay --amount-max 2000 --currency INR
node dist/src/cli.js --dir ./ptf-store pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes
node dist/src/cli.js --dir ./ptf-store audit --verify
node dist/src/cli.js --help
```

Single-writer ceiling: one CLI/MCP writer per store; proposals are in-memory
(lost on restart, fail-closed). Back up `ptf-store/` for high-value use.

## Agent quickstart (MCP stdio)

```json
{
  "mcpServers": {
    "personal-trust-fabric": {
      "command": "node",
      "args": ["./dist/src/mcp-server.js"],
      "cwd": "/path/to/personal-trust-fabric",
      "env": {
        "PTF_STORE_DIR": "./ptf-store",
        "PTF_PASSPHRASE": "via-env-only"
      }
    }
  }
}
```

Tools: `ptf_propose` (dry-run, returns terms + digest, status `pending`),
`ptf_check` (status by digest), `ptf_redeem` (challenge `cidHex`, then proof
→ receipt). No approve tool: humans approve in the CLI; the server only
spends standing grants. See `examples/mcp-client-config.json`.

## Security model in one paragraph

Default-deny with citations: every allow names the grant or approval consumed.
Policies narrow; learning never mints power. Capabilities attenuate monotonically
(`Authority(child) ≤ Authority(parent)`), bind recipient + terms digest + expiry +
uses, and redeem only against a live recipient key proof. Disclosure is
`requested ∩ available ∩ allowed`, holder-bound. Audit is hash-chained (optionally
HMAC-keyed) and never carries secrets. Audit anchors to a local checkpoint file
with offline O(log n) inclusion proofs (no ledger/witness network). External
protocol messages are untrusted evidence re-validated locally. See `THREATMODEL.md`, `SECURITY.md`, and
`docs/research/` for the full picture and the honest limits (checkpoint-file
anchoring only — no ledger/witness yet; documented subset implementations for JCS, client_id validation,
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
