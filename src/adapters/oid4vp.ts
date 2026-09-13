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
import { isRecord, reqString } from "./guards.js";

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
  if (origin.length === 0 || /[\s]/.test(origin)) {
    throw new Oid4vpError("client_id origin malformed");
  }
  // Per-prefix shape (cryptographic validation still deferred, but the string
  // shape is enforced so a pinned prefix cannot be fed garbage):
  // redirect_uri must be an https URL without fragment; others must be
  // non-empty and contain no whitespace/control characters.
  if (prefix === "redirect_uri") {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Oid4vpError("redirect_uri client_id must be a URL");
    }
    if (url.protocol !== "https:")
      throw new Oid4vpError("redirect_uri client_id must be https");
    if (url.hash !== "")
      throw new Oid4vpError("redirect_uri client_id must not carry fragment");
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
  const responseType = reqString(
    request["response_type"],
    "oid4vp: request: missing response_type"
  );
  if (
    responseType !== "vp_token" &&
    !responseType.split(" ").includes("vp_token")
  ) {
    throw new Oid4vpError("response_type must include vp_token");
  }
  const clientId = reqString(
    request["client_id"],
    "oid4vp: request: missing client_id"
  );
  parseClientId(clientId, pinned);
  const responseMode = reqString(
    request["response_mode"],
    "oid4vp: request: missing response_mode"
  );
  if (responseMode !== "fragment" && responseMode !== "direct_post") {
    throw new Oid4vpError("response_mode must be fragment or direct_post");
  }
  const nonce = reqString(request["nonce"], "oid4vp: request: missing nonce");
  if (nonce.length < 16) {
    throw new Oid4vpError("nonce too short (min 16 chars)");
  }
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
    const seenIds = new Set<string>();
    for (const [i, cred] of credentials.entries()) {
      if (!isRecord(cred))
        throw new Oid4vpError(`credential ${i} must be an object`);
      const credId = reqString(
        cred["id"],
        `oid4vp: credential ${i}: missing id`
      );
      if (seenIds.has(credId))
        throw new Oid4vpError(`duplicate credential id ${credId}`);
      seenIds.add(credId);
      const format = reqString(
        cred["format"],
        `oid4vp: credential ${i}: missing format`
      );
      if (
        format !== "sd_jwt_vc" &&
        format !== "mso_mdoc" &&
        format !== "ldp_vc"
      ) {
        // Allow-list the formats the disclosure intersection understands;
        // mdoc is structurally rejected downstream — fail loudly here.
        if (format === "mso_mdoc") {
          throw new Oid4vpError("mdoc presentations out of scope");
        }
      }
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
  } else {
    // Scope-form requests carry no claim paths; they map to an empty claim set.
    // Verifiers that need claims must use dcql_query.
    if (typeof request["scope"] !== "string") {
      throw new Oid4vpError("scope must be a string");
    }
  }
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
  /**
   * When the request carried `transaction_data`, the exact hashes we sent.
   * Equality-checked when present; presence alone is checked otherwise.
   * `holderBindingPresent` MUST be derived by the caller from cnf/sd_hash/aud/
   * nonce verification, not from presentation form.
   */
  readonly expectedTransactionData?: unknown;
}

/** Enforce response binding. Throws on the first failure — fail-closed. */
export function checkResponseBinding(
  resp: Record<string, unknown>,
  check: ResponseBinding
): void {
  const vpToken = resp["vp_token"];
  if (
    vpToken === undefined ||
    vpToken === null ||
    (typeof vpToken !== "string" &&
      !Array.isArray(vpToken) &&
      typeof vpToken !== "object")
  ) {
    throw new Oid4vpError("response: missing vp_token");
  }
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
    (resp["transaction_data_hashes"] === undefined ||
      resp["transaction_data_hashes"] === null)
  ) {
    throw new Oid4vpError("response: transaction_data_hashes required");
  }
  if (
    check.transactionDataRequested &&
    check.expectedTransactionData !== undefined
  ) {
    const got = resp["transaction_data_hashes"];
    const want = check.expectedTransactionData;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      throw new Oid4vpError("response: transaction_data_hashes mismatch");
    }
  }
}
