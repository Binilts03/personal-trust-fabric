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
`dist/src/api.js` + types). As tools: `npx personal-trust-fabric` is not
shipped — use the bins after install: `node dist/src/cli.js --help`,
`PTF_STORE_DIR=./ptf-store ptf-mcp-server` (stdio).

One-command local loop: `scripts/dev-local.sh up` (see `.claude/skills/dev-local/SKILL.md`).

## Sixty-second quickstart

Decide locally in three steps: grant authority, build the operation, evaluate.
For cross-system interop, project the decision through the standards edge
instead of emitting internals (`src/adapters/authzen.ts`,
`src/adapters/oauth-agent.ts`, `src/adapters/sd-jwt.ts`,
`src/adapters/audit-interop.ts`; canonical demo: `tests/three-env.test.ts`).

```ts
import { Authority, paymentBounds } from "personal-trust-fabric";
import { recipientBounds } from "personal-trust-fabric/profiles/payment";
import type { VerifiedIdentity } from "personal-trust-fabric";

const ids = {
  p: "did:example:you",
  a: "did:example:agent",
  m: "did:example:shop",
};

// 1. Authority: a standing grant covers the demand (policy only narrows, never creates).
const authority = new Authority();
authority.addGrant({
  id: "groceries",
  principal: ids.p,
  actor: { kind: "exact", id: ids.a },
  action: { name: "/pay" },
  bounds: [
    ...paymentBounds({ amountMax: 2000, currency: "INR" }),
    ...recipientBounds([ids.m]),
  ],
});

// 2. Operation: identity-free action/resource/context (amounts in atomic units).
const operation = {
  action: { name: "/pay" as const },
  resource: { type: "invoice", id: "invoice:inv-1" },
  context: { amount: 1790, currency: "INR", recipient: ids.m },
  purpose: "groceries",
};

// 3. Verified ingress: the host authenticates the caller OUT-OF-BAND
// (token/session/key) and binds identity here — never from the request body.
const ingress: VerifiedIdentity = {
  id: ids.a,
  principal: ids.p,
  source: "local-registration",
  proofRef: "example",
};

// 4. Decision: identity binds from the ingress and the digest derives
// inside the engine — demands never self-certify. Every allow cites its grant.
const decision = authority.evaluate(operation, ingress);
if (!decision.allow) throw new Error("denied");
```

Safe grants combine `paymentBounds` + `recipientBounds` (recipient-bounded).
Merchant-agnostic grants (no recipient bound) require explicit intent — they
allow payment to any recipient and must be audited as deliberate.

The capability envelope (`src/core/capability.ts`) is internal-only local
receipt machinery (ADR-0009) — never emitted across systems.

## Layout

- `src/api.ts` — curated public entry (explicit named re-exports: Authority
  engine, approval presenter, persona, receipts, registry). `src/profiles/` —
  domain profiles (payment conventions + helpers, no policy language) plus
  `profiles/data.ts` general agent contract (`requestData`/`requestExecution`,
  dry-run only, never mints authority).
  Capability envelope, canonical/crypto machinery, and stores stay internal
  (ADR-0011).
- `src/core/` — zero-dependency authority plane: capabilities, policy authority,
  disclosure, identity bindings, approval presenter, protected execution, audit.
  Never imports `adapters` (test-enforced).
- `src/adapters/` — thin translators: standards edge (AuthZEN PDP, OAuth-agent
  attenuation, SD-JWT/KB-JWT, audit interop) plus evidence parsers (x402 v2,
  AP2, OpenID4VP, MCP/WebMCP, A2A) and shared URL/JWS helpers, plus
  `adapters/providers.ts` protected provider seam (payment/travel/retail/email/
  identity fakes, `providerAsExecutor`/`executeViaProvider`). Evidence in,
  never authority out.
- `src/store/`, `src/cli.ts`, `src/mcp-server.ts` — durable JSON stores
  (`store/files.ts` authority/registry, `store/vault.ts` `personal-state.json`
  AES-256-GCM envelope under a keystore DEK, revision CAS + freshness
  binding), `ptf` operator CLI, MCP stdio server
  (`ptf_propose/check/redeem` + `ptf_request_data/present_data/request_action/
get_receipt/list_capabilities/revoke`).
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
# Prefer a 0600 file (or an interactive prompt) so the secret never lives in env:
# export PTF_PASSPHRASE_FILE="$HOME/.ptf/passphrase" && unset PTF_PASSPHRASE
node dist/src/cli.js --dir ./ptf-store init
node dist/src/cli.js --dir ./ptf-store keygen --alias you
node dist/src/cli.js --dir ./ptf-store keygen --alias shop
node dist/src/cli.js --dir ./ptf-store recipient --alias shop --key <hex-from-keygen>
node dist/src/cli.js --dir ./ptf-store grant --id g1 --principal you --cmd /pay --agent shopper --amount-max 2000 --currency INR --recipient shop
node dist/src/cli.js --dir ./ptf-store pay --principal you --agent shopper --recipient shop --amount 100 --currency INR --resource invoice:1 --yes
node dist/src/cli.js --dir ./ptf-store audit --verify
node dist/src/cli.js --dir ./ptf-store backup --to ./backups/ptf-store
node dist/src/cli.js --help
```

Supported topology: one CLI/MCP writer per store, with optimistic revision
control as the backstop — a stale writer fails closed ("changed under us")
instead of last-write-wins. Proposals persist per termsDigest file
(ADR-0017: restart preserves pending/denied/executed; challenges stay
in-memory). Vault (Personal State) persists to
`ptf-store/personal-state.json` with revision CAS + audit freshness binding
(stale vault fails `audit --verify`); operator commands `vault-put`
(`--value-file` only, never prints/audits values) and `vault-read`
(prints disclosed names only), plus library `VaultStore.putRecord` /
`readForPurpose` / `useCredential` from `src/index.ts` and subpath
`personal-trust-fabric/vault`. Back up `ptf-store/` for high-value use — as
one unit including `personal-state.json` (plus an anchor checkpoint; see
`docs/audit/operations.md`).

## Agent quickstart (MCP stdio)

Commerce reference host with FIXED identity at startup: the server takes
principal+actor at instantiation (configured once, not per-tool), and tool
schemas carry NO principal/agent fields — every propose/redeem is bound to
that fixed identity.

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
→ receipt; `/pay` demands only) plus the general contract:
`ptf_request_data` (`/disclose` dry-run → present via `ptf_present_data`),
`ptf_present_data` (holder-signed presentation for a pending `/disclose`
proposal; nonce-bound, single-present, verifier must enforce nonce/freshness),
`ptf_request_action` (any `/-path`
dry-run except `/disclose*`), `ptf_get_receipt` (status/receipt by digest,
in-memory only — `unknown` after restart), `ptf_list_capabilities`
(read-only grant projections for this fixed identity only, no keys or
capability envelopes),
`ptf_revoke` (request-only — returns `requested:true` + the
`ptf revoke --grant <id>` command, mutates nothing). Propose/redeem/request
schemas carry demand fields (amount, currency,
recipient, resource, purpose) with NO principal/agent fields — the fixed
startup identity applies. No approve tool: humans approve in the CLI; the server only
spends standing grants, and the contract tools never consume uses. See `examples/mcp-client-config.json`.

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
