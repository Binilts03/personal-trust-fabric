---
layout: default
title: GitHub Issues provider
nav_order: 11
permalink: /adapters/github-issues/
---

# GitHub Issues: an opt-in real REST integration

This adapter uses the real GitHub `POST /repos/{owner}/{repo}/issues` API
and PTF's `ProtectedProvider` and execution-journal seams. Registered MCP effects use the shared `createProtectedEffect` Host Kit; a direct journal call alone does not authorize an agent or apply privacy processing.
The **trusted host** must authenticate the caller, validate a recipient proof,
consume and persist bounded authorization **before** the effect, and retain
the scoped GitHub token. The agent never receives the credential. For registered MCP operation tests,
the `github:OWNER/REPO` recipient proof uses a **locally provisioned PTF key**.
GitHub does not sign PTF recipient challenges; that proof establishes the
host's local enrollment, not independent GitHub consent or attestation.
A production host must explicitly determine who controls that recipient key.

## Integration in the trusted host

```ts
import { createGitHubIssueProvider } from "personal-trust-fabric/adapters/github-issues";

// The repo and token are fixed by a trusted host, never selected by an agent.
const provider = createGitHubIssueProvider({
  repository: "OWNER/REPO",
  token: process.env.PTF_GITHUB_TOKEN!, // trusted host only
});

// Supply this provider as part of an exact /github/issues/create registration
// with an effect-bearing validator and trusted processing policy.
// Create a trusted action registration and pass it to createPtfServer.
// This example only constructs the provider; it does not submit an issue.
```

This is **adapter wiring**, not an independently authenticated host. The embedding host must validate repository, recipient, action, title and body, configure applicable privacy processing, authenticate ingress, verify recipient proof and route execution through Host Kit. See `tests/mcp-registered-actions.test.ts` for the exercised controlled-HTTP path. Never call `provider.submit`
directly from an agent. Use a disposable repository and short-lived
fine-grained token with **Issues: write** on that repository. Never use
production credentials or an agent-accessible environment. A change to
repo, title, body, action or recipient requires new authorization.

## Effect and failure boundaries

- Only `title` and `body` are sent as effect-bearing fields. A trusted
  MCP host may also bind `context.recipient` to the exact `req.recipient`;
  it is verified but never transmitted as an issue field. The
  repository is fixed by the trusted host. Labels, assignees, arbitrary
  URLs and extra arguments are rejected.
- Redirects are refused, responses are capped, POSTs have a deadline, and
  success requires a GitHub `201` response with the exact repository,
  issue number, URLs, title and body. Receipts contain only a reference.
- The host token is sent **only in the Authorization header** and is not
  written to agent outputs, PTF receipts, journal contexts or error text.
  The host must separately keep its own logs and runtime secure.
- GitHub does not guarantee an idempotency key for issue creation. An
  ambiguous outcome cannot safely be treated as absent. The included
  `githubIssueOutcomeQuery` returns `unknown` to quarantine, rather than
  automatically submitting a duplicate. Reconcile with independent
  provider-side evidence and operator action.
- Operations outside the configured PTF effect boundary are **uncovered**.

CI tests the real adapter's HTTP shape using isolated deterministic
responses, including adversarial cases. CI does **not** create a live issue,
validate external credentials, verify an independent user deployment,
or certify production security. A genuine live provider trial still
requires a disposable authorized GitHub repository and scoped token.

[GitHub REST specification](https://docs.github.com/en/rest/issues/issues#create-an-issue)
· [Adoption validation]({{ '/adoption-validation/' | relative_url }})
· [Known limitations]({{ '/audit/limits/' | relative_url }})
