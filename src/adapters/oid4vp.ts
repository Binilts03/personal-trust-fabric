/**
 * OpenID4VP request/response adapter — evidence in, never authority out.
 * Reduces an authorization request to a bounded disclosure demand and enforces
 * response binding. Follows the deep read
 * (`docs/research/2026-09-09-deep-identity-openid4vp-sdjwt.md`):
 * DCQL `values` matching is NOT security-relevant (enforcement lives in the
 * allow-list intersection), and the KB requirement comes from per-recipient
 * policy — never inferred from presentation form (RFC 9901 §9.5 downgrade rule).
 *
 * Documented limits: full cryptographic validation of x509/DID/attestation
 * `client_id` prefixes, mdoc presentations, DCQL nested paths and `claim_sets`
 * combinatorics are rejected explicitly, not half-checked.
 */

export class Oid4vpError extends Error {
  constructor(reason: string) {
    super(`oid4vp: ${reason}`);
  }
}

export type ClientIdPrefix =
  | "redirect_uri"
  | "x509_san_dns"
  | "x509_hash"
  | "decentralized_identifier"
  | "verifier_attestation"
  | "openid_federation";

const KNOWN_PREFIXES: readonly string[] = [
  "redirect_uri",
  "x509_san_dns",
  "x509_hash",
  "decentralized_identifier",
  "verifier_attestation",
  "openid_federation",
];

export interface PinnedPrefixes {
  /** Prefix types this deployment accepts (shape-checked only; see limits above). */
  readonly allowed: readonly ClientIdPrefix[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(
  obj: Record<string, unknown>,
  field: string,
  what: string
): string {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0)
    throw new Oid4vpError(`${what}: missing ${field}`);
  return v;
}

/** Shape-check the client_id and confirm its prefix type is locally pinned. */
export function parseClientId(
  clientId: string,
  pinned: PinnedPrefixes
): { prefix: ClientIdPrefix; origin: string } {
  const sep = clientId.indexOf(":");
  if (sep <= 0 || sep === clientId.length - 1)
    throw new Oid4vpError("client_id must be prefix:origin");
  const prefix = clientId.slice(0, sep);
  const origin = clientId.slice(sep + 1);
  if (!KNOWN_PREFIXES.includes(prefix))
    throw new Oid4vpError(`unknown client_id prefix ${prefix}`);
  if (!(pinned.allowed as readonly string[]).includes(prefix)) {
    throw new Oid4vpError(
      `client_id prefix ${prefix} not pinned by this deployment`
    );
  }
  return { prefix: prefix as ClientIdPrefix, origin };
}

export interface DisclosureDemandInput {
  readonly verifier: string;
  readonly nonce: string;
  /** Top-level claim keys only. */
  readonly requested: readonly string[];
  readonly transactionData: boolean;
}

/** Validate the request and map DCQL top-level claim paths to a bounded demand. */
export function requestToDisclosureDemand(
  request: Record<string, unknown>,
  pinned: PinnedPrefixes
): DisclosureDemandInput {
  const responseType = reqString(request, "response_type", "request");
  if (!responseType.split(" ").includes("vp_token")) {
    throw new Oid4vpError("response_type must include vp_token");
  }
  const clientId = reqString(request, "client_id", "request");
  parseClientId(clientId, pinned);
  reqString(request, "response_mode", "request");
  const nonce = reqString(request, "nonce", "request");
  const hasDcql = request["dcql_query"] !== undefined;
  const hasScope = request["scope"] !== undefined;
  if (hasDcql === hasScope)
    throw new Oid4vpError("exactly one of dcql_query/scope required");

  let requested: string[] = [];
  if (hasDcql) {
    const dcql = request["dcql_query"];
    if (!isRecord(dcql)) throw new Oid4vpError("dcql_query must be an object");
    if (dcql["claim_sets"] !== undefined) {
      throw new Oid4vpError(
        "claim_sets combinatorics out of scope: use flat claims"
      );
    }
    const credentials = dcql["credentials"];
    if (!Array.isArray(credentials) || credentials.length === 0) {
      throw new Oid4vpError("dcql_query.credentials must be non-empty");
    }
    const names = new Set<string>();
    for (const [i, cred] of credentials.entries()) {
      if (!isRecord(cred))
        throw new Oid4vpError(`credential ${i} must be an object`);
      reqString(cred, "id", `credential ${i}`);
      reqString(cred, "format", `credential ${i}`);
      const claims = cred["claims"];
      if (claims === undefined) continue;
      if (!Array.isArray(claims))
        throw new Oid4vpError(`credential ${i}: claims must be an array`);
      for (const [j, claim] of claims.entries()) {
        if (!isRecord(claim))
          throw new Oid4vpError(`credential ${i} claim ${j} must be an object`);
        const path = claim["path"];
        if (
          !Array.isArray(path) ||
          path.length !== 1 ||
          typeof path[0] !== "string"
        ) {
          throw new Oid4vpError(
            `credential ${i} claim ${j}: only top-level key paths supported`
          );
        }
        names.add(path[0] as string);
      }
    }
    requested = [...names];
  }
  // Scope-form requests carry no claim paths; they map to an empty claim set.
  // Verifiers that need claims must use dcql_query.
  return {
    verifier: clientId,
    nonce,
    requested,
    transactionData:
      request["transaction_data"] !== undefined &&
      request["transaction_data"] !== null,
  };
}

export interface ResponseBinding {
  readonly expectedNonce: string;
  readonly expectedAud: string;
  /** The state value we sent. Required echo when the presentation has no holder binding. */
  readonly stateSent?: string;
  readonly transactionDataRequested: boolean;
  readonly holderBindingPresent: boolean;
  /** From per-recipient policy. Never inferred from the presentation (downgrade rule). */
  readonly kbRequired: boolean;
}

/** Enforce response binding. Throws on the first failure — fail-closed. */
export function checkResponseBinding(
  resp: Record<string, unknown>,
  check: ResponseBinding
): void {
  if (resp["vp_token"] === undefined)
    throw new Oid4vpError("response: missing vp_token");
  if (resp["nonce"] !== check.expectedNonce)
    throw new Oid4vpError("response: nonce mismatch");
  if (resp["aud"] !== check.expectedAud)
    throw new Oid4vpError("response: audience mismatch");
  if (check.kbRequired && !check.holderBindingPresent) {
    throw new Oid4vpError("response: key binding required by policy");
  }
  if (!check.holderBindingPresent) {
    if (check.stateSent === undefined || resp["state"] !== check.stateSent) {
      throw new Oid4vpError(
        "response: state echo required without holder binding"
      );
    }
  }
  if (
    check.transactionDataRequested &&
    resp["transaction_data_hashes"] === undefined
  ) {
    throw new Oid4vpError("response: transaction_data_hashes required");
  }
}
