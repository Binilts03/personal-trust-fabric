#!/usr/bin/env node
import { existsSync, readdirSync, unlinkSync } from "node:fs";
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
  canonicalize,
  executeWithJournal,
  executorAsProvider,
  issueAgentChallenge,
  leafCidHex,
  loadAgents,
  loadAuthority,
  loadRegistry,
  loadVault,
  openKeystore,
  privateKeyFromPkcs8,
  publicKeyFromPrivate,
  rawPublicKey,
  readForPurpose,
  readPassphrase,
  renderProposal,
  saveAuthority,
  digestForOperation,
  verifyAgentChallengeSignature,
  type AgentChallenge,
} from "./index.js";
import { readFileSync } from "node:fs";
import { requestData, requestExecution } from "./profiles/data.js";
import {
  createProposal,
  gcChallenges,
  loadProposal,
  transitionProposal,
} from "./store/challenges.js";
import { FileReplay } from "./store/repositories.js";
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
 * call here already reloads).
 *
 * DURABILITY (ADR-0017): proposals persist as one file per termsDigest
 * under <storeDir>/proposals (O_EXCL create, CAS transitions, TTL GC) and
 * survive restarts; the digest is the idempotency key (re-proposing live
 * terms returns the stored record; executed is immutable). Pending
 * recipient challenges stay in memory with short TTLs and are lost on
 * restart (fail-closed: redeem phase 1 again) — challenges carry live
 * capabilities that must never touch disk. Receipts additionally survive
 * in audit.jsonl.
 *
 * IDENTITY (ADR-0013, ADR-0023): fixed mode speaks for ONE identity —
 * principal + actor pinned at instantiation (`PtfServerOptions`, from
 * `PTF_MCP_PRINCIPAL` / `PTF_MCP_ACTOR` in `main`) and bound as the verified
 * ingress for every evaluation. Tool inputs carry NO identity fields: a
 * caller choosing its own principal/agent would be self-certification.
 * The stdio transport is local-only, so the fixed ingress is
 * `source: "local-registration"` with `proofRef "stdio:<storeDir>"`.
 * REMOTE / MULTI-TENANT hosts must NOT reuse this binding: derive a
 * per-caller ingress from a verified token (OAuth/DPoP/mTLS) and pass it to
 * `Authority.evaluate` — that mapping is host duty, not this file's.
 *
 * REGISTRY MODE (ADR-0023): when `agents.json` exists in the store, every
 * evaluation binds a registry member instead. A launcher-asserted
 * `PTF_MCP_ACTOR` must be registered + active (rechecked from disk per
 * tool call, so removal takes effect immediately); without it, the
 * session starts unauthenticated and `ptf_authenticate` (challenge →
 * registry-key signature → bound session) is required before any other
 * tool. Session challenges are in-memory, single-use, short-TTL —
 * live material that must never touch disk (same rule as ADR-0017).
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
 * Grant visibility for one verified ingress: the principal must match and the
 * actor selector must cover the agent. The explicit `{ kind: "any" }`
 * wildcard is audit-visible by design, so it stays listed. Revoked,
 * not-yet-valid, expired, and uses-exhausted grants are excluded — listing
 * them would advertise dead authority as live.
 */
function grantVisible(
  g: {
    readonly principal: string;
    readonly actor: ActorSelector;
    readonly nbf?: number;
    readonly exp?: number;
    readonly maxUses?: number;
  },
  id: string,
  ingress: VerifiedIdentity,
  revoked: (revokedId: string) => boolean,
  nowSec: number,
  usedCount: number
): boolean {
  if (g.principal !== ingress.principal) return false;
  if (revoked(id)) return false;
  if (g.nbf !== undefined && nowSec < g.nbf) return false;
  if (g.exp !== undefined && nowSec > g.exp) return false;
  if (g.maxUses !== undefined && usedCount >= g.maxUses) return false;
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
  if (opts.actor.length === 0 && !existsSync(join(opts.dir, "agents.json"))) {
    fail(
      "server actor is required unless agents.json exists (registry session mode)"
    );
  }
  const executor = opts.executor ?? new FakePaymentExecutor();
  // Fixed verified ingress: stdio is local-only (see module header).
  // In registry mode this is only the launcher-asserted fallback — every
  // evaluation re-resolves through resolveIngress() below.
  const fixedIngress: VerifiedIdentity = {
    id: opts.actor,
    principal: opts.principal,
    source: "local-registration",
    proofRef: `stdio:${opts.dir}`,
  };

  // Session authentication (ADR-0023 registry mode): at most one bound
  // agent per stdio process, plus single-use auth challenges. The mode is
  // captured at startup: a fixed-mode server never consults the registry
  // (registry created later activates on restart), and a registry-mode
  // server fails closed if the registry disappears (no silent downgrade).
  const registryMode = existsSync(join(opts.dir, "agents.json"));
  let sessionAgent: string | null = null;
  let sessionKeyHex: string | null = null;
  const authChallenges = new Map<
    string,
    { challenge: AgentChallenge; until: number }
  >();
  const pruneAuthChallenges = (): void => {
    for (const [id, c] of authChallenges) {
      if (now() > c.until) authChallenges.delete(id);
    }
  };

  /**
   * Verified ingress for this tool call — never from request JSON.
   * Registry mode (agents.json present): session-bound agent if
   * authenticated (rechecked active every call), else the
   * launcher-asserted env actor if registered + active; otherwise fail
   * closed. Fixed mode: the pinned env identity, unchanged.
   */
  const resolveIngress = (): VerifiedIdentity => {
    if (!registryMode) {
      if (opts.actor.length === 0) fail("server actor is required");
      return fixedIngress;
    }
    if (!existsSync(join(opts.dir, "agents.json"))) {
      fail(
        "agent registry missing: restart the server after registering agents"
      );
    }
    const agents = loadAgents(opts.dir);
    if (sessionAgent !== null) {
      const live = agents.get(sessionAgent);
      if (
        live === null ||
        live.status !== "active" ||
        live.publicKeyHex === undefined ||
        live.publicKeyHex !== sessionKeyHex
      ) {
        // Removed, rotated, or tampered binding: drop the session and
        // fail. Never fall back to another identity for this session.
        sessionAgent = null;
        sessionKeyHex = null;
        fail("agent session invalid: authenticate again");
      }
      return {
        id: sessionAgent,
        principal: opts.principal,
        source: "local-registration",
        proofRef: `stdio:${opts.dir}#${sessionAgent}`,
      };
    }
    if (opts.actor.length > 0) {
      if (!agents.isActive(opts.actor)) {
        fail("agent not registered or removed");
      }
      return fixedIngress;
    }
    fail("authentication required: call ptf_authenticate first");
  };

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

  // Durable proposals (ADR-0017): one file per termsDigest under
  // <storeDir>/proposals via store/challenges.ts (O_EXCL create, TTL GC).
  // Transitions are last-writer-wins under the single-writer topology — the
  // spend backstop is the authority revision CAS + single-use capabilities,
  // not the proposal file. The digest is the idempotency key: re-proposing
  // live terms returns the stored record instead of minting a duplicate.
  // Rules: executed is immutable history (idempotent reread); pending stays
  // in flight while live; denied re-opens to pending when live authority now
  // allows. Pending recipient challenges stay in-memory with short TTLs and
  // are lost on restart (fail-closed: redeem phase 1 again) — challenges
  // carry live capabilities that must never touch disk.
  type StoredProposal = {
    readonly demand: Proposal["demand"];
    readonly status: "pending" | "denied" | "executed";
    readonly receipt?: Record<string, unknown>;
    readonly until: number;
  };

  const PROPOSAL_TTL_SEC = 600;
  const PROPOSAL_DENY_TTL_SEC = 120;
  /** Anti-fill bound: distinct-digest proposes inside the TTL window. */
  const PROPOSAL_FILE_CAP = 1000;

  /** Digest-gated proposal path (same allowlist as challenges.pathOf). */
  const proposalFile = (digest: string): string => {
    if (!/^[0-9a-f]{16,128}$/.test(digest)) fail("malformed termsDigest");
    return join(opts.dir, "proposals", `${digest}.json`);
  };

  /** TTL hygiene on reads: expired records vanish even without new proposes. */
  const gcProposals = (): void => {
    try {
      gcChallenges(opts.dir, now());
    } catch {
      // Hygiene only — failures surface at use time, never here.
    }
  };

  const countProposals = (): number => {
    try {
      return readdirSync(join(opts.dir, "proposals")).filter((n) =>
        n.endsWith(".json")
      ).length;
    } catch {
      return 0;
    }
  };

  const readStored = (digest: string): StoredProposal | null => {
    gcProposals();
    let rec: {
      readonly demand: unknown;
      readonly state: string;
      readonly receipt?: unknown;
      readonly updatedAt: number;
      readonly ttlSec: number;
    };
    try {
      rec = loadProposal(opts.dir, digest, now());
    } catch {
      return null; // unknown, expired, or unreadable → absent (propose again)
    }
    return {
      demand: rec.demand as Proposal["demand"],
      status: rec.state as StoredProposal["status"],
      ...(rec.receipt !== undefined &&
      typeof rec.receipt === "object" &&
      rec.receipt !== null
        ? { receipt: rec.receipt as Record<string, unknown> }
        : {}),
      until: rec.updatedAt + rec.ttlSec,
    };
  };

  /** Like readStored but distinguishes expired/corrupt from unknown. */
  const requireStored = (digest: string): StoredProposal => {
    try {
      loadProposal(opts.dir, digest, now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/malformed digest/.test(msg)) fail("malformed termsDigest");
      if (/expired/.test(msg)) fail("proposal expired: propose again");
      // Missing file → unknown. Present-but-unreadable → corrupt: fail
      // closed instead of silently treating tamper as absent.
      if (existsSync(proposalFile(digest))) {
        fail(`proposal store corrupt: ${digest}`);
      }
      fail("unknown proposal: propose first");
    }
    const found = readStored(digest);
    if (found === null) fail("unknown proposal: propose first");
    return found;
  };

  /** Best-effort mark-denied: leaves terminal/expired records untouched. */
  const markDenied = (digest: string): void => {
    try {
      transitionProposal(opts.dir, digest, "denied", undefined, now());
    } catch {
      // Already terminal, expired, or unreadable — leave it.
    }
  };

  const recordProposal = (
    digest: string,
    demand: Proposal["demand"],
    allow: boolean
  ): StoredProposal => {
    let demandJson: unknown;
    try {
      demandJson = JSON.parse(JSON.stringify(demand)) as unknown;
    } catch {
      fail("proposal demand not persistable: propose again");
    }
    // The engine already canonicalized these terms when deriving the digest;
    // the persisted copy must carry identical meaning (JSON mangles what
    // canonicalize rejects — Map/Set/BigInt/undefined can never reach here,
    // but verify rather than assume).
    if (canonicalize(demandJson) !== canonicalize(demand)) {
      fail("proposal demand not persistable: propose again");
    }
    gcProposals();
    const existing = readStored(digest);
    if (existing !== null && existing.status === "executed") {
      return existing; // immutable history → idempotent reread
    }
    if (existing !== null && existing.status === "pending") {
      if (allow) return existing; // still in flight
      markDenied(digest);
      const denied = readStored(digest);
      if (denied === null) fail("proposal expired: propose again");
      return denied;
    }
    if (existing !== null && existing.status === "denied" && allow) {
      // Authority changed since the denial: reopen as a fresh proposal.
      // ENOENT means a concurrent reopen won — fall through and return the
      // winner's record instead of erroring spuriously.
      try {
        unlinkSync(proposalFile(digest));
      } catch {
        // Concurrent reopen won (or FS error, which createProposal surfaces).
      }
    }
    if (existing !== null && existing.status === "denied" && !allow) {
      return existing;
    }
    if (countProposals() >= PROPOSAL_FILE_CAP) {
      gcProposals();
      if (countProposals() >= PROPOSAL_FILE_CAP) {
        fail("proposal store full: wait for TTL expiry and propose again");
      }
    }
    createProposal(
      opts.dir,
      digest,
      demandJson,
      allow ? PROPOSAL_TTL_SEC : PROPOSAL_DENY_TTL_SEC,
      now()
    );
    if (!allow) markDenied(digest);
    const stored = readStored(digest);
    if (stored === null) fail("proposal expired: propose again");
    if (allow && stored.status !== "pending" && stored.status !== "executed") {
      fail("proposal store conflict: propose again");
    }
    return stored;
  };

  server.registerTool(
    "ptf_authenticate",
    {
      description:
        "Authenticate this session as a registered agent (registry mode only). Call with no arguments for a challenge; then call again with agentId, challengeId, and the registry-key signature over the challenge. Binds the session — consumes no authority.",
      inputSchema: z.object({
        agentId: z.string().min(1).max(256).optional(),
        challengeId: z.string().min(1).max(128).optional(),
        sigHex: z.string().min(1).max(512).optional(),
      }),
    },
    async (args) => {
      pruneAuthChallenges();
      if (
        args.agentId === undefined &&
        args.challengeId === undefined &&
        args.sigHex === undefined
      ) {
        if (!registryMode || !existsSync(join(opts.dir, "agents.json"))) {
          fail(
            "agent registry missing: fixed-identity server needs no authentication"
          );
        }
        if (authChallenges.size >= 128) {
          fail("authentication busy: try again");
        }
        const challenge = issueAgentChallenge(now());
        authChallenges.set(challenge.challengeId, {
          challenge,
          until: challenge.expiresAt,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  challengeId: challenge.challengeId,
                  nonceHex: challenge.nonceHex,
                  expiresAt: challenge.expiresAt,
                },
                null,
                2
              ),
            },
          ],
        };
      }
      if (
        args.agentId === undefined ||
        args.challengeId === undefined ||
        args.sigHex === undefined
      ) {
        fail(
          "authenticate with agentId, challengeId and sigHex together, or with nothing"
        );
      }
      const pending = authChallenges.get(args.challengeId as string);
      authChallenges.delete(args.challengeId as string);
      // Single fixed failure: unknown/expired challenges, unknown agents,
      // missing keys, and bad signatures are indistinguishable (no oracle).
      let bound: string | null = null;
      if (pending !== undefined && now() <= pending.until && registryMode) {
        try {
          const agents = loadAgents(opts.dir);
          const key = agents.publicKeyRaw(args.agentId as string);
          if (
            key !== null &&
            verifyAgentChallengeSignature({
              challenge: pending.challenge,
              agentId: args.agentId as string,
              publicKeyRaw: key,
              sigHex: args.sigHex as string,
              nowSec: now(),
            })
          ) {
            bound = args.agentId as string;
            sessionKeyHex = Buffer.from(key).toString("hex");
          }
        } catch {
          bound = null;
        }
      }
      if (bound === null) {
        fail("authentication failed");
      }
      sessionAgent = bound;
      const { audit } = load();
      audit.append({ actor: sessionAgent as string, action: "authenticate" });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { authenticated: true, agent: sessionAgent },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "ptf_propose",
    {
      description:
        "Propose a bounded payment or disclosure. Evaluates authority without spending it and returns the exact terms for human approval.",
      inputSchema: demandSchema,
    },
    async (args) => {
      const { auth } = load();
      const ingress = resolveIngress();
      prunePending();
      // Binding is derived server-side from the normalized operation +
      // the verified ingress: untrusted callers supply neither
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
      const found = readStored(args.termsDigest);
      if (found === null) {
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
        "Redeem a pending proposal. Without a proof this checks live authority (dry-run) and returns its id to sign (challenge); with a recipient proof it authorizes the capability first, then spends live authority, executes, and returns a receipt. Payment demands only. Accepts any /pay proposal in the shared store regardless of which propose tool created it; re-redeeming executed terms returns the stored receipt without re-executing. Fails closed on anything stale.",
      inputSchema: z.object({
        termsDigest: z.string().min(16),
        recipientKeyHex: z.string().min(64).optional(),
        recipientSigHex: z.string().min(128).optional(),
      }),
    },
    async (args) => {
      prunePending();
      const proposal = requireStored(args.termsDigest);
      if (proposal.status === "executed") {
        // Idempotent re-redeem: the same terms already executed — return the
        // stored receipt instead of moving anything twice.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(proposal.receipt ?? {}, null, 2),
            },
          ],
        };
      }
      if (proposal.status === "denied") {
        fail("proposal denied: propose again");
      }
      const { auth, reg, audit, keys } = load();
      const ingress = resolveIngress();
      const demand = { ...proposal.demand, termsDigest: args.termsDigest };
      // Identity re-assert (ADR-0023): the stored demand must belong to
      // this verified ingress — no cross-agent redemption, and the audit
      // trail attributes the actor that was actually evaluated.
      if (
        demand.principal !== ingress.principal ||
        demand.actor !== ingress.id
      ) {
        fail("proposal identity mismatch: propose again");
      }
      // Re-evaluate under the verified ingress: strip the stored bound form
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
      // Tamper re-derivation (ADR-0018, same as present): the file must
      // still describe the exact terms its key claims. Recomputed over the
      // stored bound form verbatim, exactly as propose stored it.
      const { termsDigest: _fileDigest, ...fileBound } = demand;
      void _fileDigest;
      if (digestForOperation(fileBound) !== args.termsDigest) {
        fail("proposal terms changed: propose again");
      }
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
          markDenied(args.termsDigest);
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
        markDenied(args.termsDigest);
        fail("recipient proof must be hex");
      }
      if (proofKey.length !== 32) fail("recipient key must be 32 bytes");
      if (proofSig.length !== 64) fail("recipient signature must be 64 bytes");
      // Authorize the capability FIRST so a bad proof never burns authority.
      const redeemed = caps.redeem(
        [challenge.cap],
        {
          cmd: demand.action.name,
          args: { amount, currency },
          recipient,
          resource,
          purpose,
          termsDigest: args.termsDigest,
        },
        {
          proof: {
            key: proofKey,
            sig: proofSig,
          },
        }
      );
      if (!redeemed.ok) {
        markDenied(args.termsDigest);
        fail(`redeem failed: ${redeemed.reason}`);
      }
      // Only now spend standing authority.
      const decision = auth.evaluate(op, ingress, {
        consume: true,
        nowSec: now(),
      });
      if (!decision.allow) {
        markDenied(args.termsDigest);
        fail(`authority denied at redeem time: ${decision.reason}`);
      }
      // Persist the consumption BEFORE executing (ticket 05): a crash or a
      // failing rail between persist and execute can only burn a use, never
      // double-spend — the safe direction. CAS failure here fails the redeem
      // closed before any money moves.
      saveAuthority(opts.dir, auth);
      // Journaled execution (ADR-0021): the execution record persists under
      // a proposal-anchored idempotency key before the provider call, so a
      // crash between effect and receipt reconciles to the same receipt
      // instead of resubmitting. A reminted capability finds the SUCCEEDED
      // record and returns it without touching the provider.
      const journaled = await executeWithJournal({
        dir: opts.dir,
        provider: executorAsProvider(executor, "payment", now),
        req: {
          capabilityId: leafCidHex(challenge.cap),
          termsDigest: args.termsDigest,
          action: "/pay",
          recipient,
          resource,
          purpose,
          context: { amount, currency },
        },
        redemption: redeemed,
        nowSec: now(),
        at: now(),
      });
      // Project the /pay receipt shape from the journal receipt. Amount and
      // currency come from the exact authorized terms verified above
      // (authorizedTermsCover inside the journal) — never invented.
      const receipt = {
        receiptId: journaled.receiptId,
        capabilityId: journaled.capabilityId,
        recipient: journaled.recipient,
        amount,
        currency,
        resource: journaled.resource,
        purpose: journaled.purpose,
        transaction: journaled.transaction,
        at: journaled.at,
        termsDigest: journaled.termsDigest,
      };
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
      transitionProposal(
        opts.dir,
        args.termsDigest,
        "executed",
        JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>,
        now()
      );
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
        "Propose a disclosure (dry-run). Evaluates /disclose authority without spending it and returns exact terms for human approval. Present an allowed proposal via ptf_present_data.",
      inputSchema: z.object({
        purpose: z.string().min(1),
        resource: z.string().min(1),
        verifier: z.string().min(1),
        claims: z.array(z.string().min(1)).min(1),
      }),
    },
    async (args) => {
      const { auth } = load();
      const ingress = resolveIngress();
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
    "ptf_present_data",
    {
      description:
        "Present a pending /disclose proposal as a holder-signed presentation (read-only: a read, no uses consumed). Fails closed unless the proposal is pending and unexpired. Nonce-uniqueness + freshness enforcement is verifier duty (Disclose.verify maxAgeSec default 300). /disclose only; pay via ptf_redeem.",
      inputSchema: z.object({
        termsDigest: z.string().min(16),
        nonce: z.string().min(16),
      }),
    },
    async (args) => {
      if (
        typeof args.termsDigest !== "string" ||
        args.termsDigest.length < 16
      ) {
        fail("termsDigest must be at least 16 chars");
      }
      if (typeof args.nonce !== "string" || args.nonce.length < 16) {
        fail("nonce must be at least 16 chars");
      }
      const proposal = requireStored(args.termsDigest);
      if (proposal.status !== "pending") {
        fail("already presented/denied: propose again for a fresh nonce");
      }
      if (proposal.demand.action.name !== "/disclose") {
        fail("present supports /disclose proposals only; pay via ptf_redeem");
      }
      const { auth, keys, audit } = load();
      const ingress = resolveIngress();
      const demand = { ...proposal.demand, termsDigest: args.termsDigest };
      // Defense in depth: proposals are bound at propose time to the
      // verified ingress, but re-assert before touching vault or keys.
      if (
        demand.principal !== ingress.principal ||
        demand.actor !== ingress.id
      ) {
        fail("proposal identity mismatch: propose again");
      }
      // Identical-operation binding (ADR-0018): re-derive the digest from
      // the stored demand — a tampered proposal file fails closed here,
      // and the vault below evaluates these exact terms (resource incl.).
      const { termsDigest: _fileDigest, ...bound } = demand;
      void _fileDigest;
      if (digestForOperation(bound) !== args.termsDigest) {
        fail("proposal terms changed: propose again");
      }
      // Durable presentation-nonce replay (G11): nonce uniqueness is
      // verifier duty, but a restarted host must not launder a replayed
      // nonce — the in-memory set dies with the process. Check-then-record
      // up front, before vault or keys (burn-before-deliver: a crash
      // between record and presentation burns the nonce, never grants a
      // second presentation — retry with a fresh nonce). Prune window
      // (600s) covers the verifier maxAge default (300s) with margin.
      FileReplay.prune(opts.dir, 600, now());
      if (FileReplay.has(opts.dir, args.nonce)) {
        fail("replay denied: presentation nonce already used");
      }
      FileReplay.add(opts.dir, args.nonce, now());
      const holderSeed = keys[demand.principal];
      if (holderSeed === undefined) {
        fail(`server holds no key for principal ${demand.principal}`);
      }
      const claimsRaw: unknown = demand.context["claims"];
      const verifierRaw: unknown = demand.context["verifier"];
      if (
        !Array.isArray(claimsRaw) ||
        claimsRaw.length === 0 ||
        !claimsRaw.every(
          (c): c is string => typeof c === "string" && c.length > 0
        )
      ) {
        fail("pending demand is malformed (claims/verifier required)");
      }
      if (typeof verifierRaw !== "string" || verifierRaw.length === 0) {
        fail("pending demand is malformed (claims/verifier required)");
      }
      if (typeof demand.purpose !== "string" || demand.purpose.length === 0) {
        fail("pending demand is malformed (purpose required)");
      }
      // Reload vault fresh, resolving the DEK by envelope kid (rotation
      // windows included). Legacy plaintext files surface their
      // migrate-first error as-is (never silently read).
      const vault = loadVault(opts.dir, {
        nowSec: now,
        keys,
      });
      const holderPriv = privateKeyFromPkcs8(holderSeed as Uint8Array);
      let pres: ReturnType<typeof readForPurpose>;
      try {
        pres = readForPurpose(vault, {
          ingress,
          purpose: demand.purpose as string,
          requested: claimsRaw as string[],
          verifier: verifierRaw as string,
          nonce: args.nonce,
          nowSec: now(),
          authority: auth,
          resource: {
            type: demand.resource.type,
            id: demand.resource.id,
          },
          holder: { id: demand.principal, privateKey: holderPriv },
          audit,
        });
      } catch (err) {
        markDenied(args.termsDigest);
        throw err instanceof Error ? err : new Error(String(err));
      }
      const disclosed = pres.disclosures.map((d) => d.name);
      // Persist the consumed use BEFORE delivering (burn-before-deliver:
      // a crash burns a use without a second presentation — the safe
      // direction; single-present is enforced by the executed transition).
      saveAuthority(opts.dir, auth);
      transitionProposal(
        opts.dir,
        args.termsDigest,
        "executed",
        { disclosed: [...disclosed] },
        now()
      );
      const presentation = {
        issuer: pres.issuer,
        subject: pres.subject,
        holder: pres.holder,
        verifier: pres.verifier,
        nonce: pres.nonce,
        iat: pres.iat,
        ...(pres.credExp !== undefined ? { credExp: pres.credExp } : {}),
        disclosures: pres.disclosures.map((d) => ({ ...d })),
        sigHex: Buffer.from(pres.sig).toString("hex"),
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                presented: true,
                // Display-layer framing guard: a disclosure is holder-signed
                // data delivery, not a payment authorization. Display this
                // notice wherever the presentation is shown.
                notice:
                  "read-only /disclose presentation, not a payment authorization: holder-signed data delivery only — no uses consumed, no funds moved",
                termsDigest: args.termsDigest,
                disclosed,
                presentation,
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
      const ingress = resolveIngress();
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
        "Look up a proposal/receipt by terms digest. Durable across restarts (ADR-0017); unknown when absent or expired.",
      inputSchema: z.object({ termsDigest: z.string().min(16) }),
    },
    async (args) => {
      const found = readStored(args.termsDigest);
      if (found === null) {
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
        "List grant projections visible to this verified agent identity (read-only, no keys or capability envelopes). Only live grants are shown: other principals, other agents, revoked, not-yet-valid, expired, and uses-exhausted grants are excluded.",
      inputSchema: z.object({}),
    },
    async () => {
      const { auth } = load();
      const ingress = resolveIngress();
      const snap = auth.snapshot();
      const revokedIds = new Set(snap.revoked.map(([id]) => id));
      const usedCounts = new Map(snap.used);
      const grants = snap.grants
        .filter((g) =>
          grantVisible(
            g,
            g.id,
            ingress,
            (id) => revokedIds.has(id),
            now(),
            usedCounts.get(g.id) ?? 0
          )
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
  if (principal.length === 0) {
    throw new Error("mcp-server: PTF_MCP_PRINCIPAL is required");
  }
  if (actor.length === 0 && !existsSync(join(dir, "agents.json"))) {
    throw new Error(
      "mcp-server: PTF_MCP_ACTOR is required unless agents.json exists (registry session mode)"
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
