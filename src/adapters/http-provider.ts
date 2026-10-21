import type {
  ProviderKind,
  ProtectedProvider,
  ProviderRequest,
  ProviderSubmission,
} from "./providers.js";
import { checkRequest } from "./providers.js";
import {
  DEFAULT_TIMEOUT_MS,
  HttpWireError,
  assertEndpointUrl,
  assertSafeHeaders,
  buildTermsBody,
  httpCall,
  mergeHeaders,
  parseJsonObject,
  safeText,
  type TermsBody,
} from "./http-wire.js";

export { canonicalRequestBody } from "./http-wire.js";

/**
 * Signed JSON over HTTP — a `ProtectedProvider` transport (spec §2.1).
 *
 * The adapter carries the AUTHORIZED terms to a real endpoint: the terms
 * the approval covered, plus the capability id and the terms digest. It
 * never carries a secret — the credential stays in the host's `sign`
 * callback, which turns the canonical body into auth headers the server
 * can verify.
 *
 * Every failure is a failed effect: a non-2xx status, an unparsable body,
 * a missing external reference, a network error, a timeout, or a refused
 * attestation all throw. The adapter never returns a fabricated success.
 *
 * PTF decides; the endpoint executes (ADR-0009). The response is evidence:
 * hosts that need rail-side settlement proof still run the independent
 * checks (`checkSettlement`, `verifyMandatePair`) before trusting the
 * reference.
 */

export class HttpProviderError extends Error {
  constructor(reason: string) {
    super(`http-provider: ${reason}`);
  }
}

/** A diagnostic hook. It carries the status only — never the body, never headers. */
export interface HttpProviderDiagnostic {
  readonly phase: "request" | "response" | "error";
  readonly status?: number;
}

export interface HttpProviderOptions {
  readonly kind: ProviderKind;
  /**
   * The endpoint. A host constant, never a request term, and `https:`
   * unless the host opts into `allowInsecureHttp`.
   */
  readonly url: string;
  /**
   * Sign the request body; returns the auth headers. The second argument is
   * the canonical JSON of the body — the bytes that go on the wire. Sign
   * that string (HMAC, bearer, JWT — the host's choice) so the server can
   * recompute it from the body it received.
   */
  readonly sign: (
    body: Readonly<Record<string, unknown>>,
    canonical: string
  ) => Record<string, string> | Promise<Record<string, string>>;
  /** Map the provider's response into a submission. Throwing = a failed effect. */
  readonly interpret: (
    response: Readonly<Record<string, unknown>>,
    status: number
  ) => {
    readonly externalRef: string;
    readonly detail?: Readonly<Record<string, unknown>>;
  };
  /** Verify the response attests the exact terms (optional but recommended). */
  readonly verifyAttestation?: (
    response: Readonly<Record<string, unknown>>,
    expected: {
      readonly capabilityId: string;
      readonly termsDigest: string;
    }
  ) => { readonly ok: true } | { readonly ok: false; readonly reason: string };
  /** Static headers (a secret never rides in the body — headers are the host's own). */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * The idempotency key sent as a header. Defaults to the terms digest.
   * A header, not a body key: the body stays exactly the terms plus the
   * binding fields.
   */
  readonly idempotencyKey?: string;
  /**
   * Allow an `http:` endpoint (a local test server). Off by default.
   */
  readonly allowInsecureHttp?: boolean;
  readonly method?: "POST" | "PUT";
  readonly fetchImpl?: typeof fetch;
  /** The whole submit gets this deadline. Defaults to 30s. */
  readonly timeoutMs?: number;
  readonly nowSec?: () => number;
  /** Rail scope for journal keying. Defaults to the kind. */
  readonly namespace?: string;
  /** Opt-in diagnostics. Status only: the adapter never logs a body. */
  readonly onDiagnostic?: (event: HttpProviderDiagnostic) => void;
}

/**
 * The submission carries the seam's fixed field set plus the host's
 * non-secret detail. `ProviderSubmission` does not declare `detail`, so a
 * caller typed against the seam reads it from the concrete object.
 */
export interface HttpProviderSubmission extends ProviderSubmission {
  readonly detail?: Readonly<Record<string, unknown>>;
}

function hostMessage(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  return "unknown error";
}

function requireExternalRef(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 256) {
    throw new HttpProviderError("response carried no usable externalRef");
  }
  return raw;
}

function buildOrThrow(req: ProviderRequest): TermsBody {
  try {
    return buildTermsBody(req.context, req.capabilityId, req.termsDigest);
  } catch (err) {
    throw new HttpProviderError(
      err instanceof HttpWireError ? err.reason : "invalid request"
    );
  }
}

/**
 * Build the HTTP transport. The returned provider submits the authorized
 * terms and verifies the reference it gets back; it never decides anything
 * about authority.
 */
export function createHttpProvider(
  opts: HttpProviderOptions
): ProtectedProvider {
  const method = opts.method ?? "POST";
  const kind = opts.kind;
  const namespace = opts.namespace;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    assertEndpointUrl(opts.url, opts.allowInsecureHttp === true);
  } catch (err) {
    throw new HttpProviderError(
      err instanceof HttpWireError ? err.reason : "invalid endpoint url"
    );
  }

  function diagnose(event: HttpProviderDiagnostic): void {
    try {
      opts.onDiagnostic?.(event);
    } catch {
      // A broken diagnostic hook must not change the effect's outcome.
    }
  }

  async function submit(req: ProviderRequest): Promise<HttpProviderSubmission> {
    // The seam's own request rule applies on the direct-call path too.
    checkRequest(req);
    const built = buildOrThrow(req);

    let signed: Record<string, string>;
    try {
      signed = await opts.sign(built.body, built.canonical);
    } catch (err) {
      throw new HttpProviderError(
        `signing failed: ${safeText(hostMessage(err))}`
      );
    }
    if (
      typeof signed !== "object" ||
      signed === null ||
      Array.isArray(signed)
    ) {
      throw new HttpProviderError("sign must return a header record");
    }

    const staticHeaders = opts.headers ?? {};
    let headers: Record<string, string>;
    try {
      // Both host-supplied sets are checked: the framing headers and the
      // content type belong to the adapter, not to the host. The host's
      // static headers go in before the signed ones, so the signed ones
      // win.
      assertSafeHeaders(staticHeaders, "request headers");
      assertSafeHeaders(signed, "signed headers");
      headers = mergeHeaders(
        {
          "content-type": "application/json",
          "idempotency-key": opts.idempotencyKey ?? req.termsDigest,
        },
        staticHeaders,
        signed
      );
      assertSafeHeaders(headers, "request headers", {
        allowContentType: true,
      });
    } catch (err) {
      throw new HttpProviderError(
        err instanceof HttpWireError ? err.reason : "invalid headers"
      );
    }

    diagnose({ phase: "request" });
    let result;
    try {
      result = await httpCall({
        url: opts.url,
        method,
        headers,
        body: built.canonical,
        timeoutMs,
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      });
    } catch (err) {
      diagnose({ phase: "error" });
      throw new HttpProviderError(
        err instanceof HttpWireError ? err.reason : "request failed"
      );
    }
    diagnose({ phase: "response", status: result.status });

    if (!result.ok) {
      throw new HttpProviderError(`unexpected status ${result.status}`);
    }
    let response: Record<string, unknown>;
    try {
      response = parseJsonObject(result.text, `status ${result.status}`);
    } catch (err) {
      throw new HttpProviderError(
        err instanceof HttpWireError ? err.reason : "unreadable response"
      );
    }

    if (opts.verifyAttestation !== undefined) {
      let attested:
        { readonly ok: true } | { readonly ok: false; readonly reason: string };
      try {
        attested = opts.verifyAttestation(response, {
          capabilityId: req.capabilityId,
          termsDigest: req.termsDigest,
        });
      } catch (err) {
        throw new HttpProviderError(
          `attestation check failed: ${safeText(hostMessage(err))}`
        );
      }
      if (attested.ok !== true) {
        throw new HttpProviderError(
          `attestation failed: ${safeText(attested.reason ?? "unknown reason")}`
        );
      }
    }

    let interpreted: {
      readonly externalRef: string;
      readonly detail?: Readonly<Record<string, unknown>>;
    };
    try {
      interpreted = opts.interpret(response, result.status);
    } catch (err) {
      throw new HttpProviderError(
        `response rejected: ${safeText(hostMessage(err))}`
      );
    }
    const externalRef = requireExternalRef(interpreted.externalRef);
    const now = opts.nowSec?.() ?? Math.floor(Date.now() / 1000);
    return {
      kind,
      capabilityId: req.capabilityId,
      termsDigest: req.termsDigest,
      externalRef,
      at: now,
      ...(interpreted.detail !== undefined
        ? { detail: interpreted.detail }
        : {}),
    };
  }

  function verify(
    sub: ProviderSubmission,
    expected: { readonly capabilityId: string; readonly termsDigest: string }
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
    if (typeof sub !== "object" || sub === null) {
      return { ok: false, reason: "malformed submission" };
    }
    if (sub.kind !== kind) return { ok: false, reason: "kind mismatch" };
    if (sub.capabilityId !== expected.capabilityId) {
      return { ok: false, reason: "capability mismatch" };
    }
    if (sub.termsDigest !== expected.termsDigest) {
      return { ok: false, reason: "terms mismatch" };
    }
    if (
      typeof sub.externalRef !== "string" ||
      sub.externalRef.length === 0 ||
      sub.externalRef.length > 256
    ) {
      return { ok: false, reason: "missing externalRef" };
    }
    return { ok: true };
  }

  return {
    kind,
    ...(namespace !== undefined ? { namespace } : {}),
    submit,
    verify,
  };
}
