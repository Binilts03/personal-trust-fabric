import { randomHex, verifyBytes } from "./crypto.js";

/**
 * Agent session authentication material (ADR-0023, roadmap G5).
 *
 * Pure challenge/response over Ed25519 (node:crypto only, like the rest of
 * core): the server issues a short-lived, single-use challenge; the agent
 * proves possession of its registry key by signing domain-separated
 * challenge bytes. Verification binds agent id + challenge id + expiry,
 * so signatures cannot replay across sessions or protocols.
 *
 * Identity itself comes from the operator-managed registry
 * (`src/store/agents.ts`); this module only proves key possession.
 * Keyless agents (plain LLM clients) authenticate via launcher assertion +
 * registry membership instead — see the MCP server ingress.
 */

export const AGENT_AUTH_DOMAIN = "ptf-agent-auth/v1";
export const AGENT_CHALLENGE_TTL_SEC = 120;

export interface AgentChallenge {
  readonly challengeId: string;
  readonly nonceHex: string;
  readonly expiresAt: number;
}

/** Issue a fresh challenge. Nonce + id are CSPRNG; TTL is fixed. */
export function issueAgentChallenge(
  nowSec: number = Math.floor(Date.now() / 1000)
): AgentChallenge {
  if (!Number.isInteger(nowSec) || nowSec <= 0) {
    throw new Error("agent: nowSec must be a positive integer");
  }
  return {
    challengeId: `ach-${randomHex(8)}`,
    nonceHex: randomHex(16),
    expiresAt: nowSec + AGENT_CHALLENGE_TTL_SEC,
  };
}

/** Exact bytes the agent signs: domain ‖ claimant ‖ challenge id ‖ nonce ‖ expiry. */
export function agentChallengeMessage(
  challenge: AgentChallenge,
  agentId: string
): Uint8Array {
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new Error("agent: agentId required");
  }
  const text = `${AGENT_AUTH_DOMAIN}\n${agentId}\n${challenge.challengeId}\n${challenge.nonceHex}\n${challenge.expiresAt}`;
  return new Uint8Array(Buffer.from(text, "utf8"));
}

/**
 * Verify a session proof. Fails closed (false, never throws) on expiry,
 * malformed keys/signatures, or bad bytes — callers map false to
 * "authentication failed" without distinguishing reasons. Binding the
 * claimant id into the signed bytes stops a stolen (challenge, signature)
 * pair from authenticating a different agent id.
 */
export function verifyAgentChallengeSignature(args: {
  readonly challenge: AgentChallenge;
  readonly agentId: string;
  readonly publicKeyRaw: Uint8Array;
  readonly sigHex: string;
  readonly nowSec?: number;
}): boolean {
  const now = args.nowSec ?? Math.floor(Date.now() / 1000);
  if (now > args.challenge.expiresAt) return false;
  if (
    typeof args.agentId !== "string" ||
    args.agentId.length === 0 ||
    typeof args.challenge.challengeId !== "string" ||
    args.challenge.challengeId.length === 0 ||
    typeof args.challenge.nonceHex !== "string" ||
    args.challenge.nonceHex.length === 0
  ) {
    return false;
  }
  if (
    !(args.publicKeyRaw instanceof Uint8Array) ||
    args.publicKeyRaw.length !== 32
  ) {
    return false;
  }
  let sig: Uint8Array;
  try {
    sig = new Uint8Array(Buffer.from(args.sigHex, "hex"));
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  let message: Uint8Array;
  try {
    message = agentChallengeMessage(args.challenge, args.agentId);
  } catch {
    return false;
  }
  return verifyBytes(args.publicKeyRaw, message, sig);
}
