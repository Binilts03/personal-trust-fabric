import type { AuthorityRequest, Citation } from "./authority.js";

/**
 * Approval presenter — the human-readable side of digest-bound approval.
 * Pure string in/out: rendering the exact binding terms plus citations, and
 * parsing an explicit decision. Prompting and I/O stay with the host.
 * Free-text fields are sanitized so a malicious mandate cannot restyle the
 * terminal into faking an approval (ANSI/control stripping).
 *
 * The demand is domain-neutral (ADR-0010): identity lines first, then the
 * familiar payment/disclosure conveniences (Amount, Recipient, Claims,
 * Verifier) when the operation context carries them, then every remaining
 * context entry plus action/resource property bags verbatim — everything the
 * derived digest binds must be reviewable on screen.
 */

export interface ProposalView {
  readonly demand: AuthorityRequest;
  readonly citations: readonly Citation[];
  readonly expiresAt?: number;
  readonly maxUses?: number;
}

/**
 * Strip terminal control sequences and C0/C1 control characters.
 * Printable Unicode (including non-English names) is preserved: only bytes
 * that can restyle a terminal or smuggle control semantics are removed.
 */
export function sanitizeField(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

function line(label: string, value: string): string {
  return `${label}: ${sanitizeField(value)}`;
}

function fmtValue(value: unknown): string {
  try {
    const rendered = JSON.stringify(value);
    return typeof rendered === "string" ? rendered : "(unrenderable)";
  } catch {
    return "(unrenderable)";
  }
}

/**
 * Render one property bag (`Action <k>` / `Resource <k>` lines). Binding
 * data must be visible: the digest covers these bags, so the human must see
 * them. Empty bags render nothing.
 */
function bagLines(
  prefix: string,
  bag: Record<string, unknown> | undefined
): string[] {
  if (bag === undefined) return [];
  return Object.keys(bag)
    .sort()
    .map((key) => line(`${prefix} ${key}`, fmtValue(bag[key])));
}

/**
 * Render the operation context. Amount/currency/recipient/claims/verifier
 * keep their familiar first-class lines when present; every other key
 * renders as a `Context <key>` line so nothing digest-bound hides.
 */
function contextLines(context: Record<string, unknown>): string[] {
  const out: string[] = [];
  const amount: unknown = context["amount"];
  const currency: unknown = context["currency"];
  if (amount !== undefined) {
    const unit =
      typeof currency === "string" && currency.length > 0
        ? ` ${sanitizeField(currency)}`
        : "";
    out.push(line("Amount", `${fmtValue(amount)}${unit}`.trim()));
  } else if (currency !== undefined) {
    out.push(line("Currency", fmtValue(currency)));
  }
  const recipient: unknown = context["recipient"];
  if (typeof recipient === "string" && recipient.length > 0) {
    out.push(line("Recipient", recipient));
  }
  const claims: unknown = context["claims"];
  if (Array.isArray(claims) && claims.length > 0) {
    out.push(
      line(
        "Claims",
        (claims as unknown[])
          .map((c) => sanitizeField(typeof c === "string" ? c : fmtValue(c)))
          .join(", ")
      )
    );
  }
  const verifier: unknown = context["verifier"];
  if (typeof verifier === "string" && verifier.length > 0) {
    out.push(line("Verifier", verifier));
  }
  for (const key of Object.keys(context).sort()) {
    if (
      key === "amount" ||
      key === "currency" ||
      key === "recipient" ||
      key === "claims" ||
      key === "verifier"
    ) {
      continue;
    }
    out.push(line(`Context ${key}`, fmtValue(context[key])));
  }
  return out;
}

export function renderProposal(view: ProposalView): string {
  const d = view.demand;
  const rows = [
    "PTF approval requested — review every line. Any change needs a new approval.",
    line("Action", d.action.name),
    ...bagLines("Action", d.action.properties),
    line("Actor", d.actor),
    ...(d.actorChain !== undefined && d.actorChain.length > 0
      ? [line("Actor chain", d.actorChain.map(sanitizeField).join(" -> "))]
      : []),
    line("Principal", d.principal),
    line("Resource", `${d.resource.type}:${d.resource.id}`),
    ...bagLines("Resource", d.resource.properties),
    ...(d.purpose !== undefined ? [line("Purpose", d.purpose)] : []),
    ...contextLines(d.context ?? {}),
    ...(view.expiresAt !== undefined && Number.isFinite(view.expiresAt)
      ? [
          line(
            "Expires",
            Number.isFinite(new Date(view.expiresAt * 1000).getTime())
              ? new Date(view.expiresAt * 1000).toISOString()
              : "(invalid expiry — confirm before approving)"
          ),
        ]
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
