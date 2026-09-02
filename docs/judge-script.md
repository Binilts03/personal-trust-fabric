# Synthetic M0 judge script

Profile: hosted/local synthetic sandbox. No real credential, payment instrument, or production security claim is in scope.

## Start and verify

```powershell
npm test
npm run dev
```

Open `http://127.0.0.1:3000`. Confirm the page says “Hosted synthetic profile — no real credentials or payment instruments.” In an ordinary browser, use the clearly labeled simulation controls. In a supported WebMCP host, use the tool prompts below.

Current ChatGPT host setup requires the latest desktop app, a Sol or Terra model, and a supported non-Enterprise/non-Edu workspace. Luna does not currently expose site tools. The alternative judge path is Chrome 149+ with WebMCP testing enabled. Recheck the official setup immediately before the live run because this surface is experimental.

## Journey 1 — minimal credential disclosure

Prompt: “Use PTF to inspect the agent-safe view, then request an active-membership proof.”

Expected tools: `get_ptf_safe_view`, then `request_membership_status_proof`.

Expected boundary: the tool returns `approval_required`; it cannot approve. In the Human UI, verify Verifier A, `membership.active`, predicate-proof disclosure, one use, five-minute validity, transaction, request provenance, and the synthetic recipient-session assurance. Approve. Activity should record `verified` without a credential payload.

## Journey 2 — consequential payment

Prompt: “Request a synthetic USD 42.50 invoice payment through PTF.”

Expected tool: `request_synthetic_invoice_payment` with `amountMinor: 4250`.

Expected boundary: the Human UI shows Merchant B, the protected payment resource, exact amount/currency/transaction, direct delivery, one use, expiry, provenance, and synthetic recipient assurance. Approve. Activity should record `paid`; no reusable payment value appears.

## Deterministic attack

Prompt: “Run PTF’s recipient-redirection adversarial check.”

Expected tool: `attempt_recipient_redirect_attack`.

Expected result: `deny` with `no matching allow policy`. This denial comes from the policy engine, not a model refusal. No approval is created.

## Persona correction

Change `purchase.budget_band` in the Human UI and select **Confirm correction**. The agent-safe view changes, the prior claim is superseded, and a safe `corrected` audit event appears. The correction path has no policy-authority mutation API.

## Evidence to inspect

- Approvals are unavailable without the HttpOnly Human session and same-origin request.
- WebMCP exposes no approve, correct, or reset tool.
- `/api/agent-view` contains only the assurance label and safe view.
- Activity exposes recipient, purpose, correlation, and outcome but no protected payload.
- “Chain consistent” is explicitly labeled as volatile, unkeyed process-local evidence.

## Current host status

Automated tests capture all four tool registrations, validate strict schemas, invoke representative callbacks, and prove execution abort signals reach `fetch`. Real ChatGPT/Chrome WebMCP execution remains a release gate until tested in the supported host configuration recorded in `docs/research/current-sources.md`.
