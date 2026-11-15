import type { ProtectedProvider, ProviderRequest, ProviderSubmission, ExecutionQuery } from "./providers.js";
import { checkRequest } from "./providers.js";
import { httpCall, parseJsonObject } from "./http-wire.js";

/** A single real GitHub REST effect. Identity, approval, consumption and the
 * journal stay in the trusted PTF host; never expose submit to an agent. */
export interface GitHubIssueProviderOptions {
  readonly repository: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly nowSec?: () => number;
}

const REPOSITORY = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_][A-Za-z0-9_.-]{0,99})$/;
const ACTION = "/github/issues/create";

function exactIssue(req: ProviderRequest, repository: string): { readonly title: string; readonly body: string } {
  checkRequest(req);
  if (req.action !== ACTION || req.resource !== repository || req.recipient !== `github:${repository}`) {
    throw new Error("github-issues: operation target mismatch");
  }
  const c = req.context;
  if (
    !["body,title", "body,recipient,title"].includes(Object.keys(c).sort().join(",")) ||
    ("recipient" in c && c["recipient"] !== req.recipient) ||
    typeof c["title"] !== "string" || c["title"].length === 0 || c["title"].length > 256 ||
    typeof c["body"] !== "string" || c["body"].length === 0 || c["body"].length > 4096
  ) {
    throw new Error("github-issues: only exact title and body are supported");
  }
  return { title: c["title"], body: c["body"] };
}

/** GitHub has no guaranteed issue-creation idempotency API. Never retry an
 * unknown POST based on issue search; require manual reconciliation. */
export const githubIssueOutcomeQuery: ExecutionQuery = {
  async query() { return { state: "unknown" }; },
};

export function createGitHubIssueProvider(opts: GitHubIssueProviderOptions): ProtectedProvider {
  const repository = opts.repository;
  if (!REPOSITORY.test(repository) || repository.includes("..")) {
    throw new Error("github-issues: invalid repository");
  }
  if (typeof opts.token !== "string" || opts.token.length === 0 ||
      opts.token.length > 4096 || /\s/.test(opts.token)) {
    throw new Error("github-issues: invalid token configuration");
  }
  const timeoutMs = opts.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("github-issues: invalid timeout");
  }
  const api = `https://api.github.com/repos/${repository}`;
  const prefix = `github:${repository}#`;
  return {
    kind: "task",
    namespace: "github-issues",
    async submit(req: ProviderRequest): Promise<ProviderSubmission> {
      const issue = exactIssue(req, repository);
      let data: Record<string, unknown>;
      try {
        const response = await httpCall({
          url: `${api}/issues`, method: "POST", body: JSON.stringify(issue),
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${opts.token}`,
            "content-type": "application/json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "personal-trust-fabric",
          },
          timeoutMs,
          ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
        });
        if (response.status !== 201) throw new Error("unexpected status");
        data = parseJsonObject(response.text, "create issue");
      } catch {
        // A lost response may follow a successful POST. Do not print the raw
        // error, token, issue body or provider response.
        throw new Error("github-issues: submission outcome unverified");
      }
      const number = data["number"];
      const id = data["id"];
      if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0 ||
          typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 ||
          data["title"] !== issue.title || data["body"] !== issue.body ||
          data["repository_url"] !== api ||
          data["url"] !== `${api}/issues/${number}` ||
          data["html_url"] !== `https://github.com/${repository}/issues/${number}` ||
          "pull_request" in data) {
        throw new Error("github-issues: response attestation failed");
      }
      return {
        kind: "task", capabilityId: req.capabilityId,
        termsDigest: req.termsDigest, externalRef: `${prefix}${number}`,
        at: opts.nowSec?.() ?? Math.floor(Date.now() / 1000),
      };
    },
    verify(sub: ProviderSubmission, expected: { readonly capabilityId: string; readonly termsDigest: string }) {
      if (sub === null || typeof sub !== "object" || sub.kind !== "task" ||
          sub.capabilityId !== expected.capabilityId ||
          sub.termsDigest !== expected.termsDigest ||
          typeof sub.externalRef !== "string" || !sub.externalRef.startsWith(prefix) ||
          !/^[1-9][0-9]*$/.test(sub.externalRef.slice(prefix.length)) ||
          !Number.isSafeInteger(Number(sub.externalRef.slice(prefix.length))) ||
          sub.externalRef.length > 256) {
        return { ok: false as const, reason: "github issue receipt mismatch" };
      }
      return { ok: true as const };
    },
  };
}
