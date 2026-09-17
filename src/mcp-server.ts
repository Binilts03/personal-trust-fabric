#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { pathToFileURL } from "node:url";
import * as z from "zod/v4";
import {
  Authority,
  Capabilities,
  FakePaymentExecutor,
  FileAuditLog,
  RecipientRegistry,
  executeAndReceipt,
  leafCidHex,
  loadAuthority,
  loadRegistry,
  openKeystore,
  privateKeyFromPkcs8,
  publicKeyFromPrivate,
  rawPublicKey,
  readPassphrase,
  renderProposal,
  saveAuthority,
  signBytes,
  digestForOperation,
} from "./index.js";
import { readFileSync } from "node:fs";
import { requestData, requestExecution } from "./profiles/data.js";
import type {
  ActorSelector,
  AuthorityOperation,
  AuthorityRequest,
  PaymentExecutor,
  SealedCapability,
  VerifiedIdentity,
} from "./index.js";

/**
 * PTF MCP server (prod-04): the LLM-facing side of the harness (ADR-0007).
 * Commerce reference host — the simple payment/disclosure schema is the
 * reference-host convention, not the generic engine (which stays
 * domain-neutral behind `Authority.evaluate`).
 * Tools: ptf_propose (dry-run evaluate + render, no side effects),
 * ptf_check (status by terms digest), ptf_redeem (re-verify, issue, prove,
 * execute, receipt). There is deliberately NO approve tool: approval happens
 * human-side (CLI) or ahead of time (standing grants). The server never mints
 * authority from an agent call — it only spends what already exists.
 *
 * CONCURRENCY (optimistic revision CAS, ticket 02): authority/registry
 * files carry a `revision` bumped atomically with the data on each write.
 * A save whose handle no longer matches the file fails closed ("changed
 * under us — reload and retry") instead of last-write-wins, so concurrent
 * redeems cannot double-spend single-use authority: the loser errors
 * visibly before any receipt. Callers retry on a fresh handle (each tool
 * call here already reloads). Proposals + pending challenges stay in
 * memory with TTLs and are lost on restart (fail-closed: check → unknown,
 * redeem → propose again). Receipts survive restarts in audit.jsonl;
 * proposal status does not.
 *
 * IDENTITY (ADR-0013): the server speaks for ONE fixed identity — principal
 * + actor are pinned at instantiation (`PtfServerOptions`, from
 * `PTF_MCP_PRINCIPAL` / `PTF_MCP_ACTOR` in `main`) and bound as the verified
 * ingress for every evaluation. Tool inputs carry NO identity fields: a
 * caller choosing its own principal/agent would be self-certification.
 * The stdio transport is local-only, so the fixed ingress is
 * `source: "local-registration"` with `proofRef "stdio:<storeDir>"`.
 * REMOTE / MULTI-TENANT hosts must NOT reuse this binding: derive a
 * per-caller ingress from a verified token (OAuth/DPoP/mTLS) and pass it to
 * `Authority.evaluate` — that mapping is host duty, not this file's.
 */

export interface PtfServerOptions {
  readonly dir: string;
  readonly env: Record<string, string | undefined>;
  readonly now?: () => number;
  /** Fixed verified principal. Every evaluation binds this — callers cannot. */
  readonly principal: string;
  /** Fixed verified actor. Every evaluation binds this — callers cannot. */
  readonly actor: string;
  /**
   * Value-movement rail, injectable for fault-injection tests; production
   * hosts supply their own PaymentExecutor (ticket 05).
   */
  readonly executor?: PaymentExecutor;
}

interface Proposal {
  demand: AuthorityRequest;
  status: "pending" | "denied" | "executed";
  receipt?: Record<string, unknown>;
  until: number;
}

const demandSchema = z
  .object({
    cmd: z.enum(["/pay", "/disclose"]),
    purpose: z.string().min(1),
    resource: z.string().min(1),
    recipient: z.string().min(1),
    amount: z.number().int().positive().optional(),
    currency: z.string().optional(),
    claims: z.array(z.string()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.cmd === "/pay") {
      if (v.amount === undefined)
        ctx.addIssue({ code: "custom", message: "/pay requires amount" });
      if (v.currency === undefined || v.currency.length === 0)
        ctx.addIssue({ code: "custom", message: "/pay requires currency" });
    }
    if (v.cmd === "/disclose") {
      if (v.claims === undefined || v.claims.length === 0)
        ctx.addIssue({ code: "custom", message: "/disclose requires claims" });
    }
  });

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Issuer/recipient key resolution for capability checks (ticket 05; same
 * contract as the CLI helper of the same name). Registry authoritative;
 * known-but-retired stays retired; truly unknown ids fall back to
 * locally-held keys so the operator's own issuance verifies. Proofs still
 * need private keys that never leave the host.
 */
function resolveKeyWithLocalFallback(
  reg: RecipientRegistry,
  keys: Record<string, Uint8Array>
): (id: string) => Uint8Array | null {
  return (id: string): Uint8Array | null => {
    const bound = reg.resolve(id);
    if (bound !== null) return bound;
    if (reg.history(id) !== null) return null;
    const seed = keys[id];
    if (seed === undefined) return null;
    try {
      return rawPublicKey(publicKeyFromPrivate(privateKeyFromPkcs8(seed)));
    } catch {
      return null;
    }
  };
}

/**
 * Grant visibility for one fixed ingress: the principal must match and the
 * actor selector must cover the agent. The explicit `{ kind: "any" }`
 * wildcard is audit-visible by design, so it stays listed. Revoked grants
 * are excluded — listing them would advertise dead authority.
 */
function grantVisible(
  g: { readonly principal: string; readonly actor: ActorSelector },
  id: string,
  ingress: VerifiedIdentity,
  revoked: (revokedId: string) => boolean
): boolean {
  if (g.principal !== ingress.principal) return false;
  if (revoked(id)) return false;
  switch (g.actor.kind) {
    case "exact":
      return g.actor.id === ingress.id;
    case "set":
      return g.actor.ids.includes(ingress.id);
    case "any":
      return true;
  }
}

export function createPtfServer(opts: PtfServerOptions): McpServer {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  if (opts.principal.length === 0) fail("server principal is required");
  if (opts.actor.length === 0) fail("server actor is required");
  const executor = opts.executor ?? new FakePaymentExecutor();
  // Fixed verified ingress: stdio is local-only (see module header).
  const ingress: VerifiedIdentity = {
    id: opts.actor,
    principal: opts.principal,
    source: "local-registration",
    proofRef: `stdio:${opts.dir}`,
  };
  const proposals = new Map<string, Proposal>();

  const load = (): {
    auth: Authority;
    reg: RecipientRegistry;
    audit: FileAuditLog;
    keys: Record<string, Uint8Array>;
  } => {
    if (!existsSync(join(opts.dir, "authority.json"))) {
      fail(`no store at ${opts.dir}`);
    }
    // No TTY on stdio: the passphrase comes from PTF_PASSPHRASE(_FILE)
    // only, and only when a keystore actually exists.
    const kp = join(opts.dir, "keystore.json");
    let keys: Record<string, Uint8Array> = {};
    if (existsSync(kp)) {
      const pass = readPassphrase(opts.env);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(kp, "utf8")) as unknown;
      } catch {
        fail("keystore corrupt");
      }
      keys = openKeystore(
        parsed as Parameters<typeof openKeystore>[0],
        pass
      ) as Record<string, Uint8Array>;
    }
    return {
      auth: loadAuthority(opts.dir, { nowSec: now }),
      reg: loadRegistry(opts.dir, now),
      audit: FileAuditLog.open(join(opts.dir, "audit.jsonl"), now),
      keys,
    };
  };

  const server = new McpServer({
    name: "personal-trust-fabric",
    version: "0.1.0",
  });
  const pending = new Map<
    string,
    {
      cap: SealedCapability;
      demand: Proposal["demand"];
      until: number;
    }
  >();

  const prunePending = (): void => {
    for (const [digest, p] of pending) {
      if (now() > p.until) pending.delete(digest);
    }
  };

  const pruneProposals = (): void => {
    for (const [digest, p] of proposals) {
      if (now() > p.until) proposals.delete(digest);
    }
  };

  // Single writer for the shared proposals map: every propose tool
  // (ptf_propose, ptf_request_data, ptf_request_action) records here, and
  // ptf_redeem consumes any /pay proposal regardless of which tool created
  // it. "pending" = authority would allow; still needs live re-check at
  // redeem (standing grant) or human approval (CLI). Never "approved".
  const recordProposal = (
    digest: string,
    demand: Proposal["demand"],
    allow: boolean
  ): void => {
    proposals.set(digest, {
      demand,
      status: allow ? "pending" : "denied",
      until: now() + 600,
    });
  };

  server.registerTool(
    "ptf_propose",
    {
      description:
        "Propose a bounded payment or disclosure. Evaluates authority without spending it and returns the exact terms for human approval.",
      inputSchema: demandSchema,
    },
    async (args) => {
      const { auth } = load();
      pruneProposals();
      prunePending();
      // Binding is derived server-side from the normalized operation +
      // the fixed verified ingress: untrusted callers supply neither
      // identity nor digest, so the schema takes neither. Payment/disclosure
      // attributes ride in the context bag.
      const op: AuthorityOperation = {
        action: { name: args.cmd },
        resource: { type: "ptf-resource", id: args.resource },
        context: {
          ...(args.amount !== undefined ? { amount: args.amount } : {}),
          ...(args.currency !== undefined ? { currency: args.currency } : {}),
          ...(args.claims !== undefined ? { claims: args.claims } : {}),
          recipient: args.recipient,
        },
        purpose: args.purpose,
      };
      const bound = {
        ...op,
        principal: ingress.principal,
        actor: ingress.id,
      };
      const digest = digestForOperation(bound);
      const demand: AuthorityRequest = { ...bound, termsDigest: digest };
      const decision = auth.evaluate(op, ingress, { nowSec: now() });
      const text = renderProposal({
        demand,
        citations: decision.allow ? decision.citations : [],
      });
      if (decision.allow) {
        // "pending" = authority would allow; still needs live re-check at
        // redeem (standing grant) or human approval (CLI). Never "approved".
        recordProposal(digest, demand, true);
      } else {
        recordProposal(digest, demand, false);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              decision.allow
                ? { allowed: true, termsDigest: digest, proposal: text }
                : { allowed: false, reason: decision.reason, proposal: text },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "ptf_check",
    {
      description:
        "Check a proposal's status by terms digest (pending = authority would allow, awaiting live redeem; denied/executed are terminal).",
      inputSchema: z.object({ termsDigest: z.string().min(16) }),
    },
    async (args) => {
      pruneProposals();
      const found = proposals.get(args.termsDigest);
      if (found === undefined) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ status: "unknown" }) },
          ],
        };
      }
      if (now() > found.until) {
        proposals.delete(args.termsDigest);
        return {
          content: [
            { type: "text", text: JSON.stringify({ status: "unknown" }) },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              found.status === "executed"
                ? { status: found.status, receipt: found.receipt }
                : { status: found.status },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "ptf_redeem",
    {
      description:
        "Redeem a pending proposal. Without a proof this checks live authority (dry-run) and returns its id to sign (challenge); with a recipient proof it authorizes the capability first, then spends live authority, executes, and returns a receipt. Payment demands only. Accepts any /pay proposal in the shared map regardless of which propose tool created it. Fails closed on anything stale.",
      inputSchema: z.object({
        termsDigest: z.string().min(16),
        recipientKeyHex: z.string().min(64).optional(),
        recipientSigHex: z.string().min(128).optional(),
      }),
    },
    async (args) => {
      pruneProposals();
      prunePending();
      const proposal = proposals.get(args.termsDigest);
      if (proposal === undefined) fail("unknown proposal: propose first");
      if (now() > proposal.until) {
        proposals.delete(args.termsDigest);
        fail("proposal expired: propose again");
      }
      const { auth, reg, audit, keys } = load();
      const demand = { ...proposal.demand, termsDigest: args.termsDigest };
      // Re-evaluate under the fixed ingress: strip the stored bound form
      // back to the identity-free operation and let the engine rebind.
      const {
        termsDigest: _storedDigest,
        principal: _storedPrincipal,
        actor: _storedActor,
        actorChain: _storedChain,
        ...op
      } = demand;
      void _storedDigest;
      void _storedPrincipal;
      void _storedActor;
      void _storedChain;
      if (demand.action.name !== "/pay") {
        fail(
          "redeem supports /pay demands only in v1 (present disclosures via the CLI)"
        );
      }
      const amountRaw: unknown = demand.context["amount"];
      const currencyRaw: unknown = demand.context["currency"];
      const recipientRaw: unknown = demand.context["recipient"];
      if (
        typeof amountRaw !== "number" ||
        !Number.isFinite(amountRaw) ||
        !(amountRaw > 0)
      ) {
        fail("pending demand is malformed (amount/currency required)");
      }
      if (typeof currencyRaw !== "string" || currencyRaw.length === 0) {
        fail("pending demand is malformed (amount/currency required)");
      }
      if (typeof recipientRaw !== "string" || recipientRaw.length === 0) {
        fail("pending demand is malformed (recipient required)");
      }
      const amount: number = amountRaw;
      const currency: string = currencyRaw;
      const recipient: string = recipientRaw;
      const resource: string = demand.resource.id;
      const purpose: string = demand.purpose ?? "payment";
      const agent: string = demand.actor;
      const seed = keys[demand.principal];
      if (seed === undefined)
        fail(`server holds no key for principal ${demand.principal}`);
      const principalPriv = privateKeyFromPkcs8(seed);
      const caps = new Capabilities({
        resolveKey: resolveKeyWithLocalFallback(reg, keys),
        nowSec: now,
      });
      if (
        args.recipientKeyHex === undefined ||
        args.recipientSigHex === undefined
      ) {
        if (
          args.recipientKeyHex !== undefined ||
          args.recipientSigHex !== undefined
        ) {
          fail(
            "redeem needs both recipientKeyHex and recipientSigHex, or neither"
          );
        }
        // Dry-run first: no signed capability leaves the server unless live
        // authority would allow it. Still no consumption here.
        const preview = auth.evaluate(op, ingress, { nowSec: now() });
        if (!preview.allow) {
          proposal.status = "denied";
          fail(`authority denied at challenge time: ${preview.reason}`);
        }
        const cap = caps.issue(
          null,
          {
            iss: demand.principal,
            aud: agent,
            sub: demand.principal,
            cmd: demand.action.name,
            pol: [["<=", ".amount", amount]],
            purpose,
            resource,
            recipient,
            amountMax: amount,
            currency,
            exp: now() + 300,
            maxUses: 1,
            termsDigest: args.termsDigest,
          },
          principalPriv
        );
        const cidHex = leafCidHex(cap);
        prunePending();
        pending.set(args.termsDigest, {
          cap,
          demand,
          until: now() + 120,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { needProof: true, cidHex, recipient },
                null,
                2
              ),
            },
          ],
        };
      }
      const challenge = pending.get(args.termsDigest);
      pending.delete(args.termsDigest);
      if (challenge === undefined)
        fail("no live challenge: call redeem without a proof first");
      if (now() > challenge.until) fail("challenge expired: propose again");
      let proofKey: Uint8Array;
      let proofSig: Uint8Array;
      try {
        proofKey = new Uint8Array(Buffer.from(args.recipientKeyHex, "hex"));
        proofSig = new Uint8Array(Buffer.from(args.recipientSigHex, "hex"));
      } catch {
        proposal.status = "denied";
        fail("recipient proof must be hex");
      }
      if (proofKey.length !== 32) fail("recipient key must be 32 bytes");
      if (proofSig.length !== 64) fail("recipient signature must be 64 bytes");
      const cidBytes = new Uint8Array(
        Buffer.from(leafCidHex(challenge.cap), "hex")
      );
      // Authorize the capability FIRST so a bad proof never burns authority.
      const redeemed = caps.authorize(
        [challenge.cap],
        {
          cmd: demand.action.name,
          args: { amount, currency },
          recipient,
          termsDigest: args.termsDigest,
        },
        {
          consume: true,
          proof: {
            key: proofKey,
            sig: proofSig,
          },
        }
      );
      if (!redeemed.ok) {
        proposal.status = "denied";
        fail(`redeem failed: ${redeemed.reason}`);
      }
      // Only now spend standing authority.
      const decision = auth.evaluate(op, ingress, {
        consume: true,
        nowSec: now(),
      });
      if (!decision.allow) {
        proposal.status = "denied";
        fail(`authority denied at redeem time: ${decision.reason}`);
      }
      // Persist the consumption BEFORE executing (ticket 05): a crash or a
      // failing rail between persist and execute can only burn a use, never
      // double-spend — the safe direction. CAS failure here fails the redeem
      // closed before any money moves.
      saveAuthority(opts.dir, auth);
      const receipt = await executeAndReceipt(
        executor,
        {
          capabilityId: leafCidHex(challenge.cap),
          recipient,
          amount,
          currency,
          resource,
          purpose,
        },
        redeemed,
        now()
      );
      // Authority already persisted above: the entry stamps the post-save
      // revisions so a later file rollback fails the freshness check.
      audit.append({
        actor: agent,
        action: "redeem",
        ...(decision.allow && decision.citations[0]?.authorityId !== undefined
          ? { authorityId: decision.citations[0]?.authorityId as string }
          : {}),
        capabilityId: receipt.capabilityId,
        detail: receipt.transaction,
        authorityRev: auth.loadedRevision(),
        registryRev: reg.loadedRevision(),
      });
      proposal.status = "executed";
      proposal.receipt = JSON.parse(JSON.stringify(receipt)) as Record<
        string,
        unknown
      >;
      return {
        content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }],
      };
    }
  );

  // General agent contract (P0 slice 2). All five tools keep the
  // no-approve invariant: they dry-run `Authority.evaluate` + render and
  // never add grants/approvals, never consume uses, never revoke, and never
  // expose keys or SealedCapability envelopes.

  server.registerTool(
    "ptf_request_data",
    {
      description:
        "Propose a disclosure (dry-run). Evaluates /disclose authority without spending it and returns exact terms for human approval.",
      inputSchema: z.object({
        purpose: z.string().min(1),
        resource: z.string().min(1),
        verifier: z.string().min(1),
        claims: z.array(z.string().min(1)).min(1),
      }),
    },
    async (args) => {
      const { auth } = load();
      pruneProposals();
      let out: ReturnType<typeof requestData>;
      try {
        out = requestData(
          auth,
          ingress,
          {
            purpose: args.purpose,
            resourceId: args.resource,
            claims: args.claims,
            verifier: args.verifier,
          },
          { nowSec: now() }
        );
      } catch (err) {
        throw new Error(
          `request_data rejected: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (out.decision.allow) {
        recordProposal(out.digest, out.demand, true);
      } else {
        recordProposal(out.digest, out.demand, false);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              out.decision.allow
                ? {
                    allowed: true,
                    termsDigest: out.digest,
                    proposal: out.proposal,
                  }
                : {
                    allowed: false,
                    reason: out.decision.reason,
                    proposal: out.proposal,
                  },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "ptf_request_action",
    {
      description:
        "Propose any /-path action (dry-run, disclose tier excluded). Redeem stays /pay-only via ptf_redeem.",
      inputSchema: z.object({
        cmd: z.string().min(2).regex(/^\//),
        purpose: z.string().min(1).optional(),
        resource: z.string().min(1),
        resourceType: z.string().min(1).optional(),
        context: z.record(z.string(), z.unknown()).optional(),
        recipient: z.string().min(1).optional(),
        amount: z.number().int().positive().optional(),
        currency: z.string().min(1).optional(),
        claims: z.array(z.string().min(1)).optional(),
      }),
    },
    async (args) => {
      const { auth } = load();
      pruneProposals();
      // Caller-supplied context passes through untouched; the top-level
      // convenience fields below only fill ABSENT keys so explicit caller
      // handles are never clobbered.
      const context: Record<string, unknown> = { ...(args.context ?? {}) };
      if (args.recipient !== undefined && context["recipient"] === undefined) {
        context["recipient"] = args.recipient;
      }
      if (args.amount !== undefined && context["amount"] === undefined) {
        context["amount"] = args.amount;
      }
      if (args.currency !== undefined && context["currency"] === undefined) {
        context["currency"] = args.currency;
      }
      if (args.claims !== undefined && context["claims"] === undefined) {
        context["claims"] = [...args.claims];
      }
      let out: ReturnType<typeof requestExecution>;
      try {
        out = requestExecution(
          auth,
          ingress,
          {
            action: args.cmd as `/${string}`,
            ...(args.purpose !== undefined ? { purpose: args.purpose } : {}),
            resourceType: args.resourceType ?? "ptf-resource",
            resourceId: args.resource,
            context,
          },
          { nowSec: now() }
        );
      } catch (err) {
        throw new Error(
          `request_action rejected: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      if (out.decision.allow) {
        recordProposal(out.digest, out.demand, true);
      } else {
        recordProposal(out.digest, out.demand, false);
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              out.decision.allow
                ? {
                    allowed: true,
                    termsDigest: out.digest,
                    proposal: out.proposal,
                  }
                : {
                    allowed: false,
                    reason: out.decision.reason,
                    proposal: out.proposal,
                  },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "ptf_get_receipt",
    {
      description:
        "Look up a proposal/receipt by terms digest. In-memory only: unknown after restart (ADR-0014).",
      inputSchema: z.object({ termsDigest: z.string().min(16) }),
    },
    async (args) => {
      pruneProposals();
      const found = proposals.get(args.termsDigest);
      if (found === undefined || now() > found.until) {
        if (found !== undefined) proposals.delete(args.termsDigest);
        return {
          content: [
            { type: "text", text: JSON.stringify({ status: "unknown" }) },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              found.status === "executed"
                ? { status: found.status, receipt: found.receipt }
                : { status: found.status },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "ptf_list_capabilities",
    {
      description:
        "List grant projections visible to this fixed agent identity (read-only, no keys or capability envelopes). Grants for other principals, other agents, or revoked grants are excluded.",
      inputSchema: z.object({}),
    },
    async () => {
      const { auth } = load();
      const snap = auth.snapshot();
      const revokedIds = new Set(snap.revoked.map(([id]) => id));
      const grants = snap.grants
        .filter((g) =>
          grantVisible(g, g.id, ingress, (id) => revokedIds.has(id))
        )
        .map((g) => ({
          id: g.id,
          principal: g.principal,
          actor: g.actor,
          action: g.action.name,
          ...(g.purpose !== undefined ? { purpose: g.purpose } : {}),
          ...(g.resource !== undefined ? { resource: g.resource } : {}),
          bounds: g.bounds.length,
        }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ capabilities: grants }, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "ptf_revoke",
    {
      description:
        "Request revocation for human approval (never revokes directly from agent ingress).",
      inputSchema: z.object({
        id: z.string().min(1),
        reason: z.string().min(1).optional(),
      }),
    },
    async (args) => {
      const { auth } = load();
      const exists = auth.snapshot().grants.some((g) => g.id === args.id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                requested: true,
                id: args.id,
                knownGrant: exists,
                next: `human must run: ptf revoke --grant ${args.id}`,
                note: "agent revoke is request-only; no authority mutated",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

async function main(): Promise<void> {
  const dir = process.env["PTF_STORE_DIR"] ?? "./ptf-store";
  const env: Record<string, string | undefined> = { ...process.env };
  const principal = env["PTF_MCP_PRINCIPAL"] ?? "";
  const actor = env["PTF_MCP_ACTOR"] ?? "";
  if (principal.length === 0 || actor.length === 0) {
    throw new Error(
      "mcp-server: PTF_MCP_PRINCIPAL and PTF_MCP_ACTOR are required (fixed server identity)"
    );
  }
  const server = createPtfServer({ dir, env, principal, actor });
  await server.connect(new StdioServerTransport());
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
