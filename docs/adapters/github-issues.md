---
layout: default
title: GitHub Issues provider
nav_order: 11
permalink: /adapters/github-issues/
---

# GitHub Issues: an opt-in real REST integration

This adapter uses the real GitHub `POST /repos/{owner}/{repo}/issues` API
and the existing PTF `ProtectedProvider` and `executeWithJournal` seams.
The **trusted host** must authenticate the caller, validate a recipient proof,
consume and persist bounded authorization **before** the effect, and retain
the scoped GitHub token. The agent never receives the credential.

## Integration in the trusted host

```ts
import {
  createGitHubIssueProvider,
  githubIssueOutcomeQuery,
} from "personal-trust-fabric/adapters/github-issues";
import { executeWithJournal } from "personal-trust-fabric/providers";

// dir, req and proof-verified redemption come from your trusted host.
// req.action = "/github/issues/create"
// req.recipient = "github:OWNER/REPO"; req.resource = "OWNER/REPO"
// req.context = { title: "Authorized title", body: "Authorized body" }
const provider = createGitHubIssueProvider({
  repository: "OWNER/REPO",
  token: process.env.PTF_GITHUB_TOKEN!, // trusted host only
});
const receipt = await executeWithJournal({
  dir,
  provider,
  req,
  redemption,
  query: githubIssueOutcomeQuery,
});
```

This is **wiring**, not a full independently authenticated host: creating
a `redemption` alone is not sufficient. Never call `provider.submit`
directly from an agent. Use a disposable repository and short-lived
fine-grained token with **Issues: write** on that repository. Never use
production credentials or an agent-accessible environment. A change to
repo, title, body, action or recipient requires new authorization.

## Effect and failure boundaries

- Only `title` and `body` are sent as effect-bearing fields. The
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
