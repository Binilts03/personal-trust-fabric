import type { AuthorityDemand, Citation } from "./authority.js";

/**
 * Approval presenter — the human-readable side of digest-bound approval.
 * Pure string in/out: rendering the exact binding terms plus citations, and
 * parsing an explicit decision. Prompting and I/O stay with the host.
 * Free-text fields are sanitized so a malicious mandate cannot restyle the
 * terminal into faking an approval (ANSI/control stripping).
 */

export interface ProposalView {
  readonly demand: AuthorityDemand;
  readonly citations: readonly Citation[];
  readonly expiresAt?: number;
  readonly maxUses?: number;
}

/** Strip ANSI escape sequences and control characters (keeps newline/tab). */
export function sanitizeField(value: string): string {
  return value
    .replace(/\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[^\x09\x0a\x20-\x7e]/g, "");
}

function line(label: string, value: string): string {
  return `${label}: ${sanitizeField(value)}`;
}

export function renderProposal(view: ProposalView): string {
  const d = view.demand;
  const rows = [
    "PTF approval requested — review every line. Any change needs a new approval.",
    line("Action", d.cmd),
    ...(d.amount !== undefined
      ? [line("Amount", `${d.amount} ${d.currency ?? ""}`.trim())]
      : []),
    line("Recipient", d.recipient),
    line("Purpose", d.purpose),
    line("Resource", d.resource),
    line("Agent", d.agent),
    line("Principal", d.principal),
    ...(view.expiresAt !== undefined
      ? [line("Expires", new Date(view.expiresAt * 1000).toISOString())]
      : ["Expires: (no expiry shown — confirm before approving)"]),
    ...(view.maxUses !== undefined ? [line("Uses", String(view.maxUses))] : []),
    line("Terms digest", d.termsDigest),
  ];
  if (view.citations.length > 0) {
    rows.push("Authority cited:");
    for (const c of view.citations) {
      const policies =
        c.policyIds.length > 0
          ? ` (policies: ${c.policyIds.map(sanitizeField).join(", ")})`
          : "";
      rows.push(`  - ${c.kind} ${sanitizeField(c.authorityId)}${policies}`);
    }
  } else {
    rows.push("Authority cited: (none yet — approval will mint it)");
  }
  return rows.join("\n");
}

const APPROVE = new Set(["y", "yes", "approve", "approved", "ok", "confirm"]);
const DENY = new Set(["n", "no", "deny", "denied", "cancel", "reject"]);

/** Strict decision parser. Anything outside the two vocabularies throws — no guessing. */
export function parseDecision(input: string): "approve" | "deny" {
  const word = input.trim().toLowerCase();
  if (APPROVE.has(word)) return "approve";
  if (DENY.has(word)) return "deny";
  throw new Error("approve: unrecognized decision (expected yes/no)");
}
