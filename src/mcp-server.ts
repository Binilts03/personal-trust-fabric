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
  renderProposal,
  saveAuthority,
  signBytes,
  digestForOperation,
} from "./index.js";
import { readFileSync } from "node:fs";
import type {
  AuthorityOperation,
  AuthorityRequest,
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
 * CONCURRENCY + DURABILITY CEILING (single writer): proposals + pending
 * challenges live in memory with TTLs and are lost on restart (fail-closed:
 * check → unknown, redeem → propose again). Authority/registry/audit are
 * reloaded per call and saved on success; concurrent redeems can lost-update
 * (last write wins). Run one server per store, or add external locking.
 * Receipts survive restarts in audit.jsonl; proposal status does not.
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

export function createPtfServer(opts: PtfServerOptions): McpServer {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  if (opts.principal.length === 0) fail("server principal is required");
  if (opts.actor.length === 0) fail("server actor is required");
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
    const pass = opts.env["PTF_PASSPHRASE"] ?? "";
    const kp = join(opts.dir, "keystore.json");
    if (existsSync(kp) && pass.length === 0) {
      fail("PTF_PASSPHRASE required (keystore present)");
    }
    let keys: Record<string, Uint8Array> = {};
    if (existsSync(kp)) {
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
        proposals.set(digest, {
          demand,
          status: "pending",
          until: now() + 600,
        });
      } else {
        proposals.set(digest, { demand, status: "denied", until: now() + 600 });
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
        "Redeem a pending proposal. Without a proof this checks live authority (dry-run) and returns its id to sign (challenge); with a recipient proof it authorizes the capability first, then spends live authority, executes, and returns a receipt. Payment demands only. Fails closed on anything stale.",
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
        resolveKey: (id: string) => reg.resolve(id),
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
      const receipt = await executeAndReceipt(
        new FakePaymentExecutor(),
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
      // Persist authority BEFORE audit: a crash between must not replay.
      // (Authority consumed + no receipt is safe; receipt + unconsumed is not.)
      saveAuthority(opts.dir, auth);
      audit.append({
        actor: agent,
        action: "redeem",
        ...(decision.allow && decision.citations[0]?.authorityId !== undefined
          ? { authorityId: decision.citations[0]?.authorityId as string }
          : {}),
        capabilityId: receipt.capabilityId,
        detail: receipt.transaction,
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
